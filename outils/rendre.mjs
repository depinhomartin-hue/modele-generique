/* Rendre la page d'un client sans serveur : `node outils/rendre.mjs <client>`
   écrit le HTML sur la sortie. Avec `--controle`, n'écrit rien et vérifie
   seulement que la page se rend, qu'elle a un seul <h1>, que chaque bloc de
   l'ordre est bien dessiné et qu'aucune balise <script> n'y figure. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normaliser, rendrePage } from "../socle/public/rendu/page.js";

const [nom, option] = process.argv.slice(2);
if (!nom) { console.error("Usage : node outils/rendre.mjs <client> [--controle] [--edition]"); process.exit(2); }
const dossier = fileURLToPath(new URL("../clients/" + nom + "/", import.meta.url));
const client = JSON.parse(readFileSync(dossier + "client.json", "utf8"));
const contenu = normaliser(JSON.parse(readFileSync(dossier + "contenu.json", "utf8")));
const html = rendrePage({ contenu, client, edition: option === "--edition", origine: "http://localhost:8790" });

if (option !== "--controle") { process.stdout.write(html); process.exit(0); }

const defauts = [];
const h1 = (html.match(/<h1[\s>]/g) || []).length;
if (h1 !== 1) defauts.push(`${h1} titres <h1> au lieu d'un seul`);
for (const id of contenu.pages.accueil.ordre) {
  if (!html.includes('data-bloc="' + id + '"')) defauts.push(`le bloc ${id} n'apparaît pas dans la page`);
}
if (/<script/i.test(html)) defauts.push("une balise <script> dans la page publique");
if (/data-edit/.test(html)) defauts.push("des marques d'édition dans la page publique");
if (defauts.length) { defauts.forEach((d) => console.error("✗ " + d)); process.exit(1); }
console.log(`✓ ${nom} : ${contenu.pages.accueil.ordre.length} blocs rendus, un seul <h1>, aucun script, aucune marque d'édition`);
