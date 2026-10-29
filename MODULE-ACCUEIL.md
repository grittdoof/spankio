# Module « Accueil » — pointage des arrivées

Étude préalable. Rien n'est écrit dans le code à ce stade : ce document est la
spécification à valider avant de commencer.

Besoin exprimé : des hôtes et hôtesses se connectent avec un compte, voient sur
mobile la liste des invités d'UN événement, cochent les arrivées en un geste,
plusieurs à la fois, chacun voyant ce que font les autres, et l'organisation
récupère un rapport après la soirée.

---

## 1. Environnement — ce qui est vérifié, ce qui bloque

### Accès confirmés

| Service | État | Détail |
| ------- | ---- | ------ |
| **GitHub** | ✅ | `git@github.com:grittdoof/spankio.git`, compte `grittdoof` authentifié (scopes `repo`, `read:org`). Worktree sur `claude/spankio-checkin-module-990b92`, branche de base `main` à `4e4135d`. |
| **Vercel** | ✅ | Projet `spankio` (`prj_W41O03Pm7sR5XDfxZ8FuliO3vbY5`), équipe `grittdoofs-projects`. Dernier déploiement de **production** `READY`, sur `main` à `4e4135d` — la production est bien à jour du dernier commit. |
| **Supabase** | ✅ | Projet `spankio` (`qmhjckioehsiduongadk`), **eu-west-2**, PostgreSQL 17.6.1.166, `ACTIVE_HEALTHY`. Accès rétabli le 28 octobre 2026. |

### Ce que la vraie base révèle — deux écarts à traiter avant le module

#### A. Une migration committée sur `main` n'est pas appliquée en production

L'historique distant compte 25 migrations et s'arrête à
`20260908141508 response_corrections`. Le dépôt en contient une de plus :
**`20260908160500_dedup_sans_valeur.sql` n'a jamais été poussée.**

Vérifié dans le corps de la fonction en production : elle contient encore

```sql
if v_survey.dedup_field is not null then
  v_dedup_key := app.dedup_hash(p_survey_id, p_dedup_value);
  if v_dedup_key is null then     -- ← le refus que la migration supprime
```

Autrement dit, **le défaut décrit dans `CLAUDE.md` comme « le pire de la
série » est toujours vivant dans la base** : le correctif est dans le code,
pas dans le moteur. Le `CLAUDE.md` affirme « 21 migrations appliquées,
historique aligné sur les fichiers locaux » — ce n'est plus vrai.

**Ce qui empêche la panne aujourd'hui** : les trois sondages ont
`dedup_field = null`. Le contournement a été de désactiver l'unicité, et
l'inscription fonctionne (151 réponses vivantes sur l'événement Spie
batignolles, la dernière reçue **aujourd'hui**).

**Pourquoi c'est une mine** : il suffit qu'on rouvre « Autoriser une seule
réponse par personne » dans l'éditeur pour que la production reparte en 400 sur
chaque saisie valide. Pire, le TypeScript a déjà été corrigé en conséquence :
`dedupDesignation` part du principe que le SQL tolère une clé absente, donc
l'écran laissera volontiers réactiver l'option que la base refusera.

#### B. L'historique des migrations a divergé sur trois noms

| Distant | Local |
| ------- | ----- |
| `20260905090000 protect_super_admin` | `20260905090000_platform_admin_membership.sql` |
| `20260905115510 banner_constraints` | `20260905091000_banner_constraints.sql` |
| `20260906151215 organisation_logos` | `20260906090000_organisation_logos.sql` |

Même contenu, versions et noms différents. Un `supabase db push` naïf se
comportera mal. Il faut réaligner l'historique **avant** d'ajouter les
migrations du module, sinon le lot 1 héritera du désordre.

#### C. Les advisors Supabase

Rien d'inattendu : les 2 `ERROR` (`public_surveys`, `organisation_directory`)
et les `WARN` sur les fonctions `SECURITY DEFINER` sont exactement les risques
R10 et R11, assumés et documentés. Deux points méritent tout de même une ligne :

