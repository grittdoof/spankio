import { escapeHtml, safeUrl } from '@/lib/security/escape';

/**
 * Gabarit d'email charté.
 *
 * Les emails sont rendus par des clients qui ignorent les feuilles de style
 * externes : tout est en styles en ligne et en tableaux. Les couleurs sont
 * exprimées en hexadécimal (oklch n'est pas supporté par les clients mail).
 *
 * Toute valeur venant d'une organisation est échappée, et les URL sont
 * filtrées : le branding est une donnée, donc une entrée non fiable.
 */

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
      parts.push(
        `<img src="${escapeHtml(url)}" alt="" width="${block.image.width}" ` +
          `height="${block.image.height}" style="display:block;width:100%;max-width:100%;` +
          `height:auto;border:0;border-radius:12px;margin:0 0 18px;" />`,
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
          `<div style="font-size:15px;line-height:1.45;color:${CHARTE.text};` +
          `font-weight:600;">${escapeHtml(fact.value)}</div></td></tr>`,
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
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;">
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
