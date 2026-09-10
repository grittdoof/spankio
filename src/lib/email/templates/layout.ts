import { escapeHtml, safeUrl } from '@/lib/security/escape';

/**
 * Gabarit d'email charté.
 *
 * Les emails sont rendus par des clients qui ignorent les feuilles de style
 * externes : tout est en styles en ligne et en tableaux. Les couleurs sont
 * exprimées en hexadécimal (oklch n'est pas supporté par les clients mail).
 *
 * OUTLOOK SOUS WINDOWS REND AVEC LE MOTEUR DE WORD, et c'est la contrainte qui
 * dicte deux choix de ce fichier. Il ignore `max-width` : le gabarit est donc
 * doublé d'un tableau conditionnel `[if mso]` de largeur FIXE, sans quoi la
 * carte occupait toute la largeur du volet de lecture. Et il ignore
 * `height: auto` : les attributs d'une image portent donc ses dimensions
 * d'affichage, jamais celles de la source (voir `displayedImageSize`). Les
 * deux vont ensemble — une image de largeur fixe dans une carte de largeur
 * indéterminée resterait déformée.
 *
 * Toute valeur venant d'une organisation est échappée, et les URL sont
 * filtrées : le branding est une donnée, donc une entrée non fiable.
 */

/**
 * LARGEUR DE LA COLONNE DE CONTENU, en pixels.
 *
 * Le gabarit fait 560 de large et la carte 28 de marge de chaque côté : une
 * image y est donc affichée à 504. Ce nombre n'est pas décoratif — c'est celui
 * qui doit figurer dans les ATTRIBUTS `width`/`height` de l'image, voir
 * `displayedImageSize`.
 */
const EMAIL_SHELL_WIDTH = 560;
const EMAIL_CARD_PADDING = 28;
export const EMAIL_CONTENT_WIDTH = EMAIL_SHELL_WIDTH - EMAIL_CARD_PADDING * 2;

/**
 * Dimensions AFFICHÉES d'une image, calculées depuis ses dimensions sources.
 *
 * DÉFAUT RÉEL, signalé sur Outlook 2608 (M365 Apps) : le visuel arrivait
 * écrasé. Les attributs portaient les dimensions de la SOURCE (1200 × 704) et
 * le rapport de forme n'était tenu que par `height: auto` en CSS. Or le moteur
 * de rendu d'Outlook sous Windows est celui de Word : il ignore `height: auto`
 * et applique l'attribut `height`, tout en ramenant la largeur à celle de la
 * cellule. Une image de 1200 × 704 se retrouvait donc affichée en 504 × 704 —
 * un tiers plus haute que large. Aucun autre client ne montrait le défaut,
 * parce que tous les autres respectent `height: auto`.
 *
 * La correction est de faire porter aux attributs les dimensions RÉELLES
 * d'affichage : le rapport de forme est alors juste même quand `height: auto`
 * est ignoré. Une image plus petite que la colonne n'est pas agrandie.
 *
 * L'arrondi de la hauteur introduit au plus un demi-pixel d'écart de rapport
 * (504 × 704 / 1200 = 295,68 → 296, soit 0,1 %) : invisible, et préférable à
 * une hauteur décimale que certains clients tronquent.
 */
export function displayedImageSize(source: {
  readonly width: number;
  readonly height: number;
}): { readonly width: number; readonly height: number | null } {
  const ratioIsKnown =
    Number.isFinite(source.width) &&
    Number.isFinite(source.height) &&
    source.width > 0 &&
    source.height > 0;

  // Sans rapport de forme exploitable, on n'invente pas de hauteur : l'attribut
  // est omis, et le client la déduit lui-même de l'image. Un `height="NaN"`
  // serait pire que pas de hauteur du tout.
  if (!ratioIsKnown) return { width: EMAIL_CONTENT_WIDTH, height: null };

  const width = Math.min(Math.round(source.width), EMAIL_CONTENT_WIDTH);
  return { width, height: Math.round((width * source.height) / source.width) };
}

