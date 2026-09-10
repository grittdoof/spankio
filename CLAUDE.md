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
- **La visibilité d'un champ est TRANSITIVE.** Une condition n'est applicable
  que si les questions qu'elle observe sont elles-mêmes affichées. Défaut réel
  qui a bloqué un formulaire en production : « Nom de la personne
  accompagnante » dépendait de « Serez-vous accompagné ? », elle-même
  conditionnée par « Serez-vous présent ? ». Un répondant qui annonçait venir
  accompagné puis revenait dire qu'il ne venait pas laissait « accompagné = Oui »
  dans l'état ; cette réponse devenue inapplicable continuait à commander
  l'affichage des deux questions sur l'accompagnant. C'est la même règle que
  celle qui fait RETIRER une valeur devenue inapplicable à la validation : une
  question qu'on n'a pas posée n'affirme rien. `isFieldVisible` ne voit pas la
  transitivité — elle ne juge qu'un champ isolé — et son commentaire le dit :
  utiliser `isVisibleField(schema, id, answers)` dès que cela compte.
- **Un refus d'envoi NOMME la question, toujours.** « Certaines réponses
  doivent être corrigées » sur un formulaire de neuf questions laisse chercher :
  c'est exactement le reproche qu'on nous a fait. Trois cas, dans cet ordre — le
  champ fautif est un écran du parcours, on y retourne avec le message en
  ligne ; il existe au schéma sans être affiché, on nomme la question ; il
  n'existe pas même au schéma, on nomme la clé. Le message générique nu n'est
  plus atteignable.
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
- **Les statistiques se lisent en TROIS vues, pas en une page empilée.**
  « Combien serons-nous ? » se lit la veille en un coup d'œil ; « qu'ont
  répondu les gens ? » se lit une fois, au dépouillement ; « untel a-t-il
  confirmé ? » se lit debout, à l'accueil, sur un téléphone. Les empiler
  imposait de faire défiler plusieurs milliers de pixels pour atteindre la
  troisième. L'état des vues vit dans l'URL
  (`src/lib/admin/statistics-view.ts`) : les onglets sont des LIENS et la
  recherche un `<form method="get">`, donc l'écran entier fonctionne sans
  JavaScript. Pas de `role="tablist"` : il promettrait une navigation par
  flèches que des liens ne fournissent pas.
- **Un fait, jamais un conseil.** `eventInsights` n'énonce que des faits
  recalculables (places restantes, réponses à vérifier, période la plus
  active). La maquette proposait « Relancez mardi entre 17 h et 19 h » : rien
  dans les données ne soutient une telle recommandation — les réponses
  arrivent quand les invitations partent, pas quand les invités sont
  disponibles. Un test refuse tout impératif dans ces énoncés.
- **Aucune jauge sans dénominateur.** Le composant `Donut` exige `total`. La
  capacité d'un événement est un réglage FACULTATIF (`attendance.capacity`) :
  sans elle, l'écran affiche l'effectif attendu et rien d'autre — pas de taux
  de remplissage calculé sur un total inventé, pas de « places libres ».
- **Le nom d'un invité est DÉSIGNÉ, comme sa présence.** « Nom et prénom »
  n'existe pas plus que « Société » dans une plateforme générique :
  `attendance.identityField` et `attendance.detailField` disent quelles
  questions titrent et précisent une rangée. Sans désignation, la rangée est
  titrée par son horodatage — exact, et l'écran dit comment faire mieux.
- **Les invités se suppriment par SÉLECTION, jamais rangée par rangée.**
  Demande du client. Toutes les cases portent le même nom (`responseId`), le
  navigateur envoie la sélection entière et `getAll` la relit : l'écran continue
  de fonctionner sans JavaScript, comme sa recherche et ses filtres. Le bouton
  par rangée a DISPARU, pour deux raisons — son `<form>` se serait retrouvé
  imbriqué dans celui de la sélection, ce qu'aucun navigateur n'accepte ; et un
  bouton « Supprimer » par rangée invitait à effacer une inscription d'un seul
  clic mal placé. Rien n'est coché par défaut, et la case porte le nom de
  l'invité qu'elle désigne : « case à cocher » répété trente fois ne dit rien à
  qui n'a pas la rangée sous les yeux.
- **Une suppression groupée est bornée par le SONDAGE affiché, pas seulement
  par le RLS.** `softDeleteResponses` filtre sur `survey_id` en plus de la liste
  d'identifiants : sans lui, un formulaire forgé effacerait d'un coup les
  réponses d'un autre sondage de la même organisation — autorisé par le RLS,
  mais sans aucun rapport avec l'écran d'où part le geste. Elle exclut aussi les
  réponses DÉJÀ supprimées, sinon le délai de grâce avant la purge repartirait
  de zéro. Et elle renvoie les identifiants RÉELLEMENT écrits : le compte rendu
  annonce ce nombre, jamais celui de la sélection — « 12 supprimées » quand il y
  en a eu 11 serait un chiffre faux que rien ne signalerait.
- **La liste d'accueil remplace le tableau des réponses, l'export ne perd
  rien.** À l'entrée d'un événement on cherche UN nom et on lit UN statut ;
  douze colonnes obligeaient à défiler horizontalement pour trouver ces deux
  informations. Toutes les colonnes restent dans le tableur et le JSON, où
  elles servent à autre chose qu'à un coup d'œil.
