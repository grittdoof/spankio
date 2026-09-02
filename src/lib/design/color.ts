/**
 * Conversions de couleur pures (sRGB ↔ OKLCh) et calcul de contraste WCAG.
 * Aucune dépendance : utilisé par les tests qui vérifient que les tokens CSS
 * correspondent bien à la charte et respectent WCAG 2.1 AA.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Oklch {
  /** Luminosité perceptuelle, 0 → 1. */
  l: number;
  /** Chroma, 0 → ~0.4. */
  c: number;
  /** Teinte en degrés, 0 → 360. */
  h: number;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export function hexToRgb(hex: string): Rgb {
  const raw = hex.trim().replace(/^#/, '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Couleur hexadécimale invalide : ${hex}`);
  }
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (n: number): string =>
    Math.round(clamp01(n) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

/** Luminance relative WCAG (0 = noir, 1 = blanc). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (
    0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
  );
}

/** Ratio de contraste WCAG entre deux couleurs (1 → 21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function hexToOklch(hex: string): Oklch {
  const { r, g, b } = hexToRgb(hex);
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const c = Math.sqrt(A * A + B * B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;

  return { l: L, c, h };
}

export function oklchToHex({ l, c, h }: Oklch): string {
  const hRad = (h * Math.PI) / 180;
  const A = c * Math.cos(hRad);
  const B = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = l - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = l - 0.0894841775 * A - 1.291485548 * B;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  return rgbToHex({
    r: linearToSrgb(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    g: linearToSrgb(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    b: linearToSrgb(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
  });
}

const OKLCH_RE =
  /oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*[\d.]+%?\s*)?\)/i;

/** Parse une déclaration CSS `oklch(L% C H)`. Renvoie null si non reconnue. */
export function parseOklch(value: string): Oklch | null {
  const m = OKLCH_RE.exec(value);
  if (!m?.[1] || m[2] === undefined || m[3] === undefined) return null;
  return { l: Number(m[1]) / 100, c: Number(m[2]), h: Number(m[3]) };
}
