import { sanitizeText } from '@/lib/security/sanitize';

/**
 * Texte de consentement.
 *
 * DÉCISION IMPORTANTE : ce texte est composé PAR LE SERVEUR, jamais transmis
 * par le client.
 *
 * La base stocke `consent_text` comme preuve auditable de ce qui a été affiché
 * au répondant. Si cette preuve venait de la requête, elle ne prouverait rien :
 * n'importe qui pourrait soumettre le texte de son choix. Le serveur la
 * recompose donc à partir des mentions RGPD du sondage, et le rendu public
 * affiche EXACTEMENT le même texte, produit par cette même fonction.
 *
 * Aucune base légale n'est imposée : c'est l'organisation qui l'a choisie sur
 * son sondage, et le texte reprend son choix.
 */

export type LegalBasis =
  | 'consent'
  | 'contract'
  | 'legal_obligation'
  | 'vital_interests'
  | 'public_task'
  | 'legitimate_interests';

/** Formulation des six bases légales de l'article 6 du RGPD. */
const LEGAL_BASIS_LABELS: Readonly<Record<LegalBasis, string>> = {
  consent: 'votre consentement',
  contract: 'l’exécution d’un contrat ou de mesures précontractuelles',
  legal_obligation: 'le respect d’une obligation légale',
  vital_interests: 'la sauvegarde d’intérêts vitaux',
  public_task: 'l’exécution d’une mission d’intérêt public',
  legitimate_interests: 'les intérêts légitimes du responsable de traitement',
};

export function legalBasisLabel(basis: string | null | undefined): string | null {
  if (!basis) return null;
  return LEGAL_BASIS_LABELS[basis as LegalBasis] ?? null;
}

export interface ConsentInput {
  readonly organisationName: string;
  readonly purpose: string | null;
  readonly legalBasis: string | null;
  readonly retentionDays: number | null;
  readonly recipients: string | null;
  /** Texte rédigé par l'organisation, qui remplace la composition automatique. */
  readonly customText?: string | null;
}

export interface ConsentSection {
  readonly label: string;
  readonly value: string;
}

export interface ConsentNotice {
  /** Paragraphes affichés, dans l'ordre. */
  readonly paragraphs: readonly string[];
  /** Tableau finalité / base légale / durée / destinataires. */
  readonly sections: readonly ConsentSection[];
  /** Texte intégral stocké comme preuve. */
  readonly text: string;
}

function durationLabel(days: number): string {
  if (days % 365 === 0) {
    const years = days / 365;
    return years === 1 ? '1 an' : `${years} ans`;
  }
  if (days % 30 === 0) {
    const months = days / 30;
    return months === 1 ? '1 mois' : `${months} mois`;
  }
  return days === 1 ? '1 jour' : `${days} jours`;
}

/**
 * Compose l'information de consentement.
 *
 * Une mention absente n'est pas remplacée par une formule vague : elle est
 * simplement omise. Un sondage publié ne peut de toute façon pas avoir de
 * finalité, de base légale ou de durée manquante — la contrainte SQL
 * `surveys_published_requires_rgpd` l'interdit.
 */
export function composeConsentNotice(input: ConsentInput): ConsentNotice {
  const sections: ConsentSection[] = [];

  const purpose = input.purpose?.trim();
  if (purpose) sections.push({ label: 'Finalité', value: purpose });

  const basis = legalBasisLabel(input.legalBasis);
  if (basis) sections.push({ label: 'Base légale', value: basis });

  if (input.retentionDays !== null && input.retentionDays !== undefined) {
    sections.push({ label: 'Durée de conservation', value: durationLabel(input.retentionDays) });
  }

  const recipients = input.recipients?.trim();
  if (recipients) sections.push({ label: 'Destinataires', value: recipients });

  const custom = input.customText?.trim();
  const paragraphs = custom
    ? [custom]
    : [
        `Les réponses de ce formulaire sont collectées par ${input.organisationName}, ` +
          'responsable de ce traitement.',
        'Vous disposez d’un droit d’accès, de rectification, d’effacement, de limitation, ' +
          'd’opposition et de portabilité de vos données, ainsi que du droit de retirer votre ' +
          'consentement à tout moment lorsque le traitement repose sur celui-ci.',
      ];

  const text = [
    ...paragraphs,
    ...sections.map((section) => `${section.label} : ${section.value}`),
  ].join('\n');

  return {
    paragraphs,
    sections,
    // Le texte stocké est nettoyé comme n'importe quelle donnée, mais garde
    // ses sauts de ligne : c'est une preuve, elle doit rester lisible.
    text: sanitizeText(text, { multiline: true, maxLength: 4000 }),
  };
}

/** Libellé de la case à cocher, adapté à la base légale retenue. */
export function consentCheckboxLabel(legalBasis: string | null | undefined): string {
  return legalBasis === 'consent'
    ? 'J’ai lu ces informations et je consens au traitement de mes données.'
    : 'J’ai lu et compris ces informations.';
}
