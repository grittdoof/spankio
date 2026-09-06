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
| Migrations | Les 24 migrations sont appliquées ; l'historique distant correspond exactement aux fichiers de `supabase/migrations` (`supabase db push` ne rejoue rien) |
| `pg_cron` | Actif. Purges planifiées : réponses expirées à 3 h 17, sondages supprimés à 3 h 37 |
| Storage | Buckets `survey-banners` (3 Mio) et `organisation-logos` (1 Mio), 4 policies chacun, types d'image restreints |
| Projet Vercel | `spankio`, relié à `grittdoof/spankio`, déploiement automatique sur `main` |
| Protection Vercel | SSO activée sur tous les déploiements (hors domaine personnalisé) : le site n'est accessible qu'aux membres de l'équipe |
| Node | `24.20.0` en CI (`.nvmrc`) et `24.x` sur Vercel. Si le réglage Vercel change, mettre `.nvmrc` à jour : la CI ne le lit pas depuis Vercel |

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

## Module événement

Le module `event` ajoute à un formulaire une date, un lieu, un organisateur et
une bannière, et alimente le fichier iCalendar ainsi que les liens d'itinéraire
proposés aux répondants.

### Bannières

Le bucket **`survey-banners`** est public en lecture et contraint en écriture,
côté Storage :

| Contrainte | Valeur | Vérifié |
| ---------- | ------ | ------- |
| Taille | 3 Mio | `413 EntityTooLarge` au-delà |
| Types | `image/jpeg`, `image/png`, `image/webp`, `image/avif` | `415 InvalidMimeType` pour un SVG |
| Dossier | `{organisation_id}/{survey_id}/` | RLS sur `storage.objects` |

Le SVG est exclu délibérément : c'est un document XML pouvant porter du script,
servi depuis une origine publique. Les trois contrôles ont été éprouvés sur le
projet réel, pas seulement déclarés.

L'image part **directement du navigateur vers Storage**, avec la session de
l'utilisateur : elle ne transite par aucune route Next. Le chemin enregistré
dans `surveys.banner_path` est ensuite revérifié côté serveur — le bucket étant
public, un chemin non contrôlé permettrait d'afficher le fichier d'un autre
tenant.

### Logos d'organisation

Le bucket **`organisation-logos`** est public en lecture et contraint en
écriture. Un logo peut aussi être désigné par un **lien externe**, sans dépôt.

| Contrainte | Valeur | Vérifié |
| ---------- | ------ | ------- |
| Taille | 1 Mio | `413 EntityTooLarge` au-delà |
| Types | `image/png`, `image/jpeg`, `image/webp`, `image/avif` | `415 InvalidMimeType` pour un SVG |
| Dossier | `{organisation_id}/` | RLS, réservé à l'**administrateur** de l'organisation |
| Dépôt anonyme | refusé | `403 new row violates row-level security policy` |

Les trois contrôles ont été éprouvés sur le projet réel. Le SVG est exclu pour
la même raison que sur les bannières : c'est un document XML pouvant porter du
script, servi depuis une origine publique.

L'URL enregistrée dans `organisations.logo_url` est revérifiée côté serveur :
un lien externe passe tel quel, une URL de notre bucket doit désigner le
dossier de l'organisation qui l'enregistre.

**À savoir pour un lien externe** : le site qui héberge l'image voit passer
l'adresse IP de chaque répondant qui ouvre un formulaire. L'interface le dit à
l'organisation, qui décide. C'est aussi ce qui empêchera de restreindre
`img-src` à l'étape 9 (risque R1).

### Géocodage (Nominatim / OpenStreetMap)

Toute recherche d'adresse passe par `/api/admin/geocode`. Le navigateur ne
contacte jamais Nominatim directement : la politique d'usage d'OSM impose un
`User-Agent` identifiant l'application et plafonne à **une requête par seconde
pour l'application entière**, et relayer évite de livrer à un tiers l'adresse IP
de chaque personne qui saisit une adresse.

- `NOMINATIM_USER_AGENT` (facultative) impose le `User-Agent` ; sans elle, il
  est composé à partir de `NEXT_PUBLIC_SITE_URL`. **Renseignez-la avec une
  adresse de contact avant toute mise en service à volume réel** : c'est ce que
  la politique d'OSM attend d'une application tierce.
- Le plafond d'une requête par seconde s'appuie sur `KV_REST_API_URL` /
  `KV_REST_API_TOKEN`. Sans store, il n'est tenu que **par instance** — voir le
  risque R12 de [CLAUDE.md](./CLAUDE.md).

Les tuiles sont chargées par Leaflet depuis `tile.openstreetmap.org` ; aucune
iframe n'est utilisée. À l'étape 9, la politique de sécurité de contenu devra
autoriser `tile.openstreetmap.org` en `img-src` et **ne pas** autoriser
`openstreetmap.org` en `frame-src`.

## Sections à compléter

Les procédures de déploiement (Vercel + Supabase CLI), de préproduction, de
configuration Resend/DMARC, d'activation de `pg_cron`, ainsi que le runbook de
sauvegarde/restauration et d'exercice du droit à l'effacement, seront rédigés
aux étapes correspondantes du plan (voir § 8 de [CLAUDE.md](./CLAUDE.md)).
