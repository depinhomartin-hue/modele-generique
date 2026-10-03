# Modèle générique — le socle des sites vitrines

Un moteur commun, des blocs, des thèmes. Un site client n'est que des données :
`clients/<nom>/client.json` (la fiche) et `clients/<nom>/contenu.json` (le contenu livré).

```
socle/worker.js            le Worker commun, que chaque client importe
socle/serveur/             ce qui ne tourne que sur le serveur
socle/public/              servi tel quel par Cloudflare (gratuit, hors Worker)
  rendu/                   le rendu des pages — commun au serveur et à l'éditeur
  rendu/blocs/             un fichier par bloc
  css/socle.css            la feuille commune (contextes de couleur, mise en page)
  css/blocs/               une feuille par bloc, chargée seulement si le bloc est sur la page
clients/demo-boulangerie/  la démo (entreprise fictive)
outils/                    contrôles, tests, rendu et export en ligne de commande
```

## Commandes

```bash
npm run dev:demo                      # la démo sur http://localhost:8790
npm test                              # tests de non-régression
npm run verifier                      # contrastes des thèmes + rendu de la démo + tests
npm run exporter demo-boulangerie     # export statique dans .apercu/demo-boulangerie
```

Lancer `npm run verifier` avant chaque enregistrement.

## Bon à savoir

- **Ce projet est sur le Bureau, protégé par macOS.** Le volet de prévisualisation
  de l'application Claude n'a pas le droit d'y lire : `wrangler dev` y reste bloqué
  sans un message. Depuis un terminal, tout fonctionne. Pour l'aperçu dans
  l'application, exporter le site hors du Bureau (`npm run exporter … <dossier>`),
  ou déplacer le projet hors du Bureau.
- **`.wrangler/`** (données locales) et **`.apercu/`** (exports) ne sont pas suivis par git.

## État

Phase 1 terminée (3 octobre 2026) : rendu serveur, 9 blocs, 3 thèmes mesurés,
démo fictive, export statique, relecture contradictoire et 65 tests.

La démo est en ligne, **temporairement**, sur le compte Cloudflare de Martin
(celui de Graine de Pensée) : https://vitrine-demo-boulangerie.depinhomartin.workers.dev
— à déplacer vers le compte de l'atelier dès qu'il existera, puis à retirer
d'ici (`npx wrangler delete -c clients/demo-boulangerie/wrangler.toml`).
À suivre : phase 2, l'administration (connexion par lien e-mail, édition sur la
page, médiathèque, publication et versions).
