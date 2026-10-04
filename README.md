# Modèle générique — le socle des sites vitrines

Un moteur commun, des blocs, des thèmes, et une administration qui rend le
client autonome. Un site client n'est que des données :
`clients/<nom>/client.json` (la fiche) et `clients/<nom>/contenu.json` (le
contenu livré).

```
socle/worker.js            le Worker commun, que chaque client importe
socle/serveur/             ce qui ne tourne que sur le serveur
  admin.js                 /admin : connexion, coquille de l'éditeur, API
  atelier-coeur.js         la logique du Durable Object (brouillon, versions,
                           connexions, limites, journal, photos, messages)
                           — testable sous Node
  atelier.js               la classe Durable Object, qui délègue au cœur
  contact.js               le formulaire de contact (POST /contact)
  courriel.js              SEUL point de sortie vers le service d'e-mails
  medias.js                dépôt et service des photos (R2)
  validation.js            contrôle et forme canonique d'un contenu
socle/public/              servi tel quel par Cloudflare (gratuit, hors Worker)
  rendu/                   le rendu des pages — commun au serveur et à l'éditeur
  rendu/blocs/             un fichier par bloc (rendu, modèle, réglages, listes)
  rendu/structure.js       les règles de forme du contenu (listes, adresses, liens)
  rendu/modeles-pages.js   les pages toutes faites (mentions légales)
  rendu/formulaire.js      les règles du formulaire de contact (rendu ET serveur)
  rendu/donnees-structurees.js  ce que Google lit de l'entreprise (JSON-LD)
  editeur/                 l'éditeur, dans le navigateur
  css/socle.css            la feuille commune (contextes de couleur, mise en page)
  css/blocs/               une feuille par bloc, chargée seulement si le bloc est sur la page
clients/demo-boulangerie/  la démo (entreprise fictive)
atelier.json               le compte Cloudflare de l'atelier et son sous-domaine workers.dev
outils/                    création d'un client, contrôle, déploiement, export,
                           et les tests
```

**Créer un site client, de la maquette à la livraison : voir
[PROCESSUS.md](PROCESSUS.md).**

## Commandes

```bash
npm run verifier                      # contrastes + rendu de la démo + tous les tests
npm test                              # les tests seuls (rendu, administration, éditeur, outils)
npm run dev:demo                      # la démo et son administration sur http://localhost:8790

npm run nouveau-client -- <id> "<Nom>" [--theme <id>] [--depuis <client>]
npm run controler -- <id> [--production] [--depuis export.json]
npm run deployer -- [--vague demo|pilote|tous] [--client <id>] [--a-blanc]
npm run exporter -- <id> [dossier] [--depuis export.json] [--photos] [--origine https://…] [--hebergeur "…"]
```

Le `--` est nécessaire : sans lui, npm garde les options pour lui.

- **`nouveau-client`** fabrique `clients/<id>/` (fiche de maquette,
  `wrangler.toml` avec ses propres noms, contenu de départ avec les
  mentions légales, lien d'accès à l'administration) et affiche les
  étapes suivantes.
- **`controler`** relit un client avant de le montrer ou de le livrer :
  pages, liens (y compris ceux écrits dans un texte, que le rendu défait
  quand leur adresse est refusée), photos, textes pour Google, textes
  d'exemple, mentions légales (présentes, affichées, sans « [À compléter »
  même dans une section masquée), moyen de contact, espaces qu'il
  partagerait avec un autre client — et la configuration de production
  avec `--production`. ✓ / ⚠ / ✗, code 1 s'il y a un ✗.
- **`deployer`** met le socle à jour chez les clients, en vagues
  (maquettes, pilotes, les autres) : dépôt sans modification, `verifier`,
  compte Cloudflare d'`atelier.json`, contrôle de tous — y compris ce qui
  ferait échouer un déploiement à coup sûr (un espace de contenu encore
  « a-creer », deux clients qui partagent un espace) —, puis déploiement
  et vérification du vrai site, client par client (`www` seulement s'il
  est déclaré). Le premier échec arrête tout et dit comment revenir en
  arrière, compte Cloudflare imposé. `--a-blanc` affiche le plan sans
  rien exécuter.
- **`exporter`** écrit le site en fichiers statiques (`.apercu/<id>` par
  défaut) : le contenu livré, ou le contenu EN LIGNE d'un export de
  l'administration (`--depuis`), photos de la médiathèque comprises
  (`--photos` : seulement de vraies photos du site, sans suivre de
  redirection). Le site exporté ne sera plus chez Cloudflare : l'hébergeur
  des mentions légales y devient « [À compléter : nouvel hébergeur …] »,
  ou le texte de `--hebergeur`.

