import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EmailMessage, EmailResult } from '@/lib/email/resend';
import {
  approveMembershipRequest,
  createMembershipRequest,
  rejectMembershipRequest,
} from '@/lib/services/membership';
import type { RequestContext } from '@/lib/data/context';
import { OWNER, asUser, createTestDb, type TestDb } from '../helpers/db';
import { createPglitePort } from '../helpers/pglite-port';
import { activateMember, createAccount, createOrganisation } from '../helpers/seed';

/**
 * Contenu des emails de décision.
 *
 * Les routes ne peuvent pas le vérifier : elles n'injectent pas d'expéditeur,
 * donc l'email ne part pas en test (et c'est le comportement voulu). On teste
 * donc le service avec un expéditeur simulé, en gardant la vraie base.
 */
describe('emails du service de rattachement', () => {
  let db: TestDb;
  let orgId: string;
  let superAdmin: string;
  let sent: EmailMessage[];

  const sendEmail = (message: EmailMessage): Promise<EmailResult> => {
    sent.push(message);
    return Promise.resolve({ sent: true, id: 'msg_test' });
  };

  const contextFor = (userId: string, email: string): RequestContext => ({
    port: createPglitePort(db, asUser(userId)),
    userId,
    email,
  });

  beforeAll(async () => {
    db = await createTestDb();
    orgId = await createOrganisation(db, 'org-mail', 'Organisation Courrier');
    await db.query(
      OWNER,
      `update public.organisations
          set logo_url = 'https://cdn.exemple.test/logo.png',
              brand = '{"accent": "#123ABC"}'::jsonb,
              contact_email = 'contact@courrier.test',
              contact_phone = '01 02 03 04 05'
        where id = $1`,
      [orgId],
    );
    await db.query(
      OWNER,
      `insert into public.organisation_modules (organisation_id, module_key)
       values ($1, 'event') on conflict do nothing`,
      [orgId],
    );
    await db.query(
      OWNER,
      "update public.platform_settings set notifications_email = 'plateforme@exemple.test' where id = 1",
    );

    superAdmin = await createAccount(db, 'super@mail.test', 'Super Admin');
    await activateMember(db, superAdmin, null, 'super_admin');
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  beforeEach(() => {
    sent = [];
  });

  async function newRequest(email: string, name: string): Promise<{ id: string; user: string }> {
    const user = await createAccount(db, email, name);
    const context = contextFor(user, email);
    const created = await createMembershipRequest(
      context,
      { organisationId: orgId, requestedRole: 'editor', message: 'Je gère les inscriptions.' },
      { sendEmail, siteUrl: 'https://sondages.exemple.test' },
    );
    if (!created.ok) throw new Error(`Création impossible : ${created.error.code}`);
    return { id: created.value.request.id, user };
  }

  it('notifie la plateforme, en réponse au demandeur', async () => {
    await newRequest('camille@mail.test', 'Camille Martin');

    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.to).toBe('plateforme@exemple.test');
    expect(mail.replyTo).toBe('camille@mail.test');
    expect(mail.subject).toBe('Demande de rattachement — Organisation Courrier');
    expect(mail.text).toContain('Camille Martin');
    expect(mail.text).toContain('Je gère les inscriptions.');
    expect(mail.html).toContain('https://sondages.exemple.test/super-admin/demandes');
  });

  it('charte l’email d’acceptation aux couleurs de l’organisation', async () => {
    const { id } = await newRequest('paul@mail.test', 'Paul Durand');
    sent = [];

    const result = await approveMembershipRequest(
      contextFor(superAdmin, 'super@mail.test'),
      id,
      { role: 'editor', moduleKeys: ['event'], note: 'Bienvenue.' },
      { sendEmail, siteUrl: 'https://sondages.exemple.test' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.emailSent).toBe(true);

    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.to).toBe('paul@mail.test');
    expect(mail.subject).toBe('Accès accordé — Organisation Courrier');
    // Logo, couleur d'accent et coordonnées de l'organisation.
    expect(mail.html).toContain('https://cdn.exemple.test/logo.png');
    expect(mail.html).toContain('#123ABC');
    expect(mail.html).toContain('contact@courrier.test');
    // Rôle et nom lisible du module accordé.
    expect(mail.text).toContain('éditeur');
    expect(mail.text).toContain('Événements et inscriptions');
    expect(mail.text).toContain('Bienvenue.');
    // Liens légaux en pied de page.
    expect(mail.text).toContain('https://sondages.exemple.test/confidentialite');
  });

  it('motive l’email de refus et laisse un contact', async () => {
    const { id } = await newRequest('lea@mail.test', 'Léa Petit');
    sent = [];

    const result = await rejectMembershipRequest(
      contextFor(superAdmin, 'super@mail.test'),
      id,
      'Adresse non reconnue.',
      { sendEmail, siteUrl: 'https://sondages.exemple.test' },
    );
    expect(result.ok).toBe(true);

    const mail = sent[0]!;
    expect(mail.to).toBe('lea@mail.test');
    expect(mail.text).toContain('Adresse non reconnue.');
    expect(mail.text).toContain('contact@courrier.test');
    expect(mail.text).toContain('reste actif');
  });

  it('conserve la décision même si l’envoi échoue', async () => {
    const { id, user } = await newRequest('marc@mail.test', 'Marc Simon');
    sent = [];

    const failing = (): Promise<EmailResult> =>
      Promise.resolve({ sent: false, reason: 'network_error' });

    const result = await approveMembershipRequest(
      contextFor(superAdmin, 'super@mail.test'),
      id,
      { role: 'admin', moduleKeys: [] },
      { sendEmail: failing },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.emailSent).toBe(false);

    // L'action métier a bien abouti : c'est la règle non négociable.
    const profile = await db.queryOne<{ role: string; status: string }>(
      OWNER,
      'select role, status from public.profiles where id = $1',
      [user],
    );
    expect(profile).toEqual({ role: 'admin', status: 'active' });
  });

  it('signale l’absence d’adresse de notification sans échouer', async () => {
    await db.query(OWNER, 'update public.platform_settings set notifications_email = null, publisher_email = null');

    const user = await createAccount(db, 'sansdest@mail.test', 'Sans Destinataire');
    const result = await createMembershipRequest(
      contextFor(user, 'sansdest@mail.test'),
      { organisationId: orgId, requestedRole: 'viewer' },
      { sendEmail },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.emailSent).toBe(false);
    expect(sent).toHaveLength(0);

    await db.query(
      OWNER,
      "update public.platform_settings set notifications_email = 'plateforme@exemple.test'",
    );
  });
});
