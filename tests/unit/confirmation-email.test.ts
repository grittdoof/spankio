import { describe, expect, it } from 'vitest';
import { registrationConfirmationEmail } from '@/lib/email/templates/confirmation';
import { emailCandidates, isConfirmationConfigured } from '@/lib/survey/confirmation';
import { composeConsentNotice } from '@/lib/survey/consent';
import { validateSurveySchema, type SurveySchema } from '@/lib/survey/schema';

/**
 * Courriel de confirmation d'inscription.
 *
 * Deux enjeux, et le second est celui qui compte le plus :
 *
 *  1. **Rien n'est inventé.** Pas de visuel sans visuel, pas de ligne « Accès »
 *     sans accès, pas de bloc agenda sans date. Un courriel qui affiche
 *     « Lieu : non renseigné » est pire qu'un courriel plus court.
 *  2. **Rien n'est injecté.** Le texte d'une organisation et son visuel sont
 *     des données non fiables, servies dans un document HTML à un tiers.
 */

const branding = {
  organisationName: 'Spie batignolles',
  logoUrl: 'https://exemple.test/logo.png',
  contactEmail: 'evenements@exemple.test',
  contactPhone: null,
  postalAddress: '30 avenue du Général Gallieni, 92023 Nanterre',
  siteUrl: 'https://spankio.test',
};

const complete = {
  branding,
  surveyTitle: 'Soirée des 180 ans',
  bannerUrl: 'https://exemple.test/visuel.png',
  customText: null,
  when: 'mercredi 18 novembre 2026 à 19:30',
  whenNote: 'Fin prévue à 23:59',
  place: 'Musée Jacquemart-André, 158 Bd Haussmann, 75008 Paris',
  access: 'Métro Miromesnil (9 · 13) à 4 min.',
  directions: {
    google: 'https://exemple.test/dg',
    openStreetMap: 'https://exemple.test/osm',
    apple: 'https://exemple.test/apple',
  },
  calendar: {
    google: 'https://exemple.test/g',
    outlook: 'https://exemple.test/o',
    ics: 'https://spankio.test/api/ics/1',
  },
  publicUrl: 'https://spankio.test/s/org/invitation',
  legalLinks: [{ label: 'Confidentialité', url: 'https://spankio.test/confidentialite' }],
};

describe('désignation du destinataire', () => {
  const schema: SurveySchema = (() => {
    const result = validateSurveySchema({
      version: 1,
      steps: [
        {
          id: 'etape_1',
          fields: [
            { id: 'nom', type: 'text', label: 'Nom' },
            { id: 'email', type: 'email', label: 'Adresse électronique' },
            { id: 'assistant', type: 'email', label: 'Adresse de votre assistant' },
            { id: 'libre', type: 'text', label: 'Autre contact' },
          ],
        },
      ],
    });
    if (!result.ok) throw new Error('Schéma invalide');
    return result.schema;
  })();

  it('ne propose QUE les questions de type adresse électronique', () => {
    // Un champ libre n'est pas validé comme une adresse : l'envoi échouerait
    // une fois sur deux sans que personne ne le sache.
    expect(emailCandidates(schema).map((f) => f.id)).toEqual(['email', 'assistant']);
  });

  it('n’envoie rien tant que la désignation est incomplète', () => {
    // Deux candidates : deviner enverrait la confirmation à l'assistant sans
    // que l'organisation le voie jamais.
    expect(isConfirmationConfigured(undefined)).toBe(false);
    expect(isConfirmationConfigured({})).toBe(false);
    expect(isConfirmationConfigured({ enabled: true })).toBe(false);
    expect(isConfirmationConfigured({ emailField: 'email' })).toBe(false);
    expect(isConfirmationConfigured({ enabled: true, emailField: 'email' })).toBe(true);
  });
});

