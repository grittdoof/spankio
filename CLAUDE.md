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

**Version de Node** : `.nvmrc` fixe **24.20.0**, et la CI le lit
(`node-version-file`). C'est la version que Vercel exécute — un test qui
passerait sur un moteur que la production n'utilise pas ne prouverait pas
grand-chose. Attention au couplage : la version de Vercel est un réglage de
projet, pas une lecture de `.nvmrc` ; changer l'un sans l'autre les fait
diverger à nouveau. `engines` reste à `>=22.11.0`, qui est le plancher
réellement supporté (et la version du poste de développement actuel).

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

**Les deux autorités s'additionnent.** Un super administrateur PEUT appartenir
à une organisation : l'éditeur de la plateforme est souvent aussi
l'administrateur de la première organisation cliente. Deux conséquences, sans
lesquelles le rattachement serait cosmétique :

- `app.can_write_surveys()` accepte le rôle `super_admin` rattaché, sinon il ne
  pourrait pas créer de sondage dans SA propre organisation alors qu'il peut
  modifier ceux de toutes les autres ;
- `approve_membership_request` **préserve** le rôle plateforme au lieu de
  l'écraser. Sans cela, valider la demande d'un super administrateur le
  privait de son rôle — et pouvait laisser la plateforme sans personne pour
  valider les demandes suivantes. L'audit garde la trace de la préservation
  (`platform_role_preserved`).

Partout ailleurs, l'autorité plateforme (`app.is_super_admin()`) englobe déjà
les droits d'un administrateur d'organisation : aucune policy n'a eu besoin de
changer.

## 4. Conventions de code

- `src/lib/**` : logique **pure et testable**, aucun accès réseau implicite.
- **Le texte de consentement est composé par le SERVEUR**, jamais transmis par
  le client. `survey_responses.consent_text` est une preuve auditable : si elle
  venait de la requête, n'importe qui pourrait soumettre le texte de son choix.
  Le rendu public affiche exactement le même texte, produit par la même
  fonction (`src/lib/survey/consent.ts`).
- **La validation côté client EST celle du serveur.** Le rendu appelle
  `validateResponse` avec le schéma et n'affiche que les erreurs du champ
  courant. Il n'existe aucune règle « d'interface » : l'écran ne peut donc pas
  accepter ce que le serveur refusera, ni l'inverse.
- **Une condition se compose sur des listes fermées, jamais à la main.** Les
  opérateurs proposés dépendent du type de la question observée
  (`conditionOperators`) et les valeurs viennent de ses propres options
  (`conditionValues`) : comparer à une chaîne tapée au clavier donnerait une
  condition qui ne se déclenche jamais dès qu'un caractère diffère, sans que
  rien ne le signale. `equals` n'est pas proposé sur une case à cocher
  multiple — il échouerait dès qu'une seconde case est cochée, la réponse
  cessant d'être une valeur unique. Défaut réel corrigé : l'éditeur ne savait
  écrire que `answered`, si bien qu'une question conditionnée apparaissait dès
  qu'une réponse — n'importe laquelle — avait été donnée. Le moteur, lui,
  évaluait déjà les six opérateurs.
- **Les conditions combinées (`all` / `any`) ne se construisent pas dans
  l'éditeur.** Il les reconnaît, affiche qu'il ne sait pas les modifier, et
  n'offre que de les supprimer — les éditer par bribes les écraserait au
  premier changement.
- **Une seule implémentation des conditions.** `src/lib/survey/conditions.ts`
  sert au rendu public (quel écran afficher) ET à la validation serveur (quel
  champ est requis). Deux implémentations divergeraient, et le serveur finirait
  par exiger un champ jamais affiché — ou accepter un champ masqué.
- **Validation des soumissions en liste blanche.** Une clé inconnue du schéma
  est refusée, pas ignorée ; un champ masqué par une condition est retiré sans
  erreur (un répondant qui change d'avis laisse des valeurs devenues
  inapplicables) ; et aucune valeur n'est recopiée telle quelle — chacune est
  reconstruite depuis le schéma.
- **Rien n'est inventé dans les données sortantes.** Un événement sans heure de
  fin ne reçoit pas un `DTEND` d'une heure ; un `ORGANIZER` sans adresse est
  omis plutôt qu'émis invalide ; une page légale affiche « Non renseigné ».