Lancer `npm run verifier` avant chaque enregistrement.

### L'administration en local

```bash
cp clients/demo-boulangerie/.dev.vars.exemple clients/demo-boulangerie/.dev.vars
npm run dev:demo
```

Puis ouvrir http://localhost:8790/admin et saisir `essai@example.com`. En
local, aucun e-mail ne part : le lien de connexion s'affiche sur la page.
Le contenu, les photos et les versions sont émulés dans `.wrangler/`.

## L'administration en bref

- **Connexion** par un lien envoyé par e-mail : à usage unique, valable
  15 minutes, envoyé seulement aux adresses enregistrées (fiche du client
  et `ADRESSES_ATELIER`), demandes limitées. Le lien ouvre une page avec un
  bouton « Entrer » : les antivirus qui ouvrent les liens tout seuls ne
  peuvent pas le consommer. Session de 30 jours, « déconnecter tous mes
  appareils ».
- **Le texte se modifie en cliquant dessus**, sur la page. Le panneau ne
  sert qu'à la structure : sections, pages, menu, thème, versions — et à
  lire les messages reçus.
- **Rien ne part sans « Publier ».** Le brouillon s'enregistre tout seul ;
  une publication garde une version ; reprendre une version ou abandonner
  ses modifications met d'abord le brouillon de côté. Le site tel qu'il
  était à l'ouverture de l'éditeur reste toujours récupérable.
