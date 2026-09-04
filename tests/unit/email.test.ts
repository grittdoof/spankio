import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPlausibleEmail, sendEmail } from '@/lib/email/resend';
import { renderEmail, safeHexColor } from '@/lib/email/templates/layout';
import {
  membershipApprovedEmail,
  membershipRejectedEmail,
  membershipRequestReceivedEmail,
} from '@/lib/email/templates/membership';
import { resetLogSink, setLogSink, type LogRecord } from '@/lib/logger';

let logs: LogRecord[] = [];

beforeEach(() => {
  logs = [];
  setLogSink((record) => logs.push(record));
});

afterEach(() => {
  resetLogSink();
  vi.restoreAllMocks();
});

const configured = { apiKey: 're_test', from: 'Plateforme <no-reply@exemple.test>' };

const message = {
  to: 'destinataire@exemple.test',
  subject: 'Sujet',
  html: '<p>Corps</p>',
  text: 'Corps',
};

describe('sendEmail : dégradation silencieuse', () => {
  it('ne lève jamais et signale une configuration absente', async () => {
    const result = await sendEmail(message, { apiKey: undefined, from: undefined });
    expect(result).toEqual({ sent: false, reason: 'not_configured' });
    expect(logs.some((l) => l.event === 'email.not_configured')).toBe(true);
  });

  it('exige la clé ET l’expéditeur', async () => {
    expect((await sendEmail(message, { apiKey: 're_test', from: undefined })).sent).toBe(false);
    expect((await sendEmail(message, { apiKey: undefined, from: 'a@b.test' })).sent).toBe(false);
  });

  it('refuse un destinataire invalide sans appeler Resend', async () => {
    const fetchMock = vi.fn();
    const result = await sendEmail({ ...message, to: 'pas-une-adresse' }, { ...configured, fetch: fetchMock });
    expect(result).toEqual({ sent: false, reason: 'invalid_recipient' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renvoie sent:false sur erreur HTTP, sans lever', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 403 }));
    const result = await sendEmail(message, { ...configured, fetch: fetchMock });
    expect(result).toEqual({ sent: false, reason: 'http_error', status: 403 });
    expect(logs.some((l) => l.level === 'error' && l.event === 'email.send_failed')).toBe(true);
  });

  it('renvoie sent:false sur panne réseau, sans lever', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    const result = await sendEmail(message, { ...configured, fetch: fetchMock });
    expect(result).toEqual({ sent: false, reason: 'network_error' });
    expect(logs.some((l) => l.level === 'error' && l.event === 'email.network_error')).toBe(true);
  });

  it('envoie via l’API REST, sans SDK, et renvoie l’identifiant', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'msg_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const result = await sendEmail({ ...message, replyTo: 'contact@exemple.test' }, {
      ...configured,
      fetch: fetchMock,
    });

    expect(result).toEqual({ sent: true, id: 'msg_1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_test');
    expect(typeof init.body).toBe('string');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.from).toBe(configured.from);
    expect(body.to).toEqual(['destinataire@exemple.test']);
    expect(body.reply_to).toBe('contact@exemple.test');
  });

  it('filtre les adresses implausibles', () => {
    expect(isPlausibleEmail('a@b.test')).toBe(true);
    expect(isPlausibleEmail('a@b')).toBe(false);
    expect(isPlausibleEmail('a b@c.test')).toBe(false);
    expect(isPlausibleEmail(42)).toBe(false);
    expect(isPlausibleEmail(`${'x'.repeat(400)}@b.test`)).toBe(false);
  });
});