- **Sur le dégradé marine, les surfaces sont ASSOMBRIES, jamais éclaircies.**
  Un voile blanc rapproche le fond du texte clair : mesuré, le rapport
  descendait à 4,41:1 au bout clair du dégradé. Les tuiles et la pastille de
  variation posent donc un voile noir. Les quatre paires concernées sont dans
  `CONTRAST_REQUIREMENTS`, et la plus serrée tient 5,34:1.
- **Un graphique est un renfort, jamais un porteur d'information.** Courbe,
  barre empilée et anneaux sont `aria-hidden`, et chaque valeur est écrite à
  côté ou énumérée juste après. Conséquence moins évidente : le compte inscrit
  AU-DESSUS d'une colonne est lui aussi `aria-hidden`, sinon le lecteur
  d'écran énonce le même nombre deux fois, de part et d'autre de la valeur
  qu'il qualifie. Et le tracé garde son rapport de forme — un
  `preserveAspectRatio="none"` étirerait les étiquettes, qui sont du vrai
  texte.
- **La géométrie d'une courbe est une fonction pure** (`src/lib/design/
  sparkline.ts`), et son échelle part TOUJOURS de zéro. Une courbe fausse
  ressemble à une courbe : composée dans du JSX, elle ne se vérifierait qu'à
  l'œil, et un axe tronqué exagérerait la moindre variation.
- **Un jour n'est pas une tranche de 24 heures.** `responsePace` et `countdown`
  découpent des jours de CALENDRIER dans le fuseau de l'événement : « J-1 »
  veut dire demain, et une réponse envoyée à 23 h 40 heure de Paris ne doit pas
  basculer dans la colonne du lendemain parce que le serveur est en UTC.
- **Une distribution par valeur n'existe que si elle se lit** : réponses
  entières, et étendue d'au plus `DISTRIBUTION_SPAN` valeurs. Une question de
  surface en m² produirait autant de colonnes que de réponses — ce n'est plus
  une distribution, c'est une liste.
- **Aucun agrégat de champ libre, même déguisé en graphique.** La maquette
  comportait une carte « Sociétés représentées » alors qu'elle classait la
  société parmi les champs libres : elle n'a pas été reprise. Si une
  organisation veut ce classement, elle pose la question en liste fermée, et
  l'onglet « Questions » la restitue déjà.
- **La marque ouvre l'invitation, seule, centrée et séparée par un filet.** Le
  logo était rangé en haut de la colonne de texte du héro : décentré, et placé
  plus ou moins haut selon la longueur du titre. Le client l'a demandé au
  sommet. Effet second, recherché : la colonne de texte ne commençant plus par
  le logo, l'`align-items: center` du héro centre enfin le visuel SUR le texte
  au lieu de les aligner par le haut — mesuré, les deux centres tombent à
  325 px. Corollaire de mise en garde : ajouter un enfant à la grille
  `.sp-invite` a décalé les rangées implicites, et deux rangées codées en dur
  pendant que les autres se plaçaient seules auraient superposé le héro et la
  colonne de lecture. Les quatre rangées sont donc explicites.
- **L'invitation publique n'est pas un formulaire : elle se lit avant de se
  remplir.** D'où une mise en page éditoriale — héro, colonne de lecture,
  compte à rebours collant à droite, barre d'inscription collante en bas — et
  non l'empilement d'un écran d'administration. Le moteur de questions reste
  intact derrière : `Invitation` est un objet distinct de `SurveyRenderer`.
- **L'heure de fin est un bloc À PART de la date, sur la page comme dans le
  courriel.** Demande du client : « Fin prévue à 23:59 » ne doit pas être
  imposée. Une heure de fin n'est souvent qu'indicative, et un invité la lit
  comme un engagement — la fermer ne doit donc pas emporter le jour de
  l'événement. Le bloc suit immédiatement `practical` dans `PUBLIC_BLOCKS`,
  parce que c'est là qu'il s'affiche.
- **Chaque bloc de la page publique s'ouvre ou se ferme, et la liste
  enregistrée est celle des blocs MASQUÉS.** Avec une liste d'autorisation, un
  bloc ajouté plus tard naîtrait invisible sur tous les formulaires existants
  et personne ne saurait qu'il existe ; avec une liste de masquage, le défaut
  reste « montrer ce qui a du contenu ». Deux blocs sont fermés par défaut —
  le nombre d'inscriptions et le partage du lien — parce que publier
  l'affluence ou diffuser une adresse nominative sont des divulgations, qui se
  demandent. Corollaire : **le premier clic fige la liste entière**, sinon
  ouvrir « le partage » réactiverait « le nombre d'inscriptions » au passage.
- **Un interrupteur ne fabrique pas de contenu.** Un bloc autorisé mais vide ne
  s'affiche pas : « Déroulé de la soirée » suivi du vide est pire que son
  absence. Le filtrage vit dans la PAGE (`invitationContent`), jamais dans le
  composant — un composant qui déciderait lui-même finirait par afficher un
  titre orphelin.
- **L'interrupteur est à côté du contenu qu'il gouverne.** Le déroulé, le mot
  de l'organisateur, les questions fréquentes et l'accès portent le leur, sur
  leur propre carte ; les autres sont regroupés là où il n'y a rien à saisir.
  Ailleurs, on chercherait quel bouton commande quoi. Et **fermer un bloc ne
  détruit pas son contenu** — un test le vérifie.
- **Une organisation choisit le FOND de son bouton d'inscription, jamais son
  encre.** Blanc ou encre foncée de la charte, celle des deux qui contraste le
  mieux — laisser choisir les deux reviendrait à laisser fabriquer un bouton
  illisible, sur le seul appel à l'action d'une page publique. Le survol
  s'ÉLOIGNE de l'encre (encre blanche → fond assombri, encre foncée → fond
  éclairci) : le contraste ne peut donc que monter, ce qui rend la vérification
  au repos suffisante. Défaut attrapé par mutation pendant l'écriture : la
  première règle assombrissait tout, y compris un bouton jaune à encre foncée,
  et seule la vérification du survol mordait — l'inverse de l'intention.
- **Trois remparts, aucun destructeur, sur la couleur du bouton.** Le SCHÉMA
  n'exige que le format `#RRGGBB` — une contrainte de contraste y ferait
  échouer `validateSurveySettings` en entier, et la page publique perdrait
  TOUS ses réglages d'un coup (`settings.ok ? … : {}`). L'ÉCRAN de réglages
  refuse à la saisie en nommant le ratio mesuré. Le RENDU (`ctaPalette`)
  renvoie `null` pour toute couleur invalide ou illisible, et le bouton reprend
  la charte : quoi qu'il y ait en base, la page publique ne peut pas afficher
  un appel à l'action qu'on ne lit pas.
