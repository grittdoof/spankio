/**
 * Source de vérité de la charte graphique.
 * `src/app/globals.css` exprime ces couleurs en oklch ; un test vérifie que les
 * deux ne divergent pas, et qu'aucune paire texte/fond ne descend sous WCAG AA.
 */

/** Couleurs de référence de la charte (hex), telles que fournies par le client. */
export const BRAND_HEX = {
  marine: '#042F64',
  azur: '#2F6FDB',
  rouge: '#E00114',
  grisBg: '#F2F3F7',
} as const;

/**
 * Tokens CSS attendus dans `globals.css` (thème clair), avec leur valeur hex de
 * référence. Toute dérive entre le CSS et cette table casse le test de design.
 */
export const CSS_TOKEN_HEX: Readonly<Record<string, string>> = {
  '--sp-marine': BRAND_HEX.marine,
  '--sp-marine-soft': '#0B4A96',
  '--sp-accent': BRAND_HEX.azur,
  '--sp-accent-hover': '#255CC0',
  '--sp-accent-text': '#255CC0',
  '--sp-accent-light': '#EAF1FD',
  '--sp-danger': BRAND_HEX.rouge,
  '--sp-danger-hover': '#B80010',
  '--sp-danger-text': '#B80010',
  '--sp-danger-light': '#FDEEEF',
  '--sp-success-text': '#0B6E3F',
  '--sp-success-light': '#EFF9F3',
  '--sp-warning-text': '#8A5008',
  '--sp-warning-light': '#FCF5E8',
  '--sp-bg': BRAND_HEX.grisBg,
  '--sp-surface': '#FFFFFF',
  '--sp-surface-muted': '#FAFAFC',
  '--sp-text': '#1A1D26',
  '--sp-text-muted': '#5A6273',
  '--sp-border': '#DDE1EA',
  '--sp-border-strong': '#828CA0',
  '--sp-on-accent': '#FFFFFF',
};

/**
 * Valeurs NON colorimétriques attendues dans `globals.css`.
 *
 * Elles vivent ici, et non dans les assertions du test, pour la même raison
 * que les couleurs : la charte doit être lisible d'un seul endroit. Le
 * commentaire dit lesquelles sont imposées par le client et lesquelles
 * relèvent de l'échelle retenue — sans quoi une valeur négociable et une
 * valeur contractuelle deviennent indistinguables.
 */
export const LAYOUT_TOKENS: Readonly<Record<string, string>> = {
  // Imposées par le client, jamais renégociées.
  '--sp-ease': 'cubic-bezier(0.4, 0, 0.2, 1)',
  '--sp-transition': '0.15s var(--sp-ease)',
  '--sp-sidebar-w': '248px',
  '--sp-tap': '44px',

  // Échelle retenue lors de la refonte : corps à 16px, rayons généreux.
  '--sp-radius-lg': '24px',
  '--sp-radius': '16px',
  '--sp-radius-sm': '12px',
  '--sp-radius-pill': '999px',
  '--sp-text-xs': '0.8125rem',
  '--sp-text-sm': '0.875rem',
  '--sp-text-body': '1rem',
  '--sp-text-lg': '1.125rem',
  '--sp-leading': '1.6',
  '--sp-leading-tight': '1.15',
};

/**
 * Échelle d'espacement. Sa progression est vérifiée : une valeur intercalée
 * au jugé (« 1.25rem parce que ça tombait mieux ») ferait perdre à l'échelle
 * la seule chose qui la rend utile, sa régularité.
 */
export const SPACE_SCALE_REM: readonly number[] = [
  0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6,
];

export interface ContrastRequirement {
  label: string;
  foreground: string;
  background: string;
  /**
   * 4.5 → texte normal (WCAG 1.4.3 AA).
   * 3   → grand texte, ou frontière de composant d'interface (1.4.11).
   */
  min: number;
}

const T = CSS_TOKEN_HEX;

/**
 * Paires réellement utilisées par l'interface. Toute nouvelle combinaison
 * texte/fond doit être ajoutée ici pour être vérifiée automatiquement.
 */
