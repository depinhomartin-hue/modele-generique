/* Rendre la page d'un client sans serveur : `node outils/rendre.mjs <client>`
   écrit le HTML de l'accueil sur la sortie (`--edition` : tel que l'éditeur
   le reçoit). Avec `--controle`, n'écrit rien et vérifie, pour CHAQUE page
   du contenu, qu'elle se rend, qu'elle a un seul <h1>, que chaque bloc
   visible de l'ordre est bien dessiné, qu'aucun bloc masqué ne l'est, et
   qu'aucune balise <script> ni marque d'édition n'y figure.

   Un seul <script> est toléré : les données structurées pour Google
   (`<script type="application/ld+json">`, donnees-structurees.js), qui ne
   sont pas du code exécuté — sur l'accueil seulement, une seule fois, et
   en JSON lisible. Tout autre script, même d'un autre « type », est un
   défaut (3 octobre 2026).

   Un bloc masqué (`masque: true`) n'est pas réclamé : il est absent du site
   par décision de l'éditrice, pas par défaut du rendu. Il est au contraire
   réclamé ABSENT — une section masquée qui paraîtrait quand même en ligne
   serait le pire des deux défauts.

   La page des MENTIONS LÉGALES, si le contenu en a une, doit afficher
   quelque chose (`mentionsPresentes`, structure.js), et chaque page doit
   alors porter son lien en bas. Une page dont la seule section est
   masquée passait ce contrôle : son lien disparaît du site, et c'est un
   défaut, pas un choix (relecture du 3 octobre 2026). */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve, sep } from "node:path";
import { normaliser, rendrePage, PAGE_ACCUEIL } from "../socle/public/rendu/page.js";
import { mentionsPresentes, PAGE_MENTIONS } from "../socle/public/rendu/structure.js";

/* La forme exacte que le rendu écrit (`baliseDonneesStructurees`) : le JSON
   y est échappé, il ne contient jamais « < ». */
const JSON_LD = /<script type="application\/ld\+json">([^<]*)<\/script>/g;

const [nom, option] = process.argv.slice(2);
if (!nom) { console.error("Usage : node outils/rendre.mjs <client> [--controle] [--edition]"); process.exit(2); }
// `ATELIER_RACINE` : une copie de l'atelier, comme pour controler.mjs —
// c'est ainsi que tester.mjs lui fait rendre un client fautif sans rien
// écrire dans clients/.
const racine = process.env.ATELIER_RACINE ? resolve(process.env.ATELIER_RACINE) : fileURLToPath(new URL("..", import.meta.url));
const dossier = join(racine, "clients", nom) + sep;
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
const mentions = mentionsPresentes(contenu);
if (Object.prototype.hasOwnProperty.call(contenu.pages, PAGE_MENTIONS) && !mentions) {
  defauts.push("la page des mentions légales n'affiche rien (section masquée, vide ou absente) : son lien n'apparaît plus en bas de page");
}
const LIEN_MENTIONS = 'class="pied__mentions" href="/' + PAGE_MENTIONS + '"';
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
  if (mentions && !html.includes(LIEN_MENTIONS)) defauts.push("pas de lien vers les mentions légales en bas de page" + ou);
  const jsonLd = [...html.matchAll(JSON_LD)];
  if (/<script/i.test(html.replace(JSON_LD, ""))) defauts.push("une balise <script> dans la page publique" + ou);
  if (jsonLd.length && pageId !== PAGE_ACCUEIL) defauts.push("des données structurées hors de l'accueil" + ou);
  if (jsonLd.length > 1) defauts.push(jsonLd.length + " blocs de données structurées au lieu d'un" + ou);
  for (const m of jsonLd) {
    try { JSON.parse(m[1]); } catch { defauts.push("des données structurées illisibles" + ou); }
  }
  // Toutes les marques que le rendu ne pose qu'en édition, `data-sans-lien`
  // compris (relecture du 3 octobre 2026).
  if (/data-edit|data-masque|data-sans-lien|data-liste/.test(html)) defauts.push("des marques d'édition dans la page publique" + ou);
}
if (defauts.length) { defauts.forEach((d) => console.error("✗ " + d)); process.exit(1); }
const pages = Object.keys(contenu.pages).length;
console.log(`✓ ${nom} : ${rendus} blocs rendus` + (masques ? ` (${masques} masqué${masques > 1 ? "s" : ""}, absent${masques > 1 ? "s" : ""} du site)` : "") +
  (pages > 1 ? ` sur ${pages} pages` : "") + ", un seul <h1>, aucun script (hors données structurées), aucune marque d'édition" +
  (mentions ? ", mentions légales liées de chaque page" : ""));