- **Une couleur qui arrive de la base ne traverse jamais un attribut `style`
  telle quelle.** React n'assainit pas les valeurs CSS : ce que `normaliseHex`
  renvoie est RECONSTRUIT depuis trois composantes analysées, donc ne peut
  contenir que des chiffres hexadécimaux. La peinture passe par les variables
  internes de `sp-btn` (`--_bg`, `--_bg-hover`, `--_fg`), si bien que tailles,
  transitions, cible tactile et anneau de focus restent ceux de la charte.
- **Le contraste du bouton avec le FOND DE PAGE est signalé, pas imposé.**
  WCAG 1.4.11 dispense de la règle des 3:1 un contrôle identifiable par son
  libellé, ce qui est toujours le cas ici. Refuser tous les tons pâles au nom
  d'une règle qui ne s'applique pas serait un excès de zèle déguisé en
  accessibilité : l'écran mesure, le dit, et laisse choisir. La bande
  réellement refusée est étroite — les gris moyens autour de `#7F7F7F`, où
  aucune encre n'atteint 4,5:1.
- **La carte de la page publique est un bloc DÉBRAYABLE, et le seul qui
  contacte un tiers sans clic.** Position initiale — aucune carte, l'itinéraire
  n'étant fait que de liens — levée à la demande du client : une invitation lue
  par quelques centaines de personnes entre dans les usages modérés que prévoit
  la politique de tuiles d'OpenStreetMap. La contrepartie est donc ASSUMÉE et
  écrite dans l'écran de réglages : les tuiles partent du navigateur de chaque
  invité vers OSM. Fermer le bloc rend la page muette côté tiers sans faire
  perdre les liens d'itinéraire, qui restent un bloc distinct. La carte est un
  REPÈRE — ni glissement, ni zoom, ni clavier, donc `role="img"` — et ce sont
  les liens qui font le travail interactif : promettre une interaction qu'on ne
  fournit pas est pire que s'en abstenir. Conséquence pour l'étape 9 :
  `img-src` doit autoriser `tile.openstreetmap.org`.
- **Une page publique n'affiche jamais de places restantes.** Le plafond de
  réponses (`response_limit`) est délibérément absent de la vue
  `public_surveys`, et un test le fige : le publier dirait au monde entier à
  partir de quand le formulaire ferme. Le nombre d'inscriptions REÇUES, lui,
  est déjà public — il est donc proposé, fermé par défaut.
- **Deux compteurs de temps, deux questions.** `countdown` répond « dans
  combien de JOURS ? » en jours de calendrier — « J-1 » veut dire demain.
  `countdownParts` répond « dans combien de TEMPS ? » en écart d'instants,
  parce qu'un compteur qui affiche des secondes ne peut pas arrondir au jour.
  Aucun des deux ne lit l'horloge : l'appelant fournit le « maintenant », sans
  quoi le rendu serveur et le premier rendu client différeraient d'une seconde
  et React signalerait une divergence d'hydratation.
- **Un compteur ne parle pas.** Les chiffres du compte à rebours sont
  `aria-hidden` et la phrase écrite à côté n'est PAS une zone live : elle se lit
  quand on l'atteint. Un `aria-live` sur des secondes interromprait le lecteur
  d'écran une fois par seconde. La phrase omet d'ailleurs les secondes.
- **L'ordre du DOM est l'ordre de lecture, y compris en deux colonnes.** Le
  compte à rebours est placé juste après le héro dans le DOM et déplacé en
  colonne de droite par la grille — il ne contient AUCUN élément focalisable,
  donc l'avancer ne dérange pas la tabulation. L'agenda, lui, contient des
  liens : il reste dans la colonne de lecture. Un `order` CSS aurait fait
  sauter le focus d'un bord de l'écran à l'autre (WCAG 2.4.3).
- **Une heure d'événement s'affiche dans le fuseau DE L'ÉVÉNEMENT.** Défaut
  réel corrigé : la page publique mettait ses dates en forme dans
  `Europe/Paris` en dur alors que le champ « fuseau » existait et était
  correctement enregistré — une soirée hors de France était annoncée avec
  plusieurs heures d'écart.
