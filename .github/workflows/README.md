# CI

Trois jobs, tous bloquants sur les pull requests vers `main` :

| Job       | Contenu                                                                    |
| --------- | -------------------------------------------------------------------------- |
| `quality` | `npm ci` · `tsc --noEmit` · `eslint` · `vitest` (unit + integration + rls + a11y) · `next build` |
| `audit`   | `npm audit --audit-level=high`                                             |
| `secrets` | `gitleaks` sur l'historique complet                                        |

Les tests d'intégration et d'isolation tournent sur PGlite (Postgres en
processus) : la CI n'a besoin d'aucun projet Supabase ni d'aucun secret réel.

Pour rendre ces jobs bloquants côté GitHub, exiger `quality`, `audit` et
`secrets` dans les *branch protection rules* de `main`.