- **Les exports CSV neutralisent les formules.** Une réponse commençant par
  `=`, `+`, `-` ou `@` est préfixée d'une apostrophe : dans un tableur, une
  telle valeur est du code exécuté, pas un problème d'affichage.
- **Aucun caractère de contrôle littéral dans les sources.** Les plages
  interdites sont exprimées en points de code numériques : un source contenant
  de vrais caractères invisibles est illisible et se corrompt au copier-coller.
- Accès aux secrets exclusivement via `serverEnv()` (`src/lib/config/env.ts`),
  qui lève une erreur s'il est appelé côté client.
- `dangerouslySetInnerHTML` est **interdit par ESLint** (anti-XSS stocké) :
  toute valeur issue d'une soumission est rendue comme texte.
- Design system : classes préfixées `sp-`, tokens CSS dans
  `src/app/globals.css`. La charte est décrite en TypeScript dans
  `src/lib/design/tokens.ts` et **un test échoue si le CSS dérive** de la charte
  ou si un contraste descend sous WCAG AA. `tokens.ts` distingue explicitement
  les valeurs **imposées par le client** (couleurs, Montserrat, `--sp-ease`,
  `--sp-transition`, `248px`, `44px`) de celles **retenues à la refonte**
  (corps 16px, rayons 12/16/24, interlignes) : sans cette distinction, une
  valeur négociable et une valeur contractuelle deviennent indistinguables.
- **Une échelle, pas des valeurs au jugé.** Les espacements viennent de
  `--sp-space-1..9` (4 → 96px) ; un cran surnuméraire fait échouer le test,
  parce qu'une échelle qu'on complète au coup par coup n'en est plus une.
  L'échelle typographique fluide est réservée aux GRANDS niveaux : un corps de
  texte qui change de taille avec la fenêtre gêne la lecture, un titre non —
  et le test le vérifie dans les deux sens.
- **Les micro-animations rassurent, elles ne portent jamais d'information.**
  Toutes passent par `--sp-motion-*` et sont neutralisées en bloc par
  `prefers-reduced-motion`. Une barre de progression est toujours accompagnée
  de sa valeur écrite, et un `role="progressbar"` porte les mêmes chiffres.
- **`/atelier` (hors production) montre le système sur un écran.** Il existe
  parce que les écrans d'administration exigent une session, ce qui empêchait
  de vérifier une décision de mise en forme — et surtout de comparer deux
  composants côte à côte, où une incohérence de rayon ou d'espacement se voit
  immédiatement.
- **Les défauts d'élément sont à spécificité nulle** (`:where(a)`,
  `:where(a:hover)`, `:where(h1, h2, h3, h4)`…) : un composant préfixé `sp-`
  l'emporte toujours. Ce n'est pas un raffinement — sans `:where()`, `a:hover`
  (0,1,1) battait `.sp-btn` (0,1,0) et repeignait le libellé d'un bouton plein
  en bleu sur bleu, mesuré à 1:1 dans un navigateur : un bouton vide au
  survol. Leçon retenue dans les tests : vérifier des paires de tokens ne suffit
  pas, il faut vérifier QUI gagne la cascade — c'est le rôle du bloc « cascade »
  de `tests/unit/design-tokens.test.ts`.
- **L'aide contextuelle n'utilise jamais `title`.** Cet attribut ne s'ouvre ni
  au clavier ni au toucher, son délai n'est pas réglable et sa restitution
  varie d'un lecteur d'écran à l'autre. `Tooltip` est un *disclosure* refermable
  par Échap (WCAG 1.4.13), dont la zone cliquable atteint 44px par
  pseudo-élément alors que le dessin reste à 28px — un « ? » de 44px
  dominerait l'intitulé qu'il accompagne.
- **L'édition est guidée elle aussi**, en quatre étapes (identité, questions,
  informations, publication). Son état vit côté CLIENT et non dans l'URL,
  contrairement à la création : l'édition ne s'enregistre qu'au bouton
  « Enregistrer », et un changement d'étape qui rechargerait la page perdrait
  le brouillon en cours de saisie.
- **On ne quitte pas une étape dont un champ obligatoire est mal rempli — mais
  revenir est toujours libre**, et on peut sauter à n'importe quelle étape
  suivante dès lors que celle qu'on quitte est valide. Sans cette liberté,
  l'écran de publication resterait inatteignable tant qu'une mention manque,
  et sa liste des manques ne servirait à rien.