/** Couleurs de la charte, en hexadécimal pour les clients mail. */
const CHARTE = {
  marine: '#042F64',
  accent: '#2F6FDB',
  text: '#1A1D26',
  muted: '#5A6273',
  border: '#DDE1EA',
  background: '#F2F3F7',
  surface: '#FFFFFF',
} as const;

export interface EmailBranding {
  /** Nom affiché : celui de l'organisation, ou celui de la plateforme. */
  organisationName: string;
  logoUrl?: string | null;
  /** Couleur d'accent de l'organisation, hexadécimal uniquement. */
  accentColor?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  /** URL publique du service, pour le pied de page légal. */
  siteUrl?: string | null;
  /** Adresse postale, affichée en petit dans le pied de page. */
  postalAddress?: string | null;
}

/**
 * N'accepte qu'un hexadécimal : empêche l'injection de CSS arbitraire dans
 * l'attribut `style` via le branding d'une organisation.
 */
export function safeHexColor(value: string | null | undefined, fallback: string): string {
  const raw = (value ?? '').trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw) ? raw : fallback;
}

export interface EmailBlock {
  /** Paragraphe de texte simple. */
  paragraph?: string;
  /** Liste à puces. */
  bullets?: readonly string[];
  /** Bouton d'action. */
  action?: { label: string; url: string };
  /** Plusieurs liens sur une même ligne (itinéraires, agendas…). */
  links?: readonly { label: string; url: string }[];
  /** Bloc de citation (motif de refus, message du demandeur…). */
  quote?: string;
  /**
   * Image pleine largeur : le visuel d'un événement.
   *
   * `alt` est VIDE à dessein. Une bannière d'invitation est décorative — son
   * contenu est répété en texte juste en dessous — et beaucoup de clients mail
   * bloquent les images par défaut : un `alt` bavard laisserait alors un pavé
   * de texte à la place du visuel.
   */
  image?: { url: string; width: number; height: number };
  /** Faits alignés (date, lieu, accès) : intitulé en gris, valeur en dessous. */
  facts?: readonly { label: string; value: string }[];
}

export interface EmailContent {
  title: string;
  preheader: string;
  blocks: readonly EmailBlock[];
  branding: EmailBranding;
  /** Liens légaux ajoutés au pied de page. */
  legalLinks?: readonly { label: string; url: string }[];
}

/**
 * Texte multiligne, en HTML de COURRIEL.
 *
 * DÉFAUT RÉEL, signalé par le client : le champ « Accès » se rédige en liste —
 * métro, bus, parking — et arrivait sur une seule ligne. Le rendu s'appuyait
 * sur `white-space: pre-line`, que le moteur de Word — donc Outlook sous
 * Windows — n'applique pas. Un test le vérifiait pourtant… en cherchant la
 * propriété CSS dans la source, c'est-à-dire en constatant qu'on l'avait bien
 * écrite, pas qu'elle produisait des lignes. Même leçon que pour le rapport de
 * forme d'une image : ne pas vérifier ce qu'on ÉMET, mais ce qui est RENDU.
 *
 * Un `<br />` réel est compris de tous les clients, Outlook inclus. L'ordre
 * compte : on échappe D'ABORD, on insère les balises ENSUITE — l'inverse
 * échapperait les `<br />` eux-mêmes, qui s'afficheraient en clair.
 */
function escapeMultiline(value: string): string {
  return escapeHtml(value)
    // CRLF et CR isolés : un texte collé depuis Windows ou un vieux Mac ne
    // doit pas produire deux sauts, ni aucun.
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .join('<br />');
}

