/* Exporter un site en fichiers statiques.

   `node outils/exporter.mjs <client> [dossier]` écrit chaque page en HTML
   (`index.html`, `<page>/index.html`) et recopie les fichiers du socle
   (CSS, illustrations, icône) à côté. Le résultat se pose sur n'importe quel
   hébergement, sans Worker.

   Deux usages :
   — la CLAUSE DE SORTIE : un client qui part reçoit son site en l'état,
     qui continue de fonctionner ailleurs (sans l'éditeur) ;
   — l'aperçu local, quand aucun serveur Cloudflare n'est disponible.

   Le contenu exporté est celui du fichier livré (`contenu.json`). Pour un
   client en service, il faudra exporter le contenu PUBLIÉ (KV) — à brancher
   avec l'éditeur, en phase 2. */
import { readFileSync, mkdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { normaliser, rendrePage, PAGE_ACCUEIL } from "../socle/public/rendu/page.js";

const [nom, destination] = process.argv.slice(2);
if (!nom) { console.error("Usage : node outils/exporter.mjs <client> [dossier]"); process.exit(2); }

const racine = fileURLToPath(new URL("..", import.meta.url));
const dossierClient = join(racine, "clients", nom);
const sortie = destination || join(racine, ".apercu", nom);

const client = JSON.parse(readFileSync(join(dossierClient, "client.json"), "utf8"));
const contenu = normaliser(JSON.parse(readFileSync(join(dossierClient, "contenu.json"), "utf8")));

rmSync(sortie, { recursive: true, force: true });
mkdirSync(sortie, { recursive: true });
// Les fichiers publics du socle, sauf les modules de rendu : un site
// statique n'en a pas besoin.
for (const sous of ["css", "illustrations", "favicon.svg"]) {
  cpSync(join(racine, "socle", "public", sous), join(sortie, sous), { recursive: true });
}

let pages = 0;
for (const pageId of Object.keys(contenu.pages)) {
  const chemin = pageId === PAGE_ACCUEIL ? "/" : "/" + pageId;
  const html = rendrePage({ contenu, client, pageId, origine: "", chemin });
  const dossier = pageId === PAGE_ACCUEIL ? sortie : join(sortie, pageId);
  mkdirSync(dossier, { recursive: true });
  writeFileSync(join(dossier, "index.html"), html);
  pages++;
}
console.log(`✓ ${nom} : ${pages} page(s) exportée(s) dans ${sortie}`);
