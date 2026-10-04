# Créer un site — le processus technique

Le chemin d'un site, de la maquette pour un prospect à la vie du site
chez un client, puis à son départ. Document vivant : on le corrige dès
qu'une étape se révèle fausse, longue ou oubliée, et on note le
changement en bas de page.

État au 3 octobre 2026 : socle 0.3.0. Ce qui n'existe pas encore est
marqué **[à venir]**.

Les commandes `npm run …` prennent leurs arguments après `--` :
`npm run controler -- <id>`. Sans lui, npm garde pour lui les options
(`--production`, `--theme`…) et l'outil ne les reçoit jamais.

---

## 0. Les règles qui ne bougent pas

1. **Un site client, ce sont des données.** Tout ce qui le distingue vit
   dans `clients/<id>/` : la fiche (`client.json`), le contenu livré
   (`contenu.json`), la configuration (`wrangler.toml`). Aucun code propre
   à un client, nulle part.
2. **Un besoin nouveau devient un bloc du socle**, une option facturée, ou
   un refus. Jamais une exception dans le dossier d'un client.
3. **Le client choisit, il ne compose pas.** Thèmes et duos de polices sont
   mesurés (contraste ≥ 4,5:1). On n'ajoute pas de couleur libre, ni chez
   un client ni « juste pour lui ».
4. **`npm run verifier` passe avant chaque enregistrement**, et avant
   chaque déploiement (`npm run deployer` le relance de lui-même).
5. **Le compte Cloudflare est vérifié juste avant chaque déploiement.** Le
   Mac a plusieurs comptes Cloudflare (Graine de Pensée, l'atelier) : un
   login pour un projet écrase l'autre. `npm run deployer` refuse si
   `wrangler whoami` n'affiche pas le compte d'`atelier.json`, et le
   revérifie avant chaque client.
6. **Rien de vrai sans signature** : pas de domaine acheté, pas de vraies
   photos du prospect, pas d'adresse e-mail du client dans le dépôt avant
   la vente.
7. **Les avis sont vrais.** Une maquette affiche des avis fictifs signalés
   comme tels (le bandeau de démo et la mention du bloc s'en chargent) ;
   un site livré n'affiche que des avis recopiés de vrais clients.

---

## 1. Conventions de nommage

| Quoi | Forme | Exemple |
|---|---|---|
| Identifiant du client | minuscules, chiffres, tirets (pas à la fin), 48 caractères au plus | `boulangerie-muller` |
| Dossier | `clients/<id>/` | `clients/boulangerie-muller/` |
| Worker | `vitrine-<id>` | `vitrine-boulangerie-muller` |
| Espace photos (R2) | `vitrine-<id>-medias` | `vitrine-boulangerie-muller-medias` |
| Espace de contenu (KV) | `vitrine-<id>-contenu`, un par client (liaison `CONTENU`) | `vitrine-boulangerie-muller-contenu` |
| Identifiant d'un bloc | `<type>-<n>` | `prestations-1` |
| Ancre d'une section | courte, sans accent | `#horaires`, `#nos-pains` |
| Étiquette d'une version du socle | `socle-<version>` | `socle-0.3.0` |

Un identifiant ne contient **jamais de point** : les chemins d'édition
(`blocs.faq-1.questions.2.reponse`) se découpent sur le point.

Le compte Cloudflare où l'atelier déploie, et le sous-domaine
`*.workers.dev` des maquettes, sont écrits **une seule fois**, dans
`atelier.json` (provisoirement le compte de Martin).

---

## 2. La maquette (prospect)

Objectif : moins d'une heure de travail.

1. **Créer le dossier** :
   ```bash
   npm run nouveau-client -- <id> "<Nom du prospect>" [--theme fournil|atelier|verger] [--depuis <client>]
   ```
   Il fabrique `clients/<id>/` d'un coup — ou rien du tout s'il échoue —
   et affiche les étapes suivantes, commandes comprises :
   - `client.json` : une maquette (`"demo": true`), sa `mentionDemo`,
     `"domaine": ""`, aucune adresse d'administration. Tant que `demo` vaut
     `true`, le site n'est jamais indexé (balise, en-tête HTTP et
     `robots.txt`) ;
   - `wrangler.toml` : `vitrine-<id>`, `vitrine-<id>-medias`, et l'espace
     de contenu à `a-creer`. Il est fabriqué, jamais recopié de la démo :
     une copie aurait écrit dans le contenu de la démo. Ne pas toucher au
     bloc `[[migrations]]` ;
   - `contenu.json` : la recette générique (accroche au nom du prospect,
     présentation, prestations, avis, horaires, questions, contact avec
     formulaire), le menu vers leurs ancres, et la page des mentions
     légales. Avec `--depuis <client>`, le contenu de cet autre client,
     nom remplacé — mais son téléphone, son e-mail, son adresse, ses
     horaires, ses avis, ses photos, ses liens vers d'autres sites
     (réservation, réseaux sociaux) et ses mentions légales repartent du
     modèle : ils sont à LUI. Les boutons ainsi vidés ressortent en ⚠ au
     contrôle, à relier aux adresses du nouveau client ;
   - `.acces-demo` (jamais versionné) : le secret du lien d'accès à
     l'administration de la maquette, et ce lien.
2. **`client.json`**, en option : `"categorieGoogle"`, le genre
   d'entreprise que Google lira dans les données structurées de
   l'accueil (`Bakery`, `Restaurant`, `CafeOrCoffeeShop`, `HairSalon`,
   `BeautySalon`, `Plumber`, `Electrician`, `HousePainter`, `AutoRepair`,
   `Store`, `ProfessionalService`… — la liste fermée est dans
   `socle/public/rendu/donnees-structurees.js`). Sans lui, ou mal écrit :
   `LocalBusiness`.
