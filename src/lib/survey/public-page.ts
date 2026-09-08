import { z } from 'zod';
import { MAX_LENGTHS } from './limits';

/**
 * Réglages de la PAGE PUBLIQUE d'un événement : ce qu'elle montre, et avec
 * quel contenu.
 *
 * Rangé dans `surveys.settings` (`jsonb`) comme le reste des réglages
 * d'affichage : ajouter un bloc à l'invitation ne demande aucune migration.
 *
 * Trois décisions structurent ce module.
 *
 *  1. **La liste enregistrée est celle des blocs MASQUÉS, pas des blocs
 *     affichés.** Un jour de plus dans la vie du produit ajoutera un bloc :
 *     avec une liste d'autorisation, il naîtrait invisible sur tous les
 *     formulaires existants, et personne ne saurait qu'il existe. Avec une
 *     liste de masquage, le défaut reste « montrer ce qui a du contenu », et
 *     une organisation qui n'a jamais ouvert cet écran obtient quand même une
 *     page complète.
 *  2. **Un bloc sans contenu ne s'affiche pas, même autorisé.** L'interrupteur
 *     dit « je veux voir ce bloc » ; il ne fabrique pas le contenu. Un titre
 *     « Déroulé de la soirée » suivi du vide serait pire que son absence.
 *  3. **Aucun bloc n'invente de données.** Le compte à rebours vient de la
 *     date de l'événement, la date limite de `closes_at`, le nombre d'inscrits
 *     du compteur déjà publié par la vue `public_surveys`. Ce que la
 *     plateforme ne sait pas — un nombre de places restantes, par exemple —
 *     n'a pas de bloc.
 */

const text = (max: number) => z.string().trim().max(max);

/**
 * Blocs de la page publique, dans leur ordre d'affichage.
 *
 * L'ordre de ce tableau EST l'ordre de la page : il n'existe pas de second
 * endroit où il serait redéfini, donc pas de risque qu'un écran de réglages
 * énumère les blocs dans un ordre que la page ne respecte pas.
 */
export const PUBLIC_BLOCKS = [
  'banner',
  'logo',
  'status',
  'countdown',
  'responseCount',
  'deadline',
  'practical',
  'organiserWord',
  'programme',
  'calendar',
  'directions',
  'map',
  'faq',
  'share',
  'privacyNote',
] as const;

export type PublicBlock = (typeof PUBLIC_BLOCKS)[number];

const blockEnum = z.enum(PUBLIC_BLOCKS);

/** Un moment du déroulé. L'heure est un texte libre : « 19h30 », « en soirée ». */
const momentSchema = z.object({
  /** Texte libre et non une heure : « vers 21 h », « à l'issue du dîner ». */
  time: text(40).optional(),
  title: text(MAX_LENGTHS.label),
  note: text(MAX_LENGTHS.hint).optional(),
});

const questionSchema = z.object({
  question: text(MAX_LENGTHS.label),
  answer: text(MAX_LENGTHS.stepIntro),
});

const detailSchema = z.object({
  label: text(MAX_LENGTHS.label),
  value: text(MAX_LENGTHS.hint).optional(),
});

