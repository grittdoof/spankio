/**
 * Échappement de valeurs destinées à du HTML construit à la main.
 *
 * Le seul HTML assemblé par chaînes dans ce projet est celui des emails : React
 * échappe déjà tout le reste, et `dangerouslySetInnerHTML` est interdit par
 * ESLint. Toute valeur venant d'une organisation ou d'une soumission passe ici.
 */
const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ENTITIES[char] ?? char);
}

/**
 * N'autorise que des URL http(s) ou mailto. Renvoie null pour tout le reste,
 * ce qui neutralise `javascript:` et `data:` dans un lien d'email.
 */
export function safeUrl(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (raw === '') return null;
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
}
