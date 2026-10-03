/* Rendre la page d'un client sans serveur : `node outils/rendre.mjs <client>`
   écrit le HTML de l'accueil sur la sortie (`--edition` : tel que l'éditeur
   le reçoit). Avec `--controle`, n'écrit rien et vérifie, pour CHAQUE page
   du contenu, qu'elle se rend, qu'elle a un seul <h1>, que chaque bloc
   visible de l'ordre est bien dessiné, qu'aucun bloc masqué ne l'est, et
   qu'aucune balise <script> ni marque d'édition n'y figure.

   Un bloc masqué (`masque: true`) n'est pas réclamé : il est absent du site
   par décision de l'éditrice, pas par défaut du rendu. Il est au contraire
   réclamé ABSENT — une section masquée qui paraîtrait quand même en ligne
   serait le pire des deux défauts. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normaliser, rendrePage, PAGE_ACCUEIL } from "../socle/public/rendu/page.js";

const [nom, option] = process.argv.slice(2);
if (!nom) { console.error("Usage : node outils/rendre.mjs <client> [--controle] [--edition]"); process.exit(2); }
const dossier = fileURLToPath(new URL("../clients/" + nom + "/", import.meta.url));
const client = JSON.parse(readFileSync(dossier + "client.json", "utf8"));
const contenu = normaliser(JSON.parse(readFileSync(dossier + "contenu.json", "utf8")));
const origine = "http://localhost:8790";

if (option !== "--controle") {
  process.stdout.write(rendrePage({ contenu, client, edition: option === "--edition", origine }));
  process.exit(0);
}

const defauts = [];
let rendus = 0;
let masques = 0;
for (const [pageId, page] of Object.entries(contenu.pages)) {
  const ou = pageId === PAGE_ACCUEIL ? "" : ` (page « ${pageId} »)`;
  const html = rendrePage({ contenu, client, pageId, origine, chemin: pageId === PAGE_ACCUEIL ? "/" : "/" + pageId });
  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  if (h1 !== 1) defauts.push(`${h1} titres <h1> au lieu d'un seul${ou}`);
  for (const id of page.ordre) {
    const present = html.includes('data-bloc="' + id + '"');
    if (contenu.blocs[id].masque === true) {
      masques++;
      if (present) defauts.push(`le bloc masqué ${id} apparaît sur le site${ou}`);
    } else {
      rendus++;
      if (!present) defauts.push(`le bloc ${id} n'apparaît pas dans la page${ou}`);
    }
  }
  if (/<script/i.test(html)) defauts.push("une balise <script> dans la page publique" + ou);
  // Toutes les marques que le rendu ne pose qu'en édition, `data-sans-lien`
  // compris (relecture du 3 octobre 2026).
  if (/data-edit|data-masque|data-sans-lien|data-liste/.test(html)) defauts.push("des marques d'édition dans la page publique" + ou);
}
if (defauts.length) { defauts.forEach((d) => console.error("✗ " + d)); process.exit(1); }
const pages = Object.keys(contenu.pages).length;
console.log(`✓ ${nom} : ${rendus} blocs rendus` + (masques ? ` (${masques} masqué${masques > 1 ? "s" : ""}, absent${masques > 1 ? "s" : ""} du site)` : "") +
  (pages > 1 ? ` sur ${pages} pages` : "") + ", un seul <h1>, aucun script, aucune marque d'édition");