- **Un seul lien de retour, vers le parent** — pas un fil d'Ariane complet.
  Une chaîne entière est une phrase qu'il faut lire pour en extraire un mot,
  alors que ce qu'on cherche est presque toujours « remonter d'un cran ». Le
  chemin complet reste dans l'URL, et le titre juste en dessous dit où l'on se
  trouve.
- **L'écran des réponses ne montre que la date et les réponses.** Le
  consentement et son texte restent dans l'EXPORT, où ils servent de preuve
  auditable — le même paragraphe répété à l'identique sur chaque ligne
  n'apprend rien et repousse hors de vue ce qu'on est venu lire. C'est le rôle
  de `MetaScope` dans `src/lib/export/csv.ts` : `export` emporte tout,
  `screen` garde la date.
- **Deux espaces distincts, deux mises en page** : `/admin` fabrique des
  formulaires, `/super-admin` gouverne des organisations et des rattachements.
  Ce ne sont pas les mêmes objets ; les mêler dans une navigation unique
  obligerait à se demander, à chaque entrée, de quel côté on se trouve. Dans
  les deux cas la barrière reste le RLS — les redirections évitent seulement
  un écran vide et incompréhensible.
- **Répartition des pouvoirs sur les modules**, déjà inscrite dans le RLS : le
  super administrateur décide de ce qu'une organisation A LE DROIT d'utiliser
  (l'existence de la ligne `organisation_modules`) ; l'administrateur de
  l'organisation décide s'il l'active (colonne `enabled`). L'écran de la
  plateforme ne touche donc jamais `enabled`.
- **Un fichier `'use server'` n'exporte QUE des fonctions asynchrones.** Toute
  autre valeur exportée — un schéma Zod, une constante — fait échouer la
  collecte au build, avec un message qui ne nomme pas la cause.
- **Un refus DÉSIGNE le champ** : message en ligne, focus posé dessus, champ
  ramené dans la vue. « Certains champs sont invalides » sur un écran qui en
  compte six laisse chercher lequel. Et la liste des messages n'est énumérée
  dans l'alerte que si les champs concernés ne sont PAS sous les yeux — sinon
  la même phrase se lit deux fois.
- **Le type d'une question se choisit d'abord**, sur des cibles nommées et
  décrites, jamais dans une liste déroulante. Le type détermine ce qu'on peut
  saisir, ce qui est validé et ce qui sort à l'export ; et comme le changer
  après coup orphelinerait les réponses reçues, se tromper coûte une
  suppression suivie d'une recréation.
- **Le comptage des présents est DÉSIGNÉ, jamais devine.** La plateforme est
  générique : elle ne peut pas savoir laquelle des questions signifie « je
  viens ». L'organisation désigne la question de présence, la réponse qui vaut
  oui, et éventuellement la question donnant le nombre — le tout dans
  `settings.attendance`, donc sans migration. Sans désignation, la page des
  réponses continue de compter des RÉPONSES, ce qui reste exact.
- **Un effectif indéterminé est signalé, pas arbitré.** Plusieurs cases
  cochées là où une seule était attendue, ou aucun nombre indiqué : la réponse
  compte pour une personne — celle qui a répondu vient bien — et elle est
  marquée « à vérifier » dans la liste comme dans l'export. Additionner les
  cases ou retenir le maximum serait un arbitrage que personne n'a demandé, et
  un chiffre faux qu'aucune alerte ne signalerait.
- **Le nombre se lit dans le LIBELLÉ de l'option, pas dans sa valeur.** Les
  valeurs sont des identifiants figés à la création (`option_1`…) ; seul le
  libellé porte le sens (« 2 »). C'est la contrepartie de la règle qui gèle
  les valeurs d'option.
- **Un seul cadrage de bannière** (`BannerFrame`) pour l'aperçu de l'éditeur,
  la miniature de la liste et le rendu public : trois cadrages donneraient
  trois images, et l'organisation ne saurait pas ce que voit le répondant. Le
  format de référence (1200 × 704) est ANNONCÉ, pas imposé — une autre image
  est recadrée au centre. Un test vérifie que le ratio CSS et les dimensions
  annoncées en TypeScript concordent : sinon le conseil donné contredirait le
  rendu.
- **Une seule barre de parcours, en bas, sur tous les écrans.** Deux barres
  collantes prennent près d'un tiers de la hauteur utile d'un téléphone, et
  l'avancement se retrouve loin du bouton qui le fait avancer. Tout regrouper
  évite aussi de dupliquer la barre de progression et le lien de sortie dans
  le DOM — un exemplaire masqué par CSS reste un second contrôle interactif,
  qui réapparaît si la feuille de style n'arrive pas.
- **Sous 40rem, l'aide contextuelle devient une feuille ancrée en bas.** Une
  bulle placée au-dessus de son déclencheur dépend de la place disponible de
  part et d'autre ; près d'un bord elle sort de l'écran, et sur un téléphone
  tout est près d'un bord. Aucune règle CSS ne peut recentrer un élément
  absolu selon la position de son ancre : on change donc d'ancrage plutôt que
  de bricoler un décalage. Mesuré à 375 px ET à 320 px.
- **L'état d'un parcours guidé vit dans l'URL**, jamais en session : le
  parcours survit à un rafraîchissement, le bouton « retour » du navigateur
  fait ce qu'on attend, et chaque écran reste un `<form action>` — donc
  fonctionne sans JavaScript. Seules des valeurs de listes fermées y
  circulent, et un test le vérifie.
- **Ce qui bloque une action est dit AVANT le clic.**
  `missingForPublication` est une fonction pure, partagée par l'éditeur (qui
  l'affiche en continu) et par `updateSurvey` (qui refuse). Deux listes
  auraient divergé, et l'écran aurait fini par annoncer « prêt à publier » sur
  un formulaire que le serveur refuse.
- Les listes déroulantes sont de vraies `<select>` natives.
- Les formulaires d'authentification sont des `<form action={serverAction}>` :
  ils **fonctionnent sans JavaScript**. Un écran de connexion qui dépend d'un
  bundle devient inutilisable dès que celui-ci échoue.
- Modules Leaflet : `await import(...)` dans un effet (sinon crash SSR). La
  feuille de style, elle, est importée statiquement — un import de CSS ne peut
  pas être dynamique.
- **La carte n'est jamais le seul chemin.** Un lieu se règle par la recherche
  d'adresse et deux champs numériques, tous deux utilisables au clavier ; la
  carte est un confort. Elle porte `role="img"` et une description, plutôt
  qu'un `role="application"` qui promettrait une interaction clavier
  inexistante.
- **Les octets ne traversent pas Next.** La bannière part du navigateur vers
  Storage avec la session de l'utilisateur. Les contrôles qui protègent sont
  ceux du bucket (`file_size_limit`, `allowed_mime_types` — pas de SVG, qui
  est un document XML porteur de script servi depuis une origine publique) et
  le RLS des objets. Ce que fait le navigateur avant n'est qu'un refus
  précoce, et le chemin enregistré est revérifié côté serveur
  (`isBannerPathOf`) : le bucket étant public, un chemin non vérifié
  laisserait une organisation afficher le fichier d'une autre.
- **Le logo d'une organisation se dépose OU se désigne par un lien.** Les deux
  chemins coexistent parce que les organisations ne sont pas dans la même
  situation : la plupart ont leur logo dans un fichier, quelques-unes l'ont
  déjà en ligne. Le fichier va dans son propre bucket
  (`organisation-logos`, chemin `{organisation_id}/…`, 1 Mio, pas de SVG),
  écrit par l'ADMINISTRATEUR de l'organisation — pas l'éditeur : un logo est
  un réglage d'organisation, exactement la règle de `organisations_update`.
  L'URL retenue est revérifiée côté serveur (`isLogoUrlOf`) : un lien externe
  passe, une URL de notre bucket doit désigner le dossier de CETTE
  organisation, sinon elle afficherait le logo d'une autre sans rien
  téléverser. **Conséquence pour l'étape 9** : tant que le lien externe est
  offert, `img-src` ne peut pas être restreint à nos seules origines — voir R1.
- **Aucun appel direct du navigateur vers un tiers.** Nominatim passe par
  `/api/admin/geocode` : la politique d'usage d'OpenStreetMap exige un
  `User-Agent` identifiant l'application et plafonne à une requête par seconde
  pour l'application ENTIÈRE — un verrou `SET NX EX` partagé, distinct du
  rate-limit par appelant. Relayer évite en outre de livrer à un tiers l'IP de
  chaque personne qui tape une adresse.
- **Une heure de calendrier n'est pas un instant.** Les dates d'événement sont
  saisies dans le fuseau DE L'ÉVÉNEMENT, converties par
  `src/lib/event/time.ts`. Se fier au fuseau du navigateur rendrait le champ
  « fuseau » décoratif et décalerait le fichier iCalendar.
- Migrations SQL **toujours idempotentes** : `create or replace`,
  `drop policy if exists`, `create index if not exists`,
  `on conflict do nothing`.
- **Aucune fonction interne dans le schéma `public`.** PostgREST publie
  automatiquement toute fonction de `public` que le rôle appelant peut
  exécuter, et Supabase accorde `EXECUTE` à `anon`/`authenticated` sur toute
  nouvelle fonction via ses *default privileges* — un `revoke ... from public`
  ne suffit pas. Les fonctions internes vivent donc dans le schéma **`app`**,
  hors de la liste exposée par l'API. `public` ne contient que les 8 fonctions
  réellement appelées par le réseau, et un test échoue si une neuvième
  apparaît (`tests/rls/exposed-surface.test.ts`).
- **Tout nouvel objet naît sans droits.** Les *default privileges* de Supabase
  ont été révoqués (`alter default privileges ... revoke`) : une table, une vue
  ou une fonction ajoutée n'est accessible à personne tant qu'un `grant`
  explicite n'a pas été écrit. Plus verbeux, et volontairement : un oubli
  devient une absence d'accès, pas une fuite.
- **Une policy RLS s'exécute avec les droits de l'appelant.** Conséquence
  vérifiée par l'expérience : les fonctions appelées dans une policy doivent
  rester exécutables par `authenticated`. Ce sont les 9 fonctions de `app` qui
  reçoivent `EXECUTE` ; les autres (dont `write_audit` et `dedup_hash`) n'en
  ont pas besoin, car elles ne sont appelées que depuis une autre fonction
  `SECURITY DEFINER` ou depuis un trigger.
- **Les routes ne connaissent pas Supabase.** Elles reçoivent un port étroit
  (`src/lib/data/port.ts`) implémenté deux fois : sur `@supabase/ssr` en
  production, sur PGlite en test. C'est ce qui permet d'exécuter les vraies
  routes contre les vraies policies. Convention associée : toute fonction
  appelée par `rpc` renvoie un scalaire ou du `jsonb`, jamais un ensemble de
  lignes (le comportement diffèrerait entre les deux adaptateurs).
- **Sémantique de refus** : une ressource que le RLS masque renvoie `404` — un
  `403` confirmerait son existence. Une ressource visible mais interdite
  renvoie `403`.
- `FormData.get()` n'est jamais converti directement : il peut renvoyer un
  `File`. Passer par `src/lib/api/form.ts`, qui refuse ce cas au lieu de le
  déguiser en `[object File]`.
- **Une seule zone d'annonce à la fois.** Deux `role="alert"` simultanés
  interrompent deux fois le lecteur d'écran pour un même événement, et la
  seconde interruption écrase souvent la première. L'éditeur regroupe donc la
  cause et le détail dans une seule alerte.
- **La valeur d'une option est figée à sa création.** Le libellé se renomme,
  la valeur non : la modifier orphelinerait silencieusement toutes les
  réponses déjà enregistrées. L'éditeur l'affiche pour information, jamais en
  saisie.
- **Le tableau de bord affiche les colonnes de l'export**, produites par la
  même fonction (`responseRows`). Seule exception, documentée dans le code :
  l'horodatage est mis en forme pour une personne à l'écran et reste en
  ISO 8601 dans le fichier.
- Les chaînes d'interface vivent dans `src/lib/i18n/fr.ts`. **Exception
  assumée** : la prose longue des pages légales reste dans la page, l'i18n
  étant hors périmètre (R8). Un test de vocabulaire balaye les deux.

## 5. RGPD — règle d'or

**Ce que la politique de confidentialité affirme doit correspondre exactement à
ce que le code collecte.**

- Aucune adresse IP, aucun user-agent, aucun identifiant de session stocké en
  base. L'IP n'existe que dans le store de rate-limit (hachée, TTL court),
  jamais dans une table applicative.
- **Vocabulaire interdit : « réponses anonymes »** — et le mot est refusé par
  un test qui balaye les sources de l'interface (`tests/unit/vocabulary.test.ts`),
  au même titre que tout terme sectoriel. La plateforme n'ajoute
  aucun identifiant technique, mais une réponse contient exactement les champs
  que l'organisation a décidé de collecter — parfois un email, un téléphone, un
  nom. L'interface et les pages légales disent donc ce qui est vrai dans tous
  les cas : « aucune donnée technique de traçage n'est collectée ; les données
  personnelles enregistrées sont celles des champs du formulaire ».
- Consentement : si `require_consent`, on stocke `consent_given` **et**
  `consent_text` (snapshot du texte affiché — preuve auditable).
- Anti-doublon : appliqué par une contrainte d'unicité réelle
  (`survey_responses_dedup_uniq`), jamais une colonne décorative. La clé stockée
  est une empreinte SHA-256 salée par sondage (`public.dedup_hash`) : l'unicité
  et le rattachement d'une demande d'effacement fonctionnent sans conserver une
  seconde copie en clair de la donnée, et aucun recoupement entre deux sondages
  n'est possible.
- Les pages légales sont alimentées par `platform_settings` (singleton), jamais
  par des valeurs en dur.
- Base légale **choisie par l'organisation**, aucune valeur imposée par la
  plateforme.

## 6. Risques acceptés consciemment

Cette section est le contrat anti-dette silencieuse : tout garde-fou reporté y
figure, avec sa raison et sa condition de lever.

| # | Risque accepté | Raison | Lever quand |
| - | -------------- | ------ | ----------- |
| R1 | **CSP** : `unsafe-eval` toléré en développement (HMR de Next). Strict avec nonce en préproduction et production. **`img-src` restera ouvert aux origines `https:`** tant que le logo d'organisation pourra être désigné par un lien externe : le restreindre casserait les logos déjà en place. Conséquence assumée et dite dans l'interface — le site qui héberge un logo externe voit passer l'IP de chaque répondant. | Le HMR de Next exige `eval`. Pour `img-src`, l'alternative serait de n'accepter que le dépôt de fichier, ce qui obligerait chaque organisation à dupliquer une image déjà publiée. | N/A pour `unsafe-eval` (limite du framework). Pour `img-src` : si un client exige une CSP stricte, retirer le mode « lien » et rapatrier les logos existants. |
| R2 | **Rate-limit fail-open** : si le store KV est injoignable, la requête passe (log + alerte), avec un garde-fou mémoire par instance en second rideau. | Un `fail-closed` transformerait une panne KV en indisponibilité totale des soumissions publiques. | Si un abus réel est constaté, basculer en fail-closed sur `/api/public/submit` uniquement. |
| R3 | **a11y automatisée en jsdom** (axe-core). La règle `color-contrast` y est **désactivée explicitement** — jsdom n'a pas de moteur de rendu, donc axe ne peut pas la calculer : la laisser active donnerait un faux succès. Les contrastes sont vérifiés pour de vrai par `tests/unit/design-tokens.test.ts` sur les tokens de la charte, et la navigation clavier par `user-event`. Un audit programmatique dans un vrai navigateur (contraste calculé par rasterisation canvas, tailles de cibles, débordement horizontal à 375px) a été rejoué à la main lors de la refonte, mais **il n'est pas en CI**. L'ordre de focus réel dans un navigateur reste non couvert, de même que les **pages** de l'espace d'administration : les tests rendent les composants (éditeur, agrégats, navigation, panneau événement), pas les composants serveur qui les assemblent — et **Leaflet y est remplacé par un double**, jsdom n'ayant ni moteur de rendu ni dimensions : la carte elle-même n'est pas couverte, seul l'est le chemin clavier qui la contourne — ceux-ci n'ont été vérifiés qu'en visiteur non connecté (redirection vers `/connexion`, aucune erreur de rendu). | Playwright + navigateur ajoute plusieurs minutes à chaque CI pour un MVP. | Avant la première revente à un client soumis au RGAA. |
| R4 | **Staging Vercel/Supabase, DNS (SPF/DKIM/DMARC), sauvegardes** : documentés dans le README, **non provisionnés**. | Nécessite l'accès aux comptes Vercel / Supabase / registrar. | À la remise des accès. |
| R5 | ~~**`pg_cron`**~~ — **levé**. L'extension est disponible sur le projet cible : les deux purges y sont planifiées et actives (`3 h 17` et `3 h 37`). Les migrations restent tolérantes à son absence, et les purges restent appelables en RPC, pour les environnements qui ne l'ont pas (dont PGlite). | — | Levé le 4 septembre 2026. |
| R6 | **ESLint 9** alors qu'ESLint 10 existe : `eslint-config-next@15` ne déclare pas la compatibilité ESLint 10. | Rester sur la stack imposée (Next 15). Outil de développement uniquement, aucune vulnérabilité connue. | À la migration Next 16. |
| R7 | **`postcss` surchargé** en 8.5.26 via `overrides` : Next 15 épingle 8.4.31, vulnérable (GHSA sourceMappingURL / XSS de stringify). Correctif amont = Next 16 (majeure). | Conserver Next 15 tout en gardant `npm audit` à zéro. `postcss` n'est utilisé qu'au build. | À la migration Next 16. |
| R8 | **Hors périmètre MVP** : i18n (interface en français uniquement, chaînes centralisées), champs d'upload de fichiers dans les sondages, webhooks, SSO, multi-région. | Périmètre MVP. | Sur demande client. |
| R9 | **Tests d'intégration sur PGlite** et non sur un vrai Supabase : `auth.uid()`, les rôles `anon`/`authenticated`/`service_role` et le schéma `auth` sont émulés par le harnais. **Partiellement levé** : les 21 migrations ont été appliquées sur le projet Supabase réel et 70 contrôles y ont été rejoués (isolation, escalade, modules, soumission, purges, rattachement). Cette campagne a révélé deux failles que PGlite ne pouvait pas montrer (voir R10). Reste non couvert en CI : les *default privileges* et le comportement de PostgREST. | Aucune dépendance à Docker : la CI reste rapide et hermétique. | Ajouter un job de préproduction rejouant les migrations sur un vrai Supabase à chaque merge. |
| R10 | **Deux vues en droits du propriétaire** (`public_surveys`, `organisation_directory`) — signalées `ERROR` par le linter Supabase. C'est délibéré : `public_surveys` est le seul accès public aux sondages et n'expose qu'un sous-ensemble de colonnes de sondages publiés ; `organisation_directory` permet à un compte non encore rattaché de désigner son organisation, ce que le RLS de `organisations` interdit par construction. Les deux sont restreintes par `grant` explicite. | L'alternative (policy `anon` sur `surveys` + grants colonne par colonne) déplace la complexité sans réduire l'exposition. | Si un audit externe l'exige. |
| R11 | **8 fonctions `SECURITY DEFINER` exposées par l'API** (soumission, effacement, décisions de rattachement, purges, `my_modules`) — signalées `WARN` par le linter. C'est leur raison d'être : elles remplacent l'usage du `service role` et revérifient elles-mêmes les droits de l'appelant. Leur liste et leurs droits par rôle sont figés par un test. | Le `service role` dans le chemin par défaut serait bien plus dangereux. | N/A (choix d'architecture). |
| R12 | **Verrou global du géocodage : dégradation par instance.** Si le store KV est injoignable, chaque instance retombe sur son garde-fou mémoire : le plafond réel devient « une requête par seconde et PAR INSTANCE » au lieu d'une pour l'application entière. Le code le fait et le dit ; il n'annonce pas un fail-closed qu'il ne tient pas. | Fermer complètement rendrait la recherche d'adresse indisponible à chaque hoquet de KV, pour une fonction d'administration peu fréquentée. | Si OpenStreetMap signale un abus, ou si le nombre d'instances devient significatif. |
| R13 | **`sp-btn--sm` à 38px de haut** sur pointeur fin, alors que la consigne du projet est 44px. Sous `pointer: coarse` — donc au toucher, où la précision manque réellement — il repasse à 44px. Les cibles concernées sont des actions secondaires de rangée (« Modifier », « Réponses »), jamais une action principale. Le déclencheur d'aide contextuelle dessine 28px mais offre 44px de zone cliquable. | Des boutons de 44px dans une rangée de liste écrasent le contenu qu'ils accompagnent. | Si un client soumis au RGAA l'exige, ou si un usage tablette significatif apparaît. |

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
- [x] Étape 2 — 17 migrations idempotentes (tables, RLS, fonctions SECURITY
      DEFINER, triggers anti-escalade, vues, RPC, purges, storage), harnais
      PGlite rejouant les migrations réelles, et 105 tests de sécurité :
      isolation A/B table par table, escalade de privilèges, modules par
      utilisateur, accès anonyme, anti-doublon, immuabilité, purges.
