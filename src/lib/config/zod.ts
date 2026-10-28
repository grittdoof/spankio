import { z } from 'zod';

/**
 * Point d'entrée UNIQUE de zod, et seul endroit où la bibliothèque est
 * configurée.
 *
 * Pourquoi ce détour plutôt qu'un `import { z } from 'zod'` partout : les
 * messages d'erreur par défaut de zod sont rendus TELS QUELS à l'utilisateur.
 * L'éditeur de sondage énumère les refus du serveur
 * (`SurveyBuilder` : `Object.values(result.fields)`), et la recherche
 * d'adresse renvoie `issues[0].message` comme message d'erreur de la route.
 * Sans configuration, une interface entièrement française affiche
 * « Invalid input: expected string, received undefined ».
 *
 * zod 3 n'offrait qu'un `errorMap` global à écrire soi-même ; zod 4 fournit
 * les traductions, et `z.config()` les installe pour TOUTES les instances de
 * la bibliothèque. Cet appel doit donc avoir eu lieu avant le premier
 * `safeParse`, ce que ce module garantit par construction : tout schéma de
 * l'application importe `z` d'ici, donc charge cette ligne avant d'exister.
 *
 * Une règle ESLint interdit l'import direct de `zod` dans `src/` : un seul
 * fichier qui l'oublierait rendrait ses propres messages anglais, et
 * l'incohérence ne se verrait que sur l'écran concerné.
 */
z.config(z.locales.fr());

export { z };