- **`auth_leaked_password_protection` est désactivée.** Supabase sait vérifier
  un mot de passe contre HaveIBeenPwned. C'est gratuit, et on s'apprête à créer
  des comptes d'hôtes et d'hôtesses — exactement le profil qui réutilise un mot
  de passe.
- `public.rls_auto_enable()` est exécutable par `anon`. C'est une fonction
  installée par Supabase, pas par nous ; le test de surface l'exclut **par
  nom** mais ne contrôle pas ses droits. À vérifier une fois, pas à corriger à
  l'aveugle.

### L'événement réel — ce qu'il impose au module

| | |
| - | - |
| Événement | Spie batignolles, 180 ans |
| Date | **18 novembre 2026, 18 h 30** (`Europe/Paris`) — dans **trois semaines** |
| Capacité | **220 places** |
| Réponses vivantes | 151, la dernière aujourd'hui |
| Désignations | `identityField`, `detailField`, `presenceField`/`presenceValue`, `partyField` en `extra` : **tout est déjà configuré** |

Deux conséquences directes :

1. **La liste d'accueil affichera des noms dès le premier jour** — aucune
   désignation à faire, le sondage est complet.
2. **220 personnes : aucun fenêtrage nécessaire.** La question du volume posée
   en fin de document est tranchée, le lot 3 s'en trouve allégé.

Et une contrainte de calendrier : trois semaines, dont il faut retirer le
temps de répétition. Les lots 1 et 2 ne peuvent pas déborder.

### Trois observations faites au passage

1. **`SUPABASE_SERVICE_ROLE_KEY` est marquée `readable-secret` par Vercel.**
   Elle est stockée en « encrypted » et non en « sensitive », donc relisible
   depuis le tableau de bord et l'API. C'est la clé qui contourne tout le RLS.
   Elle mériterait d'être repassée en *sensitive* (et donc rotée, puisque la
   valeur actuelle a pu être lue).

2. **Aucune variable Supabase n'est définie pour la cible `preview`.** Les
   déploiements de branche n'ont donc ni URL ni clé : ils se construisent, mais
   ne fonctionnent pas. Pour un module dont le risque principal est
   opérationnel, pouvoir essayer une branche sur un vrai navigateur avant la
   soirée vaut cher. C'est aussi la condition d'un environnement de
   préproduction (R4, non provisionné).

3. **Une montée Dependabot est en échec** : le bump `react` 19.2.8 → 19.3.0
   (`dpl_3usyKzD8QUt8c4J5qbzJaC3xGu3L`, état `ERROR`). À traiter séparément,
   mais à ne pas laisser traîner : une CI rouge en permanence finit par ne plus
   être lue.

4. **`supabase/config.toml` déclare `major_version = 15`** alors que la
   production tourne en PostgreSQL 17.6. Même piège de couplage que celui déjà
   documenté pour Node et Vercel : un `supabase db reset` local ne valide pas le
   moteur de production.

---

## 2. Ce sur quoi le module s'appuie — l'existant est largement suffisant

Le socle couvre déjà la moitié du besoin. Inventaire de ce qui se réutilise tel
quel, sans rien réécrire :

- **`src/lib/survey/guests.ts`** — `guestList()` produit déjà exactement la
  liste d'accueil demandée : une rangée par réponse, nom désigné, initiales,
  détail secondaire, statut, effectif, recherche insensible aux accents,
  filtres et compteurs. Elle a été écrite « pour se lire debout, à l'accueil,
  sur un téléphone ». Le module de pointage **n'en écrit pas une seconde**.
- **`src/lib/survey/attendance.ts`** — statut (`attending` / `declined` /
  `unknown`), effectif attendu, réserve « à vérifier ». C'est l'effectif
  **annoncé** ; le module y ajoute l'effectif **constaté**.
- **`src/components/admin/GuestList.tsx`** — la liste existe déjà à l'écran,
  avec sa recherche en `<form method="get">` et ses filtres en liens.