export const publicPageSchema = z.object({
  /**
   * Blocs explicitement masqués. Voir la décision 1 : c'est une liste de
   * masquage, jamais d'autorisation.
   */
  hidden: z.array(blockEnum).max(PUBLIC_BLOCKS.length).optional(),

  /** Remplace « Inscriptions ouvertes » sur la pastille du visuel. */
  statusLabel: text(60).optional(),

  /**
   * Fond du bouton d'inscription, en `#RRGGBB`.
   *
   * Le FORMAT est exigé ici — cette valeur finit dans un attribut `style`, et
   * React n'assainit pas les valeurs CSS. La LISIBILITÉ, elle, n'est pas
   * vérifiée à ce niveau : une contrainte de contraste dans le schéma ferait
   * échouer `validateSurveySettings` en entier sur une valeur héritée, et la
   * page publique perdrait TOUS ses réglages d'un coup
   * (`settings.ok ? … : {}`). C'est donc `ctaPalette` qui refuse au rendu, et
   * l'écran de réglages qui refuse à la saisie — deux remparts, aucun
   * destructeur.
   */
  ctaColor: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Couleur attendue au format #RRGGBB.')
    .optional(),

  /** Précisions pratiques libres : tenue, vestiaire, accès, stationnement. */
  details: z.array(detailSchema).max(8).optional(),

  /** Le mot de l'organisateur, distinct de la description du formulaire. */
  organiserWord: z
    .object({
      author: text(MAX_LENGTHS.label).optional(),
      role: text(MAX_LENGTHS.label).optional(),
      text: text(MAX_LENGTHS.stepIntro),
    })
    .optional(),

  /** Déroulé de l'événement. */
  programme: z.array(momentSchema).max(20).optional(),

  /**
   * Comment s'y rendre : transports, stationnement, entrée à emprunter.
   *
   * Plafond relevé au format d'une introduction d'étape, et SAUTS DE LIGNE
   * conservés : un accès se rédige en une liste — métro, bus, parking — et
   * l'écraser en un paragraphe le rend illisible. `trim()` ne retire que les
   * blancs de bord, jamais ceux du milieu.
   */
  travelNote: text(MAX_LENGTHS.stepIntro).optional(),

  /** Questions fréquentes. */
  faq: z.array(questionSchema).max(20).optional(),
});

export type PublicPageSettings = z.infer<typeof publicPageSchema>;
export type PublicMoment = z.infer<typeof momentSchema>;
export type PublicQuestion = z.infer<typeof questionSchema>;
export type PublicDetail = z.infer<typeof detailSchema>;

/** Libellé et explication de chaque interrupteur, pour l'écran de réglages. */
export interface PublicBlockMeta {
  readonly key: PublicBlock;
  readonly label: string;
  /** Ce que l'absence coûte, ou ce que la présence apporte. */
  readonly help: string;
  /** Le bloc n'a de sens que pour un événement daté. */
  readonly eventOnly: boolean;
}

