# Créer un site — le processus technique

Le chemin d'un site, de la maquette pour un prospect à la vie du site
chez un client, puis à son départ. Document vivant : on le corrige dès
qu'une étape se révèle fausse, longue ou oubliée, et on note le
changement en bas de page.

État au 3 octobre 2026 : socle 0.2.0. Ce qui n'existe pas encore est
marqué **[à venir]**.

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
   chaque déploiement.
5. **`npx wrangler whoami` juste avant chaque déploiement.** Le Mac a
   plusieurs comptes Cloudflare (Graine de Pensée, l'atelier) : un login
   pour un projet écrase l'autre.
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
| Identifiant du client | minuscules, chiffres, tirets | `boulangerie-muller` |
| Dossier | `clients/<id>/` | `clients/boulangerie-muller/` |
| Worker | `vitrine-<id>` | `vitrine-boulangerie-muller` |
| Espace photos (R2) | `vitrine-<id>-medias` | `vitrine-boulangerie-muller-medias` |
| Espace de contenu (KV) | `CONTENU`, un par client | — |
| Identifiant d'un bloc | `<type>-<n>` | `prestations-1` |
| Ancre d'une section | courte, sans accent | `#horaires`, `#nos-pains` |

Un identifiant ne contient **jamais de point** : les chemins d'édition
(`blocs.faq-1.questions.2.reponse`) se découpent sur le point.

---

## 2. La maquette (prospect)

Objectif : moins d'une heure de travail.

1. **Créer le dossier** en copiant la démo :
   ```bash
   cp -R clients/demo-boulangerie clients/<id>
   rm -rf clients/<id>/.wrangler
   ```
   **[à venir]** un script `outils/nouveau-client.mjs` qui fait cette copie
   et renomme tout d'un coup.
2. **`client.json`** : `id`, `"demo": true`, une `mentionDemo` qui dit que
   c'est une maquette, `"domaine": ""`, `"administration": { "adresses": [] }`.
   Tant que `demo` vaut `true`, le site n'est jamais indexé (balise, en-tête
   HTTP et `robots.txt`).
3. **`wrangler.toml`** : `name = "vitrine-<id>"`, `bucket_name =
   "vitrine-<id>-medias"`. Ne pas toucher au bloc `[[migrations]]`.
4. **`contenu.json`** — le cœur du travail :
   - le **thème** (`fournil`, `atelier`, `verger`) et éventuellement le
     **duo** de polices (`classique`, `chaleureux`, `epure`, `affirme`,
     `doux`, `romantique`) ;
   - l'**ordre des sections** (`pages.accueil.ordre`), à partir de la
     recette du métier **[à venir : les recettes métier]**. Les blocs
     disponibles : accroche, présentation, prestations, galerie, avis,
     horaires, FAQ, appel à l'action, contact ;
   - les **textes** : le nom du prospect oui, ses vrais textes si on les a ;
   - les **photos** : libres de droits ou illustrations du socle, plutôt
     que celles du prospect ;
   - le **menu** (`entete.liens`) vers les ancres des sections.
5. **Contrôler** :
   ```bash
   node outils/rendre.mjs <id> --controle
   npm run verifier
   ```
   Le premier vérifie CE client (un seul `<h1>`, aucun script, chaque
   section rendue) ; `verifier` ne contrôle que la démo et les tests.
6. **Regarder** en local :
   ```bash
   npx wrangler dev -c clients/<id>/wrangler.toml --port 8790 --local
   ```
   Sur ordinateur ET en largeur téléphone.
7. **Ouvrir son administration sans e-mail**, le temps de la maquette : un
   secret tiré au hasard, posé sur le Worker, donne le lien
   `/admin/demo?cle=<secret>` à transmettre à qui doit y entrer.
   ```bash
   node -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))' \
     | npx wrangler secret put ACCES_DEMO -c clients/<id>/wrangler.toml
   ```
   Ce lien ne fonctionne que tant que `"demo": true`. À la vente, la fiche
   passe à `false` : les sessions ouvertes par le lien tombent d'elles-mêmes.
8. **Mettre en ligne la maquette** sur un sous-domaine du domaine de démo
   (`<id>.domaine-de-demo.fr`) **[à venir : le compte de l'atelier et le
   domaine de démo]**.