3. **`contenu.json`** — le cœur du travail :
   - le **thème** (`fournil`, `atelier`, `verger`) et éventuellement le
     **duo** de polices (`classique`, `chaleureux`, `epure`, `affirme`,
     `doux`, `romantique`) ;
   - l'**ordre des sections** (`pages.accueil.ordre`) **[à venir : les
     recettes métier]**. Les blocs disponibles : accroche, présentation,
     prestations, galerie, avis, horaires, FAQ, texte, appel à l'action,
     contact ;
   - les **textes** : le nom du prospect oui, ses vrais textes si on les a ;
   - les **photos** : libres de droits ou illustrations du socle, plutôt
     que celles du prospect ;
   - le **menu** (`entete.liens`) vers les ancres des sections ;
   - le **formulaire de contact** : `"formulaire": true` sur la section
     Contact (ou la case « Afficher un formulaire de contact » dans
     l'éditeur). Les messages arrivent dans l'onglet **Messages** de
     l'administration ;
   - les **mentions légales** gardent leurs « [À compléter … » : le SIRET
     du prospect ne s'écrit qu'après la signature.
4. **Contrôler** :
   ```bash
   npm run controler -- <id>
   npm run verifier
   ```
   Le premier relit CE client comme une personne méticuleuse : chaque
   page se rend avec un seul `<h1>` et sans script, chaque lien mène
   quelque part (une section masquée n'a plus d'ancre), aucune adresse
   refusée — ni dans un bouton ni dans un lien écrit au milieu d'un
   texte —, chaque photo a sa description, titres et descriptions pour
   Google, textes d'exemple et « [À compléter … » restants, mentions
   légales présentes, AFFICHÉES et sans trou (une section masquée ne
   dispense pas de la remplir), moyen de contact, aucun espace (contenu,
   photos, Worker) partagé avec un autre client. ✓ / ⚠ / ✗ par point ;
   sur une maquette, seul ce qui est CASSÉ est un ✗. `verifier` ne
   contrôle que la démo et les tests.
5. **Regarder** en local :
   ```bash
   cp clients/<id>/.dev.vars.exemple clients/<id>/.dev.vars
   npx wrangler dev -c clients/<id>/wrangler.toml --port 8790 --local
   ```
   Sur ordinateur ET en largeur téléphone.
6. **Créer ses espaces** sur le compte d'`atelier.json`, une fois :
   ```bash
   npx wrangler whoami
   npx wrangler kv namespace create vitrine-<id>-contenu -c clients/<id>/wrangler.toml
   npx wrangler r2 bucket create vitrine-<id>-medias
   ```
   et reporter l'identifiant du KV à la place de `a-creer` — celui que la
   commande vient d'afficher, jamais celui d'un autre client. wrangler 4
   nomme l'espace d'après le SEUL nom donné, unique sur le compte :
   « CONTENU » pour tous échouait dès le deuxième client, et recopier
   l'identifiant de l'espace existant faisait écrire deux sites dans le
   même contenu (`controler` et `deployer` le refusent désormais).
7. **Enregistrer** : `git add clients/<id>` puis un commit qui dit
   « Maquette <prospect> ». Avant le déploiement : il refuse un dépôt qui
   a des modifications.
8. **Mettre en ligne la maquette** :
   ```bash
   npm run deployer -- --client <id>
   ```
   Elle vit sur `https://vitrine-<id>.<sousDomaineWorkers>.workers.dev`
   **[à venir : le compte de l'atelier et le domaine de démo]**.
9. **Ouvrir son administration sans e-mail**, le temps de la maquette :
   le secret de `.acces-demo` se pose sur le Worker (après le premier
   déploiement : avant, il n'existe pas), et le lien de la seconde ligne
   se transmet à qui doit y entrer.
   ```bash
   head -n 1 clients/<id>/.acces-demo | tr -d '\n' | npx wrangler secret put ACCES_DEMO -c clients/<id>/wrangler.toml
   ```
   Ce lien ne fonctionne que tant que `"demo": true`. À la vente, la fiche
   passe à `false` : les sessions ouvertes par le lien tombent d'elles-mêmes.

Une maquette sans suite est **retirée** (`npx wrangler delete -c
clients/<id>/wrangler.toml`) et son dossier supprimé du dépôt.

---

## 3. La production (après signature)

### 3.1 Le domaine

- Acheté **après la signature**, chez un registrar distinct de Cloudflare.
- **Titulaire = le client** (raison sociale, SIREN, ses coordonnées).
  Contacts administratif et technique, et compte chez le registrar :
  Martin. Prévenir le client de valider l'e-mail de l'Afnic (domaine en
  `.fr`).
- Renouvellement automatique activé.
- Ajouter le domaine au compte Cloudflare de l'atelier (une « zone »),
  puis pointer ses serveurs DNS vers Cloudflare chez le registrar.
- Un client qui a déjà son domaine le garde chez son registrar : on ne
  change que les serveurs DNS.

### 3.2 La fiche et la configuration

- `client.json` : `"demo": false`, `"domaine": "<domaine>"` (sans
  `https://`, sans `www`), les adresses du client dans
  `administration.adresses` — ce sont aussi elles qui reçoivent l'alerte
  d'un message du formulaire (jamais `ADRESSES_ATELIER`), dès que
  `COURRIEL_EXPEDITEUR` est posé ; vingt e-mails d'alerte au plus par
  24 heures et par site (une alerte à trois adresses en compte trois),
  les messages suivants n'attendent que dans l'onglet Messages. Seules
  les cinq premières adresses reçoivent l'alerte (`controler` le signale
  au-delà) ; toutes gardent l'accès à l'administration.
  `"pilote": true` pour un client qui reçoit les mises à jour du socle
  avant les autres (§ 5).
- `wrangler.toml` :
  - `workers_dev = false` — un site client n'est joignable que par son
    domaine ;
  - le domaine, versionné avec le reste :
    ```toml
    routes = [
      { pattern = "<domaine>", custom_domain = true },
      { pattern = "www.<domaine>", custom_domain = true }
    ]
    ```
    Le socle renvoie lui-même `www.<domaine>` vers `https://<domaine>`
    (301), chemin compris ;
  - `[vars]` : `COURRIEL_EXPEDITEUR` (l'adresse d'expédition sur le
    domaine de l'atelier, vérifié une fois pour tous les clients) et
    `ADRESSES_ATELIER`.
- Retirer le lien de maquette : supprimer `clients/<id>/.acces-demo` et
  `npx wrangler secret delete ACCES_DEMO -c clients/<id>/wrangler.toml`.

### 3.3 Les ressources du client (une fois)

Celles de la maquette (§ 2, étape 6) servent telles quelles. Pour un
client arrivé sans maquette :

```bash
npx wrangler whoami                                   # le compte d'atelier.json
npx wrangler kv namespace create vitrine-<id>-contenu -c clients/<id>/wrangler.toml
npx wrangler r2 bucket create vitrine-<id>-medias
```

Reporter l'identifiant du KV à la place de `a-creer`. Le Durable Object
(brouillon, versions, connexions, messages) se crée tout seul au premier
déploiement ; son schéma vit dans le code, il n'y a aucune migration à
appliquer.

### 3.4 Le contenu réel

- Les vrais textes dans `contenu.json`, ou plus tard par le client lui-même
  depuis l'administration.
- Les vraies photos : de préférence **par l'administration** (elles y sont
  réduites et rangées dans l'espace R2 du client). Les illustrations du
  socle restent possibles.
- **Les mentions légales** sont obligatoires pour un professionnel (LCEN).
  La page existe déjà si le client est né d'une maquette ; sinon, onglet
  Site de l'éditeur : « Ajouter la page des mentions légales ». Remplacer
  chaque « [À compléter … » : forme juridique et identité (nom et prénom
  de l'entrepreneur, ou dénomination de la société — le nom du site n'est
  qu'un nom commercial), adresse du siège, SIREN ou SIRET, immatriculation
  (registre national des entreprises, RNE, et RCS pour une société ou un
  commerçant — le « répertoire des métiers » n'existe plus depuis 2023),
  numéro de TVA ou mention « TVA non applicable, article 293 B du CGI »,
  médiateur de la consommation, téléphone, e-mail, responsable de la
  publication, adresse où exercer ses droits sur ses données. **L'adhésion
  à un médiateur de la consommation est obligatoire AVANT la mise en
  ligne** pour qui vend à des particuliers (Code de la consommation,
  L612-1 et L616-1) : sans lui, pas de site.
  Le lien du bas de page vers elles est automatique, tant que la page
  affiche quelque chose : masquer sa section le fait disparaître, et
  `controler --production` le refuse.
- Avant de livrer, l'éditeur signale les textes et photos d'exemple — et
  les « [À compléter … » — restés en place au moment de publier : la liste
  doit être vide.

### 3.5 Déployer

```bash
npm run controler -- <id> --production
npm run deployer -- --client <id>
```

`--production` vérifie en plus la configuration : `demo` à `false`,
domaine bien écrit, `workers_dev = false`, KV créé, au moins une adresse
d'administration, plus de lien de maquette. Et ce qui manque (textes
d'exemple, mentions à compléter, moyen de contact) y devient bloquant.

Le déploiement relance `npm run verifier`, vérifie le compte, contrôle,
déploie, puis vérifie **le vrai site** : l'accueil et `/robots.txt` en 200,
`/robots.txt` qui autorise l'indexation, `www.<domaine>` — s'il est
déclaré dans les routes — qui renvoie vers le domaine. Un domaine sans
`www` déclaré n'est qu'un ⚠ (un sous-domaine n'en a pas) : il n'est pas
vérifié, et ne bloque rien. Restent à regarder de ses yeux : le cadenas
https, `/admin` qui affiche la page de connexion.

### 3.6 Contrôle avant livraison

- [ ] `npm run controler -- <id> --production` : aucun ✗.
- [ ] Lisible sur téléphone (390 px), sur tablette, sur ordinateur.
- [ ] Téléphone et e-mail écrits en clair à côté de leur lien.
- [ ] Les avis sont de vrais avis, avec leur vraie note.
- [ ] Un message envoyé par le formulaire arrive dans l'onglet Messages
      (et par e-mail au client, si `COURRIEL_EXPEDITEUR` est posé).
- [ ] Le client a reçu un lien de connexion et s'est connecté une fois.
- [ ] `client.json` : `demo` à `false`, `socle` à la version déployée.

---

## 4. La livraison

1. Le client se connecte une première fois devant nous : adresse saisie
   sur `/admin`, lien reçu, bouton « Entrer ». Si rien n'arrive, regarder
   le journal (onglet Compte) : la cause d'un envoi raté y est écrite,
   sous « Détail pour l'atelier ».
2. Une heure de prise en main : cliquer sur un texte pour le changer,
   changer une photo, publier, revenir à une version, lire un message.
3. Lui laisser le kit d'autonomie **[à venir : la fiche d'une page et les
   vidéos courtes]**.

---

## 5. La vie du site

### Mettre à jour le socle — en vagues, le même jour

1. Changer le socle, `npm run verifier`, commit.
2. Monter la version : `version` dans `package.json` et `socle` dans
   chaque `client.json` (le contrôle signale un client resté en arrière),
   commit, puis l'étiquette : `git tag socle-<version>`.
3. **Vague 1**, les maquettes : `npm run deployer -- --vague demo`.
   Vérifier en conditions réelles.
4. **Vague 2**, les clients pilotes (`"pilote": true`) :
   `npm run deployer -- --vague pilote`.
5. **Vague 3**, tous les autres, le même jour : `npm run deployer`.

`npm run deployer -- --a-blanc` affiche le plan sans rien exécuter.

Le déploiement refuse deux clients de l'atelier qui partagent un espace
de contenu, un espace photos ou un nom de Worker, un dépôt qui a des
modifications, un `verifier` en échec ou un autre compte Cloudflare ; il
contrôle TOUS les clients du plan avant le premier déploiement (un ✗
n'importe où, ou un espace de contenu encore « a-creer » : rien ne
part) ; puis, client par client, il déploie et vérifie le vrai site. Le
premier échec arrête tout, et le message dit qui a reçu la nouvelle
version et comment revenir en arrière : redéployer l'étiquette précédente
chez eux, compte imposé (`CLOUDFLARE_ACCOUNT_ID=…`). Un client absent de
l'étiquette précédente (ou dont l'espace y valait encore « a-creer ») n'a
rien à y remettre : le corriger et relancer, retirer son Worker si c'était
sa première mise en ligne, ou, s'il était déjà en ligne, redéployer le
commit d'où il était parti — une maquette déployée par `--client` vient
d'un commit sans étiquette. Un ⚠ signale un client dont la configuration
a changé depuis l'étiquette (passé en production, domaine, routes…) : la
redéployer remettrait aussi l'ancienne, à comparer d'abord. Personne ne
reste en arrière : un site à un niveau différent des autres finit
toujours par casser le jour où on l'oublie.

Quand le stockage du Durable Object change de forme : la modification se
fait dans `atelier-coeur.js` (une colonne ajoutée par `ALTER TABLE`, gardée
par une vérification), jamais par une migration à lancer à la main. Le
`tag = "v1"` du `wrangler.toml` ne se touche plus jamais après le premier
déploiement.

### Surveiller

- Le domaine : renouvellement automatique, et une échéance notée.
- Le quota d'e-mails de l'atelier (3 000 par mois inclus dans l'offre) et
  le journal de chaque site en cas de plainte « je ne reçois pas le lien »
  ou « je ne reçois pas les messages ». Ce quota n'est borné que site par
  site : 20 e-mails d'alerte et 50 liens de connexion par jour au plus,
  fois le nombre de sites. Au journal, chaque échec d'un lien de
  connexion est noté, mais celui d'une alerte de message seulement le
  premier du jour pour chaque adresse ; un message reçu n'y écrit rien
  (il est dans l'onglet Messages), seul le plafond du site atteint
  (« trop de messages en 24 heures ») s'y lit, une fois par jour.
- Les messages de plus d'un an s'effacent seuls, même sur un site que
  plus personne n'ouvre : l'alarme du Durable Object passe le jour où le
  plus ancien a un an.
- **[à venir : une tâche planifiée unique pour tout l'atelier]**, qui
  surveille les échéances de tous les clients.

---

## 6. Le départ d'un client

1. Il télécharge une copie de son contenu (administration, onglet Compte),
   ou on la télécharge pour lui : c'est le contenu EN LIGNE, ses messages
   (les 2 000 plus récents ; `exporter --depuis` dit combien sont restés
   dans l'onglet Messages, à relever avant de retirer le Worker) et les
   adresses de ses photos.
2. On lui remet une version statique de son site, photos comprises :
   ```bash
   npm run exporter -- <id> <dossier> --depuis <fichier-exporté.json> --photos
   ```
   Le dossier se pose à la racine de n'importe quel hébergement. Le
   formulaire de contact en est retiré (un site statique ne reçoit rien) ;
   les messages restent dans le fichier exporté, jamais dans le site. Une
   photo qui n'a pas pu être recopiée est signalée, et la commande finit
   en erreur : la relancer. Seules de vraies photos de la médiathèque, du
   site du client, sont recopiées (le fichier exporté a pu être retouché).
   **Les mentions légales du dossier exporté** ne nomment plus Cloudflare :
   le paragraphe « Hébergement » y devient « [À compléter : nouvel
   hébergeur …] ». Y écrire le nom, l'adresse et le téléphone du nouvel
   hébergeur avant la mise en ligne (`mentions-legales/index.html`), ou
   relancer avec `--hebergeur "<nom, adresse, téléphone>"`. Relire aussi
   ce que la sortie signale (« Données personnelles » qui parle encore du
   formulaire retiré).
3. Le code de transfert du domaine, dans le délai prévu au contrat.
4. Puis on retire le Worker, l'espace KV et l'espace R2, et le dossier du
   client dans le dépôt.

---

## 7. Travailler avec Claude Code

- Une conversation par client et par étape (maquette, production,
  livraison). Elle commence par lire ce fichier et le `README.md`.
- « Déploie » veut dire : `npm run deployer` (compte, déploiement,
  vérification du vrai site), puis un regard sur le site. Pas d'agents
  pour un déploiement.
- Les agents servent aux tâches larges et indépendantes (plusieurs
  maquettes, des relectures), pas au geste qui touche un site en ligne.
- Rien n'est enregistré ni envoyé sur GitHub sans le demander.

---

## 8. Ce qui manque encore (par ordre d'urgence)

1. Le compte Cloudflare de l'atelier, le domaine de démo, le domaine
   d'expédition des e-mails — sans lui, ni lien de connexion ni alerte de
   message ne part (les messages restent lisibles dans l'administration).
2. La relecture juridique du modèle des mentions légales
   (`modeles-pages.js` : identité, médiateur, TVA, données personnelles
   selon l'article 13 du RGPD) par la personne qui tient la veille
   juridique, avant le premier vrai client.
3. Les polices hébergées sur le site (RGPD) avant le premier vrai client.
   D'ici là, les mentions légales le disent : l'adresse IP des visiteurs
   part chez Google Fonts. Le jour où les polices seront hébergées sur le
   site, retirer cette phrase dans le même geste — du modèle ET des
   contenus déjà publiés, sinon elle devient fausse.
4. Les recettes métier et le kit d'autonomie.
5. La tâche planifiée qui surveille les échéances de tous les clients.

---

## Historique de ce document

- **3 octobre 2026** — première version, socle 0.2.0 (rendu, blocs,
  thèmes, administration en local).
- **3 octobre 2026** — socle 0.3.0 : création d'un client
  (`nouveau-client`), contrôle (`controler`), déploiement en vagues
  (`deployer`), export du contenu en ligne et des photos (`exporter
  --depuis --photos`), bloc « texte » et page des mentions légales,
  formulaire de contact et onglet Messages, données structurées pour
  Google (`categorieGoogle`), redirection de `www`, `atelier.json`. La
  maquette s'enregistre désormais AVANT sa mise en ligne (le déploiement
  refuse un dépôt modifié), et le secret du lien d'accès se pose APRÈS le
  premier déploiement.
- **3 octobre 2026** — les limites du formulaire de contact et de ses
  alertes e-mail (§ 3.2), et où lire la cause d'un e-mail raté (§ 4).
- **3 octobre 2026** — relecture contradictoire des outils du socle
  0.3.0 : l'espace de contenu se crée sous le nom `vitrine-<id>-contenu`
  (§ 1, § 2.6, § 3.3) ; `controler` et `deployer` refusent deux clients
  qui partagent un espace ; `controler` voit les liens refusés écrits
  dans un texte, et les mentions légales masquées ou vides (§ 2.4) ;
  `deployer` refuse d'avance un espace « a-creer », ne vérifie `www` que
  s'il est déclaré (§ 3.5), et son conseil de retour en arrière impose le
  compte, distingue un client absent de l'étiquette précédente et
  signale une configuration changée depuis (§ 5) ; `nouveau-client
  --depuis` retire les liens vers d'autres sites (§ 2.1) ; `exporter`
  ne recopie que de vraies photos du site et remplace l'hébergeur des
  mentions légales (§ 6).
- **3 octobre 2026** — mentions légales complétées (§ 3.4) : identité
  légale, RNE au lieu du répertoire des métiers, TVA, médiateur de la
  consommation (obligatoire avant la mise en ligne), données personnelles
  selon l'article 13 du RGPD ; leur relecture juridique et la phrase sur
  Google Fonts (§ 8). `controler` nomme la ligne d'horaires que Google ne
  sait pas lire.
- **3 octobre 2026** — relecture contradictoire du serveur : le plafond
  des alertes compte des e-mails, cinq destinataires au plus (§ 3.2) ;
  le journal n'a plus de ligne par message reçu, et un échec d'alerte n'y
  est noté qu'une fois par jour et par adresse ; les messages d'un an
  s'effacent par l'alarme du Durable Object (§ 5) ; l'export porte les
  2 000 messages les plus récents et `exporter` signale ceux qui restent
  (§ 6).
- **4 octobre 2026** — socle 0.4.0, pour le site de l'atelier
  (`clients/projet-web`, nom provisoire « Projet WEB ») : thème Braise
  (sombre ; l'éditeur nomme ses fonds Noir / Anthracite / Clair), duo
  Affiche, case « Animations douces » (onglet Thème), menu plein écran
  (onglet Site : visible dans l'aperçu ; en édition, le menu reste dans
  la barre). Les outils marchent sous Windows (`deployer` lance npm et
  wrangler par cmd.exe). Un client du socle peut donc être un site
  « vitrine de studio », pas seulement un artisan : mêmes règles, mêmes
  contrôles.
