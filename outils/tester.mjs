/* Tests de non-régression du socle — `npm test`.

   Chaque cas rejoue un défaut RÉEL, trouvé par la relecture contradictoire
   du 3 octobre 2026, ou une règle du projet. Un test qui casse le jour où
   quelqu'un « simplifie » le code, c'est précisément son rôle.

   Le Worker est appelé directement (creerSite().fetch), sans serveur : Node
   connaît Request, Response et Headers. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { creerSite } from "../socle/worker.js";
import { normaliser, rendrePage, rendreCorps } from "../socle/public/rendu/page.js";
import { texteRiche, texteBrut, adresseSure, imageSure, lienTelephone, destination } from "../socle/public/rendu/outils.js";
import { echelleValide, themeDe } from "../socle/public/rendu/themes.js";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (f) => JSON.parse(readFileSync(racine + f, "utf8"));
const client = lire("clients/demo-boulangerie/client.json");
const contenuLivre = lire("clients/demo-boulangerie/contenu.json");
const ORIGINE = "https://demo.test";

let ok = 0;
const echecs = [];
function verifier(nom, condition, detail = "") {
  if (condition) ok++;
  else echecs.push(nom + (detail ? " — " + detail : ""));
}
async function appeler(chemin, { methode = "GET", publie } = {}) {
  const env = publie === undefined ? {} : { CONTENU: { get: async () => JSON.parse(JSON.stringify(publie)) } };
  const site = creerSite({ client, contenu: contenuLivre });
  const rep = await site.fetch(new Request(ORIGINE + chemin, { method: methode }), env);
  const corps = methode === "HEAD" ? "" : await rep.text();
  return { statut: rep.status, entetes: rep.headers, corps };
}
const memeOrigine = (location) => {
  try { return new URL(location, ORIGINE + "/x/").origin === ORIGINE; } catch { return false; }
};

/* ----- Le Worker ----- */
{
  const r = await appeler("/");
  verifier("accueil en 200", r.statut === 200, "statut " + r.statut);
  verifier("politique de contenu présente", /script-src 'self'/.test(r.entetes.get("content-security-policy") || ""));
  verifier("maquette non indexée (en-tête)", /noindex/.test(r.entetes.get("x-robots-tag") || ""));
  verifier("un seul <h1>", (r.corps.match(/<h1[\s>]/g) || []).length === 1);
  verifier("aucun script dans la page publique", !/<script/i.test(r.corps));
  verifier("aucune marque d'édition dans la page publique", !/data-edit/.test(r.corps));
}
{
  const r = await appeler("/robots.txt");
  verifier("robots.txt d'une maquette interdit tout", /Disallow: \//.test(r.corps));
}
for (const chemin of ["//pirate.example/", "/%2F%2Fpirate.example/", "/%5Cpirate.example/", "/%2F%2Fpirate.example/?x=1", "/%2F/", "/tarifs/"]) {
  const r = await appeler(chemin);
  const loc = r.entetes.get("location") || "";
  verifier("redirection de « " + chemin + " » reste sur le site", r.statut !== 301 || (memeOrigine(loc) && loc !== ""), "Location = " + loc);
}
for (const chemin of ["/constructor", "/toString", "/__proto__", "/hasOwnProperty", "/%E0%A4%A", "/n-existe-pas"]) {
  const r = await appeler(chemin);
  verifier("« " + chemin + " » répond 404, pas 500", r.statut === 404, "statut " + r.statut);
}
{
  const r = await appeler("/n-existe-pas");
  verifier("page introuvable : les ancres du menu visent l'accueil", r.corps.includes('href="/#nos-pains"') && !/href="#nos-pains"/.test(r.corps));
  verifier("page introuvable non indexée", /noindex/.test(r.entetes.get("x-robots-tag") || ""));
}
verifier("POST refusé (405)", (await appeler("/", { methode: "POST" })).statut === 405);
{
  const r = await appeler("/", { methode: "HEAD" });
  verifier("HEAD sans corps", r.statut === 200 && r.corps === "");
}

/* ----- Un contenu publié abîmé ou piégé : page incomplète, jamais 500 ----- */
{
  const piege = { toString: 1 };
  const c = JSON.parse(JSON.stringify(contenuLivre));
  c.site.nom = piege;
  c.pages.accueil.titre = [piege];
  c.blocs["accroche-1"].titre = piege;
  c.blocs["accroche-1"].image = piege;
  c.entete.liens[0].vers = piege;
  c.entete.liens[1] = null;
  c.pied.texte = piege;
  c.theme.echelleTitres = piege;
  c.blocs["avis-1"].avis[0].note = piege;
  c.blocs["prestations-1"].elements = { pas: "une liste" };
  c.blocs["faq-1"].questions = [null, { question: "Deuxième ?", reponse: "Oui." }];
  c.pages.accueil.ordre.push("constructor", "toString", "accroche-1");
  const r = await appeler("/", { publie: c });
  verifier("contenu piégé : 200", r.statut === 200, "statut " + r.statut);
  verifier("contenu piégé : jamais « [object Object] »", !r.corps.includes("[object Object]"));
  verifier("contenu piégé : jamais « undefined » visible", !/>[^<]*undefined[^<]*</.test(r.corps));
}
{
  const r = await appeler("/", { publie: "pas un objet" });
  verifier("contenu publié illisible : le site livré s'affiche", r.statut === 200 && r.corps.includes("Au Pétrin d&#39;Ernestine"));
}

/* ----- Les champs absents ne publient JAMAIS le texte d'exemple ----- */
{
  const c = normaliser({ pages: { accueil: { ordre: ["avis-1", "horaires-1"] } }, blocs: { "avis-1": { type: "avis" }, "horaires-1": { type: "horaires" } } });
  const html = rendrePage({ contenu: c, client: {} });
  verifier("avis absents : pas de faux avis d'exemple", !/Recopiez ici/.test(html) && !/★/.test(html));
  verifier("horaires absents : pas d'horaires inventés", !/9 h – 18 h/.test(html));
}

/* ----- Les indices des listes restent ceux du contenu (éditeur) ----- */
{
  const c = normaliser({ pages: { accueil: { ordre: ["faq-1"] } }, blocs: { "faq-1": { type: "faq", titre: "Q", questions: [null, { question: "Deuxième", reponse: "R" }] } } });
  const html = rendreCorps({ contenu: c, client: {}, edition: true });
  verifier("liste avec un trou : le 2e élément garde l'indice 1", html.includes('data-edit="blocs.faq-1.questions.1.question"') && !html.includes("questions.0.question"));
}

/* ----- Ancres uniques ----- */
{
  const c = normaliser({ pages: { accueil: { ordre: ["faq-1", "faq-2", "appel-1"] } }, blocs: {
    "faq-1": { type: "faq", ancre: "horaires" }, "faq-2": { type: "faq", ancre: "horaires" }, "appel-1": { type: "appel", ancre: "contenu" } } });
  const ids = [...rendreCorps({ contenu: c, client: {} }).matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  verifier("ancres uniques dans la page", ids.length === new Set(ids).size, ids.join(","));
}

/* ----- Le nettoyeur de texte riche ----- */
{
  const attaques = [
    '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<a href="javascript:alert(1)">x</a>',
    '<a href="JaVaScRiPt:alert(1)">x</a>', '<a href=" javascript:alert(1)">x</a>', '<a href="&#106;avascript:alert(1)">x</a>',
    '<a href="data:text/html,<script>">x</a>', '<svg onload=alert(1)>', '<span style="x" onclick="y">t</span>',
    '<a href="/\\pirate.example">x</a>', '"><script>x</script>', "<a href='x' onmouseover='y'>t</a>"
  ];
  /* On examine chaque BALISE produite : seules les balises de la liste
     blanche, avec leurs seuls attributs permis, et des adresses sûres. Du
     texte qui ressemble à une attaque mais n'est que du texte échappé est
     inoffensif — c'est justement le travail du nettoyeur. */
  const BALISE_PERMISE = /^<\/?(strong|b|em|i|u|br|span|a)( href="[^"]*"( target="_blank" rel="noopener")?| data-taille="[a-z-]+"| data-police="[a-z]+")*>$/;
  for (const a of attaques) {
    const s = texteRiche(a);
    const balises = s.match(/<[^>]*>/g) || [];
    const fautive = balises.find((b) => !BALISE_PERMISE.test(b) ||
      (/href="/.test(b) && adresseSure(b.match(/href="([^"]*)"/)[1].replace(/&amp;/g, "&")) === ""));
    verifier("texte riche neutralise " + a, !fautive, fautive || "");
  }
  verifier("texte riche : balises refermées dans l'ordre", texteRiche("<strong>a<em>b</strong>c") === "<strong>a<em>b</em></strong>c");
  const t0 = performance.now();
  texteRiche("<b>" + "</i>".repeat(20000));
  texteRiche("<b>".repeat(20000));
  texteBrut("<".repeat(40000));
  verifier("texte riche et texte brut : pas de temps quadratique", performance.now() - t0 < 300, Math.round(performance.now() - t0) + " ms");
}

/* ----- Adresses, téléphones, échelle ----- */
for (const a of ["/\\pirate.example", "/\t/pirate.example", "//pirate.example", "javascript:alert(1)", " data:text/html,x", "\\\\pirate"]) {
  verifier("adresse refusée : " + JSON.stringify(a), adresseSure(a) === "" && imageSure(a) === "");
}
verifier("une ancre seule n'est pas une destination", destination("#") === "" && destination("#horaires") === "#horaires");
const tel = [
  ["+33 (0)3 89 12 34 56", "tel:+33389123456"], ["03 89 12 34 56 / 06 12 34 56 78", "tel:0389123456"],
  ["01 99 00 12 34", "tel:0199001234"], ["Appelez-nous", ""], ["12", ""]
];
for (const [entree, attendu] of tel) verifier("téléphone « " + entree + " »", lienTelephone(entree) === attendu, lienTelephone(entree));
for (const [v, attendu] of [[null, 1], ["", 1], [{ toString: 1 }, 1], [1.05, 1], [2, 1.12], [0.5, 0.9], ["1.12", 1.12]]) {
  verifier("échelle des titres " + JSON.stringify(v), echelleValide(v) === attendu, String(echelleValide(v)));
}
verifier("duo inconnu : celui du thème", themeDe({ theme: { id: "atelier", duo: "inconnu" } }).duo.id === "epure");

/* ----- Bilan ----- */
if (echecs.length) {
  for (const e of echecs) console.error("✗ " + e);
  console.error(`\n${echecs.length} échec(s), ${ok} réussite(s).`);
  process.exit(1);
}
console.log(`✓ ${ok} vérifications réussies`);
