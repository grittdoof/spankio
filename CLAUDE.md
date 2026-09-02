# CLAUDE.md — architecture, conventions et risques acceptés

Plateforme SaaS **multi-tenant** de sondages et d'inscriptions à des événements.
Générique par construction : aucune hypothèse de secteur (vocabulaire, champs,
base légale RGPD) n'est codée en dur. Chaque organisation a son espace isolé et
son branding ; la plateforme est revendable.

## 1. Stack

| Domaine        | Choix                                                      |
| -------------- | ---------------------------------------------------------- |
| Framework      | Next.js 15.5.25 (App Router), TypeScript strict            |
| Base / auth    | Supabase (PostgreSQL, Auth, Storage, RLS)                  |
| Hébergement    | Vercel (UE)                                                |
| Emails         | API REST Resend via `fetch` (aucun SDK)                    |
| Rate-limit     | Vercel KV / Upstash Redis via REST (aucun SDK)             |
| Tests          | Vitest — projets `unit`, `integration`, `rls`, `a11y`      |
| Cartographie   | Leaflet + tuiles OpenStreetMap (jamais d'iframe)           |

**Dépendances pinnées** (versions exactes, `save-exact=true`), lockfile
committé, Dependabot hebdomadaire.

## 2. Principe fondateur : schéma flexible

Le schéma d'un sondage vit dans `surveys.schema` (`jsonb`). Créer un nouveau
type de sondage ne demande **aucune migration SQL**. Réglages (textes, options,
mode événement, bannière, RGPD) → ce JSON ou des colonnes dédiées de `surveys`.
**Jamais une table par type de question.** Seul le binaire (bannières) va dans
un bucket Storage.

**Corollaire non négociable : validation serveur.** Toute soumission publique
est validée côté serveur contre le schéma du sondage — champs requis, types,
options autorisées, plafond de taille du payload. Le client n'est jamais cru.

## 3. Sécurité d'isolation

- **RLS-first.** Le chemin par défaut des routes API est le client Supabase
  authentifié, soumis au RLS. Le `service role` est l'**exception** (setup
  initial, cron, tâches super-admin) : chaque usage est commenté et justifié
  dans le code.
- **Aucune policy RLS récursive.** Les policies passent par des fonctions
  `SECURITY DEFINER` (`my_org_id()`, `my_role()`, …) qui contournent le RLS sur
  `profiles`.
- **Test d'isolation bloquant** (projet `rls`) : un utilisateur de
  l'organisation A ne peut ni lire ni écrire les données de B, route par route.

### Rôles