export const PUBLIC_BLOCK_META: readonly PublicBlockMeta[] = [
  {
    key: 'banner',
    label: 'Le visuel de l’événement',
    help: 'L’image déposée dans « Présentation ». Sans elle, la page reste lisible mais commence par du texte.',
    eventOnly: false,
  },
  {
    key: 'logo',
    label: 'Le logo de l’organisation',
    help: 'Déposé dans le profil de l’organisation. À défaut, son nom s’affiche.',
    eventOnly: false,
  },
  {
    key: 'status',
    label: 'La pastille « Inscriptions ouvertes »',
    help: 'Elle n’apparaît que sur une page réellement ouverte : la page publique n’existe pas avant publication ni après la clôture.',
    eventOnly: false,
  },
  {
    key: 'countdown',
    label: 'Le compte à rebours',
    help: 'Jours, heures, minutes et secondes avant le début. Il disparaît de lui-même une fois l’événement commencé.',
    eventOnly: true,
  },
  {
    key: 'responseCount',
    label: 'Le nombre d’inscriptions reçues',
    help: 'Un chiffre qui rassure sur une soirée attendue — et qui décourage sur un formulaire encore vide. À vous de juger.',
    eventOnly: false,
  },
  {
    key: 'deadline',
    label: 'La date limite de réponse',
    help: 'La date de clôture du formulaire, rappelée près du bouton d’inscription.',
    eventOnly: false,
  },
  {
    key: 'practical',
    label: 'Les informations pratiques',
    help: 'Date, lieu, adresse, et les précisions que vous ajoutez ci-dessous.',
    eventOnly: true,
  },
  {
    key: 'organiserWord',
    label: 'Le mot de l’organisateur',
    help: 'Un paragraphe signé, qui explique pourquoi cette invitation existe.',
    eventOnly: false,
  },
  {
    key: 'programme',
    label: 'Le déroulé',
    help: 'Les moments de l’événement, dans l’ordre. Utile dès que la soirée a plusieurs temps.',
    eventOnly: true,
  },
  {
    key: 'calendar',
    label: 'L’ajout à l’agenda',
    help: 'Google, Outlook et le fichier `.ics`. Bloquer la date est souvent le premier geste d’un invité.',
    eventOnly: true,
  },
  {
    key: 'directions',
    label: 'L’itinéraire',
    help: 'Des liens vers Google Maps, Plans et OpenStreetMap. Aucune carte n’est chargée : rien ne part vers un tiers avant le clic.',
    eventOnly: true,
  },
  {
    key: 'map',
    label: 'La carte du lieu',
    help: 'Un repère visuel dans le bloc « S’y rendre ». C’est le SEUL bloc qui contacte un tiers sans clic : les tuiles partent du navigateur de l’invité vers OpenStreetMap, dont la politique d’usage vise les usages modérés. À fermer si vous préférez ne rien laisser filer, ou si l’invitation est lue par des dizaines de milliers de personnes.',
    eventOnly: true,
  },
  {
    key: 'faq',
    label: 'Les questions fréquentes',
    help: 'Les questions que vos invités posent par courriel, répondues une fois pour toutes.',
    eventOnly: false,
  },
  {
    key: 'share',
    label: 'Le partage du lien',
    help: 'L’adresse de la page, copiable en un geste. À laisser fermé si l’invitation est nominative.',
    eventOnly: false,
  },
  {
    key: 'privacyNote',
    label: 'La mention sur les données',
    help: 'Une phrase disant à quoi servent les réponses. Le détail complet reste sur l’écran de consentement.',
    eventOnly: false,
  },
];

/** Blocs masqués par défaut : ceux qu'une organisation doit vouloir. */
const HIDDEN_BY_DEFAULT: readonly PublicBlock[] = ['responseCount', 'share'];

/**
 * Le bloc est-il AUTORISÉ ? Répond à l'interrupteur seul, pas à la présence de
 * contenu — c'est l'appelant qui sait s'il a quelque chose à montrer.
 */
export function isBlockAllowed(
  settings: PublicPageSettings | undefined,
  block: PublicBlock,
): boolean {
  const hidden = settings?.hidden;
  if (hidden) return !hidden.includes(block);
  return !HIDDEN_BY_DEFAULT.includes(block);
}

/**
 * Bascule un interrupteur et renvoie la nouvelle liste de masquage.
 *
 * La liste est TOUJOURS écrite en entier dès qu'on y touche : tant qu'elle est
 * absente, les défauts s'appliquent, et un premier clic doit donc figer aussi
 * les blocs qu'on n'a pas touchés — sinon activer « le partage » réactiverait
 * en même temps « le nombre d'inscriptions », masqué par défaut.
 */
export function toggleBlock(
  settings: PublicPageSettings | undefined,
  block: PublicBlock,
  allowed: boolean,
): PublicBlock[] {
  const current = new Set(
    settings?.hidden ?? HIDDEN_BY_DEFAULT,
  );
  if (allowed) current.delete(block);
  else current.add(block);
  // L'ordre de `PUBLIC_BLOCKS` plutôt que l'ordre d'insertion : la valeur
  // enregistrée reste comparable d'un enregistrement à l'autre.
  return PUBLIC_BLOCKS.filter((candidate) => current.has(candidate));
}

/** Nombre de blocs masqués, pour le résumé de l'écran de réglages. */
export function hiddenCount(settings: PublicPageSettings | undefined): number {
  return PUBLIC_BLOCKS.filter((block) => !isBlockAllowed(settings, block)).length;
}