- **Le port de données** (`src/lib/data/port.ts`) et son double PGlite :
  les vraies routes s'exécuteront contre les vraies policies en test.
- **Les modules** (`public.modules`, `organisation_modules`,
  `profile_module_overrides`, `profile_can_use_module`) : la concession par
  organisation et la restriction par utilisateur sont déjà là. Le module
  `checkin` s'y branche sans une ligne de mécanique nouvelle.
- **`src/lib/export/csv.ts`** et `responseRows` : le rapport d'après-soirée
  réutilise les colonnes de l'export, avec la neutralisation des formules.
- **`src/lib/design/sparkline.ts`** : géométrie pure, déjà testée, pour la
  courbe des arrivées.

Ce qui manque vraiment est court : **un droit plus étroit que `viewer`**, **une
table de faits d'arrivée**, **un chemin d'écriture sûr**, et **un écran de
pointage**.

---

## 3. Architecture proposée

### 3.1 Un vrai module du catalogue

Ajout de la ligne `('checkin', 'Accueil et pointage', …, is_core = false)` dans
`public.modules`. Gratuitement, on hérite de : la concession par le super
administrateur, l'activation par l'administrateur de l'organisation, la
restriction par utilisateur, le filtrage de la barre latérale, et la clause
`can_use_module(...)` déjà présente dans les policies de `survey_responses`.

Le module dépend de `event` : pointer les arrivées d'un sondage sans date n'a
pas de sens. L'écran le dit plutôt que de le masquer.

### 3.2 Le droit — le vrai sujet, et le plus risqué

**Le problème.** Les rôles actuels sont `super_admin`, `admin`, `editor`,
`viewer`. Donner `viewer` à une hôtesse engagée pour une soirée lui ouvrirait
`survey_responses_select`, c'est-à-dire **toutes les réponses de toute
l'organisation, tous sondages confondus** — noms, courriels, téléphones. Pour
un poste temporaire, à l'entrée d'une salle, sur un téléphone personnel, c'est
non.

**La solution, en deux pièces qui ne valent qu'ensemble :**

1. **Un rôle `host`**, ajouté à l'énumération `public.user_role`. Un `host`
   est membre actif de son organisation mais n'a accès ni à `/admin`, ni à
   `/super-admin`, ni à un sondage quelconque. Son espace est `/accueil`, et
   rien d'autre.

2. **Une table d'affectation** `public.checkin_staff (survey_id, profile_id,
   granted_by, granted_at, expires_at)`. Un `host` ne voit QUE les événements
   où une ligne le désigne. L'affectation est l'autorisation ; le rôle ne fait
   que l'empêcher de voir autre chose.

**Conséquence qu'il faut assumer, et qui est le point délicat de tout le
module** : les policies existantes sont rédigées avec `is_active_member()`,
qui serait vrai pour un `host`. Elles doivent donc être amendées pour
l'exclure, et une policy additive doit lui ouvrir précisément les réponses des
sondages où il est affecté. Les policies permissives s'additionnent : ajouter
sans retrancher **élargirait** l'accès au lieu de le restreindre. C'est
exactement le genre de défaut que le test d'isolation existant est fait pour
attraper — à condition qu'on lui ajoute la persona `host`, route par route,
table par table. **C'est la tâche la plus importante du lot, avant tout
écran.**

Détail d'implémentation à ne pas rater : `alter type … add value` ne peut pas
être suivi d'un usage de la nouvelle valeur dans la **même** transaction.
L'ajout de `host` est donc une migration à lui seul, et tout ce qui s'en sert
vient dans la suivante.

### 3.3 Les données — l'arrivée est un fait NOUVEAU, pas une réécriture

`survey_responses.data` est immuable par doctrine : `consent_text` prouve ce
qui a été affiché, `submitted_at` date l'acte du répondant, et une correction
est une suppression logique plus une copie. **Écrire l'arrivée dans `data`
détruirait cette correspondance** et ferait d'un geste d'hôtesse une
falsification de preuve. L'arrivée vit donc à part.

```
public.event_checkins                       -- l'ÉTAT courant, une ligne par réponse
  response_id      uuid primary key → survey_responses(id) on delete cascade
  survey_id        uuid not null    → surveys(id)
  organisation_id  uuid not null                 -- dénormalisé, comme ailleurs : RLS sans jointure
  arrived_at       timestamptz                   -- null = pas encore arrivé
  people_in        integer                       -- effectif RÉELLEMENT entré
  by_profile       uuid             → profiles(id)
  version          integer not null default 0    -- concurrence optimiste
  updated_at       timestamptz not null default now()

