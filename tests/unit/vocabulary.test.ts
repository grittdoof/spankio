import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Garde-fou de vocabulaire.
 *
 * Deux règles que l'interface ne doit pas enfreindre en silence :
 *
 *  1. « anonyme » est INTERDIT. La plateforme n'ajoute aucun identifiant
 *     technique, mais une réponse contient les champs que l'organisation a
 *     décidé de collecter — parfois un nom ou un courriel. Promettre
 *     l'anonymat serait faux dans le cas général.
 *
 *  2. aucun terme sectoriel. La plateforme est générique et revendable :
 *     l'interface ne peut pas présumer que le client est une mairie, une
 *     entreprise ou une association.
 *
 * Le test analyse le code SOURCE en retirant les commentaires : ceux-ci
 * peuvent légitimement parler de ces mots pour expliquer l'interdiction.
 */

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

const SCANNED_DIRS = [
  'app',
  'components',
  'lib/i18n',
  'lib/email',
  // Les modèles de sondages contiennent des libellés affichés au public.
  'lib/event',
  'lib/survey',
];

/** Mots dont la présence dans un texte affiché serait un mensonge. */
const FORBIDDEN_CLAIMS = [/\banonym\w*/i];

/** Termes qui présumeraient du secteur d'activité du client. */
const FORBIDDEN_SECTOR = [
  /\bmairie\w*/i,
  /\bmunicipal\w*/i,
  /\bcommunale?s?\b/i,
  /\bcitoyen\w*/i,
  /\badministrés?\b/i,
  /\bcollectivités?\b/i,
];

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Retire commentaires de bloc, commentaires de ligne et imports.
 * Volontairement simple : les sources du projet n'utilisent pas de séquences
 * exotiques qui piégeraient cette approche.
 */
function strippedSource(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .map((line) => line.replace(/\s\/\/.*$/, ''))
    .join('\n');
}

const files = (
  await Promise.all(SCANNED_DIRS.map((directory) => collectFiles(path.join(SRC, directory))))
).flat();

describe('vocabulaire de l’interface', () => {
  it('analyse effectivement des fichiers', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((file) => [path.relative(SRC, file), file] as const))(
    '%s ne promet pas l’anonymat',
    (_label, file) => {
      const source = strippedSource(file);
      for (const pattern of FORBIDDEN_CLAIMS) {
        const match = pattern.exec(source);
        expect(
          match,
          `« ${match?.[0] ?? ''} » est interdit : une réponse contient les champs ` +
            "que l'organisation a décidé de collecter, parfois nominatifs.",
        ).toBeNull();
      }
    },
  );

  it.each(files.map((file) => [path.relative(SRC, file), file] as const))(
    '%s n’emploie aucun terme sectoriel',
    (_label, file) => {
      const source = strippedSource(file);
      for (const pattern of FORBIDDEN_SECTOR) {
        const match = pattern.exec(source);
        expect(
          match,
          `« ${match?.[0] ?? ''} » présume du secteur du client : la plateforme est générique.`,
        ).toBeNull();
      }
    },
  );
});