- [x] Étape 3 — authentification (connexion, inscription, réinitialisation de
      mot de passe, retour de courriel), demandes de rattachement, validation
      par le super administrateur avec choix du rôle ET des modules, emails
      chartés Resend, rate-limit distribué, port de données à deux
      implémentations, 8 routes API, middleware de session, premières pages
      légales alimentées par `platform_settings`. 354 tests dont 59
      d'intégration exécutant les vraies routes contre le vrai RLS.
- [x] Déploiement (4 septembre 2026) — 21 migrations appliquées sur le projet
      Supabase `spankio` (PostgreSQL 17.6, `eu-west-2`), historique aligné sur
      les fichiers locaux, `pg_cron` actif, bucket des bannières créé. Vercel
      relié au dépôt, trois déploiements de production réussis, protection SSO
      active. **Deux failles corrigées, invisibles sous PGlite** : `write_audit`
      appelable anonymement (forge d'entrées d'audit) et annuaire des
      organisations lisible sans compte — les deux causées par les *default
      privileges* de Supabase.
- [x] Étape 4 — `src/lib` pur, sans aucun accès réseau : schéma de sondage
      (11 types de champs, conditions bornées), validation serveur des
      soumissions en liste blanche, évaluation des conditions partagée entre
      rendu et validation, assainissement Unicode, ICS RFC 5545, liens agenda
      et itinéraire, export CSV avec neutralisation des formules, 4 modèles en
      TypeScript. 570 tests dont 370 unitaires.
