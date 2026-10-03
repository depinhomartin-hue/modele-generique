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
                           connexions, limites, journal, photos) — testable sous Node
  atelier.js               la classe Durable Object, qui délègue au cœur
  courriel.js              SEUL point de sortie vers le service d'e-mails
  medias.js                dépôt et service des photos (R2)
  validation.js            contrôle et forme canonique d'un contenu
socle/public/              servi tel quel par Cloudflare (gratuit, hors Worker)
  rendu/                   le rendu des pages — commun au serveur et à l'éditeur
  rendu/blocs/             un fichier par bloc (rendu, modèle, réglages, listes)
  rendu/structure.js       les règles de forme du contenu (listes, adresses, liens)
  editeur/                 l'éditeur, dans le navigateur
  css/socle.css            la feuille commune (contextes de couleur, mise en page)
  css/blocs/               une feuille par bloc, chargée seulement si le bloc est sur la page
clients/demo-boulangerie/  la démo (entreprise fictive)
outils/                    contrôles, tests, simulateurs, rendu et export
```

**Créer un site client, de la maquette à la livraison : voir
[PROCESSUS.md](PROCESSUS.md).**

## Commandes

```bash
npm run verifier                      # contrastes + rendu de la démo + tous les tests
npm test                              # les tests seuls (rendu, administration, éditeur)
npm run exporter demo-boulangerie     # export statique dans .apercu/demo-boulangerie
npm run dev:demo                      # la démo et son administration sur http://localhost:8790
```

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
  sert qu'à la structure : sections, pages, menu, thème, versions.
- **Rien ne part sans « Publier ».** Le brouillon s'enregistre tout seul ;
  une publication garde une version ; reprendre une version ou abandonner
  ses modifications met d'abord le brouillon de côté. Le site tel qu'il
  était à l'ouverture de l'éditeur reste toujours récupérable.
- **Avant de publier**, l'éditeur signale les textes et photos d'exemple
  restés en place (chaque bloc déclare les siens dans `exemples`).
- **Une maquette peut s'ouvrir sans e-mail** : avec le secret `ACCES_DEMO`
  posé sur son Worker, le lien `/admin/demo?cle=<secret>` mène droit à
  l'éditeur. Seulement si `client.json` dit `"demo": true` — chez un vrai
  client, le secret ne fait rien.
- **Les photos sont réduites dans le navigateur** (1 600 px, vignette de
  400 px) et vérifiées par leurs octets à l'arrivée.

Le contenu publié est lu dans KV à chaque visite ; tout le reste vit dans le
Durable Object du client. Une visite ne réveille jamais le Durable Object.

## Mettre l'administration en ligne

Ce qu'il faut créer une fois, sur le compte Cloudflare de l'atelier (offre
Workers Paid), avant le premier déploiement d'un client — le détail est
dans `clients/demo-boulangerie/wrangler.toml` :

1. l'espace KV `CONTENU` (`wrangler kv namespace create`), dont l'identifiant
   remplace « a-creer » ;
2. l'espace R2 des photos du client (`wrangler r2 bucket create`) ;
3. le domaine d'expédition vérifié chez Cloudflare Email Service, puis
   `COURRIEL_EXPEDITEUR` ;
4. les adresses autorisées : `ADRESSES_ATELIER` (l'atelier) et
   `administration.adresses` dans `client.json` (le client).

Le Durable Object se crée seul au déploiement ; son schéma vit dans le code,
sans migration à appliquer. Ne jamais modifier le `tag = "v1"` du bloc
`[[migrations]]` après un premier déploiement.

## Bon à savoir

- **Ce projet est sur le Bureau, protégé par macOS.** Le volet de
  prévisualisation de l'application Claude n'a pas le droit d'y lire :
  `wrangler dev` y reste bloqué sans un message. Depuis un terminal, tout
  fonctionne. Pour un aperçu dans l'application, travailler sur une copie
  hors du Bureau.
- **`.wrangler/`** (données locales), **`.apercu/`** (exports) et
  **`.dev.vars`** ne sont pas suivis par git ; `.dev.vars.exemple` l'est.

## État

- Phase 1 (3 octobre 2026) : rendu serveur, 9 blocs, 3 thèmes mesurés,
  démo fictive, export statique.
- Phase 2 (3 octobre 2026) : l'administration, construite et essayée en
  local de bout en bout. **Pas encore en ligne** : elle attend les
  ressources ci-dessus.

La démo est en ligne, **temporairement**, sur le compte Cloudflare de Martin
(celui de Graine de Pensée), dans sa version de la phase 1 :
https://vitrine-demo-boulangerie.depinhomartin.workers.dev — à déplacer vers
le compte de l'atelier dès qu'il existera, puis à retirer d'ici
(`npx wrangler delete -c clients/demo-boulangerie/wrangler.toml`).
⚠️ Tant que l'espace KV n'existe pas, un `wrangler deploy` de la démo échoue :
c'est voulu.