describe('mention d’information', () => {
  const base = {
    organisationName: 'Spie batignolles',
    purpose: 'organiser la soirée',
    legalBasis: 'consent',
    retentionDays: 365,
    recipients: 'Service organisateur',
  };

  it('annonce le courriel dès qu’il est activé', () => {
    // Règle d'or : ce que la mention affirme doit correspondre exactement à ce
    // que le code fait. Un envoi non annoncé serait un usage tacite.
    const notice = composeConsentNotice({ ...base, confirmationEmail: true });
    expect(notice.sections.map((s) => s.label)).toContain('Courriel de confirmation');
    expect(notice.text).toContain('Courriel de confirmation');
  });

  it('n’en parle pas quand il est fermé', () => {
    const notice = composeConsentNotice({ ...base, confirmationEmail: false });
    expect(notice.sections.map((s) => s.label)).not.toContain('Courriel de confirmation');
  });
});

describe('contenu du courriel', () => {
  it('reprend logo, visuel, date, lieu, accès, itinéraire, agenda et coordonnées', () => {
    const { subject, html, text } = registrationConfirmationEmail(complete);

    expect(subject).toBe('Inscription confirmée — Soirée des 180 ans');
    expect(html).toContain('https://exemple.test/logo.png');
    expect(html).toContain('https://exemple.test/visuel.png');
    expect(html).toContain('mercredi 18 novembre 2026 à 19:30');
    expect(html).toContain('Fin prévue à 23:59');
    expect(html).toContain('Musée Jacquemart-André');
    expect(html).toContain('Métro Miromesnil');
    expect(html).toContain('https://exemple.test/dg');
    expect(html).toContain('https://exemple.test/g');
    // Coordonnées de l'organisation, en pied de page.
    expect(html).toContain('evenements@exemple.test');
    expect(html).toContain('92023 Nanterre');
    // La version texte porte les mêmes faits : beaucoup de clients la lisent.
    expect(text).toContain('Accès : Métro Miromesnil (9 · 13) à 4 min.');
    expect(text).toContain('Lieu : Musée Jacquemart-André');
  });

  it('compose une phrase neutre à défaut de texte, et respecte celui fourni', () => {
    expect(registrationConfirmationEmail(complete).html).toContain(
      'Votre inscription à « Soirée des 180 ans » est enregistrée.',
    );
    const custom = registrationConfirmationEmail({
      ...complete,
      customText: 'Nous avons hâte de vous accueillir.',
    });
    expect(custom.html).toContain('Nous avons hâte de vous accueillir.');
    expect(custom.html).not.toContain('est enregistrée.');
  });

  it('laisse le visuel DÉCORATIF : un alt bavard remplacerait l’image par un pavé', () => {
    // Beaucoup de clients mail bloquent les images par défaut.
    expect(registrationConfirmationEmail(complete).html).toContain('alt=""');
  });

  it('n’invente rien quand les informations manquent', () => {
    const bare = registrationConfirmationEmail({
      branding: { organisationName: 'Organisation Témoin' },
      surveyTitle: 'Consultation',
      publicUrl: 'https://spankio.test/s/org/consultation',
    });
    for (const absent of ['Lieu', 'Accès', 'Date', 'Ajouter à mon agenda', 'S’y rendre']) {
      expect(bare.html, absent).not.toContain(absent);
    }
    // Il reste ce qui est vrai : la phrase, et le lien vers l'invitation.
    expect(bare.html).toContain('Votre inscription à « Consultation » est enregistrée.');
    expect(bare.html).toContain('https://spankio.test/s/org/consultation');
  });

  it('échappe le texte de l’organisation : un courriel est une surface d’injection', () => {
    const hostile = registrationConfirmationEmail({
      ...complete,
      customText: '<script>alert(1)</script> & « guillemets »',
    });
    expect(hostile.html).not.toContain('<script>');
    expect(hostile.html).toContain('&lt;script&gt;');
    expect(hostile.html).toContain('&amp;');
  });

  it('refuse une URL de visuel non http(s) plutôt que de la servir', () => {
    const hostile = registrationConfirmationEmail({
      ...complete,
      bannerUrl: 'javascript:alert(1)',
    });
    expect(hostile.html).not.toContain('javascript:');
  });

  it('n’accepte comme couleur d’accent qu’un hexadécimal', () => {
    const hostile = registrationConfirmationEmail({
      ...complete,
      branding: { ...branding, accentColor: 'red;position:fixed;top:0' },
    });
    expect(hostile.html).not.toContain('position:fixed');
  });
});
