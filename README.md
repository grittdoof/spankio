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

## Environnements provisionnés

| Élément | État |
| ------- | ---- |
| Projet Supabase | `spankio` (`qmhjckioehsiduongadk`), PostgreSQL 17.6, région `eu-west-2` |
| Migrations | Les 21 migrations sont appliquées ; l'historique distant correspond exactement aux fichiers de `supabase/migrations` (`supabase db push` ne rejoue rien) |
| `pg_cron` | Actif. Purges planifiées : réponses expirées à 3 h 17, sondages supprimés à 3 h 37 |
| Storage | Bucket `survey-banners` créé, 4 policies |
| Projet Vercel | `spankio`, relié à `grittdoof/spankio`, déploiement automatique sur `main` |
| Protection Vercel | SSO activée sur tous les déploiements (hors domaine personnalisé) : le site n'est accessible qu'aux membres de l'équipe |

### Reste à faire avant une mise en service

1. **Variables d'environnement Vercel** (Settings → Environment Variables). Sans
   elles, les pages publiques s'affichent mais toute action touchant la base
   échoue — le middleware referme les espaces protégés et journalise l'erreur.

   | Variable | Valeur |
   | -------- | ------ |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://qmhjckioehsiduongadk.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clé `anon` du projet (Supabase → Settings → API Keys) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Clé `service_role` du même écran — **secret**, à ne coller que dans Vercel |
   | `NEXT_PUBLIC_SITE_URL` | URL publique retenue (domaine personnalisé ou URL Vercel) |

   Puis, dans Supabase → Authentication → URL Configuration, régler `Site URL`
   et ajouter `<URL publique>/auth/callback` aux *Redirect URLs*, sinon les
   liens de confirmation et de réinitialisation ne reviendront pas sur le site.

2. **Premier super administrateur.** Créer un compte par `/inscription`, puis
   l'élever une seule fois depuis l'éditeur SQL Supabase :

   ```sql
   update public.profiles
      set role = 'super_admin', status = 'active', organisation_id = null
    where email = 'votre.adresse@exemple.test';
   ```

   Le trigger anti-escalade autorise cette écriture parce qu'aucun JWT n'est
   présent (contexte serveur de confiance) ; aucun compte ne peut se l'accorder
   par l'application.

3. **Réglages de plateforme.** Renseigner `platform_settings` (éditeur,
   hébergeur, DPO, autorité de contrôle, adresse d'exercice des droits,
   `notifications_email`). Les pages légales affichent « Non renseigné » pour
   tout champ vide — elles ne fabriquent aucune valeur.

4. **Région et politique de confidentialité.** Le projet Supabase est en
   `eu-west-2`, c'est-à-dire **Londres (Royaume-Uni)**, alors que la politique
   de confidentialité écrite dans l'application annonce un hébergement en
   *Union européenne*. Deux issues, au choix : recréer le projet en `eu-west-3`
   (Paris) ou `eu-central-1` (Francfort) — les migrations étant idempotentes,
   l'opération prend quelques minutes sur une base vide — ou corriger le
   tableau des sous-traitants pour mentionner le Royaume-Uni et sa décision
   d'adéquation. **Ne pas laisser les deux en contradiction.**

5. **Resend, KV et Sentry** : `RESEND_API_KEY`, `EMAIL_FROM` (domaine vérifié
   avec SPF/DKIM/DMARC), `KV_REST_API_URL` / `KV_REST_API_TOKEN`, `SENTRY_DSN`.
   Toutes optionnelles : leur absence dégrade proprement (aucun email envoyé,
   rate-limit réduit au garde-fou mémoire), jamais silencieusement.

## Sections à compléter

Les procédures de déploiement (Vercel + Supabase CLI), de préproduction, de
configuration Resend/DMARC, d'activation de `pg_cron`, ainsi que le runbook de
sauvegarde/restauration et d'exercice du droit à l'effacement, seront rédigés
aux étapes correspondantes du plan (voir § 8 de [CLAUDE.md](./CLAUDE.md)).
