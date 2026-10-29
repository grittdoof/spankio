/**
 * Empreinte SHA-256, en hexadécimal.
 *
 * `crypto.subtle` plutôt que `node:crypto` : le même code doit fonctionner
 * dans une action serveur, dans une route et dans un test, sans dépendre du
 * moteur. C'est déjà le choix fait par le rate-limit pour hacher l'adresse IP.
 *
 * Le format — hexadécimal minuscule — est celui qu'`encode(..., 'hex')` rend
 * côté PostgreSQL. Les deux doivent coïncider exactement, puisqu'une
 * invitation est posée par l'un et relue par l'autre.
 */
export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