- **Une finalité libre ne s'insère pas dans une phrase.** Défaut réel corrigé :
  la mention de la page publique composait « Elles servent à {finalité} », et
  une organisation dont la finalité était rédigée comme une phrase complète
  obtenait « Elles servent à Vos réponses ont bien été enregistrées par le
  service de direction ». La plateforme ne connaît pas la forme grammaticale
  d'un texte libre. La finalité complète reste énoncée par
  `composeConsentNotice`, qui est fait pour cela.
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
- **Accueil et remerciement passent par la MÊME scène que les questions**
  (`sp-runner` > `sp-stage`). Ils en étaient sortis, et n'avaient donc aucune
  marge horizontale : le texte touchait les bords de l'écran là où chaque
  question respirait. La correction est une enveloppe unique, pas un
  rembourrage recopié écran par écran — deux réglages auraient divergé au
  premier ajustement.
- **Le transformateur JSX des tests se règle par `oxc`, plus par `esbuild`.**
  `tsconfig.json` déclare `jsx: preserve` pour Next, donc Vitest doit être
  instruit explicitement ; depuis Vite 8, qui a remplacé esbuild par oxc, la
  clé est `oxc.jsx`. Sans elle, l'erreur est explicite : « make sure to not
  set jsx to preserve ».
- **Une carte Leaflet ne se démonte QU'UNE fois.** `Map.remove()` efface
  `container._leaflet_id` ; un second appel compare cet identifiant à celui que
  la carte a mémorisé et lève « Map container is being reused by another
  instance ». Défaut réel : le nettoyage appelait `remove()` sur `mapRef` puis
  sur la variable locale — la même carte — ce qui produisait une page blanche
  au retour depuis l'écran de l'événement. Le double de Leaflet utilisé en
  test reproduit désormais cette invariante, sinon il laisserait repasser le
  défaut. Corollaire : le conteneur est relu APRÈS l'import dynamique, jamais
  capturé avant — React peut avoir remplacé le nœud entre-temps.
- **L'unicité des réponses n'est jamais imposée en silence.** Un modèle peut
  la SUGGÉRER, `createSurvey` ne l'applique pas : le parcours de création la
  propose explicitement, avec sa conséquence — un second envoi est refusé, et
  le répondant ne peut pas se corriger lui-même. Défaut réel : la suggestion
  du modèle d'inscription était appliquée d'office, et un invité qui se
  réinscrivait recevait un `409` pour une règle que personne n'avait choisie.
  Seuls un courriel ou un téléphone sont proposés comme clé : deux invités
  peuvent porter le même nom.
- **Le parcours de création DÉPEND du type.** Un événement a un écran « date et
  lieu » de plus, placé avant les mentions d'information parce qu'un événement
  sans date ne peut pas être publié. Un écran vide affiché aux sondages
  apprendrait à l'utilisateur que certaines étapes ne le concernent pas, et il
  finirait par les traverser sans les lire.
- **Les modèles d'événement préconfigurent le comptage** (`settings.attendance`
  pointant sur leurs propres questions) : un modèle sait quelles questions il
  pose, l'organisation n'a rien à câbler pour obtenir un effectif.
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
- **Une question JAMAIS POSÉE n'est pas une réserve.** Le comptage évalue les
  conditions d'affichage (`isFieldVisible`) avant de conclure : si « Nombre de
  personnes vous accompagnant » n'est montré qu'à ceux qui ont annoncé venir
  accompagnés, celui qui vient seul a un effectif parfaitement déterminé — une
  personne — et ne doit rien avoir à vérifier. Défaut réel : ce module était
  la seule partie du produit à raisonner sans le moteur de conditions, et
  marquait « à vérifier » tous les invités venant seuls. Corollaire : la
  réserve ne subsiste que lorsque la question a ÉTÉ posée et laissée vide.
- **Désigner une question d'effectif FACULTATIVE est dit, avec son coût.**
  L'écran de l'événement prévient : un invité peut la sauter, sa réponse
  ressortira « à vérifier », et il faudra le rappeler. C'est le cas qui a
  produit le premier « à vérifier » incompris en production — une invitée
  ayant annoncé venir accompagnée sans dire de combien.