public.event_checkin_log                    -- le JOURNAL, en ajout seul
  id, response_id, survey_id, op_id uuid, at, by_profile,
  from_state, to_state, people_in, source
```

Deux tables et non une, pour une raison précise : l'état doit se lire d'un coup
sur un téléphone pendant un afflux (une ligne par invité, un index, rien à
agréger), et le journal doit répondre à « qui a pointé Mme X, à quelle heure,
et qui l'a dé-pointée ensuite ». Les deux sont écrits dans **la même
transaction par la même fonction** : ils ne peuvent pas diverger.

`updated_at` porte un index : c'est la clé du rafraîchissement par delta.

### 3.4 L'écriture — une porte `SECURITY DEFINER`, idempotente

Une seule fonction exposée :

```sql
public.set_checkin(
  p_response_id      uuid,
  p_arrived          boolean,
  p_people_in        integer,
  p_op_id            uuid,      -- identifiant de l'opération, généré par le client
  p_expected_version integer
) returns jsonb
```

Quatre propriétés, chacune pour une panne précise :

- **Elle revérifie les droits elle-même** (affectation vivante, module
  autorisé, sondage de l'organisation, réponse non supprimée), comme
  `correct_survey_response`. Une policy d'`update` sur `event_checkins`
  ouvrirait le chemin à tout appel direct, y compris à un défaut futur — c'est
  le raisonnement déjà écrit en R11.
- **Elle est idempotente sur `op_id`.** Le téléphone perd le réseau après
  l'envoi mais avant la réponse ; il réessaie. Sans `op_id`, le second appel
  bascule l'invité une seconde fois et le ré-efface. **C'est la décision la
  plus importante du module, et elle coûte une colonne et un index unique.**
- **Elle refuse une écriture périmée** (`expected_version`). Deux hôtesses
  pointent la même rangée : la première gagne, la seconde reçoit « cette ligne
  a changé » et voit l'état réel — plutôt qu'un dernier-arrivé-gagne silencieux
  où un dé-pointage tardif effacerait une arrivée réelle.
- **Elle renvoie l'état écrit**, pas un booléen : l'écran affiche ce que la
  base contient, jamais ce qu'il espérait écrire.

Cela porte la surface exposée par PostgREST de **9 à 10 fonctions**.
`tests/rls/exposed-surface.test.ts` fige ce nombre ; il faudra l'amender
explicitement, avec sa justification. C'est un amendement assumé à R11, pas un
contournement.

### 3.5 Le temps réel — et le fait qu'il doive pouvoir tomber

Trois options, et le choix n'est pas celui qu'on attend.

| | Mécanisme | Ce qui se passe quand ça casse |
| - | --------- | ------------------------------ |
| A | Supabase Realtime (websocket) | La liste **gèle sans le dire**. C'est la pire panne possible à une porte. |
| B | Interrogation par delta (`updated_at > curseur`) toutes les N secondes | La liste a N secondes de retard, et on peut l'écrire à l'écran. |
| C | B comme contrat, A comme accélérateur | Latence d'un websocket, robustesse d'un sondage périodique. |

**Je propose C, écrit de telle sorte que B seul suffise.** Le delta est le
contrat : si le websocket meurt, rien ne casse, la liste converge en N
secondes. Le websocket ne fait que raccourcir le délai.

Et surtout : **la fraîcheur est écrite à l'écran**, en toutes lettres (« à jour
il y a 3 s », « hors ligne depuis 40 s »). Une liste périmée qui a l'air vivante
est le danger ; une liste périmée qui le dit est une information. C'est le même
raisonnement que « aucune jauge sans dénominateur ».

Le delta se lit **directement depuis le navigateur vers Supabase**, avec la
session de l'utilisateur, donc sous RLS — pas via une fonction Vercel. Deux
raisons : une pièce de moins dans le chemin critique, et le précédent est déjà
posé et documenté (la bannière part du navigateur vers Storage, pour le même
motif). Le premier rendu, lui, reste **serveur** : la liste s'affiche
complète au chargement, et fonctionne avec JavaScript désactivé en lecture.

### 3.6 Hors-ligne — le geste part en local d'abord

Une salle de réception a du réseau par intermittence. Le comportement visé :

1. On tape « Présent » → **la rangée verdit immédiatement**, en local.
2. L'opération entre dans une file (avec son `op_id`), envoyée avec reprise
   exponentielle.
3. Un badge discret dit « 2 en attente ». Il disparaît quand tout est passé.
4. Si le serveur refuse (version périmée), la rangée revient à l'état réel
   **avec un message**, jamais en silence.

La décision de ce qui s'affiche — état serveur + file locale → rangée à
l'écran — est une **fonction pure** dans `src/lib/checkin/reducer.ts`, testée
sans navigateur. C'est elle qui décide ce qu'une hôtesse voit ; elle ne peut
pas vivre dans un composant.

**Ce qui est stocké sur le téléphone, et ce qui ne l'est pas.** La file
d'opérations en attente et un instantané de la liste vivent dans IndexedDB,
sinon un verrouillage d'écran perdrait les pointages non envoyés. Ce sont des
données personnelles sur un appareil souvent personnel : l'instantané est donc
**effacé à la déconnexion et expire automatiquement**, et la politique de
confidentialité le dit — la règle d'or du projet s'applique ici comme ailleurs.
Le *service worker* de la PWA, lui, **ne met en cache que la coquille de
l'application**, jamais une donnée d'invité.

### 3.7 PWA — ce qu'elle apporte vraiment

Il n'y a aujourd'hui **aucun dossier `public/`** : ni manifeste, ni icône, ni
service worker. La PWA apporte trois choses utiles et une à refuser :

- ✅ l'icône sur l'écran d'accueil (l'hôtesse n'a pas à retrouver une URL) ;
- ✅ le plein écran, sans barre d'adresse — plus de place pour la liste, et
  moins de chances de naviguer ailleurs par accident ;
- ✅ la coquille qui charge même sans réseau, donc un écran qui dit « hors
  ligne » au lieu du dinosaure du navigateur ;
- ❌ la mise en cache de la liste d'invités par le service worker : non.

Pas de notifications *push* en v1 : elles exigent VAPID, un abonnement stocké,
et une base légale. Le besoin ne les demande pas.

### 3.8 Les écrans

**Côté hôtesse — `/accueil`** (hors `/admin`, mise en page propre) :

- `/accueil` — si une seule affectation, redirection directe ; sinon, la liste
  des événements du soir. Le chooser ne doit pas coûter un geste quand il n'y a
  rien à choisir.
- `/accueil/[id]` — **l'écran unique**. En haut, le compteur de salle, gros, et
  la fraîcheur. Dessous, la recherche. Dessous, la liste : nom, détail, statut
  **écrit**, effectif, et un seul bouton pleine hauteur par rangée.
- `/accueil/[id]/impression` — la liste de secours, en A4, à imprimer la veille.

**Côté organisation — dans l'écran existant du sondage :**

- `/admin/sondages/[id]/accueil` — désignation des hôtes, affectations,
  état de préparation, essai à blanc.
- Une **quatrième vue** dans les statistiques existantes : « Arrivées ».
  Elle ne s'ajoute qu'au dépouillement, et réutilise `StatisticsTabs`.

---

## 4. Sécurité et robustesse — les pannes prévues, nommées

L'exigence est claire : ça ne doit pas tomber pendant la soirée. Voici ce
contre quoi le module est conçu, panne par panne.

| Panne | Conséquence sans garde-fou | Garde-fou |
| ----- | -------------------------- | --------- |
| Réseau coupé 30 s | Les pointages sont perdus, personne ne le sait | File locale + `op_id` + reprise ; badge « en attente » |
| Requête partie, réponse perdue | Double bascule, l'invité redevient absent | Idempotence sur `op_id` |
| Deux hôtesses, même invité | Un dé-pointage tardif efface une arrivée | `expected_version`, refus explicite |
| Websocket mort | **Liste gelée qui a l'air vivante** | Le delta est le contrat ; fraîcheur écrite |
| 6 téléphones derrière le wifi de la salle | Le rate-limit par IP les étrangle mutuellement | Seau **par utilisateur**, pas par IP (voir ci-dessous) |
| Une hôtesse ne peut pas se connecter à 19 h 50 | La soirée se fait sur papier | Lien d'invitation à usage unique, session longue, essai à blanc la veille, écran « qui s'est déjà connecté » |
| Panne totale (Vercel, Supabase, 4G) | Rien | **La liste imprimée de la veille** |
| Un invité se présente sans être sur la liste | Un nom sur un papier, rapport faux | Arrivant de dernière minute enregistré dans l'application |
| Le téléphone est perdu après la soirée | Une liste nominative dans la nature | Affectation qui **expire**, instantané local effacé |

### Le piège du rate-limit, à corriger pour ce module

`clientIdentifier()` (`src/lib/security/rate-limit.ts:75`) ne lit que
`x-forwarded-for` / `x-real-ip`. Six hôtesses derrière le NAT d'une salle
partagent **une seule IP** : elles consommeraient le même seau et se
bloqueraient entre elles, en plein service. Les seaux du module `checkin`
doivent donc être indexés sur **l'identifiant de l'utilisateur authentifié**.
C'est un défaut latent qui ne se verrait qu'un soir d'événement.

Et comme le rate-limit est *fail-open* par choix (R2) : si KV est injoignable,
le pointage continue de fonctionner. C'est le bon arbitrage ici, et il faut
l'écrire noir sur blanc dans R2 plutôt que de le découvrir.

### La couleur n'est pas une information

Le besoin est formulé en couleurs : vert présent, rouge absent. Tel quel, c'est
un défaut d'accessibilité — et c'est la règle déjà posée dans le projet (« un
graphique est un renfort, jamais un porteur d'information »). Chaque rangée
portera donc **le statut écrit** et une forme distincte ; la couleur renforce,
elle ne porte pas. Le changement d'état est annoncé une fois, dans une zone
unique — pas deux `role="alert"` concurrents.

Cibles tactiles : 44 px pleins, y compris sur pointeur fin. Le `sp-btn--sm` à
38 px (R13) n'a rien à faire sur l'écran de pointage : ici, c'est l'action
principale, et elle se fait debout, d'une main.

### Les tests qui conditionnent la livraison

- **`rls`** — persona `host`, route par route : il ne lit pas l'événement B, il
  ne lit aucune autre réponse de l'organisation, il n'écrit pas `data`, il
  n'atteint pas `/admin`, son affectation expirée ne lui ouvre plus rien. Et le
  test de surface exposée passe de 9 à 10 fonctions, nommément.
- **`integration`** — même `op_id` deux fois = une transition ; deux appels
  concurrents = un gagnant, un refus, aucune perte ; pointage d'une réponse
  supprimée = refus ; pointage après la fin de l'affectation = refus.
- **`unit`** — le réducteur (état serveur + file locale → affichage), les
  agrégats d'arrivée, la courbe.
- **`a11y`** — statut non porté par la couleur, annonce unique, cibles 44 px,
  liste utilisable au clavier et au lecteur d'écran.

---

## 5. Ce que je vous propose en plus — et ce que j'écarte

Vous demandez d'être poussé. Voici ce que je retiens, par ordre d'utilité
réelle à une porte, pas par ordre de séduction.

### Les quatre qui changent la soirée

1. **L'effectif réellement entré, pas seulement l'arrivée.** « Mme X annoncée
   +2, arrive seule. » Sans un `+/−` sur la rangée, le compteur de salle est
   faux toute la soirée — et c'est précisément le chiffre que le traiteur et la
   sécurité demandent à 21 h. Deux boutons, et le rapport cesse de mentir.

2. **L'arrivant de dernière minute.** Quelqu'un se présente sans être sur la
   liste. Aujourd'hui, c'est un nom griffonné sur un papier et un rapport
   incomplet. Proposition : un bouton « Ajouter un arrivant » qui crée une
   **vraie réponse**, par le même chemin que la soumission publique — donc avec
   la même validation, la même preuve de consentement, la même base légale —
   marquée `source: 'desk'`. Sans cela, le module raconte une soirée qui n'a
   pas eu lieu.

3. **« Annuler » pendant 30 secondes.** L'erreur la plus fréquente à une porte
   n'est pas le double-clic, c'est la rangée du dessous. Retrouver l'invité,
   le dé-pointer, se justifier : trente secondes perdues et une file qui
   s'allonge. Un « Annuler » éphémère coûte dix lignes.

4. **La liste de secours imprimable.** C'est la seule réponse honnête à « ça ne
   doit pas crasher ». Vercel, Supabase et la 4G peuvent tomber ensemble ; une
   feuille A4 imprimée la veille, non. Une feuille de style d'impression sur la
   liste existante, et c'est fait.

### Les quatre qui évitent la catastrophe de 19 h 50

5. **L'essai à blanc.** L'administrateur ouvre le poste d'accueil en mode
   répétition : les hôtesses s'entraînent, rien n'est compté, un bouton remet à
   zéro. Le classique « on a découvert à 19 h 50 que le compte ne marchait pas »
   disparaît.

6. **« Qui s'est déjà connecté ? »** L'écran de préparation affiche : trois
   hôtesses affectées, deux se sont connectées au moins une fois. Le plus gros
   risque opérationnel devient un fait visible, la veille.

7. **L'invitation à usage unique.** L'administrateur crée le compte hôte depuis
   l'écran de l'événement et envoie un lien qui pose le mot de passe. Pas de
   réinitialisation de mot de passe sur un parvis, sous la pluie, en 4G.

8. **Le partage de la file par lettre.** Trois pupitres, trois hôtesses, un
   filtre A–F / G–M / N–Z dans l'URL. C'est comme ça que les portes se tiennent
   réellement, et ça évite que deux personnes cherchent le même nom.

### Les trois qui servent après

9. **La courbe des arrivées par tranche de dix minutes.** Le pic d'affluence est
   un fait, calculable, et c'est ce que l'organisation reproche à son prestataire
   l'année suivante. `sparkline.ts` le dessine déjà. **Un fait, jamais un
   conseil** : on n'écrira pas « ouvrez un second pupitre ».

10. **Les absents annoncés présents.** La différence entre l'effectif annoncé et
    l'effectif constaté, nommément. C'est le chiffre qui sert à dimensionner la
    soirée suivante.

11. **L'expiration automatique des accès.** Deux jours après l'événement,
    l'affectation ne vaut plus rien et l'instantané local est effacé. Personne
    n'y pense ; tout le monde le regrette.

### Ce que j'écarte, et pourquoi

- **Le QR code sur l'invitation.** Séduisant, et c'est un piège : il faut que
  chaque invité retrouve son courriel à l'entrée, et il faut maintenir un
  chemin de secours par le nom de toute façon. On aurait deux parcours à tenir
  pour un gain nul — la recherche par nom sur 500 personnes prend deux
  secondes. À reconsidérer au-delà de 2 000 invités.
- **Les notifications push.** VAPID, abonnements stockés, base légale. Pour
  prévenir de quoi ?
- **Le badge imprimé à l'entrée.** C'est un autre métier (imprimante, gabarit,
  pilote). Si le besoin existe, il mérite son propre lot.
- **Le registre d'invités** (import d'une liste nominative, relances,
  non-répondants). Hors périmètre déclaré en R8, et pour de bonnes raisons :
  c'est un module, pas un écran. Le pointage ne le présuppose pas.

---

## 6. Plan de livraison

Cinq lots. Chacun se termine par `npm run verify` au vert, et aucun ne laisse
l'application dans un état intermédiaire déployable à moitié.

| Lot | Contenu | Pourquoi dans cet ordre |
| --- | ------- | ----------------------- |
| ~~**0. Assainissement**~~ ✅ | Historique réaligné, `dedup_sans_valeur` appliquée et prouvée, `CLAUDE.md` corrigé | **Préalable, pas une option.** Ajouter des migrations sur un historique divergent, c'est construire sur du sable — et la mine du `dedup_field` sauterait sur le premier sondage qui réactive l'unicité. |
| ~~**1. Droits**~~ ✅ | Rôle `host`, `checkin_staff` à clés composites, `app.can_staff_survey`, module au catalogue, `is_active_member()` fermée à la source, persona `host` dans les tests | C'est le seul lot qui peut ouvrir une fuite. Il se fait seul, et se relit seul. **Déployé le 29 octobre 2026.** |
| ~~**2. Faits**~~ ✅ | `event_checkins`, `event_checkin_log`, `set_checkin`, idempotence, concurrence, surface exposée 9 → 10 | Le cœur, testable sans aucun écran. **Déployé le 29 octobre 2026.** |
| ~~**3. Poste d'accueil**~~ ✅ | `/accueil`, réducteur pur, delta, file hors-ligne, PWA, impression de secours | L'écran, une fois que ce qu'il manipule est sûr. **Deux écarts à la note, assumés et écrits** : le delta et le pointage passent par nos ROUTES et non en direct vers Supabase (sans quoi la correction du seau par utilisateur n'aurait plus d'objet, et le chemin ne serait pas couvert par le harnais d'intégration) ; et pas de service worker (R15), ni d'instantané de la liste sur l'appareil. |
| **4. Préparation** | Écran d'affectation, invitation à usage unique, essai à blanc, « qui s'est connecté » | Ce qui évite l'échec du soir même. |
| **5. Rapport** | Vue « Arrivées », export, courbe, écarts annoncé/constaté | Ce qui sert le lendemain. |

Les lots 1 et 2 sont le vrai travail de sécurité ; les lots 3 à 5 sont du
produit. Si le temps manque, **1 + 2 + 3 est un module utilisable** ; 4 et 5
peuvent suivre.

### Ce qui reste à trancher avec vous

1. ~~**Accès Supabase**~~ — ✅ rétabli le 28 octobre 2026.
2. **Le nom du rôle** : `host` dans le code, mais quel mot à l'écran ? « Hôte
   d'accueil » ? Le vocabulaire est balayé par un test, il doit être choisi une
   fois.
3. **L'arrivant de dernière minute** (proposition 2) : il crée une vraie
   réponse, donc il touche aux comptages et au RGPD. Je le recommande, mais
   c'est votre décision, pas la mienne.
4. ~~**Le volume maximal attendu**~~ — ✅ tranché par les données : 220 places,
   151 réponses. Pas de fenêtrage.
5. **Le lot 0 est-il à faire maintenant ?** Pousser `dedup_sans_valeur` touche
   la fonction de soumission d'un formulaire **ouvert et qui reçoit des
   réponses aujourd'hui**. La migration est idempotente et ne change le
   comportement que dans le cas aujourd'hui inatteignable (`dedup_field` non
   nul), mais c'est une écriture en production sur un chemin vivant : elle se
   décide, elle ne se glisse pas dans un lot.
