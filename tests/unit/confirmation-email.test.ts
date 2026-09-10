import { describe, expect, it } from 'vitest';
import { registrationConfirmationEmail } from '@/lib/email/templates/confirmation';
import { submittedRecap } from '@/lib/survey/recap';
import {
  CONFIRMATION_BLOCKS,
  emailCandidates,
  isConfirmationBlockShown,
  isConfirmationConfigured,
  toggleConfirmationBlock,
} from '@/lib/survey/confirmation';
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

describe('récapitulatif de ce qui a été saisi', () => {
  const schema: SurveySchema = (() => {
    const result = validateSurveySchema({
      version: 1,
      steps: [
        {
          id: 'etape_1',
          fields: [
            { id: 'nom', type: 'text', label: 'Nom et prénom' },
            {
              id: 'presence',
              type: 'radio',
              label: 'Serez-vous présent ?',
              options: [
                { value: 'oui', label: 'Oui, je serai présent' },
                { value: 'non', label: 'Non' },
              ],
            },
            {
              id: 'combien',
              type: 'select',
              label: 'Nombre d’accompagnants',
              options: [
                { value: 'option_1', label: '1' },
                { value: 'option_2', label: '2' },
              ],
              condition: { field: 'presence', op: 'equals', value: 'oui' },
            },
            { id: 'telephone', type: 'tel', label: 'Téléphone' },
            { id: 'remarque', type: 'textarea', label: 'Remarque' },
          ],
        },
      ],
    });
    if (!result.ok) throw new Error('Schéma invalide');
    return result.schema;
  })();

  it('relit les LIBELLÉS, jamais les valeurs d’option', () => {
    // `option_2` ne veut rien dire pour la personne qui a répondu « 2 ».
    const recap = submittedRecap(schema, {
      nom: 'Camille Arnoult',
      presence: 'oui',
      combien: 'option_2',
    });
    expect(recap).toEqual([
      { label: 'Nom et prénom', value: 'Camille Arnoult' },
      { label: 'Serez-vous présent ?', value: 'Oui, je serai présent' },
      { label: 'Nombre d’accompagnants', value: '2' },
    ]);
  });

  it('omet les questions non posées, et les réponses vides', () => {
    // « Nombre d'accompagnants » est masqué quand on décline : le faire figurer
    // laisserait croire à un oubli. Et « Téléphone : — » n'apprend rien.
    const recap = submittedRecap(schema, { nom: 'Karim Zebiri', presence: 'non' });
    expect(recap.map((line) => line.label)).toEqual([
      'Nom et prénom',
      'Serez-vous présent ?',
    ]);
  });

  it('tronque une réponse libre trop longue', () => {
    // Une réponse peut faire 5 000 caractères : la recopier en entier rendrait
    // illisible un courriel dont le rôle est la vérification d'un coup d'œil.
    const recap = submittedRecap(schema, { remarque: 'a'.repeat(600) });
    const value = recap[0]?.value ?? '';
    expect(value.length).toBeLessThanOrEqual(301);
    expect(value.endsWith('…')).toBe(true);
  });

  it('figure dans le courriel, sous un intitulé', () => {
    const { html, text } = registrationConfirmationEmail({
      ...complete,
      recap: [{ label: 'Nom et prénom', value: 'Camille Arnoult' }],
    });
    expect(html).toContain('Vos réponses');
    expect(html).toContain('Camille Arnoult');
    expect(text).toContain('Nom et prénom : Camille Arnoult');
  });

  it('n’ajoute AUCUN intitulé quand il n’y a rien à relire', () => {
    expect(registrationConfirmationEmail({ ...complete, recap: [] }).html).not.toContain(
      'Vos réponses',
    );
  });
});