describe('gabarit d’email', () => {
  const branding = {
    organisationName: 'Organisation Témoin',
    contactEmail: 'contact@temoin.test',
  };

  it('échappe le nom de l’organisation (branding = donnée non fiable)', () => {
    const { html } = renderEmail({
      title: 'Titre',
      preheader: 'Aperçu',
      blocks: [],
      branding: { organisationName: '<script>alert(1)</script>' },
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('échappe le contenu des paragraphes et des citations', () => {
    const { html, text } = renderEmail({
      title: 'Titre',
      preheader: 'Aperçu',
      branding,
      blocks: [{ paragraph: '<img onerror=x>' }, { quote: '"guillemets" & <balises>' }],
    });
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;img onerror=x&gt;');
    expect(text).toContain('« "guillemets" & <balises> »');
  });

  it('rejette une URL de logo ou de bouton non http(s)', () => {
    const { html } = renderEmail({
      title: 'Titre',
      preheader: 'Aperçu',
      branding: { ...branding, logoUrl: 'javascript:alert(1)' },
      blocks: [{ action: { label: 'Cliquer', url: 'javascript:alert(2)' } }],
    });
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('Cliquer');
    // Repli sur le nom textuel quand le logo est refusé.
    expect(html).toContain('Organisation Témoin');
  });

  it('n’accepte qu’une couleur hexadécimale comme accent', () => {
    expect(safeHexColor('#123ABC', '#000000')).toBe('#123ABC');
    expect(safeHexColor('#fff', '#000000')).toBe('#fff');
    expect(safeHexColor('red; background:url(x)', '#000000')).toBe('#000000');
    expect(safeHexColor(undefined, '#2F6FDB')).toBe('#2F6FDB');
  });

  it('produit toujours une version texte', () => {
    const { text } = renderEmail({
      title: 'Titre',
      preheader: 'Aperçu',
      branding,
      blocks: [{ paragraph: 'Bonjour' }, { bullets: ['un', 'deux'] }],
      legalLinks: [{ label: 'Confidentialité', url: 'https://exemple.test/confidentialite' }],
    });
    expect(text).toContain('Titre');
    expect(text).toContain('- un');
    expect(text).toContain('Confidentialité : https://exemple.test/confidentialite');
  });
});

describe('emails du parcours de rattachement', () => {
  const context = {
    branding: {
      organisationName: 'Organisation Témoin',
      accentColor: '#2F6FDB',
      contactEmail: 'contact@temoin.test',
      contactPhone: '01 02 03 04 05',
    },
    siteUrl: 'https://exemple.test/',
    legalLinks: [{ label: 'Confidentialité', url: 'https://exemple.test/confidentialite' }],
  };

  it('notifie le super administrateur avec le contexte de la demande', () => {
    const mail = membershipRequestReceivedEmail(
      {
        requesterName: 'Camille Martin',
        requesterEmail: 'camille@exemple.test',
        organisationLabel: 'Organisation Témoin',
        requestedRole: 'editor',
        message: 'Je gère les inscriptions.',
      },
      context,
    );
    expect(mail.subject).toBe('Demande de rattachement — Organisation Témoin');
    expect(mail.text).toContain('Camille Martin');
    expect(mail.text).toContain('éditeur');
    expect(mail.text).toContain('Je gère les inscriptions.');
    expect(mail.html).toContain('/super-admin/demandes');
  });

  it('annonce l’acceptation avec le rôle et les modules accordés', () => {
    const mail = membershipApprovedEmail(
      {
        recipientName: 'Camille Martin',
        organisationName: 'Organisation Témoin',
        role: 'editor',
        moduleNames: ['Sondages', 'Événements et inscriptions'],
      },
      context,
    );
    expect(mail.subject).toBe('Accès accordé — Organisation Témoin');
    expect(mail.text).toContain('éditeur');
    expect(mail.text).toContain('Événements et inscriptions');
    expect(mail.html).toContain('/admin');
  });

  it('indique le module de base quand aucun module optionnel n’est accordé', () => {
    const mail = membershipApprovedEmail(
      {
        recipientName: null,
        organisationName: 'Organisation Témoin',
        role: 'viewer',
        moduleNames: [],
      },
      context,
    );
    expect(mail.text).toContain('module de base');
    expect(mail.text).toContain('Bonjour,');
  });

  it('motive le refus et laisse une porte de sortie', () => {
    const mail = membershipRejectedEmail(
      {
        recipientName: 'Camille',
        organisationLabel: 'Organisation Témoin',
        note: 'Adresse non reconnue.',
        contactEmail: 'contact@temoin.test',
      },
      context,
    );
    expect(mail.text).toContain('Adresse non reconnue.');
    expect(mail.text).toContain('contact@temoin.test');
    expect(mail.text).toContain('reste actif');
  });

  it('n’emploie aucun vocabulaire sectoriel', () => {
    const mails = [
      membershipRequestReceivedEmail(
        {
          requesterName: null,
          requesterEmail: 'a@b.test',
          organisationLabel: 'X',
          requestedRole: 'admin',
        },
        context,
      ),
      membershipApprovedEmail(
        { recipientName: null, organisationName: 'X', role: 'admin', moduleNames: [] },
        context,
      ),
      membershipRejectedEmail({ recipientName: null, organisationLabel: 'X' }, context),
    ];
    const interdits = /mairie|commune|citoyen|entreprise|association|administré|élu/i;
    for (const mail of mails) {
      expect(mail.text).not.toMatch(interdits);
      expect(mail.subject).not.toMatch(interdits);
    }
  });
});