`super_admin` (plateforme, validation des inscriptions, activation des modules)
· `admin` (son organisation, ses membres, ses modules) · `editor` (sondages des
modules autorisés) · `viewer` (lecture seule, pas d'accès admin).

Une seule voie vers `admin`/`editor` : une **demande de rattachement** validée
par le super_admin, qui choisit le rôle **et** les modules autorisés. La
restriction des modules est **par utilisateur** (table d'overrides), pas
seulement par organisation.

## 4. Conventions de code

- `src/lib/**` : logique **pure et testable**, aucun accès réseau implicite.
- Accès aux secrets exclusivement via `serverEnv()` (`src/lib/config/env.ts`),
  qui lève une erreur s'il est appelé côté client.
- `dangerouslySetInnerHTML` est **interdit par ESLint** (anti-XSS stocké) :
  toute valeur issue d'une soumission est rendue comme texte.
- Design system : classes préfixées `sp-`, tokens CSS dans
  `src/app/globals.css`. La charte est décrite en TypeScript dans
  `src/lib/design/tokens.ts` et **un test échoue si le CSS dérive** de la charte
  ou si un contraste descend sous WCAG AA.
- Les listes déroulantes sont de vraies `<select>` natives.
- Modules Leaflet : `await import(...)` dans un effet (sinon crash SSR).
- Migrations SQL **toujours idempotentes** : `create or replace`,
  `drop policy if exists`, `create index if not exists`,
  `on conflict do nothing`.

## 5. RGPD — règle d'or

**Ce que la politique de confidentialité affirme doit correspondre exactement à
ce que le code collecte.**

- Aucune adresse IP, aucun user-agent stocké en base. L'IP n'existe que dans le
  store de rate-limit (haché, TTL court), jamais dans une table applicative.
  C'est la condition pour pouvoir écrire honnêtement « réponses anonymes ».
- Consentement : si `require_consent`, on stocke `consent_given` **et**
  `consent_text` (snapshot du texte affiché — preuve auditable).
- Anti-doublon : appliqué par une contrainte d'unicité réelle, jamais une
  colonne décorative.
- Les pages légales sont alimentées par `platform_settings` (singleton), jamais
  par des valeurs en dur.
- Base légale **choisie par l'organisation**, aucune valeur imposée par la
  plateforme.

## 6. Risques acceptés consciemment

Cette section est le contrat anti-dette silencieuse : tout garde-fou reporté y
figure, avec sa raison et sa condition de lever.

| # | Risque accepté | Raison | Lever quand |
| - | -------------- | ------ | ----------- |
| R1 | **CSP** : `unsafe-eval` toléré en développement (HMR de Next). Strict avec nonce en préproduction et production. | Le HMR de Next exige `eval`. | N/A (limite du framework). |
| R2 | **Rate-limit fail-open** : si le store KV est injoignable, la requête passe (log + alerte), avec un garde-fou mémoire par instance en second rideau. | Un `fail-closed` transformerait une panne KV en indisponibilité totale des soumissions publiques. | Si un abus réel est constaté, basculer en fail-closed sur `/api/public/submit` uniquement. |
| R3 | **a11y automatisée en jsdom** (axe-core) et non dans un vrai navigateur : le contraste calculé et l'ordre de focus réel ne sont pas couverts par axe. Les contrastes sont vérifiés par un test dédié sur les tokens ; la navigation clavier est testée par `user-event`. | Playwright + navigateur ajoute plusieurs minutes à chaque CI pour un MVP. | Avant la première revente à un client soumis au RGAA. |
| R4 | **Staging Vercel/Supabase, DNS (SPF/DKIM/DMARC), sauvegardes** : documentés dans le README, **non provisionnés**. | Nécessite l'accès aux comptes Vercel / Supabase / registrar. | À la remise des accès. |
| R5 | **`pg_cron`** : les migrations tolèrent l'absence de l'extension ; les purges restent appelables en RPC et via une route cron signée. | L'extension n'est pas disponible sur tous les plans Supabase ni sous PGlite (tests). | À l'activation de pg_cron sur le projet cible. |
| R6 | **ESLint 9** alors qu'ESLint 10 existe : `eslint-config-next@15` ne déclare pas la compatibilité ESLint 10. | Rester sur la stack imposée (Next 15). Outil de développement uniquement, aucune vulnérabilité connue. | À la migration Next 16. |
| R7 | **`postcss` surchargé** en 8.5.26 via `overrides` : Next 15 épingle 8.4.31, vulnérable (GHSA sourceMappingURL / XSS de stringify). Correctif amont = Next 16 (majeure). | Conserver Next 15 tout en gardant `npm audit` à zéro. `postcss` n'est utilisé qu'au build. | À la migration Next 16. |
| R8 | **Hors périmètre MVP** : i18n (interface en français uniquement, chaînes centralisées), champs d'upload de fichiers dans les sondages, webhooks, SSO, multi-région. | Périmètre MVP. | Sur demande client. |
| R9 | **Tests d'intégration sur PGlite** et non sur un vrai Supabase : `auth.uid()`, les rôles `anon`/`authenticated`/`service_role` et le schéma `auth` sont émulés par le harnais. Les policies et les contraintes testées sont en revanche le SQL réel de production. | Aucune dépendance à Docker ni à un projet Supabase : la CI reste rapide et hermétique. | Ajouter un job de préproduction rejouant les migrations sur un vrai Supabase à la remise des accès. |

## 7. Commandes

```bash
npm run dev         # serveur de développement
npm run verify      # tsc --noEmit + eslint + vitest  (ce que la CI exige)
npm run test        # les 4 projets Vitest
npm run build       # build de production
```

## 8. État d'avancement

- [x] Étape 1 — socle : dépendances pinnées, TS strict, ESLint, Vitest (4
      projets), CI bloquante, Dependabot, design system + tests de charte et de
      contraste, accès typé aux variables d'environnement.
- [ ] Étape 2 — migrations SQL + harnais PGlite + tests RLS/isolation.
- [ ] Étape 3 — auth, profils, demandes de rattachement, modules par utilisateur.
- [ ] Étape 4 — `src/lib` pur : validation de schéma/réponse, ICS, CSV.
- [ ] Étape 5 — renderer public + consentement + API de soumission.
- [ ] Étape 6 — builder visuel, tableau de bord, statistiques, exports.
- [ ] Étape 7 — module événement (bannière, Leaflet, agenda, itinéraire).
- [ ] Étape 8 — RGPD : `platform_settings`, pages légales, purges, effacement.
- [ ] Étape 9 — durcissement : CSP à nonce, Sentry, axe en CI, README final.