describe('accès multiligne', () => {
  /**
   * DÉFAUT RÉEL, signalé par le client : l'accès arrivait sur une seule ligne.
   * Le rendu s'appuyait sur `white-space: pre-line`, que le moteur de Word —
   * donc Outlook sous Windows — n'applique pas.
   *
   * Et ce test l'affirmait déjà : il cherchait la PROPRIÉTÉ CSS dans la source,
   * c'est-à-dire qu'on l'avait bien écrite — pas qu'elle produisait des lignes.
   * Il vérifie désormais les balises `<br />`, comprises de tous les clients.
   */
  const acces = 'Métro Miromesnil (9 · 13)\nBus 22, 43, 52\nParking Haussmann-Berri';

  it('coupe les lignes avec de vraies balises, pas avec du CSS', () => {
    const { html, text } = registrationConfirmationEmail({ ...complete, access: acces });

    expect(html).toContain('Métro Miromesnil (9 · 13)<br />Bus 22, 43, 52<br />Parking');
    // Le CSS que le client cible ignore n'est plus la seule garantie.
    expect(html).not.toContain('white-space:pre-line');
    // Et le texte brut garde ses retours à la ligne tels quels.
    expect(text).toContain('Parking Haussmann-Berri');
  });

  it('normalise les fins de ligne Windows plutôt que de doubler les sauts', () => {
    // Un texte collé depuis Windows arrive en CRLF : sans normalisation, le
    // `\r` resterait dans le HTML et certains clients doubleraient l'interligne.
    const { html } = registrationConfirmationEmail({
      ...complete,
      access: 'Métro Miromesnil\r\nBus 22\rParking',
    });
    expect(html).toContain('Métro Miromesnil<br />Bus 22<br />Parking');
    expect(html).not.toContain('\r');
  });

  it('échappe AVANT d’insérer les balises', () => {
    // L'ordre inverse afficherait « <br /> » en clair, ou pire laisserait
    // passer une balise venue de la saisie.
    const { html } = registrationConfirmationEmail({
      ...complete,
      access: '<b>Métro</b>\nBus',
    });
    expect(html).toContain('&lt;b&gt;Métro&lt;/b&gt;<br />Bus');
    expect(html).not.toContain('<b>Métro</b>');
  });
});

describe('blocs du courriel', () => {
  /**
   * Ce qui s'affiche est réglable, et c'est la liste des blocs MASQUÉS qui est
   * enregistrée : un bloc ajouté plus tard ne doit pas naître invisible sur
   * tous les formulaires existants. Même décision que pour la page publique.
   */
  it('montre tout par défaut', () => {
    for (const block of CONFIRMATION_BLOCKS) {
      expect(isConfirmationBlockShown(undefined, block)).toBe(true);
      expect(isConfirmationBlockShown({}, block)).toBe(true);
    }
  });

  it('ferme uniquement ce qui est listé', () => {
    const settings = { hidden: ['endTime' as const] };
    expect(isConfirmationBlockShown(settings, 'endTime')).toBe(false);
    expect(isConfirmationBlockShown(settings, 'when')).toBe(true);
  });

  it('fige la liste entière au premier changement', () => {
    // Sans normalisation, fermer un bloc rouvrirait ceux qu'une version future
    // aurait fermés par défaut.
    expect(toggleConfirmationBlock({}, 'endTime', false)).toEqual(['endTime']);
    expect(toggleConfirmationBlock({ hidden: ['endTime'] }, 'recap', false)).toEqual([
      'endTime',
      'recap',
    ]);
    // L'ordre est celui du courriel, jamais celui des clics.
    expect(toggleConfirmationBlock({ hidden: ['recap'] }, 'endTime', false)).toEqual([
      'endTime',
      'recap',
    ]);
    expect(toggleConfirmationBlock({ hidden: ['endTime'] }, 'endTime', true)).toEqual([]);
  });

  /**
   * Le cas demandé : ne pas annoncer une heure de fin seulement indicative. La
   * DATE, elle, reste — les deux se ferment séparément.
   */
  it('retire l’heure de fin sans retirer la date', () => {
    const { html, text } = registrationConfirmationEmail({
      ...complete,
      whenNote: null,
    });
    for (const rendered of [html, text]) {
      expect(rendered).toContain('mercredi 18 novembre 2026 à 19:30');
      expect(rendered).not.toContain('Fin prévue');
    }
  });

  it('retire chaque bloc sans emporter les autres', () => {
    const { html } = registrationConfirmationEmail({
      ...complete,
      bannerUrl: null,
      place: null,
      access: null,
      calendar: null,
      directions: null,
      publicUrl: null,
      recap: [],
      branding: { ...branding, contactEmail: null, contactPhone: null, postalAddress: null },
    });

    // Ce qui reste : le logo, le texte, la date. Rien d'orphelin.
    expect(html).toContain('mercredi 18 novembre 2026');
    expect(html).toContain('Spie batignolles');
    expect(html).not.toContain('visuel.png');
    expect(html).not.toContain('Musée Jacquemart-André');
    expect(html).not.toContain('Métro Miromesnil');
    expect(html).not.toContain('Ajouter à mon agenda');
    expect(html).not.toContain('S’y rendre');
    expect(html).not.toContain('Revoir l’invitation');
    expect(html).not.toContain('evenements@exemple.test');
    expect(html).not.toContain('92023 Nanterre');
  });
});