- **Trois lectures d'une réponse d'effectif, et c'est le TYPE de la question
  qui décide lesquelles sont offertes.** `extra` (un nombre d'accompagnants),
  `total` (un nombre déjà inclusif) et `one` (un oui/non : la réponse désignée
  ajoute UNE personne). Un champ numérique n'accepte pas `one`, un choix sans
  libellé numérique n'accepte que `one`, une case à cocher multiple n'accepte
  aucun oui/non. Proposer une lecture inapplicable donnerait un comptage qui ne
  se déclenche jamais — c'est le même raisonnement que pour les opérateurs de
  condition. `one` existe pour l'événement qui n'accepte qu'un accompagnant :
  « Serez-vous accompagné ? » suffit alors, et demander un nombre serait une
  question de plus pour une réponse déjà connue.
- **Une lecture d'effectif que la question ne peut pas porter est IGNORÉE, pas
  appliquée.** Défaut réel : après avoir refait ses questions, une organisation
  gardait `partyMode: 'extra'` sur « Serez-vous accompagné ? », dont les
  libellés sont « Oui » et « Non ». Lus comme un nombre ils ne donnent rien, et
  CHAQUE présent ressortait « à vérifier » — un écran entier de réserves pour
  une désignation devenue incohérente, que rien ne signalait. On retombe donc
  sur une personne par réponse, sans réserve. Corollaire pour les tests : une
  désignation incohérente n'est PAS un cas d'ambiguïté de réponse ; l'ambiguïté
  suppose une question capable de porter un effectif, affichée, et restée vide.
- **En mode oui/non, une valeur non désignée rend le comptage MUET, pas faux.**
  Sans `partyValue`, la comparaison ne se déclencherait jamais : on compte une
  personne par réponse, sans réserve. L'écran ne la PRÉSÉLECTIONNE pas — il le
  faisait, en retenant la première option, et c'était un chiffre faux en germe :
  la plateforme est générique, rien ne dit que la première option signifie
  « oui », et une liste « Non / Oui » aurait compté un accompagnant à chaque
  refus sans qu'aucune alerte ne le signale. Le choix est donc demandé, et un
  encadré dit que l'accompagnant n'est pas encore compté tant qu'il manque.
- **La lecture d'effectif appliquée est calculée UNE fois, pour l'écran comme
  pour le comptage** (`effectivePartyMode`). Ignorer une lecture impossible ne
  suffisait pas : sur un « Serez-vous accompagné ? » en Oui/Non portant encore
  `partyMode: 'extra'`, l'écran de réglages annonçait « Un oui ou non » — la
  seule lecture que cette question admette — pendant que le comptage renonçait,
  et que la question « Réponse qui ajoute une personne » restait masquée parce
  que sa condition lisait le réglage périmé. Résultat : deux réponses
  différentes à la même question, et aucun accompagnant compté. Une question
  qui n'admet qu'UNE lecture reçoit donc celle-là — son type la détermine, ce
  n'est pas une invention ; une question qui en admet plusieurs n'en reçoit
  aucune, arbitrer serait une décision que personne n'a prise. Un réglage
  absent vaut toujours `extra`, le défaut historique.
- **Une réponse se CORRIGE sans être réécrite.** Le besoin est légitime — un
  nom mal saisi, un effectif oublié — et le RGPD en fait un droit (art. 16).
  Mais `consent_text` prouve ce qui a été affiché et `submitted_at` date l'acte
  du répondant : réécrire `data` en place détruirait la correspondance entre la
  preuve et ce qu'elle prouve. Une correction est donc l'originale passée en
  suppression logique PLUS une copie portant les données corrigées, la même
  date, le même consentement et un lien `corrects_id`. Rien n'est perdu, rien
  n'est réécrit, les comptages ne bougent pas, et l'audit garde la trace de
  l'auteur — sans recopier la moindre donnée personnelle.
- **L'ordre des deux écritures d'une correction n'est pas interchangeable.**
  Suppression logique d'abord, copie ensuite : l'index anti-doublon est partiel
  sur `deleted_at is null`, et deux lignes vivantes portant la même clé le
  violent. L'ordre inverse paraissait plus prudent et échouait — défaut attrapé
  par le test d'intégration, pas par la relecture. Il est sans risque parce que
  tout se joue dans UNE transaction.
- **La correction passe par une porte `SECURITY DEFINER`, pas par une policy.**
  `correct_survey_response` est la neuvième fonction exposée (voir R11) et
  revérifie elle-même les droits de l'appelant. Autoriser l'écriture de `data`
  par une policy aurait ouvert le chemin à tout appel direct, y compris à un
  futur défaut. Le CONTENU, lui, est validé en TypeScript par
  `validateResponse` — la même liste blanche qu'une soumission publique, pour
  qu'un éditeur ne puisse pas ranger dans `data` des clés qu'un répondant ne
  peut pas y mettre.
- **L'écran de correction réutilise `FieldInput`**, le composant du parcours
  public : onze types de champs déjà accessibles et déjà testés, et les
  questions conditionnelles suivent la saisie comme côté répondant. En écrire
  une version « admin » aurait donné deux comportements pour une même question.
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
- **La marque d'une organisation est son logo, l'initiale n'est qu'un repli.**
  `BrandMark` affiche le logo déposé dans `/admin/organisation` dès qu'il
  existe, et un carré portant l'initiale sinon — une organisation sans logo
  doit tout de même se distinguer d'une autre dans la barre latérale. Le nom
  reste écrit à côté : à 32 px de haut, la plupart des logos ne se lisent pas.
  Les deux formes sont décoratives (`aria-hidden` / `alt=""`), sinon le nom
  s'entendrait deux fois. Côté CSS, seule la HAUTEUR du logo est contrainte :
  un logo est presque toujours plus large que haut, et l'enfermer dans le
  carré de 2rem le réduirait à un timbre illisible.
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
- **Le titre du rendez-vous d'agenda est RÉGLABLE, et suit le contrat de la
  note.** Demande du client. Un titre d'invitation est fait pour être lu SUR
  une page — « Spie batignolles célèbre ses 180 ans et vous convie à une soirée
  d'exception » — pas pour tenir dans la case d'un lundi. `eventTitle` remplace
  donc par ce qui est écrit, ne compte pas un champ vide ou fait d'espaces, et
  retombe toujours sur le titre du formulaire : un rendez-vous sans titre serait
  pire qu'un titre trop long. Rangé dans `settings.calendar.title`, donc sans
  migration. La MÊME fonction sert aux liens de la page, au fichier `.ics` —
  dont elle nomme aussi le FICHIER, sans quoi un `.ics` nommé d'après
  l'invitation et un rendez-vous nommé autrement laisseraient croire à deux
  événements — et au courriel de confirmation.
- **Une note d'agenda écrite par l'organisation REMPLACE le texte
  automatique**, elle ne s'y ajoute pas (`eventNote`). C'est le contrat le plus
  prévisible — ce qu'on écrit est ce que le répondant lit, sans mention
  d'organisateur ni lien ajoutés dans son dos. Conséquence assumée : le lien de
  retour disparaît d'une note personnalisée, d'où le bouton « Reprendre le
  texte automatique » qui prégarnit la zone de saisie plutôt que d'ouvrir une
  page blanche. Une note vide ou faite d'espaces ne compte pas : un champ
  effacé produirait un rendez-vous muet, alors que le texte automatique vaut
  mieux que rien.
- **L'aperçu d'une note est produit par la MÊME fonction que les liens
  d'agenda et le fichier `.ics`.** Un aperçu qui recomposerait le texte de son
  côté finirait par montrer autre chose que ce que reçoit le répondant.
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
  hors de la liste exposée par l'API. `public` ne contient que les 9 fonctions
  réellement appelées par le réseau, et un test échoue si une dixième
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

- **Le courriel de confirmation est ANNONCÉ avant d'être envoyé.** Écrire au
  répondant est un usage de l'adresse qu'on lui a demandée : dès que l'envoi
  est activé, `composeConsentNotice` ajoute la mention, la mention s'affiche
  avant l'envoi et la preuve stockée la garde. C'est la règle d'or appliquée à
  la lettre, et un test d'intégration lit `consent_text` en base pour le
  vérifier.
- **L'adresse du destinataire est DÉSIGNÉE, jamais devinée.** Un formulaire
  peut demander deux adresses — celle de l'invité et celle de son assistant —
  et se tromper ne se verrait jamais côté organisation. Seules les questions de
  type « adresse électronique » sont proposées : un champ libre n'est pas
  validé comme une adresse, et l'envoi échouerait une fois sur deux sans que
  personne ne le sache.
- **Un envoi qui échoue ne défait pas une inscription.** `sendEmail` ne lève
  jamais, l'envoi vient APRÈS l'écriture, et son résultat n'est qu'un booléen
  informatif dans `SubmissionResult`. Une adresse absente n'est même pas une
  anomalie : la question désignée peut être facultative.
- **Les attributs d'une image de courriel portent ses dimensions
  d'AFFICHAGE, jamais celles de la source.** Défaut réel signalé sur Outlook
  2608 (M365 Apps) : le visuel arrivait écrasé. Les attributs disaient
  1200 × 704 et le rapport de forme n'était tenu que par `height: auto`. Or
  Outlook sous Windows rend avec le moteur de Word : il ignore `height: auto`
  et applique l'attribut `height`, tout en ramenant la largeur à celle de la
  cellule. Reproduit dans un navigateur en imitant ce moteur — l'image
  ressortait en 502 × 704, soit un rapport de 0,71 au lieu de 1,70, deux fois
  et demie trop haute. Aucun autre client ne le montrait, tous respectant
  `height: auto`. `displayedImageSize` calcule donc les dimensions réelles
  depuis la largeur de la colonne (504 px), et n'agrandit pas une image plus
  petite. Sans rapport de forme exploitable, la hauteur est OMISE : le client
  la déduit de l'image, ce qu'un `height="NaN"` empêcherait. C'est aussi
  pourquoi le logo d'organisation n'a pas d'attribut de hauteur — la
  plateforme ne connaît pas son rapport de forme.
- **Le gabarit de courriel est doublé d'un tableau conditionnel `[if mso]` de
  largeur fixe.** Outlook ignore `max-width` : la carte occupait toute la
  largeur du volet de lecture. Les deux correctifs ne valent qu'ENSEMBLE — une
  image de largeur fixe posée dans une cellule de largeur indéterminée
  redevient déformée dès que `height: auto` est ignoré. Un test compte les
  ouvertures ET les fermetures du commentaire conditionnel : un commentaire non
  refermé emporterait la fin du document chez Outlook seulement, donc
  invisiblement.
- **Un saut de ligne de courriel est une BALISE, jamais du CSS.** Défaut réel
  signalé par le client : le champ « Accès » se rédige en liste — métro, bus,
  parking — et arrivait sur une seule ligne. Le rendu s'appuyait sur
  `white-space: pre-line`, que le moteur de Word — donc Outlook sous Windows —
  n'applique pas. Et un test l'affirmait déjà : il cherchait la PROPRIÉTÉ CSS
  dans la source, c'est-à-dire qu'on l'avait bien écrite, pas qu'elle produisait
  des lignes. Deuxième fois que ce piège se referme, après le rapport de forme
  d'une image : ne pas vérifier ce qu'on ÉMET, mais ce qui est RENDU.
  `escapeMultiline` échappe D'ABORD et insère les `<br />` ENSUITE — l'inverse
  afficherait les balises en clair — et normalise les fins de ligne Windows,
  sans quoi un `\r` résiduel doublerait l'interligne chez certains clients.
- **Le visuel d'un courriel est DÉCORATIF** (`alt` vide). Beaucoup de clients
  mail bloquent les images : un `alt` bavard laisserait un pavé de texte à la
  place de la bannière, alors que son contenu est déjà dit par les faits qui la
  suivent.
- **Une date d'événement n'est mise en forme qu'à UN endroit**
  (`src/lib/event/display.ts`), partagé par la page publique et le courriel.
  Deux compositions auraient divergé, et le courriel aurait fini par annoncer
  une autre heure que l'invitation — sur la seule information qu'un invité
  recopie dans son agenda.
- **Une réponse sans clé anti-doublon est ENREGISTRÉE, pas refusée.** La
  fonction SQL exigeait une valeur dès que le sondage désignait une clé. Défaut
  réel, et le pire de la série : après avoir refait ses questions, une
  organisation gardait `dedup_field = 'email'`, identifiant que le schéma ne
  contenait plus. Aucune valeur ne pouvait être extraite, `dedup_hash` renvoyait
  null, et CHAQUE inscription repartait en 400 « Les données envoyées sont
  invalides » — sur une saisie parfaitement valide, sans un seul champ à
  corriger, et sans que rien ne le signale côté organisation. Neuf réponses
  reçues, puis plus aucune. Le refus prétendait garantir « toute réponse porte
  une clé » : garantie intenable, puisque la question désignée peut avoir
  disparu, être facultative, ou n'être POSÉE qu'à une partie des répondants —
  une adresse demandée aux seuls présents n'existe pas chez ceux qui déclinent.
  La garantie réelle est celle de l'index partiel : deux réponses vivantes ne
  peuvent pas porter la MÊME clé ; une clé absente ne collisionne avec rien.
- **La clé anti-doublon est une DÉSIGNATION, avec les mêmes règles que les
  autres.** `dedupDesignation` (`src/lib/survey/dedup.ts`) est la seule lecture
  de `surveys.dedup_field` : une question absente du schéma est ignorée et
  journalisée (`survey.dedup_field_missing`) — muet plutôt que faux, exactement
  comme une lecture d'effectif que la question ne peut pas porter. Le même
  module porte la liste des candidats, qui avait DÉJÀ divergé : l'éditeur et le
  parcours de création n'acceptaient qu'un courriel ou un téléphone, tandis que
  la fonction de `builder.ts` — testée mais appelée nulle part — acceptait aussi
  les champs libres.
- **Un `<select>` dont la valeur ne correspond à aucune option MENT.** Trois
  défauts réels de cette seule cause, dont deux affichaient l'inverse de la
  base et un faisait passer un test pour vert. Le
  navigateur affiche alors la première : l'écran d'édition annonçait « Autoriser
  plusieurs réponses » alors que la base imposait une clé introuvable, et
  l'organisation n'avait aucun moyen de le voir. La désignation orpheline est
  donc une option à part entière, nommée « Question supprimée — à corriger », et
  un encadré dit la conséquence. Corollaire : quand la question désignée existe
  mais est facultative ou conditionnée, l'écran dit que l'unicité ne couvrira
  qu'une partie des réponses — c'est un coût, pas un défaut, et il se connaît
  avant de publier. Même cause dans les réglages d'événement : « Réponse qui
  ajoute une personne » n'avait pas d'option vide, si bien qu'un `partyValue`
  absent faisait afficher la première réponse de la liste — et un test
  d'accessibilité AFFIRMAIT cette présélection, qui n'existait qu'à l'écran.
  Tout `<select>` dont la valeur peut être absente porte donc une option vide
  explicite, qui dit la conséquence.
- **Chaque bloc du courriel de confirmation s'ouvre ou se ferme**, et la liste
  enregistrée est celle des blocs MASQUÉS — mêmes décisions que pour la page
  publique, et pour les mêmes raisons (`src/lib/survey/confirmation.ts`). Le
  besoin est venu du client : une heure de fin seulement indicative qu'il ne
  voulait pas annoncer. L'heure de fin est donc un bloc DISTINCT de la date, et
  fermer l'un ne ferme pas l'autre. Le filtrage vit dans l'appelant
  (`sendConfirmation`), jamais dans le gabarit — comme `invitationContent` pour
  la page : un gabarit qui déciderait lui-même finirait par afficher un titre
  orphelin. Corollaire : l'avertissement « le champ Accès est vide » disparaît
  quand le bloc « Accès » est fermé, puisqu'il n'énonce plus de conséquence.
- **Le champ « Accès » sert deux fois.** Saisi une fois dans les réglages de la
  page publique, il s'affiche dans « S'y rendre » ET dans le courriel. L'écran
  signale qu'il est vide quand l'envoi est activé, plutôt que de laisser
  découvrir un courriel sans accès.

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
  `consent_text` (snapshot du texte affiché — preuve auditable). Ce texte
  mentionne le courriel de confirmation dès que l'organisation l'active : un
  envoi non annoncé serait un usage tacite de l'adresse collectée.
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
| R6 | **ESLint 9** alors qu'ESLint 10 existe : `eslint-config-next@15` ne déclare pas la compatibilité ESLint 10. La montée proposée par Dependabot vers `eslint-config-next@16` a été **refusée** : c'est le paquet de configuration de Next 16, et l'installer sans Next 16 fait diverger l'outil du framework qu'il est censé décrire. | Rester sur la stack imposée (Next 15). Outil de développement uniquement, aucune vulnérabilité connue. | À la migration Next 16, où les deux montent ensemble. |
| R7 | **`postcss` surchargé** en 8.5.26 via `overrides` : Next 15 épingle 8.4.31, vulnérable (GHSA sourceMappingURL / XSS de stringify). Correctif amont = Next 16 (majeure). | Conserver Next 15 tout en gardant `npm audit` à zéro. `postcss` n'est utilisé qu'au build. | À la migration Next 16. |
| R8 | **Hors périmètre MVP** : i18n (interface en français uniquement, chaînes centralisées), champs d'upload de fichiers dans les sondages, webhooks, SSO, multi-région, et **registre d'invités** — donc pas de « non-répondants », pas de relance, pas de taux de complétion. La plateforme connaît les réponses REÇUES par un lien public ; elle ne connaît pas la population invitée, et un « 142 sans réponse » serait un chiffre sans source. | Périmètre MVP. Un registre suppose l'import d'une liste nominative, des liens personnels, un canal d'envoi et une base légale par destinataire : c'est un module, pas un écran. | Sur demande client, avec sa propre analyse RGPD. |
| R9 | **Tests d'intégration sur PGlite** et non sur un vrai Supabase : `auth.uid()`, les rôles `anon`/`authenticated`/`service_role` et le schéma `auth` sont émulés par le harnais. **Partiellement levé** : les 21 migrations ont été appliquées sur le projet Supabase réel et 70 contrôles y ont été rejoués (isolation, escalade, modules, soumission, purges, rattachement). Cette campagne a révélé deux failles que PGlite ne pouvait pas montrer (voir R10). Reste non couvert en CI : les *default privileges* et le comportement de PostgREST. | Aucune dépendance à Docker : la CI reste rapide et hermétique. | Ajouter un job de préproduction rejouant les migrations sur un vrai Supabase à chaque merge. |
| R10 | **Deux vues en droits du propriétaire** (`public_surveys`, `organisation_directory`) — signalées `ERROR` par le linter Supabase. C'est délibéré : `public_surveys` est le seul accès public aux sondages et n'expose qu'un sous-ensemble de colonnes de sondages publiés ; `organisation_directory` permet à un compte non encore rattaché de désigner son organisation, ce que le RLS de `organisations` interdit par construction. Les deux sont restreintes par `grant` explicite. | L'alternative (policy `anon` sur `surveys` + grants colonne par colonne) déplace la complexité sans réduire l'exposition. | Si un audit externe l'exige. |
| R11 | **9 fonctions `SECURITY DEFINER` exposées par l'API** (soumission, correction d'une réponse, effacement, décisions de rattachement, purges, `my_modules`) — signalées `WARN` par le linter. C'est leur raison d'être : elles remplacent l'usage du `service role` et revérifient elles-mêmes les droits de l'appelant. Leur liste et leurs droits par rôle sont figés par un test. | Le `service role` dans le chemin par défaut serait bien plus dangereux. | N/A (choix d'architecture). |
| R12 | **Verrou global du géocodage : dégradation par instance.** Si le store KV est injoignable, chaque instance retombe sur son garde-fou mémoire : le plafond réel devient « une requête par seconde et PAR INSTANCE » au lieu d'une pour l'application entière. Le code le fait et le dit ; il n'annonce pas un fail-closed qu'il ne tient pas. | Fermer complètement rendrait la recherche d'adresse indisponible à chaque hoquet de KV, pour une fonction d'administration peu fréquentée. | Si OpenStreetMap signale un abus, ou si le nombre d'instances devient significatif. |
| R13 | **`sp-btn--sm` à 38px de haut** sur pointeur fin, alors que la consigne du projet est 44px. Sous `pointer: coarse` — donc au toucher, où la précision manque réellement — il repasse à 44px. Les cibles concernées sont des actions secondaires de rangée (« Modifier », « Réponses »), jamais une action principale. Le déclencheur d'aide contextuelle dessine 28px mais offre 44px de zone cliquable. | Des boutons de 44px dans une rangée de liste écrasent le contenu qu'ils accompagnent. | Si un client soumis au RGAA l'exige, ou si un usage tablette significatif apparaît. |
| R14 | **`zod` reste en 3.25.76** alors que la 4 existe. La 4 change la forme des erreurs (`issues`), le comportement de `z.string().datetime()` et celui des unions discriminées — or ce sont exactement les trois points sur lesquels repose la validation des schémas de sondage, des réponses publiques et des entrées d'API. La montée est une migration à conduire, pas une mise à jour à accepter. | Aucune vulnérabilité connue sur la 3.25.76, et la 3 reste maintenue. Prendre la 4 sans relire les 49 tests de validation des réponses reviendrait à changer les règles sans les vérifier. | À planifier comme un chantier propre, avec relecture des tests de validation. |

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
- [x] Statistiques d'événement (7 septembre 2026) — l'écran des réponses
      devient « Statistiques » en trois vues : vue d'ensemble (effectif
      attendu, capacité facultative, répartition des statuts, rythme sur 7 ou
      30 jours, distribution des accompagnants, fiabilité du comptage, faits à
      retenir), questions (agrégats par question, champs libres regroupés) et
      invités (recherche, filtres, rangées nommées). État dans l'URL, aucun
      JavaScript requis. Mise en forme reprise d'une maquette fournie par le
      client — palette et Montserrat inchangés, ce qui n'était pas calculable
      écarté et documenté. 1387 tests dont 15 d'accessibilité sur les trois
      vues.
- [x] Page publique d'un événement (7 septembre 2026) — l'invitation reprend
      la maquette « Invitation Publique Mobile » : héro, compte à rebours
      vivant, informations pratiques, mot de l'organisateur, déroulé, accès,
      agenda, questions fréquentes, partage du lien, mention sur les données,
      et barre d'inscription collante. **Quatorze blocs, tous ouvrables ou
      fermables** depuis un écran dédié (`/admin/sondages/[id]/invitation`),
      avec leur contenu propre rangé dans `settings.publicPage` — aucune
      migration. **La couleur du bouton d'inscription est personnalisable** :
      l'organisation choisit le fond, l'encre et le survol en découlent, et
      toute couleur qu'aucune encre ne rendrait lisible est refusée à la
      saisie comme au rendu. Deux défauts réels corrigés au passage : les
      dates étaient mises en forme dans `Europe/Paris` en dur, et la finalité
      déclarée par l'organisation était recopiée au milieu d'une phrase.
      1486 tests dont 37 d'accessibilité sur l'invitation et son écran de
      réglages.
- [ ] Étape 8 — RGPD : `platform_settings`, pages légales, purges, effacement.
- [ ] Étape 9 — durcissement : CSP à nonce, Sentry, axe en CI, README final.