9. **Enregistrer** : `git add clients/<id>` puis un commit qui dit
   « Maquette <prospect> ».

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
  `administration.adresses`.
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
  - `[vars]` : `COURRIEL_EXPEDITEUR` (l'adresse d'expédition sur le
    domaine de l'atelier, vérifié une fois pour tous les clients) et
    `ADRESSES_ATELIER`.

### 3.3 Les ressources du client (une fois)

```bash
npx wrangler whoami                                   # le compte de l'ATELIER
npx wrangler kv namespace create CONTENU -c clients/<id>/wrangler.toml
npx wrangler r2 bucket create vitrine-<id>-medias
```

Reporter l'identifiant du KV à la place de `a-creer`. Le Durable Object
(brouillon, versions, connexions) se crée tout seul au premier
déploiement ; son schéma vit dans le code, il n'y a aucune migration à
appliquer.

### 3.4 Le contenu réel

- Les vrais textes dans `contenu.json`, ou plus tard par le client lui-même
  depuis l'administration.
- Les vraies photos : de préférence **par l'administration** (elles y sont
  réduites et rangées dans l'espace R2 du client). Les illustrations du
  socle restent possibles.
- **Les mentions légales** sont obligatoires pour un professionnel (LCEN)
  **[à venir : un bloc « texte libre » pour les pages légales]**.
- Avant de livrer, l'éditeur signale les textes et photos d'exemple restés
  en place au moment de publier : la liste doit être vide.

### 3.5 Déployer

```bash
npm run verifier
node outils/rendre.mjs <id> --controle
npx wrangler whoami
npx wrangler deploy -c clients/<id>/wrangler.toml
```

Puis vérifier **le vrai site**, pas seulement le succès de la commande :
la page s'ouvre sur le domaine (avec et sans `www`), le cadenas https est
là, `/robots.txt` autorise l'indexation, `/admin` affiche la page de
connexion.

### 3.6 Contrôle avant livraison

- [ ] Lisible sur téléphone (390 px), sur tablette, sur ordinateur.
- [ ] Chaque lien du menu, chaque bouton mène quelque part ; téléphone et
      e-mail écrits en clair à côté de leur lien.
- [ ] Un seul `<h1>` par page ; chaque photo a sa description.
- [ ] Titre et description « pour Google » remplis sur chaque page.
- [ ] Aucun texte ou photo d'exemple (avertissement de publication vide).
- [ ] Mentions légales en ligne.
- [ ] Les avis sont de vrais avis, avec leur vraie note.
- [ ] Le client a reçu un lien de connexion et s'est connecté une fois.
- [ ] `client.json` : `demo` à `false`, `socle` à la version déployée.

---

## 4. La livraison

1. Le client se connecte une première fois devant nous : adresse saisie
   sur `/admin`, lien reçu, bouton « Entrer ». Si rien n'arrive, regarder
   le journal (onglet Compte) : la cause d'un envoi raté y est écrite.
2. Une heure de prise en main : cliquer sur un texte pour le changer,
   changer une photo, publier, revenir à une version.
3. Lui laisser le kit d'autonomie **[à venir : la fiche d'une page et les
   vidéos courtes]**.

---

## 5. La vie du site

### Mettre à jour le socle — en vagues, le même jour

1. Changer le socle, `npm run verifier`, commit.
2. Monter la version (`socle` dans chaque `client.json`), et poser une
   étiquette git (`git tag socle-0.3.0`).
3. **Vague 1** : la démo. Vérifier en conditions réelles.
4. **Vague 2** : un client pilote.
5. **Vague 3** : tous les autres, le même jour.

Revenir en arrière chez un client = redéployer l'étiquette précédente.
Personne ne reste en arrière : un site à un niveau différent des autres
finit toujours par casser le jour où on l'oublie.
**[à venir : un script de déploiement en vagues]**

Quand le stockage du Durable Object change de forme : la modification se
fait dans `atelier-coeur.js` (une colonne ajoutée par `ALTER TABLE`, gardée
par une vérification), jamais par une migration à lancer à la main. Le
`tag = "v1"` du `wrangler.toml` ne se touche plus jamais après le premier
déploiement.

### Surveiller

- Le domaine : renouvellement automatique, et une échéance notée.
- Le quota d'e-mails de l'atelier (3 000 par mois inclus dans l'offre) et
  le journal de chaque site en cas de plainte « je ne reçois pas le lien ».
- **[à venir : une tâche planifiée unique pour tout l'atelier]**, qui
  surveille les échéances de tous les clients.

---

## 6. Le départ d'un client

1. Il télécharge une copie de son contenu (administration, onglet Compte),
   ou on la télécharge pour lui.
2. On lui remet une version statique de son site :
   `npm run exporter <id> <dossier>`. **[à venir]** aujourd'hui l'export
   lit `contenu.json` (le contenu livré) et non le contenu publié, et ne
   recopie pas les photos de R2 : à outiller avant le premier départ.
3. Le code de transfert du domaine, dans le délai prévu au contrat.
4. Puis on retire le Worker, l'espace KV et l'espace R2, et le dossier du
   client dans le dépôt.

---

## 7. Travailler avec Claude Code

- Une conversation par client et par étape (maquette, production,
  livraison). Elle commence par lire ce fichier et le `README.md`.
- « Déploie » veut dire : `whoami`, déployer, vérifier le vrai site. Pas
  d'agents pour un déploiement.
- Les agents servent aux tâches larges et indépendantes (plusieurs
  maquettes, des relectures), pas au geste qui touche un site en ligne.
- Rien n'est enregistré ni envoyé sur GitHub sans le demander.

---

## 8. Ce qui manque encore (par ordre d'urgence)

1. Le compte Cloudflare de l'atelier, le domaine de démo, le domaine
   d'expédition des e-mails.
2. Un bloc « texte libre » pour les mentions légales.
3. Les polices hébergées sur le site (RGPD) avant le premier vrai client.
4. Le script de création d'un client et celui du déploiement en vagues.
5. L'export complet d'un client en service (contenu publié + photos).
6. Le formulaire de contact (phase 3).
7. Les recettes métier et le kit d'autonomie.

---

## Historique de ce document

- **3 octobre 2026** — première version, socle 0.2.0 (rendu, blocs,
  thèmes, administration en local).