export const CONTRAST_REQUIREMENTS: readonly ContrastRequirement[] = [
  // Texte courant
  { label: 'texte / carte', foreground: T['--sp-text']!, background: T['--sp-surface']!, min: 4.5 },
  { label: 'texte / fond gris', foreground: T['--sp-text']!, background: T['--sp-bg']!, min: 4.5 },
  { label: 'texte / surface atténuée', foreground: T['--sp-text']!, background: T['--sp-surface-muted']!, min: 4.5 },
  { label: 'texte secondaire / carte', foreground: T['--sp-text-muted']!, background: T['--sp-surface']!, min: 4.5 },
  { label: 'texte secondaire / fond gris', foreground: T['--sp-text-muted']!, background: T['--sp-bg']!, min: 4.5 },
  { label: 'texte secondaire / surface atténuée', foreground: T['--sp-text-muted']!, background: T['--sp-surface-muted']!, min: 4.5 },

  // Titres
  { label: 'titre marine / carte', foreground: T['--sp-marine']!, background: T['--sp-surface']!, min: 4.5 },
  { label: 'titre marine / fond gris', foreground: T['--sp-marine']!, background: T['--sp-bg']!, min: 4.5 },
  { label: 'titre marine / fond tinté azur', foreground: T['--sp-marine']!, background: T['--sp-accent-light']!, min: 4.5 },
  { label: 'marine adouci / carte', foreground: T['--sp-marine-soft']!, background: T['--sp-surface']!, min: 4.5 },

  // Liens & accents textuels
  { label: 'lien azur / carte', foreground: T['--sp-accent-text']!, background: T['--sp-surface']!, min: 4.5 },
  { label: 'lien azur / fond gris', foreground: T['--sp-accent-text']!, background: T['--sp-bg']!, min: 4.5 },
  { label: 'lien azur / fond tinté azur', foreground: T['--sp-accent-text']!, background: T['--sp-accent-light']!, min: 4.5 },

  // `--sp-accent-light` est le fond de survol de plusieurs composants
  // (choix, échelle, navigation latérale, résultats de recherche) : tout ce qui
  // s'y écrit doit être vérifié, pas seulement les liens.
  { label: 'texte / fond tinté azur', foreground: T['--sp-text']!, background: T['--sp-accent-light']!, min: 4.5 },
  { label: 'texte secondaire / fond tinté azur', foreground: T['--sp-text-muted']!, background: T['--sp-accent-light']!, min: 4.5 },
  // Compteur principal du tableau de bord : chiffre marine et libellé azur sur
  // fond tinté.
  { label: 'compteur principal / fond tinté azur', foreground: T['--sp-marine']!, background: T['--sp-accent-light']!, min: 4.5 },

  // Boutons pleins : le texte est toujours blanc
  { label: 'bouton plein : blanc / azur', foreground: T['--sp-on-accent']!, background: T['--sp-accent']!, min: 4.5 },
  { label: 'bouton plein survolé : blanc / azur foncé', foreground: T['--sp-on-accent']!, background: T['--sp-accent-hover']!, min: 4.5 },
  { label: 'bouton destructif : blanc / rouge', foreground: T['--sp-on-accent']!, background: T['--sp-danger']!, min: 4.5 },
  { label: 'bouton destructif survolé : blanc / rouge foncé', foreground: T['--sp-on-accent']!, background: T['--sp-danger-hover']!, min: 4.5 },

  // États
  { label: 'erreur / carte', foreground: T['--sp-danger-text']!, background: T['--sp-surface']!, min: 4.5 },
  { label: 'erreur / fond gris', foreground: T['--sp-danger-text']!, background: T['--sp-bg']!, min: 4.5 },
  { label: 'erreur / fond tinté rouge', foreground: T['--sp-danger-text']!, background: T['--sp-danger-light']!, min: 4.5 },
  { label: 'succès / fond tinté vert', foreground: T['--sp-success-text']!, background: T['--sp-success-light']!, min: 4.5 },
  { label: 'succès / carte', foreground: T['--sp-success-text']!, background: T['--sp-surface']!, min: 4.5 },
  { label: 'alerte / fond tinté ambre', foreground: T['--sp-warning-text']!, background: T['--sp-warning-light']!, min: 4.5 },
  { label: 'alerte / carte', foreground: T['--sp-warning-text']!, background: T['--sp-surface']!, min: 4.5 },

  // Frontières de composants (WCAG 1.4.11 — 3:1)
  { label: 'bordure de champ / carte', foreground: T['--sp-border-strong']!, background: T['--sp-surface']!, min: 3 },
  { label: 'bordure de champ / fond gris', foreground: T['--sp-border-strong']!, background: T['--sp-bg']!, min: 3 },
  { label: 'bordure de champ focus / carte', foreground: T['--sp-accent']!, background: T['--sp-surface']!, min: 3 },
];