- [x] Étape 5 — rendu public « une question, un écran » (11 types de champs,
      conditions, progression, transitions, secousse d'erreur, pied collant),
      écran de consentement, remerciement avec agenda et itinéraire, route de
      soumission publique et fichier ICS. 660 tests dont 28 d'accessibilité sur
      le parcours public.
- [x] Étape 6 — espace d'administration : barre latérale, liste des
      formulaires, création (vierge ou depuis un modèle), éditeur visuel du
      schéma, mentions d'information, publication, tableau de bord
      (agrégats sans aucun contenu de réponse libre), détail des réponses,
      suppression logique d'une réponse et exports CSV / JSON. 780 tests dont
      11 d'accessibilité sur l'éditeur et le tableau de bord.
- [x] Étape 7 — module événement : réglages de l'événement (dates dans le
      fuseau de l'événement, lieu, organisateur, précisions), bannière
      téléversée directement vers Storage sous contraintes de bucket, carte
      Leaflet + tuiles OpenStreetMap avec marqueur déplaçable, relais de
      géocodage Nominatim authentifié et plafonné, agenda et itinéraire déjà
      posés à l'étape 5. 924 tests dont 10 d'accessibilité sur le panneau
      événement et 21 d'intégration sur la bannière et le géocodage.
- [x] Refonte de l'expérience (5 septembre 2026) — échelles d'espacement et de
      typographie, mouvement, primitives pédagogiques (en-tête d'écran, chapeau,
      encadré avec exemple, état vide, avancement, aide contextuelle, bouton à
      retour visuel), accueil et écrans d'authentification retravaillés, barre
      latérale à icônes repliable en barre horizontale sous 60rem, **parcours
      guidé de création en cinq écrans** avec état dans l'URL, liste permanente
      de ce qui manque avant publication, et `/atelier` hors production.
      Couleurs et Montserrat inchangés : c'est l'identité du client.
- [x] Gouvernance et prise en main (6 septembre 2026) — espace plateforme
      distinct (`/super-admin`) avec liste des organisations, comptages et
      concession des modules ; page de profil d'organisation
      (`/admin/organisation`) qui dit ce qui manque ET ce que l'absence coûte,
      rappelée depuis l'accueil tant que le profil est incomplet ; fil d'Ariane
      remplacé par un retour au parent ; écran des réponses réduit à
      l'essentiel.
- [ ] Étape 8 — RGPD : `platform_settings`, pages légales, purges, effacement.
- [ ] Étape 9 — durcissement : CSP à nonce, Sentry, axe en CI, README final.
