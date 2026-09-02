# Plateforme de sondages et d'inscriptions

Plateforme SaaS multi-tenant permettant à toute organisation — entreprise,
association, établissement, collectivité — de recenser des besoins, sonder un
public et gérer des inscriptions à des événements.

L'architecture, les conventions et les **risques acceptés** sont documentés dans
[CLAUDE.md](./CLAUDE.md).

## Démarrage local

```bash
npm ci
cp .env.example .env.local   # puis renseigner les variables (voir ci-dessous)
npm run dev
```

Vérifier avant tout commit ce que la CI exige :

```bash
npm run verify
```

## Variables d'environnement

| Variable | Obligatoire | Rôle |
| -------- | ----------- | ---- |
| `NEXT_PUBLIC_SUPABASE_URL` | oui | URL du projet Supabase. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | oui | Clé anonyme, soumise au RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | oui | **Secret serveur.** Contourne le RLS : jamais exposé au client, jamais committé. |
| `NEXT_PUBLIC_SITE_URL` | oui | URL publique canonique (liens des emails, ICS). |
| `RESEND_API_KEY` | non | Envoi d'emails transactionnels. Absente → aucun email, aucune action métier en échec. |
| `EMAIL_FROM` | non | Expéditeur sur un domaine vérifié (SPF/DKIM/DMARC). |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | non | Rate-limit distribué (Vercel KV ou Upstash Redis). |
| `SENTRY_DSN` | non | Observabilité. Absente → les erreurs restent dans les logs structurés. |
| `CRON_SECRET` | non | Secret partagé protégeant les routes `/api/cron/*`. |
| `NOMINATIM_USER_AGENT` | non | User-Agent conforme pour le proxy de géocodage. |

`.env.example` liste ces variables sans aucune valeur.

## Tests

```bash
npm run test                       # tous les projets
npx vitest run --project unit         # logique pure
npx vitest run --project integration  # routes API sur PGlite
npx vitest run --project rls          # isolation multi-tenant (bloquant)
npx vitest run --project a11y         # axe-core sur les écrans publics
```

Les tests base de données tournent sur **PGlite** (PostgreSQL en processus) :
les migrations réelles sont rejouées, `auth.uid()` et les rôles Supabase sont
émulés. Aucun Docker, aucun projet Supabase, aucun secret réel nécessaire.

## Sections à compléter

Les procédures de déploiement (Vercel + Supabase CLI), de préproduction, de
configuration Resend/DMARC, d'activation de `pg_cron`, ainsi que le runbook de
sauvegarde/restauration et d'exercice du droit à l'effacement, seront rédigés
aux étapes correspondantes du plan (voir § 8 de [CLAUDE.md](./CLAUDE.md)).