function renderBlockHtml(block: EmailBlock, accent: string): string {
  const parts: string[] = [];

  if (block.paragraph) {
    parts.push(
      `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:${CHARTE.text};">${escapeHtml(
        block.paragraph,
      )}</p>`,
    );
  }

  if (block.bullets?.length) {
    const items = block.bullets
      .map(
        (item) =>
          `<li style="margin:0 0 6px;font-size:15px;line-height:1.5;color:${CHARTE.text};">${escapeHtml(
            item,
          )}</li>`,
      )
      .join('');
    parts.push(`<ul style="margin:0 0 16px;padding-left:20px;">${items}</ul>`);
  }

  if (block.quote) {
    parts.push(
      `<blockquote style="margin:0 0 16px;padding:12px 16px;background:${CHARTE.background};` +
        `border-left:3px solid ${accent};border-radius:8px;font-size:15px;line-height:1.5;` +
        `color:${CHARTE.text};">${escapeHtml(block.quote)}</blockquote>`,
    );
  }

  if (block.image) {
    const url = safeUrl(block.image.url);
    if (url) {
      // Les attributs portent les dimensions d'AFFICHAGE, jamais celles de la
      // source : c'est ce qui tient le rapport de forme chez les clients qui
      // ignorent `height: auto` — Outlook sous Windows en tête.
      const size = displayedImageSize(block.image);
      parts.push(
        `<img src="${escapeHtml(url)}" alt="" width="${size.width}" ` +
          (size.height === null ? '' : `height="${size.height}" `) +
          `style="display:block;width:100%;max-width:${size.width}px;` +
          // `-ms-interpolation-mode` : sans lui, Outlook et IE redimensionnent
          // au plus proche voisin, ce qui crénèle un visuel réduit.
          `height:auto;border:0;border-radius:12px;margin:0 0 18px;` +
          `-ms-interpolation-mode:bicubic;" />`,
      );
    }
  }

  if (block.facts?.length) {
    const rows = block.facts
      .map(
        (fact) =>
          `<tr><td style="padding:0 0 12px;">` +
          `<div style="font-size:12px;line-height:1.4;color:${CHARTE.muted};` +
          `text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(fact.label)}</div>` +
          // La valeur d'un fait peut être multiligne — l'accès à un lieu se
          // rédige en liste. Les sauts deviennent des `<br />`, jamais un
          // `white-space: pre-line` : voir `escapeMultiline`.
          `<div style="font-size:15px;line-height:1.45;color:${CHARTE.text};` +
          `font-weight:600;">${escapeMultiline(fact.value)}</div>` +
          `</td></tr>`,
      )
      .join('');
    parts.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" ` +
        `style="margin:0 0 8px;">${rows}</table>`,
    );
  }

  if (block.links?.length) {
    const items = block.links
      .map((link) => {
        const url = safeUrl(link.url);
        return url
          ? `<a href="${escapeHtml(url)}" style="display:inline-block;margin:0 12px 8px 0;` +
              `font-size:14px;font-weight:600;color:${accent};text-decoration:underline;">` +
              `${escapeHtml(link.label)}</a>`
          : null;
      })
      .filter((value): value is string => value !== null)
      .join('');
    if (items) parts.push(`<p style="margin:0 0 16px;">${items}</p>`);
  }

  if (block.action) {
    const url = safeUrl(block.action.url);
    if (url) {
      parts.push(
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">` +
          `<tr><td style="border-radius:10px;background:${accent};">` +
          `<a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 22px;` +
          `font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;">` +
          `${escapeHtml(block.action.label)}</a></td></tr></table>`,
      );
    }
  }

  return parts.join('');
}