- **Avant de publier**, l'éditeur signale les textes et photos d'exemple
  restés en place (chaque bloc déclare les siens dans `exemples`), et
  tout « [À compléter … » — ceux des mentions légales d'abord.
- **Les messages du formulaire de contact** arrivent dans l'onglet
  Messages (gardés un an au plus), et par e-mail aux adresses du client
  (`administration.adresses`, jamais celles de l'atelier) quand
  `COURRIEL_EXPEDITEUR` est posé. Au plus 5 messages par heure depuis une
  même connexion et 100 par 24 heures pour le site ; au plus 20 e-mails
  d'alerte par 24 heures et par site — une alerte à trois adresses en
  compte trois, et seules les 5 premières adresses de la fiche la
  reçoivent —, parce que le quota d'e-mails de l'atelier est partagé : les
  messages suivants attendent dans l'onglet. Ce quota n'est borné que site
  par site (20 e-mails d'alerte et 50 liens de connexion par jour, fois
  le nombre de sites) : il se surveille. Un message de plus d'un an est
  effacé même si plus rien ne réveille le site (alarme du Durable
  Object). L'onglet montre les 200 plus récents, dit quand la liste est
  coupée et va chercher les suivants (« Afficher les messages plus
  anciens ») ; sa pastille des non-lus se remet à jour seule, toutes les
  deux minutes au plus, tant que l'éditeur est affiché. Ouverte
  directement, l'adresse `/contact` ramène à l'accueil, sauf si le client
  a une page « contact ».
- **Une maquette peut s'ouvrir sans e-mail** : avec le secret `ACCES_DEMO`
  posé sur son Worker, le lien `/admin/demo?cle=<secret>` mène droit à
  l'éditeur. Seulement si `client.json` dit `"demo": true` — chez un vrai
  client, le secret ne fait rien. `nouveau-client` le tire au hasard et
  le range dans `clients/<id>/.acces-demo`, jamais versionné.
- **La démo peut s'ouvrir à tout le monde** : avec `"accesLibre": true` dans
  sa fiche (et `"demo": true`), la page de connexion affiche un bouton
  « Outrepasser l'authentification ». Ces sessions modifient tout SAUF les
  photos : le compte Cloudflare héberge d'autres sites, et des images
  déposées par un inconnu pourraient le faire suspendre. Le contrôle
  `--production` refuse ce réglage.
- **Les photos sont réduites dans le navigateur** (1 600 px, vignette de
  400 px) et vérifiées par leurs octets à l'arrivée.

Le contenu publié est lu dans KV à chaque visite ; tout le reste vit dans le
Durable Object du client. Une visite ne réveille jamais le Durable Object
(seul l'envoi du formulaire de contact le fait).

## Mettre un client en ligne

Ce qu'il faut créer une fois par client, sur le compte Cloudflare de
l'atelier (`atelier.json`), avant son premier déploiement — le détail est
dans son `wrangler.toml` et dans PROCESSUS.md :

1. l'espace KV du contenu, nommé d'après le client
   (`wrangler kv namespace create vitrine-<id>-contenu`), dont
   l'identifiant remplace « a-creer » — jamais celui d'un autre client :
   les deux sites écriraient dans le même contenu ;
2. l'espace R2 des photos du client (`wrangler r2 bucket create`) ;
3. une fois pour tout l'atelier : le domaine d'expédition vérifié chez
   Cloudflare Email Service, puis `COURRIEL_EXPEDITEUR` ;
4. les adresses autorisées : `ADRESSES_ATELIER` (l'atelier) et
   `administration.adresses` dans `client.json` (le client).

Le Durable Object se crée seul au déploiement ; son schéma vit dans le code,
sans migration à appliquer. Ne jamais modifier le `tag = "v1"` du bloc
`[[migrations]]` après un premier déploiement. Tant que l'espace KV d'un
client vaut « a-creer », son `wrangler deploy` échoue : c'est voulu, et
`npm run deployer` le refuse avant le premier déploiement de la vague.

## Bon à savoir

- **Sous Windows** (le PC de bureau, 4 octobre 2026), tout marche depuis
  Git Bash comme depuis PowerShell ; les commandes du processus qui
  emploient `cp`, `head` ou `tr` se lancent dans Git Bash.
- **Ce projet est sur le Bureau, protégé par macOS.** Le volet de
  prévisualisation de l'application Claude n'a pas le droit d'y lire :
  `wrangler dev` y reste bloqué sans un message. Depuis un terminal, tout
  fonctionne. Pour un aperçu dans l'application, travailler sur une copie
  hors du Bureau.
- **`.wrangler/`** (données locales), **`.apercu/`** (exports),
  **`.dev.vars`** et **`.acces-demo`** ne sont pas suivis par git ;
  `.dev.vars.exemple` l'est.
- **`.gitattributes`** impose des fins de ligne Unix et traite images et
  polices en binaire.
- **Les tests des outils** (`outils/tester-outils.mjs`) travaillent sur une
  copie de l'atelier dans un dossier temporaire (`ATELIER_RACINE`), avec un
  faux wrangler (`ATELIER_WRANGLER`) : ils ne touchent ni aux vrais clients
  ni au compte Cloudflare.

## État

- Phase 1 (3 octobre 2026) : rendu serveur, 9 blocs, 3 thèmes mesurés,
  démo fictive, export statique.
- Phase 2 (3 octobre 2026) : l'administration.
- Socle 0.3.0 (3 octobre 2026) : bloc « texte » et page des mentions
  légales, formulaire de contact et onglet Messages, données structurées
  pour Google, redirection de `www`, et les outils de l'atelier
  (`nouveau-client`, `controler`, `deployer`, `exporter --depuis
  --photos`). Relu le même jour : outils resserrés (espace de contenu
  nommé d'après le client, espaces partagés refusés, mentions masquées
  vues, export qui ne recopie que de vraies photos et remplace
  l'hébergeur) — détail dans l'historique de PROCESSUS.md.
- Socle 0.4.0 (4 octobre 2026), pour le site de l'atelier
  (`clients/projet-web`) : le thème **Braise** (le premier thème sombre :
  noir et orange, noms des fonds propres au thème), le duo **Affiche**
  (titres en capitales), la case **« Animations douces »** de l'onglet
  Thème (entrée de l'accroche, titres qui montent, cartes qui glissent,
  marches entre les sections, survols — en CSS seulement, coupées par le
  mouvement réduit, à l'impression et pendant l'édition), le **menu plein
  écran** (onglet Site, sans JavaScript), une accroche et une
  présentation sans photo sur une seule colonne. Les outils marchent
  aussi sous Windows. Relu le même jour (15 défauts confirmés, corrigés).

La démo est en ligne, **temporairement**, sur le compte Cloudflare de Martin
(celui de Graine de Pensée), administration ouverte par le lien secret de
maquette ou le bouton « Outrepasser l'authentification » :
https://vitrine-demo-boulangerie.depinhomartin.workers.dev — à déplacer vers
le compte de l'atelier dès qu'il existera (changer `atelier.json`), puis à
retirer d'ici (`npx wrangler delete -c clients/demo-boulangerie/wrangler.toml`).
