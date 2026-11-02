/**
 * Comptes de pointage créés par l'organisation.
 *
 * Le chemin normal d'entrée dans la plateforme est l'inscription, puis un
 * rattachement validé — ou, depuis le lot 4b, une invitation à usage unique.
 * Les deux supposent que la personne ouvre un courriel, choisit un mot de
 * passe et comprend ce qu'elle fait. Pour une soirée tenue par du personnel
 * engagé à la journée, c'est une marche trop haute : l'organisation veut
 * remettre un identifiant et un mot de passe, de la main à la main.
 *
 * D'où ce module, et les trois décisions qu'il porte.
 *
 * **L'identifiant est FABRIQUÉ, pas demandé.** Une hôtesse n'a pas à fournir
 * d'adresse — c'est tout l'intérêt. L'authentification de Supabase exige
 * pourtant une adresse : on en compose donc une, dérivée du nom affiché, sur
 * un sous-domaine `accueil.` qui ne reçoit aucun courrier. Elle sert
 * d'identifiant et de rien d'autre.
 *
 * **Le suffixe est tiré au sort, pas incrémenté.** Deux « Marie » dans la même
 * organisation sont la règle, pas l'exception ; `marie-2` obligerait à
 * interroger la base pour savoir quel numéro est libre, et à recommencer à
 * chaque collision. Quatre caractères tirés de `crypto.getRandomValues`
 * règlent la question sans lecture préalable — et la contrainte d'unicité de
 * la base reste le juge, l'appelant réessayant avec un autre tirage.
 *
 * **Le mot de passe se DICTE.** Il sera lu au téléphone ou recopié d'un SMS :
 * des syllabes prononçables valent mieux qu'une suite de caractères, et le
 * nombre final évite qu'il ressemble à un mot du dictionnaire. L'organisation
 * reste libre de le remplacer — le champ est prégarni, pas verrouillé.
 */

/** Sous-domaine des identifiants fabriqués. Aucune boîte n'y existe. */
export const STAFF_SUBDOMAIN = 'accueil';

/** Bornes du nom affiché saisi par l'organisation. */
export const STAFF_LABEL_MAX = 60;

/** Plancher du mot de passe. Supabase en impose 6 ; on en demande plus. */
export const STAFF_PASSWORD_MIN = 10;

/**
 * Nom affiché → segment d'identifiant.
 *
 * Accents retirés, espaces et ponctuation ramenés à un tiret unique. Un nom
 * fait uniquement de signes ne donne rien, et l'appelant retombe alors sur
 * `poste` : un identifiant vide serait refusé par la base avec un message
 * que personne ne saurait lire.
 */
export function slugifyLabel(label: string): string {
  const slug = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '');
  return slug === '' ? 'poste' : slug;
}

/** Quatre caractères tirés au sort, sans voyelle : aucun mot ne s'y forme. */
function randomSuffix(): string {
  const alphabet = 'bcdfghjkmnpqrstvwxz23456789';
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

/**
 * Hôte des identifiants fabriqués, dérivé de l'adresse du site.
 *
 * Dérivé plutôt que configuré : une variable d'environnement de plus serait
 * une occasion de plus de diverger entre les environnements, pour une valeur
 * qui n'a aucune raison de différer de celle du site.
 */
export function staffIdentifierHost(siteUrl: string): string {
  try {
    const { hostname } = new URL(siteUrl);
    return `${STAFF_SUBDOMAIN}.${hostname}`;
  } catch {
    // Une adresse de site illisible ne doit pas empêcher de tenir une porte.
    return `${STAFF_SUBDOMAIN}.localhost`;
  }
}

/** L'identifiant complet, celui qu'on remet à la personne. */
export function staffIdentifier(label: string, host: string): string {
  return `${slugifyLabel(label)}.${randomSuffix()}@${host}`;
}

/**
 * Cet identifiant a-t-il été fabriqué par la plateforme ?
 *
 * L'écran s'en sert pour ne PAS proposer « réinitialiser le mot de passe » sur
 * le compte d'un éditeur affecté à la porte : son mot de passe est le sien, et
 * le remettre à zéro depuis cet écran serait une prise de contrôle.
 */
export function isStaffIdentifier(email: string | null, host: string): boolean {
  return email !== null && email.toLowerCase().endsWith(`@${host.toLowerCase()}`);
}

/** Ce qu'on affiche d'un identifiant fabriqué : la partie avant l'arrobase. */
export function identifierLocalPart(email: string): string {
  const at = email.indexOf('@');
  return at === -1 ? email : email.slice(0, at);
}

export function isStaffLabelShape(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= STAFF_LABEL_MAX && /\p{L}|\d/u.test(trimmed);
}

export function isPasswordAcceptable(value: string): boolean {
  return value.length >= STAFF_PASSWORD_MIN && value.length <= 72 && value.trim() === value;
}

const CONSONANTS = 'bdfgklmnprstvz';
const VOWELS = 'aeiou';

/**
 * Un mot de passe prononçable : trois groupes de deux syllabes, puis deux
 * chiffres. « bako-tire-muso-47 » se dicte au téléphone sans épeler.
 *
 * Environ 43 bits de hasard — très au-delà de ce qu'une saisie manuelle
 * permet d'essayer, et sans rapport avec un mot de dictionnaire.
 */
export function suggestPassword(): string {
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);

  const groups: string[] = [];
  let cursor = 0;
  for (let group = 0; group < 3; group += 1) {
    let text = '';
    for (let syllable = 0; syllable < 2; syllable += 1) {
      text += CONSONANTS[bytes[cursor]! % CONSONANTS.length];
      cursor += 1;
      text += VOWELS[bytes[cursor]! % VOWELS.length];
      cursor += 1;
    }
    groups.push(text);
  }

  const digits = String((bytes[12]! % 10) * 10 + (bytes[13]! % 10)).padStart(2, '0');
  return `${groups.join('-')}-${digits}`;
}