function renderBlockText(block: EmailBlock): string {
  const parts: string[] = [];
  if (block.paragraph) parts.push(block.paragraph);
  if (block.bullets?.length) parts.push(block.bullets.map((b) => `- ${b}`).join('\n'));
  // L'image n'a pas d'équivalent textuel : elle est décorative, et son contenu
  // est déjà dit par les faits qui la suivent.
  if (block.facts?.length) {
    parts.push(block.facts.map((fact) => `${fact.label} : ${fact.value}`).join('\n'));
  }
  if (block.quote) parts.push(`« ${block.quote} »`);
  if (block.links?.length) {
    const lines = block.links
      .map((link) => {
        const url = safeUrl(link.url);
        return url ? `${link.label} : ${url}` : null;
      })
      .filter((value): value is string => value !== null);
    if (lines.length > 0) parts.push(lines.join('\n'));
  }
  if (block.action) {
    const url = safeUrl(block.action.url);
    if (url) parts.push(`${block.action.label} : ${url}`);
  }
  return parts.join('\n\n');
}

export function renderEmail(content: EmailContent): { html: string; text: string } {
  const accent = safeHexColor(content.branding.accentColor, CHARTE.accent);
  const logo = safeUrl(content.branding.logoUrl);
  const name = escapeHtml(content.branding.organisationName);

  const header = logo
    ? `<img src="${escapeHtml(logo)}" alt="${name}" width="140" ` +
      `style="display:block;max-width:140px;height:auto;border:0;" />`
    : `<span style="font-size:18px;font-weight:700;color:${CHARTE.marine};">${name}</span>`;

  const contactLines: string[] = [];
  if (content.branding.contactEmail) contactLines.push(content.branding.contactEmail);
  if (content.branding.contactPhone) contactLines.push(content.branding.contactPhone);
  if (content.branding.postalAddress) contactLines.push(content.branding.postalAddress);

  const legal = (content.legalLinks ?? [])
    .map((link) => {
      const url = safeUrl(link.url);
      return url
        ? `<a href="${escapeHtml(url)}" style="color:${CHARTE.muted};text-decoration:underline;">${escapeHtml(
            link.label,
          )}</a>`
        : null;
    })
    .filter((value): value is string => value !== null)
    .join(' &middot; ');

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(content.title)}</title>
</head>
<body style="margin:0;padding:0;background:${CHARTE.background};">
<div style="display:none;font-size:1px;color:${CHARTE.background};max-height:0;overflow:hidden;">${escapeHtml(
    content.preheader,
  )}</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${CHARTE.background};">
<tr><td align="center" style="padding:32px 16px;">
<!--[if mso]>
<table role="presentation" cellpadding="0" cellspacing="0" width="${EMAIL_SHELL_WIDTH}" align="center"><tr><td>
<![endif]-->
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:${EMAIL_SHELL_WIDTH}px;">
<tr><td style="padding:0 0 20px;">${header}</td></tr>
<tr><td style="background:${CHARTE.surface};border:1px solid ${CHARTE.border};border-radius:16px;padding:28px;">
<h1 style="margin:0 0 18px;font-size:22px;line-height:1.25;color:${CHARTE.marine};">${escapeHtml(
    content.title,
  )}</h1>
${content.blocks.map((block) => renderBlockHtml(block, accent)).join('')}
</td></tr>
<tr><td style="padding:20px 4px 0;font-size:13px;line-height:1.5;color:${CHARTE.muted};">
<p style="margin:0 0 6px;">${name}${
    contactLines.length ? ` &middot; ${escapeHtml(contactLines.join(' &middot; '))}` : ''
  }</p>
${legal ? `<p style="margin:0;">${legal}</p>` : ''}
</td></tr>
</table>
<!--[if mso]>
</td></tr></table>
<![endif]-->
</td></tr>
</table>
</body>
</html>`;

  const textParts = [
    content.title,
    '',
    ...content.blocks.map(renderBlockText).filter((part) => part !== ''),
    '',
    '—',
    content.branding.organisationName,
    ...contactLines,
    ...(content.legalLinks ?? [])
      .map((link) => {
        const url = safeUrl(link.url);
        return url ? `${link.label} : ${url}` : null;
      })
      .filter((value): value is string => value !== null),
  ];

  return { html, text: textParts.join('\n') };
}