/**
 * Le message qu'on transmet à la personne.
 *
 * Composé ici, donc identique partout : l'écran l'affiche, le bouton le copie,
 * et rien ne se recompose à la main dans un coin. Le mot de passe n'y figure
 * que lorsqu'il vient d'être choisi — il n'est jamais relu depuis la base,
 * puisqu'il n'y est pas.
 */
export function accessMessage(input: {
  readonly eventTitle: string;
  readonly deskUrl: string;
  readonly identifier: string;
  readonly password?: string;
}): string {
  const lines = [
    `Accueil — ${input.eventTitle}`,
    '',
    `Lien : ${input.deskUrl}`,
    `Identifiant : ${input.identifier}`,
  ];
  if (input.password) lines.push(`Mot de passe : ${input.password}`);
  lines.push('', 'Ouvrez le lien, connectez-vous, la liste s’affiche.');
  return lines.join('\n');
}

/** L'adresse du poste, celle qu'on partage. */
export function deskUrl(siteUrl: string, surveyId: string): string {
  return `${siteUrl.replace(/\/$/, '')}/accueil/${surveyId}`;
}

/**
 * État rendu par les actions de compte.
 *
 * Il vit ICI et non dans le fichier d'actions : un module `'use server'`
 * n'exporte que des fonctions asynchrones, et y laisser un type ferait
 * échouer la collecte au build avec un message qui ne nomme pas la cause.
 *
 * Le mot de passe y figure parce que c'est le seul moyen de le remettre sous
 * les yeux de celui qui vient de le choisir, pour qu'il le transmette. Il ne
 * voyage que dans la RÉPONSE d'un POST — jamais dans une URL, donc jamais
 * dans un historique de navigateur ni dans un journal de serveur, qui est
 * exactement la raison pour laquelle le jeton d'invitation, lui, ne s'affiche
 * pas. Il n'est stocké nulle part : rechargez la page, il a disparu.
 */
export type StaffAccountState =
  | { readonly status: 'idle' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'created';
      readonly label: string;
      readonly identifier: string;
      readonly password: string;
    }
  | {
      readonly status: 'reset';
      readonly identifier: string;
      readonly password: string;
    };

export const IDLE_ACCOUNT_STATE: StaffAccountState = { status: 'idle' };

/**
 * Peut-on remettre le mot de passe de ce compte ?
 *
 * C'est LA barrière que le moteur n'applique pas. Partout ailleurs dans cette
 * plateforme, un refus vient du RLS ; ici l'appel se fait avec la clé de
 * service, qui contourne tout. Rien n'empêcherait techniquement un
 * administrateur d'organisation de se donner le mot de passe d'un éditeur,
 * voire d'un super-administrateur rattaché à la même organisation.
 *
 * La décision est donc extraite ici, en fonction pure, pour être testée pour
 * elle-même : une barrière qui n'existe qu'au milieu d'un appel réseau ne se
 * vérifie qu'en production, c'est-à-dire trop tard. Les trois conditions sont
 * CUMULATIVES, et chacune ferme un cas réel :
 *
 *  * même organisation — sinon l'écran atteint un autre tenant ;
 *  * rôle `host` — un éditeur ou un administrateur garde le sien ;
 *  * identifiant FABRIQUÉ — un compte créé par son titulaire, même devenu
 *    `host`, reste le sien ; son mot de passe ouvre peut-être autre chose.
 */
export type ResetVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string };

export function mayResetPassword(
  target: {
    readonly organisationId: string | null;
    readonly role: string;
    readonly email: string | null;
  },
  callerOrganisationId: string,
  host: string,
): ResetVerdict {
  if (target.organisationId === null || target.organisationId !== callerOrganisationId) {
    return {
      ok: false,
      code: 'PT403',
      message: 'Ce compte n’appartient pas à votre organisation.',
    };
  }
  if (target.role !== 'host' || !isStaffIdentifier(target.email, host)) {
    return {
      ok: false,
      code: 'PT403',
      message:
        'Ce compte a été créé par son titulaire : son mot de passe ne se remet pas à zéro depuis cet écran.',
    };
  }
  return { ok: true };
}
