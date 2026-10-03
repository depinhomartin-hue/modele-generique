/* Tests de non-régression du socle — `npm test`.

   Chaque cas rejoue un défaut RÉEL, trouvé par la relecture contradictoire
   du 3 octobre 2026, ou une règle du projet. Un test qui casse le jour où
   quelqu'un « simplifie » le code, c'est précisément son rôle.

   Le Worker est appelé directement (creerSite().fetch), sans serveur : Node
   connaît Request, Response et Headers. */
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { creerSite } from "../socle/worker.js";
import { normaliser, rendrePage, rendreCorps, rendreBloc, ancresDeLaPage } from "../socle/public/rendu/page.js";
import { texteRiche, texteBrut, echapper, adresseSure, imageSure, lienTelephone, destination, identifiantValide } from "../socle/public/rendu/outils.js";
import { echelleValide, themeDe, THEMES, COUPLES } from "../socle/public/rendu/themes.js";
import { BLOCS, CATALOGUE, nouveauBloc, valeurReglage, reglageActif } from "../socle/public/rendu/registre.js";
import { restesDuModele, contientUnTrou, compterTrous, mentionsPresentes, PAGE_MENTIONS as PAGE_MENTIONS_STRUCTURE } from "../socle/public/rendu/structure.js";
import { LIBELLES } from "../socle/public/rendu/libelles.js";
import { PAGE_MENTIONS, pageMentionsLegales } from "../socle/public/rendu/modeles-pages.js";
import { donneesStructurees, plagesHoraires, lignesHorairesIllisibles, jsonLdSur, baliseDonneesStructurees, CATEGORIES_GOOGLE } from "../socle/public/rendu/donnees-structurees.js";
import { CHAMPS_CONTACT, CHAMP_PIEGE, REGLES_CONTACT, ERREURS_CONTACT, validerMessage, MOTIF_TELEPHONE, MOTIF_EMAIL, MOTIF_NOM } from "../socle/public/rendu/formulaire.js";
import { REGLAGE_FOND, FONDS } from "../socle/public/rendu/blocs/commun.js";
import {
  LISTES_SITE, descripteurListe, nouvelIdBloc, PAGES_RESERVEES, idDePage, cheminAlt, nomDuBloc,
  cheminsVers, lireChemin, ecrireChemin, mediasCites, liensDansLesTextes, reecrireLiensDansTexte
} from "../socle/public/rendu/structure.js";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (f) => JSON.parse(readFileSync(racine + f, "utf8"));
const client = lire("clients/demo-boulangerie/client.json");
const contenuLivre = lire("clients/demo-boulangerie/contenu.json");
const ORIGINE = "https://demo.test";

/* Les données structurées pour Google (`<script type="application/ld+json">`)
   sont le SEUL script toléré dans une page publique : ce n'est pas du code
   exécuté (3 octobre 2026). La forme est celle qu'écrit le rendu ; le JSON
   y est échappé et ne contient jamais « < ». */
const JSON_LD = /<script type="application\/ld\+json">([^<]*)<\/script>/g;
const sansDonneesStructurees = (html) => html.replace(JSON_LD, "");
const donneesDe = (html) => [...html.matchAll(JSON_LD)].map((m) => JSON.parse(m[1]));

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
  verifier("aucun script dans la page publique (hors données structurées)", !/<script/i.test(sansDonneesStructurees(r.corps)));
  verifier("données structurées : une seule fois sur l'accueil, en JSON lisible", donneesDe(r.corps).length === 1 && donneesDe(r.corps)[0].name === "Au Pétrin d'Ernestine");
  verifier("aucune marque d'édition dans la page publique", !/data-edit|data-sans-lien|data-masque|data-liste/.test(r.corps));
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

/* =========================================================
   Phase 2 — ce que l'éditeur demande au rendu
   ========================================================= */
const copieDe = (v) => (v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v);
const nbH1 = (html) => (html.match(/<h1[\s>]/g) || []).length;

/* Les sections d'une page rendue : identifiant du bloc → son ancre, sa
   balise d'ouverture et le niveau de son premier titre. */
function sections(html) {
  const res = {};
  const trouvees = [...html.matchAll(/<section id="([^"]*)"[^>]*data-bloc="([^"]+)"[^>]*>/g)];
  trouvees.forEach((m, i) => {
    const fin = i + 1 < trouvees.length ? trouvees[i + 1].index : html.indexOf("</main>");
    const h = html.slice(m.index, fin).match(/<h([1-6])[\s>]/);
    res[m[2]] = { ancre: m[1], ouverture: m[0], titre: h ? "h" + h[1] : "" };
  });
  return res;
}

/* ----- Sections masquées ----- */
{
  const n = normaliser({ blocs: {
    "faq-1": { type: "faq", masque: "true" }, "faq-2": { type: "faq", masque: 1 }, "faq-3": { type: "faq", masque: false },
    "faq-4": { type: "faq", masque: { toString: 1 } }, "faq-5": { type: "faq", masque: true }
  } });
  verifier("masque : seul un vrai true est gardé, toute autre valeur disparaît",
    ["faq-1", "faq-2", "faq-3", "faq-4"].every((id) => !Object.hasOwn(n.blocs[id], "masque")) && n.blocs["faq-5"].masque === true);
}
{
  /* L'accroche porte le <h1> et une vraie photo ; la galerie est la seule
     de son genre, réclame l'ancre d'un bloc visible placé APRÈS elle, et
     cite une police que le reste de la page n'emploie pas. */
  const brut = copieDe(contenuLivre);
  const PHOTO = "/medias/0123456789abcdef0123456789abcdef.jpg";
  brut.blocs["accroche-1"].masque = true;
  brut.blocs["accroche-1"].image = PHOTO;
  brut.blocs["galerie-1"].masque = true;
  brut.blocs["galerie-1"].ancre = "horaires";
  brut.blocs["galerie-1"].titre = 'Des photos <span data-police="romantique">cachées</span>';
  const c = normaliser(brut);
  const pub = rendrePage({ contenu: c, client, origine: ORIGINE });
  const edi = rendrePage({ contenu: c, client, origine: ORIGINE, edition: true });
  const sp = sections(pub);
  const se = sections(edi);
  const visibles = c.pages.accueil.ordre.filter((id) => c.blocs[id].masque !== true);
  verifier("masqué : absent de la page publique", !sp["accroche-1"] && !sp["galerie-1"] && !pub.includes("Le pain du village") && !pub.includes("Des photos"));
  verifier("masqué : aucune marque data-masque dans la page publique", !pub.includes("data-masque"));
  verifier("masqué : rendu en édition, avec data-masque sur sa <section>",
    !!se["accroche-1"] && /\sdata-masque[\s>]/.test(se["accroche-1"].ouverture) && !!se["galerie-1"] && /\sdata-masque[\s>]/.test(se["galerie-1"].ouverture));
  verifier("masqué : les sections visibles ne portent pas data-masque",
    Object.keys(se).filter((id) => se[id].ouverture.includes("data-masque")).sort().join() === "accroche-1,galerie-1");
  verifier("masqué : chaque bloc visible est rendu sur le site", visibles.length === 7 && visibles.every((id) => sp[id]));
  verifier("masqué : ancres des blocs visibles identiques en édition et sur le site", visibles.every((id) => se[id] && se[id].ancre === sp[id].ancre),
    visibles.map((id) => id + "=" + (sp[id] || {}).ancre + "/" + (se[id] || {}).ancre).join(" "));
  verifier("masqué : il ne prend pas l'ancre d'un bloc visible qui le suit", sp["horaires-1"].ancre === "horaires" && se["galerie-1"].ancre === "galerie-1");
  const ancresEd = Object.values(se).map((s) => s.ancre);
  verifier("masqué : ancres uniques en édition", ancresEd.length === new Set(ancresEd).size);
  const ancres = ancresDeLaPage(c, c.pages.accueil);
  verifier("ancresDeLaPage : celles que la page écrit", Object.keys(se).every((id) => ancres[id] === se[id].ancre));
  verifier("masqué : niveaux de titre des blocs visibles identiques en édition et sur le site", visibles.every((id) => se[id].titre === sp[id].titre));
  verifier("masqué : le <h1> revient au premier bloc visible", sp["presentation-1"].titre === "h1" && nbH1(pub) === 1);
  verifier("masqué : en édition, un bloc masqué n'est jamais premier", se["accroche-1"].titre === "h2" && se["presentation-1"].titre === "h1" && nbH1(edi) === 1);
  verifier("masqué : sa feuille n'est pas chargée sur le site", !pub.includes("/css/blocs/galerie.css") && !pub.includes("/css/blocs/accroche.css") && pub.includes("/css/blocs/horaires.css"));
  verifier("masqué : sa feuille est chargée en édition", edi.includes("/css/blocs/galerie.css") && edi.includes("/css/blocs/accroche.css"));
  verifier("masqué : sa photo ne devient pas l'image des réseaux sociaux", !pub.includes(PHOTO) && !edi.includes('og:image" content="' + ORIGINE + PHOTO));
  verifier("masqué : la police qu'il cite n'est pas téléchargée sur le site", !pub.includes("family=Cormorant") && edi.includes("family=Cormorant"));
  verifier("masqué : rendreBloc seul ne le dessine pas hors édition", rendreBloc("accroche-1", c.blocs["accroche-1"], { edition: false, contenu: c, client }) === "");
  // Contre-épreuve : sans le masque, la même photo est bien publiée — sinon
  // le test de l'image ne prouverait rien.
  delete brut.blocs["accroche-1"].masque;
  verifier("contre-épreuve : visible, sa photo devient l'image des réseaux sociaux",
    rendrePage({ contenu: normaliser(brut), client, origine: ORIGINE }).includes('og:image" content="' + ORIGINE + PHOTO + '"'));
}
{
  const c = normaliser({ pages: { accueil: { titre: "Tout est caché", ordre: ["faq-1", "appel-1"] } },
    blocs: { "faq-1": { type: "faq", titre: "Q", masque: true }, "appel-1": { type: "appel", titre: "A", masque: true } } });
  const pub = rendreCorps({ contenu: c, client: {} });
  const edi = rendreCorps({ contenu: c, client: {}, edition: true });
  verifier("page entièrement masquée : un seul <h1>, aucun bloc", nbH1(pub) === 1 && !pub.includes("data-bloc") && pub.includes("Tout est caché"));
  verifier("page entièrement masquée : en édition, les blocs et un seul <h1>", nbH1(edi) === 1 && edi.includes('data-bloc="faq-1"') && edi.includes('data-bloc="appel-1"'));
}
{
  const c = normaliser({ pages: { accueil: { titre: "Titre de page", ordre: ["faq-1"] } }, blocs: { "faq-1": { type: "faq", titre: "" } } });
  const pub = rendreCorps({ contenu: c, client: {} });
  const edi = rendreCorps({ contenu: c, client: {}, edition: true });
  verifier("premier titre vide : un seul <h1>, sur le site comme en édition",
    nbH1(pub) === 1 && pub.includes(">Titre de page</h1>") && nbH1(edi) === 1 && edi.includes('data-edit="blocs.faq-1.titre"'));
}
{
  const c = copieDe(contenuLivre);
  c.blocs["avis-1"].masque = true;
  const r = await appeler("/", { publie: c });
  verifier("le Worker ne sert pas un bloc masqué publié", r.statut === 200 && !r.corps.includes('data-bloc="avis-1"') && !r.corps.includes("Claire M.") && r.corps.includes('data-bloc="horaires-1"'));
}

/* ----- Les réglages : l'éditeur et la page disent la même chose ----- */
{
  const ctx = { edition: false, contenu: normaliser({}), client: {} };
  const classeFond = (html) => (html.match(/class="bloc bloc-[a-z]+ bloc--([a-z]+)/) || [])[1];
  const ecarts = [];
  for (const type of Object.keys(BLOCS)) {
    for (const f of FONDS) {
      const b = Object.assign(nouveauBloc(type), { fond: f });
      if (classeFond(rendreBloc(type + "-1", b, ctx)) !== f || valeurReglage(b, REGLAGE_FOND) !== f) ecarts.push(type + " " + f);
    }
    for (const f of [undefined, "violet", { toString: 1 }]) {
      const b = nouveauBloc(type);
      if (f === undefined) delete b.fond; else b.fond = f;
      const affiche = valeurReglage(b, REGLAGE_FOND);
      if (classeFond(rendreBloc(type + "-1", b, ctx)) !== affiche) ecarts.push(type + " " + String(typeof f === "object" ? "piégé" : f));
    }
  }
  verifier("fond : la page dessine celui que l'éditeur affiche, pour chaque genre", ecarts.length === 0, ecarts.join(", "));
  verifier("fond inconnu : celui du modèle (l'appel reste foncé)", valeurReglage({ type: "appel", fond: "violet" }, "fond") === "sombre" &&
    classeFond(rendreBloc("appel-1", { type: "appel", fond: "violet", titre: "A" }, ctx)) === "sombre");
  verifier("fond absent sans modèle : le premier choix", valeurReglage({ type: "accroche" }, "fond") === "clair");
  const pres = (inverse) => rendreBloc("presentation-1", Object.assign(nouveauBloc("presentation"), { inverse }), ctx).includes("presentation--inverse");
  verifier("case « Photo à gauche » : seul un vrai true la coche, sur la page comme dans l'éditeur",
    pres(true) && !pres("non") && !pres(1) && !pres(false) && valeurReglage({ type: "presentation", inverse: "non" }, "inverse") === false &&
    valeurReglage({ type: "presentation", inverse: true }, "inverse") === true);
  const acc = (disposition) => rendreBloc("accroche-1", Object.assign(nouveauBloc("accroche"), { disposition }), ctx);
  verifier("disposition inconnue : celle du modèle, sur la page comme dans l'éditeur",
    acc("bizarre").includes("accroche--cote") && valeurReglage({ type: "accroche", disposition: "bizarre" }, "disposition") === "cote-a-cote" && acc("image-fond").includes("accroche--pleine"));
  verifier("valeurReglage : réglage inconnu → undefined", valeurReglage({ type: "faq" }, "disposition") === undefined && valeurReglage(null, "fond") === undefined);
}

/* ----- Le catalogue et les descriptions des blocs ----- */
{
  const ORDRE = ["accroche", "presentation", "prestations", "galerie", "avis", "horaires", "faq", "texte", "appel", "contact"];
  verifier("catalogue : tous les genres, dans l'ordre d'« Ajouter une section »",
    CATALOGUE.map((x) => x.type).join() === ORDRE.join() && Object.keys(BLOCS).join() === ORDRE.join());
  verifier("catalogue : nom et phrase repris du module",
    CATALOGUE.every((x) => Object.keys(x).join() === "type,nom,description" && x.nom === BLOCS[x.type].nom && x.description === BLOCS[x.type].description));
  const JARGON = /\b(blocs?|json|slug|session|cache|révision|html|css)\b/i;
  for (const x of CATALOGUE) {
    verifier("description de « " + x.type + " » : une phrase simple",
      typeof x.description === "string" && x.description.length >= 20 && x.description.length <= 140 && /\.$/.test(x.description) && !JARGON.test(x.description), x.description);
    verifier("feuille de « " + x.type + " » présente", existsSync(racine + "socle/public/css/blocs/" + x.type + ".css"));
  }
  verifier("descriptions figées (l'éditeur ne peut pas les changer par mégarde)",
    Object.isFrozen(CATALOGUE) && Object.isFrozen(CATALOGUE[0]) && Object.isFrozen(BLOCS.accroche.reglages) && Object.isFrozen(BLOCS.accroche.reglages[0].choix[0]) && Object.isFrozen(BLOCS.faq.listes.questions));
  const a = nouveauBloc("faq");
  a.questions.push({});
  verifier("modèle : un objet neuf à chaque appel", nouveauBloc("faq").questions.length === 2 && !Object.isFrozen(a));
  verifier("REGLAGE_FOND : exactement les fonds que le rendu connaît",
    REGLAGE_FOND.cle === "fond" && REGLAGE_FOND.choix.map((c) => c.valeur).join() === FONDS.join() && FONDS.join() === "clair,doux,sombre" &&
    REGLAGE_FOND.choix.map((c) => c.libelle).join() === "Clair,Teinté,Foncé");

  // Le tableau de la spécification (§ 5.2), tel quel.
  // Socle 0.3.0 : le bloc « texte », et la case du formulaire de contact.
  const REGLAGES_ATTENDUS = { accroche: "disposition,fond", presentation: "fond,inverse", prestations: "fond", galerie: "fond", avis: "fond", horaires: "fond", faq: "fond", texte: "fond", appel: "fond", contact: "fond,formulaire" };
  const LISTES_ATTENDUES = { accroche: "boutons:2", presentation: "", prestations: "elements:12", galerie: "images:24", avis: "avis:12", horaires: "jours:14", faq: "questions:20", texte: "paragraphes:40", appel: "", contact: "" };
  for (const [type, def] of Object.entries(BLOCS)) {
    const modele = def.modele();
    const problemes = [];
    const reglages = Array.isArray(def.reglages) ? def.reglages : [];
    if (reglages.map((r) => r.cle).join() !== REGLAGES_ATTENDUS[type]) problemes.push("réglages " + reglages.map((r) => r.cle).join() + " au lieu de " + REGLAGES_ATTENDUS[type]);
    // Le fond est REGLAGE_FOND, ou sa copie avec une condition (`seulementSi`) :
    // dans les deux cas, LES MÊMES choix — une seule liste des fonds.
    const fond = reglages.find((r) => r.cle === "fond");
    if (!fond || fond.choix !== REGLAGE_FOND.choix || fond.libelle !== REGLAGE_FOND.libelle) problemes.push("le fond n'est pas REGLAGE_FOND");
    const listes = def.listes && typeof def.listes === "object" && !Array.isArray(def.listes) ? def.listes : null;
    if (!listes) problemes.push("listes absent");
    const resumeListes = Object.entries(listes || {}).map(([k, d]) => k + ":" + d.max).join();
    if (resumeListes !== LISTES_ATTENDUES[type]) problemes.push("listes " + resumeListes + " au lieu de " + LISTES_ATTENDUES[type]);

    const id = type + "-1";
    const ctx = { edition: false, contenu: normaliser({}), client: {} };
    for (const r of reglages) {
      if (typeof r.cle !== "string" || !r.cle || typeof r.libelle !== "string" || !r.libelle.trim()) { problemes.push("réglage sans clé ou sans libellé"); continue; }
      let valeurs;
      if (r.type === "case") {
        if (r.choix !== undefined) problemes.push(r.cle + " : une case n'a pas de choix");
        if (Object.hasOwn(modele, r.cle) && typeof modele[r.cle] !== "boolean") problemes.push(r.cle + " : le modèle ne donne pas oui ou non");
        valeurs = [true, false];
      } else {
        if (r.type !== undefined) problemes.push(r.cle + " : type inconnu « " + r.type + " »");
        valeurs = Array.isArray(r.choix) ? r.choix.map((x) => x && x.valeur) : [];
        if (valeurs.length < 2) problemes.push(r.cle + " : moins de deux choix");
        if (!valeurs.every((v) => typeof v === "string" && v)) problemes.push(r.cle + " : un choix sans valeur");
        if (new Set(valeurs).size !== valeurs.length) problemes.push(r.cle + " : deux choix de même valeur");
        if (!(r.choix || []).every((x) => x && typeof x.libelle === "string" && x.libelle.trim())) problemes.push(r.cle + " : un choix sans libellé");
        if (Object.hasOwn(modele, r.cle) && !valeurs.includes(modele[r.cle])) problemes.push(r.cle + " : le modèle donne « " + modele[r.cle] + " », hors des choix");
        if (!valeurs.includes(valeurReglage(modele, r))) problemes.push(r.cle + " : la valeur affichée pour un bloc neuf n'est pas un choix");
      }
      // Un réglage qui ne change rien à la page serait un bouton sans effet.
      const rendus = new Set(valeurs.map((v) => rendreBloc(id, Object.assign(def.modele(), { [r.cle]: v }), ctx)));
      if (rendus.size !== valeurs.length) problemes.push(r.cle + " : deux choix donnent la même page");
    }
    // Ce que `normaliser` reprend du modèle comme réglage doit être réglable.
    for (const k of ["disposition", "fond", "inverse"]) {
      if (Object.hasOwn(modele, k) && !reglages.some((r) => r.cle === k)) problemes.push("le modèle porte « " + k + " » sans réglage déclaré");
    }
    for (const k of Object.keys(modele).filter((k) => Array.isArray(modele[k]))) {
      if (!listes || !Object.hasOwn(listes, k)) problemes.push("la liste « " + k + " » du modèle n'a pas de descripteur");
    }
    const c = normaliser({ pages: { accueil: { ordre: [id] } }, blocs: { [id]: modele } });
    const edi = rendreCorps({ contenu: c, client: {}, edition: true });
    for (const [nom, d] of Object.entries(listes || {})) {
      const el = Array.isArray(modele[nom]) ? modele[nom][0] : null;
      if (!el || typeof el !== "object" || Array.isArray(el)) problemes.push(nom + " : le modèle n'en donne aucun élément");
      if (typeof d.libelle !== "string" || !d.libelle.trim()) problemes.push(nom + " : sans libellé");
      // Le serveur refuse un tableau de plus de 60 éléments (spécification, § 4).
      if (!Number.isInteger(d.max) || d.max < 1 || d.max > 60) problemes.push(nom + " : maximum hors de 1 à 60");
      if (Array.isArray(modele[nom]) && modele[nom].length > d.max) problemes.push(nom + " : le modèle dépasse le maximum");
      if (!edi.includes('data-liste="blocs.' + id + "." + nom + '" data-index="0"')) problemes.push(nom + " : aucun élément marqué en édition (pas de barre d'élément sur la page)");
    }
    if (edi.includes("n'a pas pu s'afficher") || !rendreCorps({ contenu: c, client: {} }).includes('data-bloc="' + id + '"')) problemes.push("le modèle ne se rend pas");
    verifier("descripteurs de « " + type + " » cohérents avec son modèle et son rendu", problemes.length === 0, problemes.join(" ; "));
  }
}

/* ----- structure.js : les règles de forme du contenu ----- */
const demo = normaliser(copieDe(contenuLivre));
{
  verifier("LISTES_SITE : le menu et le pied",
    Object.keys(LISTES_SITE).join() === "entete.liens,pied.liens" &&
    Object.values(LISTES_SITE).every((d) => d.libelle === "un lien" && d.max === 8 && d.modele.texte === "Nouveau lien" && d.modele.vers === ""));
  const menu = descripteurListe(demo, "entete.liens");
  menu.modele.texte = "modifié";
  verifier("descripteurListe : le modèle du menu est une copie neuve",
    descripteurListe(demo, "entete.liens").modele.texte === "Nouveau lien" && LISTES_SITE["entete.liens"].modele.texte === "Nouveau lien");
  verifier("descripteurListe : le pied, même sans contenu", (descripteurListe(null, "pied.liens") || {}).max === 8);
  const q = descripteurListe(demo, "blocs.faq-1.questions");
  verifier("descripteurListe : une liste de bloc", !!q && q.libelle === "une question" && q.max === 20 && JSON.stringify(q.modele) === JSON.stringify(BLOCS.faq.modele().questions[0]));
  if (q) q.modele.question = "modifiée";
  verifier("descripteurListe : le modèle d'un élément est une copie neuve", descripteurListe(demo, "blocs.faq-1.questions").modele.question !== "modifiée");
  verifier("descripteurListe : les boutons de l'accroche", (descripteurListe(demo, "blocs.accroche-1.boutons") || {}).max === 2);
  const refus = ["blocs.faq-1.inconnue", "blocs.faq-1.titre", "blocs.inexistant.questions", "blocs.constructor.questions", "blocs.toString.questions",
    "blocs.__proto__.questions", "blocs.faq-1", "blocs.faq-1.questions.0", "entete", "entete.bouton", "pages.accueil.ordre", "", null, 42, { toString: 1 }];
  verifier("descripteurListe : null pour tout ce qui n'est pas une liste", refus.every((ch) => descripteurListe(demo, ch) === null),
    refus.filter((ch) => descripteurListe(demo, ch) !== null).map(String).join(", "));
}
{
  verifier("nouvelIdBloc : le suivant", nouvelIdBloc("faq", demo.blocs) === "faq-2");
  verifier("nouvelIdBloc : le plus petit numéro libre", nouvelIdBloc("faq", { "faq-1": {}, "faq-3": {} }) === "faq-2");
  verifier("nouvelIdBloc : rien de pris", [null, undefined, [], "x", { toString: 1 }].every((b) => nouvelIdBloc("avis", b) === "avis-1"));
  verifier("nouvelIdBloc : genre inconnu → null", ["inconnu", "", null, { toString: 1 }, "constructor", "FAQ"].every((t) => nouvelIdBloc(t, demo.blocs) === null));
  verifier("nouvelIdBloc : un identifiant valide pour chaque genre", Object.keys(BLOCS).every((t) => identifiantValide(nouvelIdBloc(t, demo.blocs))));
}
{
  const ATTENDUES = ["accueil", "admin", "medias", "css", "rendu", "editeur", "illustrations", "js", "favicon", "robots", "sitemap", "introuvable", "contenu", "api"];
  verifier("PAGES_RESERVEES : la liste de la spécification",
    PAGES_RESERVEES instanceof Set && PAGES_RESERVEES.size === ATTENDUES.length && ATTENDUES.every((p) => PAGES_RESERVEES.has(p)));
  const cas = [
    ["Nos tarifs", {}, "nos-tarifs"], ["Éléments à récupérer", {}, "elements-a-recuperer"], ["Nos œufs & crème", {}, "nos-oeufs-creme"],
    ["  L’été, à l’atelier !  ", {}, "l-ete-a-l-atelier"], ["Accueil", {}, "accueil-2"], ["ADMIN", {}, "admin-2"], ["Médias", {}, "medias-2"],
    ["Tarifs", { tarifs: {} }, "tarifs-2"], ["Tarifs", { tarifs: {}, "tarifs-2": {} }, "tarifs-3"], ["", {}, "page"], ["   ", {}, "page"],
    ["🥖🥐", {}, "page"], ["🥖 Pains", {}, "pains"], ["🥖🥐", { page: {} }, "page-2"], ["2026 : nos horaires", {}, "page-2026-nos-horaires"],
    ["Constructor", {}, "constructor-2"], ["prototype", {}, "prototype-2"], ["<b>Gras</b> &amp; fin", {}, "gras-fin"],
    [{ toString: 1 }, {}, "page"], [null, null, "page"], ["Tarifs", [], "tarifs"], ["Tarifs", { toString: 1 }, "tarifs"]
  ];
  for (const [titre, pages, attendu] of cas) {
    let obtenu;
    try { obtenu = idDePage(titre, pages); } catch (e) { obtenu = "a levé : " + e.message; }
    verifier("idDePage(" + JSON.stringify(titre) + ") = " + attendu, obtenu === attendu, obtenu);
  }
  const prises = {};
  const fautes = [];
  for (const titre of ["Une page au nom vraiment beaucoup trop long pour tenir dans une adresse", "x".repeat(500), "-".repeat(50), "9".repeat(60), "é".repeat(80), "a-b-c-".repeat(20)]) {
    for (let i = 0; i < 12; i++) {
      const id = idDePage(titre, prises);
      if (!identifiantValide(id) || id.length > 40 || /-$/.test(id) || Object.hasOwn(prises, id) || PAGES_RESERVEES.has(id)) fautes.push(id);
      prises[id] = {};
    }
  }
  verifier("idDePage : noms extrêmes, 12 fois chacun — valide, 40 caractères au plus, jamais réservé ni pris", fautes.length === 0 && Object.keys(prises).length === 72, fautes.join(" "));
}
{
  verifier("cheminAlt : la description à côté de la photo",
    cheminAlt("blocs.accroche-1.image") === "blocs.accroche-1.imageAlt" && cheminAlt("blocs.galerie-1.images.2.src") === "blocs.galerie-1.images.2.alt");
  verifier("cheminAlt : pas de description pour le logo ni le reste",
    [ "site.logo", "blocs.accroche-1.titre", "image", "src", "", null, { toString: 1 }, "blocs.__proto__.image" ].every((ch) => cheminAlt(ch) === null));
}
{
  verifier("nomDuBloc : le genre puis le titre", nomDuBloc(demo.blocs["prestations-1"]) === "Prestations — Nos pains et viennoiseries");
  verifier("nomDuBloc : le titre sans sa mise en forme", nomDuBloc(demo.blocs["accroche-1"]) === "Accroche — Le pain du village, pétri chaque nuit");
  verifier("nomDuBloc : sans titre, le genre seul",
    nomDuBloc({ type: "avis", titre: "" }) === "Avis" && nomDuBloc({ type: "avis" }) === "Avis" && nomDuBloc({ type: "avis", titre: { toString: 1 } }) === "Avis");
  const long = nomDuBloc({ type: "faq", titre: "Une question très longue qui n'en finit pas de s'allonger encore" });
  const titreSeul = long.slice("Questions fréquentes — ".length);
  verifier("nomDuBloc : titre coupé à 40 caractères", long.startsWith("Questions fréquentes — ") && Array.from(titreSeul).length <= 40 && titreSeul.endsWith("…"), long);
  const emoji = nomDuBloc({ type: "faq", titre: "🥐".repeat(60) });
  verifier("nomDuBloc : jamais un demi-caractère", !/[\uD800-\uDFFF]/.test(emoji.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "")), emoji);
  verifier("nomDuBloc : bloc inconnu ou abîmé", [null, undefined, {}, { type: "inconnu" }, [], { toString: 1 }].every((b) => nomDuBloc(b) === "Section"));
}
{
  const attendus = [
    "entete.liens.0.vers", "entete.liens.1.vers", "entete.liens.2.vers", "entete.liens.3.vers", "entete.bouton.vers",
    "pied.liens.0.vers", "pied.liens.1.vers", "pied.liens.2.vers",
    "blocs.accroche-1.boutons.0.vers", "blocs.accroche-1.boutons.1.vers", "blocs.presentation-1.bouton.vers",
    "blocs.horaires-1.lienPlan", "blocs.appel-1.bouton.vers"
  ];
  const obtenus = cheminsVers(demo);
  verifier("cheminsVers : toutes les destinations de la démo", [...obtenus].sort().join() === [...attendus].sort().join(), obtenus.join(" "));
  verifier("cheminsVers : chaque chemin se lit et donne un texte", obtenus.every((ch) => typeof lireChemin(demo, ch) === "string"));
  const c = copieDe(demo);
  for (const ch of cheminsVers(c)) if (lireChemin(c, ch) === "#horaires") ecrireChemin(c, ch, "#nous-trouver");
  const json = JSON.stringify(c);
  verifier("cheminsVers + ecrireChemin : une ancre renommée partout", !json.includes('"#horaires"') && json.split('"#nous-trouver"').length - 1 === 3);
  const abime = { entete: { liens: [null, { vers: { toString: 1 } }, { vers: "#a" }], bouton: [] }, pied: { liens: "non" },
    blocs: { "faq-1": { type: "faq", bouton: { vers: 42 }, "x.y": { vers: "#b" } }, "Pas valide": { vers: "#c" } } };
  verifier("cheminsVers : seulement des textes, à des chemins réinscriptibles", cheminsVers(abime).join() === "entete.liens.2.vers");
}
{
  const o = JSON.parse('{"a":{"b":[{"c":1}]},"__proto__":{"x":1}}');
  verifier("lireChemin : un chemin avec indice", lireChemin(o, "a.b.0.c") === 1 && lireChemin(demo, "blocs.faq-1.questions.1.question") === "Avez-vous du pain sans gluten ?");
  const interdits = ["__proto__.x", "__proto__", "a.constructor", "a.toString", "a.b.length", "a.b.constructor", "constructor.prototype", "a..b", "", "a.b.-1.c", "a.b.01.c", "a.b.0.c.d"];
  verifier("lireChemin : jamais le prototype, jamais un faux indice", interdits.every((ch) => lireChemin(o, ch) === undefined), interdits.filter((ch) => lireChemin(o, ch) !== undefined).join(", "));
  verifier("lireChemin : objet ou chemin abîmé", [null, undefined, 42, "texte"].every((x) => lireChemin(x, "a.b") === undefined) &&
    lireChemin(o, null) === undefined && lireChemin(o, { toString: 1 }) === undefined);

  const cible = {};
  const refuses = ["__proto__.pollue", "constructor.prototype.pollue", "a.__proto__.pollue", "__proto__", "prototype", "a.constructor", "x..y", ""];
  verifier("ecrireChemin : refuse __proto__, constructor et prototype",
    refuses.every((ch) => ecrireChemin(cible, ch, "oui") === false) && ({}).pollue === undefined && Object.prototype.pollue === undefined && Object.keys(cible).length === 0);
  verifier("ecrireChemin : crée les objets intermédiaires", ecrireChemin(cible, "pages.tarifs.titre", "Tarifs") === true && cible.pages.tarifs.titre === "Tarifs");
  verifier("ecrireChemin : un indice crée une liste, pas un objet",
    ecrireChemin(cible, "entete.liens.0.texte", "Nos pains") === true && Array.isArray(cible.entete.liens) && cible.entete.liens[0].texte === "Nos pains");
  verifier("ecrireChemin : ajoute juste après le dernier élément", ecrireChemin(cible, "entete.liens.1", { texte: "B" }) === true && cible.entete.liens.length === 2);
  verifier("ecrireChemin : refuse un indice lointain (liste à trous), sans rien créer",
    !ecrireChemin(cible, "entete.liens.999999.texte", "x") && !ecrireChemin(cible, "pied.liens.3.texte", "x") && cible.entete.liens.length === 2 && cible.pied === undefined);
  cible.site = { nom: "Texte" };
  verifier("ecrireChemin : ne remplace jamais un texte par un objet", !ecrireChemin(cible, "site.nom.premier", "x") && cible.site.nom === "Texte");
  verifier("ecrireChemin : refuse un mot là où une liste attend un indice", !ecrireChemin(cible, "entete.liens.length", 0) && cible.entete.liens.length === 2);
  verifier("ecrireChemin : une clé héritée devient propre, sans toucher au prototype",
    ecrireChemin(cible, "x.toString", "t") === true && cible.x.toString === "t" && typeof ({}).toString === "function");
  verifier("ecrireChemin : objet figé ou abîmé → false, sans lever",
    ecrireChemin(Object.freeze({ a: 1 }), "a", 2) === false && [null, undefined, 42, "x"].every((x) => ecrireChemin(x, "a", 1) === false) && ecrireChemin(cible, { toString: 1 }, 1) === false);
}
{
  const c = copieDe(demo);
  const A = "/medias/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png", B = "/medias/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg";
  const C = "/medias/vignettes/cccccccccccccccccccccccccccccccc.webp", D = "/medias/dddddddddddddddddddddddddddddddd.jpg";
  c.site.logo = A;
  c.blocs["galerie-1"].images[1].src = "  " + B + " ";
  c.blocs["accroche-1"].image = C;
  c.site["clé.avec.point"] = D;
  const m = mediasCites(c);
  verifier("mediasCites : toutes les photos de la médiathèque, où qu'elles soient", m.size === 4 && [A, B, C, D].every((x) => m.has(x)), [...m].join(" "));
  verifier("mediasCites : rien d'autre (la démo n'emploie que des illustrations)", mediasCites(demo).size === 0);
  const boucle = { a: "/medias/e.jpg", liste: [] };
  boucle.liste.push(boucle);
  verifier("mediasCites : un objet qui se cite lui-même ne fait pas boucler", mediasCites(boucle).size === 1);
}

/* ----- Rien ne lève sur un contenu abîmé ----- */
{
  const piege = { toString: 1 };
  const abimes = [
    null, undefined, 42, "texte", [], [piege], piege, { version: piege }, { blocs: [] },
    { blocs: piege, pages: piege, entete: piege, pied: piege, site: piege, theme: piege },
    { blocs: { "faq-1": piege, "faq-2": null, "faq-3": { type: piege, titre: piege, questions: piege } } },
    { blocs: { "faq-1": { type: "faq", masque: piege, fond: piege, ancre: piege, titre: piege, questions: [piege, null, 3] } }, pages: { accueil: { ordre: [piege, null, "faq-1", "faq-1"] } } },
    { entete: { liens: [piege, null, { vers: piege, texte: piege }], bouton: { vers: piege } }, pied: { liens: piege } },
    { pages: { accueil: piege, constructor: { ordre: [] }, "Pas valide": {} }, blocs: { constructor: { type: "faq" } } },
    { pied: { texte: '</a></a><a href="#x">a<a href=\'/y\'>b</a href="/z"><a href>c<a href="javascript:x">d<A HREF=/w>e<a href="' },
      entete: { bouton: { masque: piege, texte: piege }, liens: [{ texte: '<a href="#q">' }] },
      blocs: { "faq-1": { type: "faq", titre: "<a", questions: [{ reponse: '<a href="/p">x</a>'.repeat(3) }] } } }
  ];
  const fonctions = {
    normaliser: (c) => rendrePage({ contenu: normaliser(c), client: {} }) + rendrePage({ contenu: normaliser(c), client: {}, edition: true }),
    descripteurListe: (c) => [descripteurListe(c, "blocs.faq-1.questions"), descripteurListe(c, "entete.liens"), descripteurListe(c, piege)],
    nouvelIdBloc: (c) => nouvelIdBloc("faq", c && c.blocs),
    idDePage: (c) => idDePage(c, c && c.pages),
    cheminAlt: (c) => cheminAlt(c),
    nomDuBloc: (c) => [nomDuBloc(c), nomDuBloc(c && c.blocs && c.blocs["faq-1"])],
    cheminsVers: (c) => cheminsVers(c),
    liensDansLesTextes: (c) => liensDansLesTextes(c),
    reecrireLiensDansTexte: (c) => [reecrireLiensDansTexte(c, () => ""), reecrireLiensDansTexte(c && c.pied && c.pied.texte, () => "")],
    lireChemin: (c) => lireChemin(c, "blocs.faq-1.questions.0"),
    ecrireChemin: (c) => ecrireChemin(c, "blocs.faq-1.titre", "x"),
    mediasCites: (c) => mediasCites(c),
    valeurReglage: (c) => [valeurReglage(c, REGLAGE_FOND), valeurReglage(c, "fond"), valeurReglage(c && c.blocs && c.blocs["faq-1"], "fond")]
  };
  for (const [nom, f] of Object.entries(fonctions)) {
    const levees = [];
    abimes.forEach((c, i) => { try { f(copieDe(c)); } catch (e) { levees.push("cas " + i + " : " + e.message); } });
    verifier(nom + " ne lève jamais sur un contenu abîmé", levees.length === 0, levees.join(" | "));
  }
  let version;
  try { version = normaliser({ version: piege }).version; } catch (e) { version = "a levé : " + e.message; }
  verifier("normaliser : une version piégée donne 1", version === 1, String(version));
  const une = normaliser(copieDe(contenuLivre));
  verifier("normaliser : une seconde fois ne change rien (même empreinte)", JSON.stringify(normaliser(copieDe(une))) === JSON.stringify(une));
  let page;
  try { page = rendreCorps({ contenu: demo, client: {}, pageId: "constructor", edition: true }); } catch (e) { page = ""; }
  verifier("une page « constructor » demandée par l'éditeur : l'accueil, pas une erreur", page.includes('data-bloc="accroche-1"'));
}

/* ----- Un réglage qui ne vaut que dans un cas ----- */
{
  const fondAccroche = BLOCS.accroche.reglages.find((r) => r.cle === "fond");
  verifier("le fond de l'accroche n'est proposé qu'en « côte à côte »",
    reglageActif({ type: "accroche", disposition: "cote-a-cote" }, fondAccroche) &&
    !reglageActif({ type: "accroche", disposition: "image-fond" }, fondAccroche) &&
    // une disposition abîmée vaut celle que le rendu dessine : côte à côte
    reglageActif({ type: "accroche", disposition: { toString: 1 } }, fondAccroche));
  verifier("un réglage sans condition est toujours proposé",
    BLOCS.presentation.reglages.every((r) => reglageActif({ type: "presentation" }, r)) && reglageActif(null, null));
}

/* ----- Ce qui reste du modèle avant de publier ----- */
{
  // Chaque motif déclaré désigne bien quelque chose dans le modèle : un
  // motif mal écrit ne préviendrait jamais, sans un mot.
  const motifsMorts = [];
  for (const [type, def] of Object.entries(BLOCS)) {
    for (const motif of def.exemples || []) {
      let courants = [def.modele()];
      for (const seg of motif.split(".")) courants = courants.flatMap((c) => (seg === "*" ? (Array.isArray(c) ? c : []) : (c && typeof c === "object" && seg in c ? [c[seg]] : [])));
      if (!courants.length || courants.every((v) => v === "" || v === undefined)) motifsMorts.push(type + ":" + motif);
    }
  }
  verifier("chaque champ d'exemple déclaré existe dans le modèle", !motifsMorts.length, motifsMorts.join(", "));

  const demo = normaliser(JSON.parse(JSON.stringify(contenuLivre)));
  verifier("la démo n'a aucun texte d'exemple signalé (pas de fausse alerte)", restesDuModele(demo).length === 0, JSON.stringify(restesDuModele(demo)));
  const c = normaliser(JSON.parse(JSON.stringify(contenuLivre)));
  for (const t of Object.keys(BLOCS)) { c.blocs[t + "-9"] = nouveauBloc(t); c.pages.accueil.ordre.push(t + "-9"); }
  const ids = restesDuModele(c).map((r) => r.id).sort().join(",");
  verifier("une section neuve est signalée (sauf appel et contact, sans texte à remplacer)",
    ids === "accroche-9,avis-9,faq-9,galerie-9,horaires-9,presentation-9,prestations-9,texte-9", ids);
  const galerie = restesDuModele(c).find((r) => r.id === "galerie-9");
  verifier("la galerie neuve : des photos d'exemple, pas de texte", galerie && galerie.photo && !galerie.texte);
  c.blocs["horaires-9"].jours[1].heures = "8 h – 12 h";
  c.blocs["horaires-9"].adresse = "1 rue du Moulin";
  c.blocs["faq-9"].masque = true;
  const apres = restesDuModele(c).map((r) => r.id);
  verifier("des horaires retouchés ne sont plus signalés ; une section masquée non plus",
    !apres.includes("horaires-9") && !apres.includes("faq-9") && apres.includes("avis-9"));
  c.blocs["prestations-9"].elements.push({ titre: "Première prestation", texte: "Vrai texte", prix: "" });
  c.blocs["prestations-9"].elements.slice(0, 3).forEach((e) => { e.titre = "Vrai"; e.texte = "Vrai"; });
  verifier("une carte ajoutée depuis le modèle est signalée, où qu'elle soit dans la liste",
    restesDuModele(c).some((r) => r.id === "prestations-9"));
  verifier("contenu abîmé : aucune exception",
    restesDuModele(null).length === 0 && restesDuModele({ pages: { a: { ordre: ["x", { toString: 1 }] } }, blocs: { x: { type: "faq", questions: { toString: 1 } } } }).length === 0);
}

/* =========================================================
   Relecture contradictoire du 3 octobre 2026 — chantier « rendu »
   ========================================================= */

/* ----- Un avis ajouté naît SANS note (défauts 12 et 35) ----- */
{
  const modele = descripteurListe(demo, "blocs.avis-1.avis");
  verifier("avis : le modèle d'un avis ajouté ne porte aucune note",
    !!modele && modele.modele.note === "" && nouveauBloc("avis").avis[0].note === "", JSON.stringify(modele && modele.modele));
  // L'avis tel que l'éditeur l'ajoute (copie du modèle), puis recopié.
  const c = copieDe(demo);
  const ajoute = Object.assign(modele.modele, { texte: "Bon pain, mais accueil un peu froid.", auteur: "Paul R." });
  c.blocs["avis-1"].avis.push(ajoute);
  const pub = rendrePage({ contenu: normaliser(c), client });
  const carte = (pub.match(/<li class="carte avis">(?:(?!<\/li>).)*Bon pain, mais accueil(?:(?!<\/li>).)*<\/li>/s) || [""])[0];
  verifier("avis : un avis ajouté puis recopié part en ligne sans étoiles inventées", carte !== "" && !carte.includes("★") && !carte.includes("Note :"), carte.slice(0, 160));
  verifier("avis : les notes déjà données restent affichées", (pub.match(/aria-label="Note : \d sur 5"/g) || []).length === 3);
}

/* ----- Un bouton sans lien se signale en édition (défaut 16) ----- */
{
  const c = copieDe(demo);
  c.blocs["appel-2"] = nouveauBloc("appel");
  c.pages.accueil.ordre.push("appel-2");
  c.entete.bouton.vers = "";
  c.entete.liens[0].vers = "#";            // une ancre seule ne mène nulle part
  c.pied.liens[1].vers = "";
  c.blocs["horaires-1"].lienPlan = "http://plan.example/";   // pas https : absent du site
  const n = normaliser(c);
  const edi = rendreCorps({ contenu: n, client, edition: true });
  const pub = rendreCorps({ contenu: n, client });
  const balise = (html, attribut) => (html.match(new RegExp("<a [^>]*" + attribut.replace(/\./g, "\\.") + '"[^>]*>')) || [""])[0];
  const marque = (attribut) => /\sdata-sans-lien[\s>]/.test(balise(edi, attribut));
  verifier("sans lien : le bouton d'une section neuve est marqué en édition", marque('data-edit="blocs.appel-2.bouton.texte'), balise(edi, 'data-edit="blocs.appel-2.bouton.texte'));
  verifier("sans lien : le bouton de l'en-tête, un lien du menu, un lien du pied, le plan sont marqués",
    marque('data-edit="entete.bouton.texte') && marque('data-edit="entete.liens.0.texte') && marque('data-edit="pied.liens.1.texte') &&
    marque('data-edit-dest="blocs.horaires-1.lienPlan'));
  verifier("sans lien : un bouton qui a une destination n'est pas marqué",
    !marque('data-edit="blocs.appel-1.bouton.texte') && !marque('data-edit="entete.liens.1.texte') && !marque('data-edit="blocs.accroche-1.boutons.0.texte'));
  verifier("sans lien : sur le site, ni la marque ni les boutons sans lien",
    !pub.includes("data-sans-lien") && !pub.includes("Nous appeler") && !pub.includes("entete__bouton") && !pub.includes("Voir le plan"));
  verifier("sans lien : la marque est posée sur le <a> lui-même (les barres d'élément de l'accroche aussi)",
    (edi.match(/data-sans-lien/g) || []).length === (edi.match(/<a [^>]*data-sans-lien[^>]*>/g) || []).length);
}

/* ----- Le bouton de l'en-tête se masque par `masque`, pas en vidant son texte (défauts 17 et 9) ----- */
{
  const avec = (bouton) => { const c = copieDe(demo); c.entete.bouton = bouton; return normaliser(c); };
  const present = (bouton, edition) => rendreCorps({ contenu: avec(bouton), client, edition }).includes("entete__bouton");
  verifier("en-tête : masqué, le bouton n'est rendu ni sur le site ni en édition",
    !present({ texte: "Réserver votre kougelhopf", vers: "#contact", masque: true }, false) && !present({ texte: "Réserver votre kougelhopf", vers: "#contact", masque: true }, true));
  verifier("en-tête : masqué, son libellé reste dans le contenu",
    avec({ texte: "Réserver votre kougelhopf", vers: "#contact", masque: true }).entete.bouton.texte === "Réserver votre kougelhopf");
  verifier("en-tête : non masqué, sur le site il lui faut un texte ET une destination",
    present({ texte: "Commander", vers: "#contact" }, false) && !present({ texte: "", vers: "#contact" }, false) && !present({ texte: "Commander", vers: "" }, false));
  verifier("en-tête : non masqué, en édition il reste cliquable même vide ou sans lien",
    present({ texte: "", vers: "#contact" }, true) && present({ texte: "Commander", vers: "" }, true));
  const brut = { entete: { bouton: { texte: "A", vers: "#a", masque: "true" } } };
  const fige = JSON.stringify(brut);
  const douteux = [{ masque: "true" }, { masque: 1 }, { masque: false }, { masque: { toString: 1 } }, { masque: null }]
    .map((x) => normaliser({ entete: { bouton: Object.assign({ texte: "A", vers: "#a" }, x) } }).entete.bouton);
  verifier("en-tête : normaliser ne garde masque que s'il vaut true",
    douteux.every((b) => !Object.hasOwn(b, "masque") && b.texte === "A") && normaliser({ entete: { bouton: { texte: "A", masque: true } } }).entete.bouton.masque === true &&
    present({ texte: "A", vers: "#a", masque: "true" }, false));
  normaliser(brut);
  verifier("en-tête : normaliser ne touche pas au contenu reçu", JSON.stringify(brut) === fige);
  const piege = normaliser(JSON.parse('{"entete":{"__proto__":{"liens":[{"texte":"Volé","vers":"#v"}]},"bouton":{"texte":"A","vers":"#a","masque":0}}}'));
  verifier("en-tête : une clé « __proto__ » reste une donnée dans la copie",
    Object.getPrototypeOf(piege.entete) === Object.prototype && piege.entete.liens === undefined && !rendreCorps({ contenu: piege, client: {} }).includes("Volé"));
  const une = avec({ texte: "A", vers: "#a", masque: true });
  verifier("en-tête : normaliser deux fois ne change rien", JSON.stringify(normaliser(copieDe(une))) === JSON.stringify(une));
}

/* ----- Un lien « #ancre » écrit dans le texte du pied vise l'accueil (défaut 36) ----- */
{
  const c = copieDe(contenuLivre);
  c.pied.texte = 'Venez nous voir : <a href="#horaires">nos horaires</a>, <a href="/tarifs">nos tarifs</a>, <a href="https://carte.example/?a=1&amp;b=2">le plan</a>.';
  c.pages.tarifs = { titre: "Tarifs", ordre: [] };
  const n = normaliser(c);
  const pied = (html) => (html.match(/<p class="pied__texte"[^>]*>.*?<\/p>/s) || [""])[0];
  const surTarifs = pied(rendrePage({ contenu: n, client, pageId: "tarifs" }));
  const surAccueil = pied(rendrePage({ contenu: n, client }));
  verifier("pied : hors de l'accueil, « #horaires » écrit dans le texte devient « /#horaires »",
    surTarifs.includes('href="/#horaires"') && !surTarifs.includes('href="#horaires"'), surTarifs);
  verifier("pied : sur l'accueil, l'ancre reste telle quelle", surAccueil.includes('href="#horaires"') && !surAccueil.includes('href="/#horaires"'));
  verifier("pied : les autres liens du texte ne changent pas",
    surTarifs.includes('href="/tarifs"') && surTarifs.includes('href="https://carte.example/?a=1&amp;b=2" target="_blank" rel="noopener"'));
  const introuvable = await appeler("/n-existe-pas", { publie: c });
  verifier("pied : la page introuvable aussi", pied(introuvable.corps).includes('href="/#horaires"'), pied(introuvable.corps));
  // En édition, le texte est relu dans la page pour être enregistré : il
  // doit rester celui que l'éditrice a écrit.
  verifier("pied : en édition, le texte garde la forme enregistrée",
    pied(rendrePage({ contenu: n, client, pageId: "tarifs", edition: true })).includes('href="#horaires"'));
  verifier("texte riche : la réécriture d'un lien ne fait jamais entrer une adresse refusée",
    texteRiche('<a href="#x">a</a>', { lien: () => "javascript:alert(1)" }) === "a" && texteRiche('<a href="#x">a</a>', { lien: (v) => "/" + v }) === '<a href="/#x">a</a>');
}

/* ----- Le lien du téléphone en temps linéaire (défaut 37) ----- */
{
  const cas = [
    ["+33 (0)3 89 12 34 56", "tel:+33389123456"], ["03 89 12 34 56 / 06 12 34 56 78", "tel:0389123456"],
    ["03 89 12 34 56 ou 06 12 34 56 78", "tel:0389123456"], ["03.89.12.34.56, poste 2", "tel:0389123456"],
    ["03 89 12 34 56;06 12 34 56 78", "tel:0389123456"], ["  03 89 12 34 56  ", "tel:0389123456"],
    ["+41 61 123 45 67", "tel:+41611234567"], ["(03) 89-12-34-56", "tel:0389123456"], ["Ou 03 89 12 34 56", ""],
    [42, ""], [{ toString: 1 }, ""], ["0389123456" + " ".repeat(300), "tel:0389123456"], ["0389123456" + " ".repeat(150) + "/ x", "tel:0389123456"],
    ["0389123456" + " 1".repeat(150), ""], ["0389123456" + "0".repeat(300) + " / 06 12 34 56 78", ""]
  ];
  for (const [entree, attendu] of cas) verifier("téléphone " + JSON.stringify(entree).slice(0, 48), lienTelephone(entree) === attendu, lienTelephone(entree));
  const t0 = performance.now();
  for (const blanc of [" ", "\t", " "]) {
    lienTelephone(blanc.repeat(19990) + "x");
    lienTelephone("+" + blanc.repeat(19990) + "x");
  }
  const t1 = performance.now();
  verifier("téléphone : 20 000 blancs suivis de « x » ne coûtent rien", t1 - t0 < 20, Math.round(t1 - t0) + " ms");
  // La page entière, avec ce champ dans les horaires ET le contact.
  const c = copieDe(contenuLivre);
  c.blocs["horaires-1"].telephone = " ".repeat(19990) + "x";
  c.blocs["contact-1"].telephone = "\t".repeat(19990) + "x";
  const n = normaliser(c);
  const t2 = performance.now();
  rendrePage({ contenu: n, client });
  const t3 = performance.now();
  verifier("téléphone : une page qui porte deux de ces champs se rend en quelques millisecondes", t3 - t2 < 50, Math.round(t3 - t2) + " ms");
}

/* ----- Accroche « photo en fond » sans photo : le site dit ce que dit l'éditeur (défaut 40) ----- */
{
  const ctxPub = { edition: false, contenu: normaliser({}), client: {} };
  const ctxEd = { edition: true, contenu: normaliser({}), client: {} };
  const ouverture = (html) => (html.match(/<section [^>]*>/) || [""])[0];
  const b = Object.assign(nouveauBloc("accroche"), { disposition: "image-fond", fond: "sombre", image: "" });
  const fige = JSON.stringify(b);
  const pub = ouverture(rendreBloc("accroche-1", b, ctxPub));
  verifier("accroche sans photo : sur le site, côte à côte sur fond clair (le fond enregistré n'est pas réglable ici)",
    /\bbloc--clair\b/.test(pub) && /\baccroche--cote\b/.test(pub) && !/bloc--sombre/.test(pub), pub);
  verifier("accroche sans photo : l'éditeur ne propose pas de fond, et le site n'en emploie pas d'autre",
    !reglageActif(b, BLOCS.accroche.reglages.find((r) => r.cle === "fond")));
  // L'éditeur montre ce que montrera le site (contrôle du 3 octobre 2026),
  // avec le cadre de la photo à choisir, cliquable.
  const ed = rendreBloc("accroche-1", b, ctxEd);
  verifier("accroche sans photo : en édition, la même disposition que sur le site, avec la photo à choisir",
    /\baccroche--cote\b/.test(ouverture(ed)) && /\bbloc--clair\b/.test(ouverture(ed)) && ed.includes("image-attente") && ed.includes('data-edit-img="blocs.accroche-1.image"'));
  verifier("accroche sans photo : le contenu n'est pas touché", JSON.stringify(b) === fige);
  const avecPhoto = ouverture(rendreBloc("accroche-1", Object.assign({}, b, { image: "/illustrations/neutre.svg" }), ctxPub));
  verifier("accroche avec photo : en plein cadre sur le site", /\baccroche--pleine\b/.test(avecPhoto), avecPhoto);
  const cote = ouverture(rendreBloc("accroche-1", Object.assign({}, b, { disposition: "cote-a-cote" }), ctxPub));
  verifier("accroche côte à côte : son fond reste le sien", /\bbloc--sombre\b/.test(cote), cote);
}

/* ----- Les liens écrits dans un texte (défauts 6 et 38) ----- */
{
  const c = copieDe(demo);
  c.blocs["presentation-1"].texte = 'Découvrez <a href="#nos-pains">nos pains</a> et <a href="/tarifs#prix">les prix</a>.';
  c.pied.texte = 'Voir <a href="https://carte.example/?a=1&amp;b=2" target="_blank" rel="noopener">le plan</a>.';
  c.blocs["faq-1"].questions[0].reponse = '<a href="javascript:alert(1)">piège</a> <a>sans adresse</a> <a href="/contact">nous écrire</a>';
  c.blocs["appel-1"].bouton.vers = '<a href="/pas-un-texte">x</a>';       // une adresse, pas un texte : `cheminsVers` s'en charge
  c.blocs["Pas valide"] = { texte: '<a href="/ignore">x</a>' };
  const trouves = liensDansLesTextes(c).map((l) => l.chemin + " → " + l.vers);
  const attendus = [
    "pied.texte → https://carte.example/?a=1&b=2",
    "blocs.presentation-1.texte → #nos-pains", "blocs.presentation-1.texte → /tarifs#prix",
    "blocs.faq-1.questions.0.reponse → /contact"
  ];
  verifier("liensDansLesTextes : chaque lien affiché, avec son chemin et son adresse décodée", trouves.join(" | ") === attendus.join(" | "), trouves.join(" | "));
  verifier("liensDansLesTextes : la démo n'en a aucun", liensDansLesTextes(demo).length === 0);
  verifier("liensDansLesTextes : contenu abîmé → liste vide", [null, 42, "x", [], { blocs: { toString: 1 } }].every((x) => liensDansLesTextes(x).length === 0));

  // Les liens vus sont exactement ceux que le nettoyeur affiche.
  const textes = [
    c.blocs["presentation-1"].texte, c.pied.texte, c.blocs["faq-1"].questions[0].reponse,
    "<a href='/simple'>a</a> <A HREF=/majuscules>b</A> <a href=\"/1\" href=\"/2\">c</a> <abbr href=\"/non\">d</abbr> <a href=\"#a&amp;b\">e</a>"
  ];
  const ecarts = textes.filter((t) => {
    const vus = liensDansLesTextes({ pied: { texte: t } }).map((l) => l.vers);
    const affiches = [...texteRiche(t).matchAll(/<a href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
    return vus.join("|") !== affiches.join("|");
  });
  verifier("liensDansLesTextes : la même lecture que le nettoyeur", ecarts.length === 0, ecarts.join(" ;; "));

  const t = 'Découvrez <a href="#nos-pains">nos pains</a> et <a href="/tarifs#nos-pains">les prix</a>&nbsp;!<br><span data-police="romantique">fin</span>';
  verifier("reecrireLiensDansTexte : une ancre renommée, le reste octet pour octet",
    reecrireLiensDansTexte(t, (v) => v.replace(/#nos-pains$/, "#notre-pain")) ===
    'Découvrez <a href="#notre-pain">nos pains</a> et <a href="/tarifs#notre-pain">les prix</a>&nbsp;!<br><span data-police="romantique">fin</span>');
  const u = 'Voir <strong><a href="/tarifs">nos &amp; tarifs</a></strong> ou <a href="https://x.example/?a=1&amp;b=2" target="_blank" rel="noopener">ailleurs</a>.';
  const recus = [];
  verifier("reecrireLiensDansTexte : un lien vers une page supprimée redevient du texte simple",
    reecrireLiensDansTexte(u, (v) => { recus.push(v); return v === "/tarifs" ? "" : v; }) ===
    'Voir <strong>nos &amp; tarifs</strong> ou <a href="https://x.example/?a=1&amp;b=2" target="_blank" rel="noopener">ailleurs</a>.');
  verifier("reecrireLiensDansTexte : la fonction reçoit l'adresse décodée", recus.join(" ") === "/tarifs https://x.example/?a=1&b=2", recus.join(" "));
  verifier("reecrireLiensDansTexte : l'adresse nouvelle est réencodée",
    reecrireLiensDansTexte('<a href="/a">x</a>', () => '/b?x=1&y="2"') === '<a href="/b?x=1&amp;y=&quot;2&quot;">x</a>');
  verifier("reecrireLiensDansTexte : liens imbriqués, la bonne fermeture disparaît",
    reecrireLiensDansTexte('<a href="/a">x <a href="/b">y</a> z</a>!', (v) => (v === "/a" ? "" : v)) === 'x <a href="/b">y</a> z!' &&
    reecrireLiensDansTexte('<a href="/a">x <a href="/b">y</a> z</a>!', (v) => (v === "/b" ? "" : v)) === '<a href="/a">x y z</a>!');
  const inchanges = [u, "", "pas de lien", '<a href="javascript:x">j</a></a>', '<a href="/a">sans fermeture'];
  verifier("reecrireLiensDansTexte : rien à changer, rien de changé", inchanges.every((x) => reecrireLiensDansTexte(x, (v) => v) === x) &&
    reecrireLiensDansTexte('<a href="javascript:x">j</a>', () => "") === '<a href="javascript:x">j</a>' &&
    reecrireLiensDansTexte('<a href="/a">x</a>', () => undefined) === '<a href="/a">x</a>');
  verifier("reecrireLiensDansTexte : un lien sans fermeture se défait aussi", reecrireLiensDansTexte('a <a href="/a">b', () => "") === "a b");
  verifier("reecrireLiensDansTexte : une valeur qui n'est pas un texte est rendue telle quelle",
    [null, undefined, 42, { toString: 1 }].every((x) => reecrireLiensDansTexte(x, () => "") === x));
  // Le texte réécrit, repassé par le nettoyeur, ne change plus : c'est ce
  // que l'éditeur enregistre.
  const r = reecrireLiensDansTexte(u, (v) => (v === "/tarifs" ? "/nos-tarifs" : v));
  verifier("reecrireLiensDansTexte : un texte du nettoyeur reste un texte du nettoyeur", texteRiche(r) === r && r.includes('href="/nos-tarifs"'), r);
  const t0 = performance.now();
  reecrireLiensDansTexte('<a href="/a">x</a>'.repeat(1500) + "<a " + "x".repeat(15000), () => "");
  liensDansLesTextes({ pied: { texte: "<a href=\"".repeat(4000) } });
  verifier("liens des textes : pas de temps quadratique", performance.now() - t0 < 100, Math.round(performance.now() - t0) + " ms");
}

/* =========================================================
   Socle 0.3.0 — chantier « rendu » (3 octobre 2026)
   Bloc texte, page des mentions légales, données structurées pour
   Google, formulaire de contact.
   ========================================================= */
const figerTout = (v) => { if (v && typeof v === "object") { Object.freeze(v); Object.values(v).forEach(figerTout); } return v; };
const avecMentions = (c) => {
  const r = pageMentionsLegales(c);
  c.pages[r.pageId] = r.page;
  Object.assign(c.blocs, r.blocs);
  return r;
};
const PRESENTATION_LIB = { nom: "contactNom", email: "contactEmail", telephone: "contactTelephone", message: "contactMessage" };
const sansMentions = () => { const c = copieDe(contenuLivre); delete c.pages[PAGE_MENTIONS]; delete c.blocs["texte-1"]; return c; };

/* ----- Le bloc « texte » ----- */
{
  const def = BLOCS.texte;
  verifier("texte : le modèle de la spécification, tel quel",
    JSON.stringify(def.modele()) === JSON.stringify({ type: "texte", surtitre: "", titre: "Un titre", intro: "", paragraphes: [{ titre: "Un sous-titre", texte: "Un paragraphe de texte." }] }),
    JSON.stringify(def.modele()));
  verifier("texte : nom, phrase, réglages, liste et exemples de la spécification",
    def.nom === "Texte" &&
    def.description === "Un titre et des paragraphes, pour les pages d'information : mentions légales, conditions, engagements." &&
    def.reglages.length === 1 && def.reglages[0] === REGLAGE_FOND &&
    def.listes.paragraphes.libelle === "un paragraphe" && def.listes.paragraphes.max === 40 &&
    def.exemples.join() === "titre,paragraphes.*.titre,paragraphes.*.texte");

  const page = (paragraphes, avant = []) => normaliser({
    pages: { accueil: { ordre: avant.concat("texte-1") } },
    blocs: Object.assign({ "texte-1": { type: "texte", titre: "Conditions", paragraphes } }, ...avant.map((id) => ({ [id]: { type: "faq", titre: "Avant" } })))
  });
  const c = page([{ titre: "Premier", texte: "Un <b>texte</b><script>x</script>" }, { titre: "", texte: "Sans sous-titre" }, { titre: "", texte: "" }]);
  const pub = rendreCorps({ contenu: c, client: {} });
  const edi = rendreCorps({ contenu: c, client: {}, edition: true });
  verifier("texte : premier de la page, son titre est le <h1> et ses sous-titres des <h2>",
    nbH1(pub) === 1 && /<h1 class="titre-section">Conditions<\/h1>/.test(pub) && /<h2 class="texte__sous-titre">Premier<\/h2>/.test(pub) && !/<h3/.test(pub));
  const suivi = rendreCorps({ contenu: page([{ titre: "Premier", texte: "x" }], ["faq-1"]), client: {} });
  verifier("texte : après une autre section, titre en <h2> et sous-titres en <h3>",
    /<h2 class="titre-section">Conditions<\/h2>/.test(suivi) && /<h3 class="texte__sous-titre">Premier<\/h3>/.test(suivi));
  verifier("texte : dans une colonne étroite, chaque paragraphe dans un élément de liste, le texte riche nettoyé",
    pub.includes('<div class="conteneur conteneur--etroit">') && (pub.match(/<li class="texte__paragraphe">/g) || []).length === 2 &&
    pub.includes('<div class="texte-courant">Un <b>texte</b>x</div>') && !pub.includes("<script"));
  verifier("texte : un sous-titre vide disparaît sur le site, reste cliquable en édition",
    (pub.match(/texte__sous-titre/g) || []).length === 1 && edi.includes('data-edit="blocs.texte-1.paragraphes.1.titre" data-edit-riche>'));
  verifier("texte : un paragraphe tout vide n'est pas rendu sur le site, il l'est en édition",
    !pub.includes('data-index="2"') && edi.includes('data-liste="blocs.texte-1.paragraphes" data-index="2"'));
  verifier("texte : le paragraphe est du texte riche sur plusieurs lignes en édition",
    edi.includes('<div class="texte-courant" data-edit="blocs.texte-1.paragraphes.0.texte" data-edit-riche data-edit-lignes>'));
  const trou = rendreCorps({ contenu: page([null, { titre: "B", texte: "b" }]), client: {}, edition: true });
  verifier("texte : un élément abîmé est sauté sans décaler les indices",
    trou.includes('data-edit="blocs.texte-1.paragraphes.1.titre"') && !trou.includes("paragraphes.0."));
  /* Relecture du 3 octobre 2026 : une section Texte (ou Prestations) SANS
     titre, après une accroche. Sur le site, son titre vide disparaît, et
     ses sous-titres restaient en <h3> juste après le <h1> : un niveau
     sauté, et un lecteur d'écran les rangeait sous la section d'avant. */
  const niveaux = (html) => [...(html.match(/<main[\s\S]*<\/main>/) || [""])[0].matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
  const sauts = (html) => niveaux(html).filter((n, i, t) => i > 0 && n > t[i - 1] + 1).length;
  const sansTitre = (bloc, avant) => normaliser({
    site: { nom: "Essai" },
    pages: { accueil: { ordre: avant.concat("x-1") } },
    blocs: Object.assign({ "x-1": bloc }, ...avant.map((id) => ({ [id]: id === "accroche-1" ? { type: "accroche", titre: "Bienvenue" } : { type: "presentation", titre: "Notre histoire", texte: "x" } })))
  });
  const fautesNiveaux = [];
  for (const [genre, bloc] of [["texte", { type: "texte", titre: "", paragraphes: [{ titre: "Farines locales", texte: "x" }, { titre: "Zéro gaspillage", texte: "y" }] }],
    ["prestations", { type: "prestations", titre: "", elements: [{ titre: "Pain", texte: "x" }] }]]) {
    for (const avant of [["accroche-1"], ["accroche-1", "presentation-1"], []]) {
      for (const edition of [false, true]) {
        const html = rendrePage({ contenu: sansTitre(bloc, avant), client: {}, edition });
        if (sauts(html) || nbH1(html) !== 1) fautesNiveaux.push(genre + " après [" + avant.join(", ") + "]" + (edition ? " en édition" : "") + " : " + niveaux(html).join(" "));
      }
    }
    // Avec un titre, rien ne change : h2 puis h3.
    const titre = rendrePage({ contenu: sansTitre(Object.assign({}, bloc, { titre: "Engagements" }), ["accroche-1"]), client: {} });
    if (niveaux(titre).join() !== "1,2," + (genre === "texte" ? "3,3" : "3")) fautesNiveaux.push(genre + " avec titre : " + niveaux(titre).join(" "));
  }
  verifier("texte et prestations : jamais un niveau de titre sauté, avec ou sans titre de section, sur le site comme en édition",
    fautesNiveaux.length === 0, fautesNiveaux.join(" ; "));
  verifier("texte : sa feuille existe et ne pose aucune couleur (tout vient du contexte de la section)",
    !/color|background|#[0-9a-f]{3}/i.test(readFileSync(racine + "socle/public/css/blocs/texte.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "")));
}

/* ----- La page des mentions légales ----- */
{
  verifier("mentions : l'adresse « mentions-legales », qui n'est pas réservée", PAGE_MENTIONS === "mentions-legales" && !PAGES_RESERVEES.has(PAGE_MENTIONS));
  const base = sansMentions();
  const fige = figerTout(copieDe(base));
  const avant = JSON.stringify(fige);
  let r;
  try { r = pageMentionsLegales(fige); } catch (e) { r = null; }
  const libre = copieDe(base);
  pageMentionsLegales(libre);
  verifier("mentions : n'écrit rien dans le contenu reçu (figé, il ne lève pas ; libre, il reste intact)",
    !!r && JSON.stringify(fige) === avant && JSON.stringify(libre) === avant);
  verifier("mentions : { pageId, page, blocs }, la page et sa section texte",
    Object.keys(r).join() === "pageId,page,blocs" && r.pageId === "mentions-legales" &&
    r.page.titre === "Mentions légales" && r.page.description === "Qui édite ce site, qui l'héberge, et ce que deviennent vos données." &&
    r.page.ordre.length === 1 && r.page.ordre[0] === "texte-1" && Object.keys(r.blocs).join() === "texte-1" &&
    r.blocs["texte-1"].type === "texte" && r.blocs["texte-1"].titre === "Mentions légales");
  const p = r.blocs["texte-1"].paragraphes;
  /* Relecture du 3 octobre 2026 : la première version n'avait que cinq
     paragraphes, sans médiateur de la consommation ni identité légale ni
     TVA, demandait un numéro au « répertoire des métiers » (remplacé par
     le RNE depuis 2023), et son paragraphe « Données personnelles » ne
     disait ni base légale, ni destinataires, ni transfert, ni tous les
     droits (RGPD, article 13). Les contrôles la déclaraient conforme une
     fois ses trous remplis. */
  verifier("mentions : les six paragraphes, dans l'ordre (médiation comprise)",
    p.map((x) => x.titre).join(" | ") === "Éditeur du site | Responsable de la publication | Hébergement | Médiation de la consommation | Propriété intellectuelle | Données personnelles",
    p.map((x) => x.titre).join(" | "));
  verifier("mentions : le nom du site n'est qu'un nom commercial",
    p[0].texte.startsWith("Nom commercial : Au Pétrin d'Ernestine<br>") && !JSON.stringify(r).includes("nom de l'entreprise"));
  const editeur = texteBrut(p[0].texte);
  verifier("mentions : l'éditeur — identité et forme juridique, siège, SIREN, RNE ou RCS, TVA, téléphone et e-mail à compléter",
    editeur.includes("[À compléter : forme juridique, par exemple entreprise individuelle (EI) — dans ce cas, le nom et le prénom de l'entrepreneur —, micro-entreprise, EURL, SARL ou SAS au capital de … € — dans ce cas, la dénomination sociale]") &&
    editeur.includes("Adresse du siège : [À compléter]") && editeur.includes("SIREN ou SIRET : [À compléter]") &&
    editeur.includes("Immatriculation : [À compléter : Registre national des entreprises (RNE), et pour une société ou un commerçant « RCS de <ville> n° … »]") &&
    editeur.includes("TVA : [À compléter : numéro de TVA intracommunautaire FR…, ou « TVA non applicable, article 293 B du CGI »]") &&
    editeur.includes("Téléphone : [À compléter] — E-mail : [À compléter]"), editeur);
  verifier("mentions : plus aucun « répertoire des métiers » (remplacé par le RNE au 1er janvier 2023)",
    !/r[ée]pertoire des m[ée]tiers/i.test(texteBrut(JSON.stringify(r))));
  verifier("mentions : le responsable de la publication à compléter", p[1].texte === "[À compléter : prénom et nom]");
  verifier("mentions : l'hébergeur, vérifié le 3 octobre 2026",
    texteBrut(p[2].texte) === "Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, États-Unis. Téléphone : +1 888 993 5273. www.cloudflare.com", texteBrut(p[2].texte));
  // Chaque paragraphe cherché par son sous-titre : un modèle qui en
  // perdrait un échoue ici, il ne fait pas tomber le reste des tests.
  const par = (titre) => { const x = p.find((y) => y && y.titre === titre); return x && typeof x.texte === "string" ? x.texte : ""; };
  verifier("mentions : le médiateur de la consommation (Code de la consommation, L612-1), à compléter",
    par("Médiation de la consommation") === "Conformément à l'article L612-1 du Code de la consommation, vous pouvez recourir gratuitement à un médiateur de la consommation : " +
      "[À compléter : nom, adresse postale et site internet du médiateur].", par("Médiation de la consommation"));
  verifier("mentions : la propriété intellectuelle sans trou de plus", /appartiennent à son éditeur, sauf mention contraire/.test(par("Propriété intellectuelle")) && !contientUnTrou(par("Propriété intellectuelle")));
  const donnees = texteBrut(par("Données personnelles"));
  // Chaque information de l'article 13 du RGPD, et rien qu'on ne puisse
  // tenir : aucune certification précise du transfert n'est affirmée.
  const RGPD = ["responsable du traitement", "votre nom, votre adresse e-mail, votre téléphone si vous le donnez, et votre message",
    "uniquement à répondre à votre demande", "Base légale : les mesures précontractuelles prises à votre demande, ou notre intérêt légitime à vous répondre",
    "Cloudflare", "sous-traitant", "hors de l'Union européenne, avec les garanties prévues par le RGPD", "un an au plus sur le site",
    "accéder", "rectifier", "effacer", "vous opposer", "limitation", "portabilité", "écrivez à [À compléter : adresse e-mail]",
    "réclamation à la CNIL (www.cnil.fr)", "aucun cookie",
    "Les polices de caractères sont fournies par Google Fonts : pour les afficher, votre navigateur transmet votre adresse IP à Google."];
  const manquants = RGPD.filter((m) => !donnees.includes(m));
  verifier("mentions : données personnelles — tout ce que demande l'article 13 du RGPD, et la phrase sur Google Fonts",
    manquants.length === 0 && !/Privacy Framework|clauses contractuelles/i.test(donnees), manquants.join(" | ") || donnees);
  verifier("mentions : les « [À compléter …] » comptés — 10 avec le nom du site (forme, siège, SIREN, immatriculation, TVA, téléphone, e-mail, responsable, médiateur, adresse des droits)",
    compterTrous(r.blocs) === 10, String(compterTrous(r.blocs)));

  const sansNom = pageMentionsLegales({ blocs: { "texte-1": {}, "texte-2": {} } });
  verifier("mentions : sans nom de site, le trou du nom ; identifiant libre suivant",
    sansNom.blocs["texte-3"].paragraphes[0].texte.startsWith("Nom commercial : [À compléter : nom de l'entreprise]<br>") && sansNom.page.ordre[0] === "texte-3" &&
    compterTrous(sansNom.blocs) === 11);
  const piege = pageMentionsLegales({ site: { nom: "Pain & <Co>" }, blocs: {} });
  verifier("mentions : un nom avec « & » ou « < » entre échappé dans le texte riche",
    piege.blocs["texte-1"].paragraphes[0].texte.startsWith("Nom commercial : Pain &amp; &lt;Co&gt;<br>") &&
    texteRiche(piege.blocs["texte-1"].paragraphes[0].texte).startsWith("Nom commercial : Pain &amp; &lt;Co&gt;<br>"));
  verifier("mentions : l'adresse vit dans structure.js, modeles-pages.js la réexporte", PAGE_MENTIONS === PAGE_MENTIONS_STRUCTURE);
  const t = { toString: 1 };
  const levees = [null, undefined, 42, "x", [], t, { site: t, blocs: t }, { site: { nom: t }, blocs: [] }, { blocs: { "texte-1": null } }]
    .filter((x) => { try { return !pageMentionsLegales(x).blocs; } catch { return true; } });
  verifier("mentions : contenu abîmé — jamais d'exception", levees.length === 0, String(levees.length));
  const deux = pageMentionsLegales(base);
  deux.blocs["texte-1"].paragraphes[0].texte = "changé";
  verifier("mentions : deux appels, deux objets neufs", pageMentionsLegales(base).blocs["texte-1"].paragraphes[0].texte !== "changé");

  // Rangée dans un contenu, la page se rend, et l'éditeur signale ses trous.
  const c = sansMentions();
  avecMentions(c);
  const n = normaliser(c);
  const html = rendrePage({ contenu: n, client, pageId: PAGE_MENTIONS, chemin: "/mentions-legales" });
  verifier("mentions : la page se rend, un seul <h1> « Mentions légales », des <h2> pour les paragraphes",
    nbH1(html) === 1 && html.includes('<h1 class="titre-section">Mentions légales</h1>') && (html.match(/<h2 class="texte__sous-titre">/g) || []).length === 6 &&
    html.includes("<title>Mentions légales · Au Pétrin d&#39;Ernestine</title>"));
  const restes = restesDuModele(n);
  verifier("mentions : les « [À compléter » sont signalés avant de publier (texte, et aCompleter)",
    restes.length === 1 && restes[0].id === "texte-1" && restes[0].pageId === PAGE_MENTIONS && restes[0].texte === true && restes[0].photo === false && restes[0].aCompleter === true,
    JSON.stringify(restes));
  for (const para of n.blocs["texte-1"].paragraphes) {
    para.texte = para.texte.replace(/\[À compléter[^\]]*\]/g, "rempli");
  }
  verifier("mentions : une fois remplie, plus rien n'est signalé", restesDuModele(n).length === 0, JSON.stringify(restesDuModele(n)));
}

/* ----- Les trous « [À compléter » ----- */
{
  const avec = (bloc, masque) => normaliser({ pages: { accueil: { ordre: ["contact-1"] } }, blocs: { "contact-1": Object.assign({ type: "contact", titre: "Contact", masque }, bloc) } });
  const r = restesDuModele(avec({ telephone: "[À compléter]" }));
  verifier("trous : signalés même dans une section sans texte d'exemple (le contact)",
    r.length === 1 && r[0].id === "contact-1" && r[0].texte === true && r[0].aCompleter === true, JSON.stringify(r));
  verifier("trous : une section masquée n'est pas signalée", restesDuModele(avec({ telephone: "[À compléter]" }, true)).length === 0);
  verifier("trous : la casse, l'accent et l'espace insécable n'y changent rien",
    ["[à compléter]", "[A completer : x]", "[À&nbsp;compléter]", "[ À  compléter ]", "<b>[À compléter</b>]", "[&Agrave; compl&eacute;ter"].every((v) => contientUnTrou(v)) &&
    ["À compléter", "Liste à compléter", "Compléter", "", null, 42, { toString: 1 }].every((v) => !contientUnTrou(v)));
  verifier("trous : cherchés dans toute la profondeur d'une section", contientUnTrou({ a: [{ b: ["x", "SIRET : [À compléter]"] }] }));
  verifier("trous : la démo n'en a aucun, sa page de mentions comprise",
    !contientUnTrou(contenuLivre) && restesDuModele(normaliser(copieDe(contenuLivre))).length === 0);
}

/* ----- Le lien des mentions légales en bas de page ----- */
{
  const bas = (html) => (html.match(/<div class="conteneur pied__bas">.*?<\/div>/s) || [""])[0];
  const n = normaliser(copieDe(contenuLivre));
  const lien = '<a class="pied__mentions" href="/mentions-legales">Mentions légales</a>';
  verifier("pied : avec la page, « © année Nom · Mentions légales »",
    bas(rendrePage({ contenu: n, client })) === '<div class="conteneur pied__bas"><p>© ' + new Date().getFullYear() + " Au Pétrin d&#39;Ernestine · " + lien + "</p></div>",
    bas(rendrePage({ contenu: n, client })));
  verifier("pied : sur la page elle-même, le lien dit qu'on y est",
    bas(rendrePage({ contenu: n, client, pageId: PAGE_MENTIONS })).includes('<a class="pied__mentions" href="/mentions-legales" aria-current="page">'));
  verifier("pied : sans la page, pas de lien", !bas(rendrePage({ contenu: normaliser(sansMentions()), client })).includes("mentions"));
  const vide = copieDe(contenuLivre);
  vide.pied.liens = [];
  verifier("pied : ce n'est pas une entrée de la liste du pied — la vider ne le retire pas",
    bas(rendrePage({ contenu: normaliser(vide), client })).includes(lien) && !JSON.stringify(contenuLivre.pied).includes("mentions"));
  const libelle = copieDe(contenuLivre);
  libelle.libelles.mentionsLegales = "Infos <légales>";
  verifier("pied : son libellé se change (et s'échappe)", bas(rendrePage({ contenu: normaliser(libelle), client })).includes(">Infos &lt;légales&gt;</a>"));
  libelle.libelles.mentionsLegales = "   ";
  verifier("pied : un libellé vidé retombe sur « Mentions légales »", bas(rendrePage({ contenu: normaliser(libelle), client })).includes(lien));
  verifier("pied : en édition, on clique dessus pour le réécrire",
    bas(rendrePage({ contenu: n, client, edition: true })).includes('href="/mentions-legales" data-edit="libelles.mentionsLegales">Mentions légales</a>'));
  verifier("libellés : « Mentions légales » parmi les petits mots", LIBELLES.mentionsLegales === "Mentions légales");
  const page = await appeler("/mentions-legales");
  verifier("Worker : /mentions-legales répond 200, avec ses paragraphes et son lien en bas",
    page.statut === 200 && nbH1(page.corps) === 1 && page.corps.includes("000 000 000 00000") && bas(page.corps).includes("aria-current"));
  const introuvable = await appeler("/n-existe-pas");
  verifier("Worker : la page introuvable garde le lien des mentions", introuvable.statut === 404 && bas(introuvable.corps).includes(lien));

  /* Relecture du 3 octobre 2026 : masquer la section des mentions (pour
     faire taire l'avertissement des « [À compléter ») laissait le lien en
     bas de chaque page, vers une page qui n'affichait rien. Le lien suit
     désormais `mentionsPresentes` : la page doit avoir une section
     visible qui affiche du texte. */
  const varier = (f) => { const c = copieDe(contenuLivre); f(c); return c; };
  const notice = (c) => (rendreCorps({ contenu: normaliser(c), client }).match(/<p class="contact__notice">.*?<\/p>/s) || [""])[0];
  const sansLien = {
    "section masquée": varier((c) => { c.blocs["texte-1"].masque = true; }),
    "page sans section": varier((c) => { c.pages[PAGE_MENTIONS].ordre = []; }),
    "section vidée": varier((c) => { c.blocs["texte-1"] = { type: "texte", surtitre: "", titre: " ", intro: "<br>", paragraphes: [{ titre: "", texte: "" }] }; }),
    "section d'un genre inconnu": varier((c) => { c.blocs["texte-1"].type = "inconnu"; }),
    "section absente des blocs": varier((c) => { delete c.blocs["texte-1"]; }),
    "réglages et adresses seuls": varier((c) => { c.blocs["texte-1"] = { type: "accroche", image: "/medias/0123456789abcdef0123456789abcdef.jpg", imageAlt: "Une photo", fond: "sombre", boutons: [{ texte: "", vers: "/" }] }; })
  };
  const fautes = [];
  for (const [cas, c] of Object.entries(sansLien)) {
    if (mentionsPresentes(c) || mentionsPresentes(normaliser(c))) fautes.push(cas + " : mentionsPresentes vrai");
    if (bas(rendrePage({ contenu: normaliser(c), client })).includes("mentions")) fautes.push(cas + " : lien en bas de page");
    if (bas(rendrePage({ contenu: normaliser(c), client, edition: true })).includes("mentions")) fautes.push(cas + " : lien en bas de page, en édition");
    if (notice(c).includes("mentions-legales")) fautes.push(cas + " : lien dans la notice du formulaire");
  }
  verifier("pied : une page des mentions qui n'affiche rien n'a pas de lien — ni en bas de page, ni sous le formulaire", fautes.length === 0, fautes.join(" ; "));
  const deux = varier((c) => {
    c.blocs["texte-2"] = { type: "texte", titre: "", paragraphes: [{ titre: "", texte: "Une ligne." }] };
    c.pages[PAGE_MENTIONS].ordre.push("texte-2");
    c.blocs["texte-1"].masque = true;
  });
  verifier("pied : une autre section visible suffit, le lien revient",
    mentionsPresentes(deux) && bas(rendrePage({ contenu: normaliser(deux), client })).includes(lien) && notice(deux).includes('href="/mentions-legales"'));
  verifier("mentionsPresentes : la démo, et le modèle rangé tel quel",
    mentionsPresentes(contenuLivre) && mentionsPresentes(normaliser(copieDe(contenuLivre))) && !mentionsPresentes(sansMentions()) &&
    (() => { const c = sansMentions(); avecMentions(c); return mentionsPresentes(c); })());
  const t = { toString: 1 };
  const abimes = [null, undefined, 42, "x", [], t, { pages: t, blocs: t }, { pages: { [PAGE_MENTIONS]: t }, blocs: {} },
    { pages: { [PAGE_MENTIONS]: { ordre: t } }, blocs: {} }, { pages: { [PAGE_MENTIONS]: { ordre: [t, null, "constructor", "toString"] } }, blocs: {} },
    { pages: { [PAGE_MENTIONS]: { ordre: ["x"] } }, blocs: { x: { type: t, titre: "a" } } }, { pages: { [PAGE_MENTIONS]: { ordre: ["x"] } }, blocs: { x: { type: "texte", titre: t, masque: "true" } } }];
  const leve = abimes.filter((c) => { try { return mentionsPresentes(c) !== false; } catch { return true; } });
  verifier("mentionsPresentes : contenu abîmé — faux, jamais d'exception", leve.length === 0, String(leve.length));
}

/* ----- Les données structurées pour Google ----- */
{
  const n = normaliser(copieDe(contenuLivre));
  const attendu = {
    "@context": "https://schema.org", "@type": "Bakery", name: "Au Pétrin d'Ernestine",
    description: "Boulangerie artisanale : pain au levain naturel, farines d'Alsace, viennoiseries pur beurre et kougelhopf le week-end.",
    url: ORIGINE + "/", telephone: "01 99 00 12 34", email: "bonjour@example.com", address: "3 place de la Fontaine, Rieddorf",
    openingHoursSpecification: [
      ["Tuesday", "06:30", "13:00"], ["Tuesday", "15:30", "19:00"], ["Wednesday", "06:30", "13:00"], ["Wednesday", "15:30", "19:00"],
      ["Thursday", "06:30", "13:00"], ["Thursday", "15:30", "19:00"], ["Friday", "06:30", "13:00"], ["Friday", "15:30", "19:00"],
      ["Saturday", "06:00", "18:00"], ["Sunday", "06:30", "12:30"]
    ].map(([j, o, f]) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/" + j, opens: o, closes: f }))
  };
  const d = donneesStructurees(n, { client, origine: ORIGINE, pageId: "accueil" });
  // La démo se déclare boulangerie (`categorieGoogle` de sa fiche) : sans
  // ce champ, Google l'aurait lue comme une entreprise quelconque.
  verifier("Google : la démo — boulangerie, nom, description, adresse, téléphone, e-mail, horaires (le lundi fermé n'y est pas)",
    JSON.stringify(d) === JSON.stringify(attendu), JSON.stringify(d));
  verifier("Google : seulement sur l'accueil", donneesStructurees(n, { client, origine: ORIGINE, pageId: PAGE_MENTIONS }) === null &&
    donneesStructurees(n, { client, origine: ORIGINE, pageId: "introuvable" }) === null);
  const sans = donneesStructurees(n, { client, pageId: "accueil" });
  verifier("Google : sans origine, ni adresse du site ni photo", sans && !("url" in sans) && !("image" in sans) && sans.name === attendu.name);
  verifier("Google : la catégorie de la fiche, si elle est dans la liste fermée",
    donneesStructurees(n, { client: { categorieGoogle: "Bakery" } }) ["@type"] === "Bakery" &&
    ["Boulangerie", "bakery", "Thing", "constructor", { toString: 1 }, ["Bakery"], ""].every((cat) => donneesStructurees(n, { client: { categorieGoogle: cat } })["@type"] === "LocalBusiness") &&
    CATEGORIES_GOOGLE.length === 15 && CATEGORIES_GOOGLE.includes("HealthAndBeautyBusiness") && Object.isFrozen(CATEGORIES_GOOGLE));

  const varier = (f) => { const c = copieDe(contenuLivre); f(c); return donneesStructurees(normaliser(c), { client, origine: ORIGINE }) || {}; };
  const PHOTO = "/medias/0123456789abcdef0123456789abcdef.jpg";
  verifier("Google : la première photo visible, en adresse absolue, jamais un SVG",
    varier((c) => { c.blocs["galerie-1"].images[2].src = PHOTO; }).image === ORIGINE + PHOTO &&
    varier((c) => { c.blocs["galerie-1"].images[2].src = PHOTO; c.blocs["galerie-1"].masque = true; }).image === undefined &&
    varier((c) => { c.blocs["presentation-1"].image = "https://photos.example/a.webp"; }).image === "https://photos.example/a.webp" &&
    varier(() => {}).image === undefined);
  verifier("Google : la même photo que celle des liens partagés",
    rendrePage({ contenu: normaliser((() => { const c = copieDe(contenuLivre); c.blocs["galerie-1"].images[2].src = PHOTO; return c; })()), client, origine: ORIGINE })
      .includes('og:image" content="' + ORIGINE + PHOTO + '"'));
  verifier("Google : le téléphone des horaires d'abord, sinon celui du contact",
    varier((c) => { c.blocs["horaires-1"].telephone = ""; c.blocs["contact-1"].telephone = "03 89 00 00 00"; }).telephone === "03 89 00 00 00" &&
    varier((c) => { c.blocs["horaires-1"].masque = true; c.blocs["contact-1"].telephone = "03 89 00 00 00"; }).telephone === "03 89 00 00 00");
  verifier("Google : une section masquée ne donne ni adresse ni horaires",
    (() => { const x = varier((c) => { c.blocs["horaires-1"].masque = true; }); return !("address" in x) && !("openingHoursSpecification" in x); })());
  verifier("Google : l'adresse sur une ligne", varier((c) => { c.blocs["horaires-1"].adresse = "<b>3 place</b><br><br>67000 <i>Rieddorf</i><br>"; }).address === "3 place, 67000 Rieddorf");
  verifier("Google : un champ vide n'apparaît pas",
    (() => { const x = varier((c) => { c.site.description = ""; c.blocs["horaires-1"].email = ""; c.blocs["contact-1"].email = " "; c.blocs["horaires-1"].adresse = ""; }); return !("description" in x) && !("email" in x) && !("address" in x); })());
  verifier("Google : un texte encore « [À compléter » ne part pas",
    (() => { const x = varier((c) => { c.blocs["horaires-1"].adresse = "[À compléter]"; c.blocs["horaires-1"].telephone = "[À compléter]"; c.blocs["contact-1"].telephone = ""; }); return !("address" in x) && !("telephone" in x); })());
  verifier("Google : sans nom, rien du tout", varier((c) => { c.site.nom = ""; }).name === undefined);
  // Une section neuve : horaires et adresse INVENTÉS, jamais envoyés à Google.
  const neuf = normaliser({ site: { nom: "Neuf" }, pages: { accueil: { ordre: ["horaires-1"] } }, blocs: { "horaires-1": nouveauBloc("horaires") } });
  const dn = donneesStructurees(neuf, {});
  verifier("Google : les horaires et l'adresse d'exemple d'une section neuve ne partent pas",
    dn && !("openingHoursSpecification" in dn) && !("address" in dn), JSON.stringify(dn));
  neuf.blocs["horaires-1"].jours[0].heures = "8 h – 12 h";
  verifier("Google : retouchés, ils partent", (donneesStructurees(neuf, {}).openingHoursSpecification || []).length === 6);

  const cas = [
    ["9 h – 18 h", "09:00-18:00"], ["9h-18h", "09:00-18:00"], ["6 h 30 – 13 h · 15 h 30 – 19 h", "06:30-13:00 15:30-19:00"],
    ["9:00 - 12:00, 14:00 - 18:00", "09:00-12:00 14:00-18:00"], ["de 9 h à 18 h", "09:00-18:00"], ["9 h — 12 h et 14 h — 18 h", "09:00-12:00 14:00-18:00"],
    ["  9H30-12H ", "09:30-12:00"], ["18 h – 24 h", "18:00-23:59"], ["22 h – 2 h", "22:00-02:00"],
    ["Fermé", ""], ["fermée", ""], ["FERMÉ", ""]
  ];
  const refus = ["", "Sur rendez-vous", "9 h – midi", "9 h – 18 h, puis 20 h", "25 h – 18 h", "9 h 75 – 18 h", "9 h – 9 h", "9-18", "9 h – 18 h,",
    "24 h – 6 h", "9 h – 18 h (sauf jours fériés)", "Fermé le matin", null, 42, { toString: 1 }, "9 h – 18 h · ".repeat(20)];
  const lire = (v) => { const p = plagesHoraires(v); return p === null ? null : p.map((x) => x.opens + "-" + x.closes).join(" "); };
  const fautes = cas.filter(([v, a]) => lire(v) !== a).map(([v]) => v + " → " + lire(v))
    .concat(refus.filter((v) => lire(v) !== null).map((v) => JSON.stringify(v) + " → " + lire(v)));
  verifier("Google : les horaires qu'on sait lire, et ceux qu'on refuse en entier", fautes.length === 0, fautes.join(" ; "));
  const jours = (lignes) => (varier((c) => { c.blocs["horaires-1"].jours = lignes; }).openingHoursSpecification || []).map((s) => s.dayOfWeek.slice(19) + " " + s.opens);
  verifier("Google : jours sans casse ni accent ; une ligne vide ou abîmée ne compte pas",
    jours([{ jour: "LUNDI", heures: "9 h – 12 h" }, { jour: "Mércredi :", heures: "9 h – 12 h" }, { jour: "Samedi", heures: "Fermé" },
      null, { jour: { toString: 1 } }, { jour: "", heures: "" }, { jour: " ", heures: " " }]).join() === "Monday 09:00,Wednesday 09:00");
  /* TOUT OU RIEN (relecture du 3 octobre 2026). Une ligne illisible était
     sautée et les autres partaient : un jour absent se lit « fermé » chez
     Google, et la boulangerie ouverte du mardi au vendredi y paraissait
     fermée ces quatre jours. Une seule ligne illisible, et aucun horaire
     ne part. */
  const illisibles = {
    "une plage de jours": [{ jour: "Lundi", heures: "Fermé" }, { jour: "Du mardi au vendredi", heures: "6 h 30 – 13 h · 15 h 30 – 19 h" },
      { jour: "Samedi", heures: "6 h – 18 h" }, { jour: "Dimanche", heures: "6 h 30 – 12 h 30" }],
    "des heures illisibles un jour": [{ jour: "Lundi", heures: "9 h – 19 h" }, { jour: "Mardi", heures: "9 h – 19 h" }, { jour: "Mercredi", heures: "9 h – 19 h" },
      { jour: "Jeudi", heures: "9 h – 19 h" }, { jour: "Vendredi", heures: "9 h – 19 h 30 (nocturne)" }, { jour: "Samedi", heures: "9h-12h | 14h-18h" }, { jour: "Dimanche", heures: "Fermé" }],
    "des jours abrégés": [{ jour: "Mar.", heures: "8 h – 12 h" }, { jour: "Mer.", heures: "8 h – 12 h" }, { jour: "Sam", heures: "8 h – 12 h" }, { jour: "Dimanche", heures: "8 h – 12 h" }],
    "un jour sans heures": [{ jour: "Lundi", heures: "9 h – 12 h" }, { jour: "Mardi", heures: "" }],
    "des heures sans jour lisible": [{ jour: "Lundi", heures: "9 h – 12 h" }, { jour: "Mardi et jeudi", heures: "9 h – 12 h" }],
    // La ligne « de suite » de l'après-midi, sans jour : la sauter envoyait
    // « mardi 9 h – 12 h » seul — le mardi après-midi fermé chez Google
    // (contrôle du 3 octobre 2026).
    "des heures sans jour du tout (ligne de suite)": [{ jour: "Mardi", heures: "9 h – 12 h" }, { jour: "", heures: "14 h – 18 h" }, { jour: "Samedi", heures: "9 h – 12 h" }]
  };
  const partis = Object.entries(illisibles).filter(([, l]) => "openingHoursSpecification" in varier((c) => { c.blocs["horaires-1"].jours = l; })).map(([cas]) => cas);
  verifier("Google : une seule ligne illisible, et AUCUN horaire ne part (un jour absent se lit « fermé »)", partis.length === 0, partis.join(" ; "));
  verifier("Google : la démo garde ses dix plages", (d.openingHoursSpecification || []).length === 10);
  // Le contrôle qualité nomme la ligne fautive : sans elle, l'éditrice ne
  // saurait pas pourquoi Google ne reçoit rien.
  const noms = (l) => lignesHorairesIllisibles(l).map((x) => x.index + ":" + x.jour + "|" + x.heures).join(" ; ");
  verifier("Google : les lignes illisibles, nommées telles qu'elles s'affichent",
    noms(illisibles["une plage de jours"]) === "1:Du mardi au vendredi|6 h 30 – 13 h · 15 h 30 – 19 h" &&
    noms(illisibles["des heures illisibles un jour"]) === "4:Vendredi|9 h – 19 h 30 (nocturne) ; 5:Samedi|9h-12h | 14h-18h" &&
    noms(illisibles["des jours abrégés"]) === "0:Mar.|8 h – 12 h ; 1:Mer.|8 h – 12 h ; 2:Sam|8 h – 12 h" &&
    noms(illisibles["des heures sans jour du tout (ligne de suite)"]) === "1:|14 h – 18 h" &&
    noms(contenuLivre.blocs["horaires-1"].jours) === "" &&
    [null, undefined, 42, "x", { toString: 1 }, [null, { jour: { toString: 1 } }, { jour: "Lundi", heures: { toString: 1 } }]].every((v) => Array.isArray(lignesHorairesIllisibles(v))) &&
    noms([null, { jour: "Lundi", heures: { toString: 1 } }]) === "1:Lundi|",
    noms(illisibles["des heures illisibles un jour"]));

  const t = { toString: 1 };
  const abimes = [null, undefined, 42, "x", [], t, { site: t, pages: t, blocs: t }, { site: { nom: "A" }, pages: { accueil: { ordre: t } } },
    { site: { nom: "A" }, pages: { accueil: { ordre: ["h", "h", t, null, "constructor"] } }, blocs: { h: { type: "horaires", jours: t, adresse: t, telephone: t, masque: t } } },
    { site: { nom: "A", description: t }, pages: { accueil: { ordre: ["h"] } }, blocs: { h: { type: "horaires", jours: [t, null, { jour: "Lundi", heures: t }] } } }];
  const leve = abimes.filter((c) => { try { donneesStructurees(c, { client: t, origine: t, pageId: "accueil" }); return false; } catch { return true; } });
  verifier("Google : contenu abîmé — jamais d'exception", leve.length === 0, String(leve.length));

  // L'échappement : rien ne sort de la balise, et le JSON se relit à l'identique.
  const nom = 'Pain </script><script>alert(1)</script> & « Co » <!-- x';
  const c = copieDe(contenuLivre);
  c.site.nom = nom;
  const html = rendrePage({ contenu: normaliser(c), client, origine: ORIGINE });
  const balises = [...html.matchAll(JSON_LD)];
  verifier("Google : un nom piégé ne sort pas de la balise (« < », « > », « & », U+2028 et U+2029 échappés)",
    balises.length === 1 && !/[<>&\u2028\u2029]/.test(balises[0][1]) && JSON.parse(balises[0][1]).name === texteBrut(nom) && /[<&]/.test(texteBrut(nom)) &&
    !/<script/i.test(sansDonneesStructurees(html)), balises.length ? balises[0][1].slice(0, 120) : "aucune balise");
  verifier("Google : jsonLdSur et la balise", jsonLdSur({ a: "<&>" }) === '{"a":"\\u003c\\u0026\\u003e"}' &&
    jsonLdSur({ a: "\u2028\u2029" }) === '{"a":"\\u2028\\u2029"}' && JSON.parse(jsonLdSur({ a: "<\u2028>" })).a === "<\u2028>" &&
    baliseDonneesStructurees({ a: 1 }) === '<script type="application/ld+json">{"a":1}</script>' && baliseDonneesStructurees(null) === "");
  verifier("Google : rien hors de l'accueil, rien en édition",
    donneesDe(rendrePage({ contenu: n, client, origine: ORIGINE, pageId: PAGE_MENTIONS })).length === 0 &&
    donneesDe(rendrePage({ contenu: n, client, origine: ORIGINE, edition: true })).length === 0 &&
    donneesDe(rendrePage({ contenu: n, client, origine: ORIGINE })).length === 1);
  const accueil = await appeler("/");
  verifier("Google : la politique de contenu n'a pas bougé (aucun script en ligne permis)",
    /(^|;\s*)script-src 'self'(;|$)/.test(accueil.entetes.get("content-security-policy") || ""), accueil.entetes.get("content-security-policy"));
}

/* ----- Le formulaire : une seule règle (formulaire.js) ----- */
{
  verifier("formulaire : les quatre champs, dans l'ordre", CHAMPS_CONTACT.join() === "nom,email,telephone,message" && Object.isFrozen(CHAMPS_CONTACT) && CHAMP_PIEGE === "site_web");
  verifier("formulaire : les messages d'erreur de la spécification, figés dans le code",
    JSON.stringify(ERREURS_CONTACT) === JSON.stringify({
      nom: "Indiquez votre nom.",
      email: "Indiquez une adresse e-mail complète, par exemple nom@exemple.fr.",
      telephone: "Ce numéro de téléphone ne semble pas valide.",
      message: "Écrivez votre message (10 caractères au moins).",
      limite: "Trop de messages sont partis d'ici récemment. Réessayez plus tard, ou appelez-nous.",
      indisponible: "Votre message n'a pas pu partir. Réessayez dans quelques minutes, ou appelez-nous."
    }) && Object.isFrozen(ERREURS_CONTACT));
  verifier("formulaire : les bornes de la spécification",
    REGLES_CONTACT.nom.max === 100 && REGLES_CONTACT.email.max === 254 && REGLES_CONTACT.telephone.max === 30 && !REGLES_CONTACT.telephone.requis &&
    REGLES_CONTACT.message.min === 10 && REGLES_CONTACT.message.max === 4000);
  const bon = { nom: "  Jeanne   Martin ", email: " jeanne@exemple.fr ", telephone: " 03 89 12 34 56 ", message: "\r\n Bonjour,\r\nUne couronne pour dimanche ?  \r\n" };
  const v = validerMessage(bon);
  verifier("formulaire : un message correct, nettoyé",
    v.ok === true && Object.keys(v.erreurs).length === 0 && v.valeurs.nom === "Jeanne Martin" && v.valeurs.email === "jeanne@exemple.fr" &&
    v.valeurs.telephone === "03 89 12 34 56" && v.valeurs.message === "Bonjour,\nUne couronne pour dimanche ?" && Object.keys(v.valeurs).join() === "nom,email,telephone,message",
    JSON.stringify(v));
  const erreur = (champ, valeur) => validerMessage(Object.assign({}, bon, { [champ]: valeur })).erreurs[champ];
  const fautes = [];
  for (const [champ, valeur, attendu] of [
    ["nom", "", true], ["nom", "   ", true], ["nom", "x".repeat(100), false], ["nom", "x".repeat(101), true], ["nom", "Zoé", false],
    ["email", "", true], ["email", "jeanne", true], ["email", "jeanne@", true], ["email", "@exemple.fr", true], ["email", "jean ne@exemple.fr", true],
    ["email", "jeanne@exemple", true], ["email", "jeanne@exemple.fr\r\nBcc: x@y.fr", true], ["email", "a".repeat(245) + "@exemple.fr", true],
    ["email", "Jeanne.Martin+pain@sous.domaine.fr", false], ["email", "a".repeat(64) + "@" + "b".repeat(63) + ".fr", false],
    ["telephone", "", false], ["telephone", "+33 (0)3 89 12 34 56", false], ["telephone", "06.12.34.56.78", false], ["telephone", "abc", true],
    ["telephone", "+", true], ["telephone", "12 34", true], ["telephone", "0".repeat(31), true], ["telephone", "03 89 12 34 56 poste 2", true],
    ["message", "123456789", true], ["message", "1234567890", false], ["message", "  123456789  ", true], ["message", "x".repeat(4000), false],
    ["message", "x".repeat(4001), true], ["message", "1234\r\n6789", true], ["message", "x".repeat(3999) + "\r\n", false]
  ]) {
    const e = erreur(champ, valeur);
    if (!!e !== attendu || (e && e !== ERREURS_CONTACT[champ])) fautes.push(champ + " " + JSON.stringify(valeur).slice(0, 30) + " → " + (e || "accepté"));
  }
  verifier("formulaire : chaque borne, accepté ou refusé avec son message", fautes.length === 0, fautes.join(" ; "));
  const ctl = validerMessage(Object.assign({}, bon, { nom: "Jeanne\u0000\nMartin\u2028", message: "Ligne 1\u0007\nLigne\t2\u2028Ligne 3" }));
  verifier("formulaire : les caractères de contrôle disparaissent, un nom tient sur une ligne, le message garde ses lignes",
    ctl.valeurs.nom === "Jeanne Martin" && ctl.valeurs.message === "Ligne 1\nLigne 2\nLigne 3", JSON.stringify(ctl.valeurs));
  const t = { toString: 1 };
  const abimes = [null, undefined, 42, "x", [], t, { nom: t, email: [1], telephone: {}, message: 12345678901 }, JSON.parse('{"__proto__":{"nom":"Volé","email":"a@b.fr","message":"0123456789"}}'),
    { get: () => { throw new Error("x"); } }];
  const leve = abimes.filter((x) => { try { const r = validerMessage(x); return !r || r.ok || typeof r.valeurs.nom !== "string"; } catch { return true; } });
  verifier("formulaire : n'importe quoi reçu → des erreurs, jamais une exception, jamais rien lu du prototype", leve.length === 0, String(leve.length));
  const params = new URLSearchParams("nom=Jeanne&email=jeanne%40exemple.fr&message=Bonjour%20%C3%A0%20vous%20!&site_web=&page=accueil&bloc=contact-1&autre=x");
  const p = validerMessage(params);
  verifier("formulaire : lit aussi un formulaire reçu tel quel (URLSearchParams), et seulement ses quatre champs",
    p.ok && p.valeurs.nom === "Jeanne" && p.valeurs.message === "Bonjour à vous !" && p.valeurs.telephone === "" && Object.keys(p.valeurs).length === 4);
}

/* ----- Le formulaire dans la section contact ----- */
{
  const reglage = BLOCS.contact.reglages.find((r) => r.cle === "formulaire");
  verifier("contact : la case « Afficher un formulaire de contact », décochée à la naissance",
    !!reglage && reglage.type === "case" && reglage.libelle === "Afficher un formulaire de contact" && nouveauBloc("contact").formulaire === false);
  const avec = (formulaire, f) => { const c = copieDe(contenuLivre); c.blocs["contact-1"].formulaire = formulaire; if (f) f(c); return normaliser(c); };
  const section = (html, id = "contact-1") => {
    const debut = html.indexOf('data-bloc="' + id + '"');
    return debut < 0 ? "" : html.slice(html.lastIndexOf("<section", debut), html.indexOf("</section>", debut) + 10);
  };
  const corps = (contenu, opts = {}) => section(rendreCorps(Object.assign({ contenu, client }, opts)));
  verifier("contact : sans un vrai true, pas de formulaire (la section d'avant, à l'identique)",
    [false, "true", 1, undefined].every((f) => !corps(avec(f)).includes("<form")) && corps(avec(true)).includes("<form") &&
    corps(avec(false)).includes('<div class="conteneur contact__grille"><div class="contact__texte">'));
  const s = corps(avec(true));
  verifier("contact : un vrai formulaire, envoyé à /contact, qui revient à la section",
    s.includes('<form class="contact__formulaire" method="post" action="/contact#contact">') &&
    s.includes('<input type="hidden" name="page" value="accueil">') && s.includes('<input type="hidden" name="bloc" value="contact-1">'));
  const champs = [...s.matchAll(/<(input|textarea) class="contact__saisie"([^>]*)>/g)].map((m) => m[1] + m[2]);
  const attendus = {
    nom: ['type="text"', "required", 'maxlength="100"', 'autocomplete="name"'],
    email: ['type="email"', "required", 'maxlength="254"', 'autocomplete="email"'],
    telephone: ['type="tel"', 'maxlength="30"', 'autocomplete="tel"'],
    message: ["textarea", "required", 'minlength="10"', 'maxlength="4000"']
  };
  verifier("contact : quatre champs, chacun avec son libellé, ses bornes et son type",
    champs.length === 4 && CHAMPS_CONTACT.every((n, i) => champs[i].includes('name="' + n + '"') && attendus[n].every((a) => champs[i].includes(a)) &&
      s.includes('<label class="contact__libelle" for="formulaire-contact-1-' + n + '"><span>' + LIBELLES[PRESENTATION_LIB[n]] + "</span></label>") &&
      champs[i].includes('id="formulaire-contact-1-' + n + '"')) &&
    !/telephone"[^>]*required/.test(s) && !s.includes("aria-invalid") && !s.includes("disabled"), champs.join(" | "));
  /* Le navigateur arrête ce que le serveur refuserait (relecture du
     3 octobre 2026) : « 06/12/34/56/78 » ou « jeanne@exemple » partaient
     et revenaient refusés. Chaque `pattern` écrit dans la page doit
     compiler avec le drapeau `v` des navigateurs récents (sinon il est
     ignoré sans un mot) ET avec `u`, et accepter exactement ce
     qu'accepte `validerMessage`. Le contrôle propre à `type="email"`
     (WHATWG) s'ajoute à celui de l'e-mail : c'est ce que fait le
     navigateur. */
  const motifs = Object.fromEntries([...s.matchAll(/<input class="contact__saisie"[^>]*name="([a-z]+)"[^>]*pattern="([^"]+)"/g)].map((m) => [m[1], m[2].replace(/&amp;/g, "&")]));
  const compiles = {};
  const invalides = [];
  for (const [nm, motif] of Object.entries(motifs)) {
    for (const f of ["v", "u"]) {
      try { const r = new RegExp("^(?:" + motif + ")$", f); if (f === "v") compiles[nm] = r; } catch (e) { invalides.push(nm + " (" + f + ") : " + e.message); }
    }
  }
  verifier("contact : un motif sur le nom, l'e-mail et le téléphone (aucun sur le message), valide en mode v comme en mode u",
    Object.keys(motifs).join() === "nom,email,telephone" && invalides.length === 0 &&
    motifs.nom === MOTIF_NOM && motifs.email === MOTIF_EMAIL && motifs.telephone === MOTIF_TELEPHONE && !/<textarea[^>]*pattern/.test(s),
    invalides.join(" ; ") || JSON.stringify(motifs));
  const WHATWG = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  const navigateur = {
    // Un champ vide n'est jamais confronté à son motif : `required` décide.
    nom: (v) => v !== "" && v.length <= 100 && (!compiles.nom || compiles.nom.test(v)),
    email: (v) => { const x = v.trim(); return x !== "" && x.length <= 254 && WHATWG.test(x) && (!compiles.email || compiles.email.test(x)); },
    telephone: (v) => v === "" || (v.length <= 30 && (!compiles.telephone || compiles.telephone.test(v)))
  };
  const saisies = {
    nom: ["Jeanne", "Zoé Martin", "   ", " ", "\u0007", "x".repeat(100), " Jeanne "],
    email: ["jeanne@exemple.fr", "jeanne@exemple", "jeanne@", "@exemple.fr", "Jeanne.Martin+pain@sous.domaine.fr", "jean ne@exemple.fr",
      "jeanne@-exemple.fr", "jeanne@exemple..fr", "jeanne@exemple.fr.", "a@b.c", "a@b@c.fr", "jeanne@ex_emple.fr"],
    telephone: ["", "03 89 12 34 56", "+33 (0)3 89 12 34 56", "06.12.34.56.78", "06-12-34-56-78", "06/12/34/56/78", "06 12 34 56 78 (après 18 h)",
      "abc", "+", "12 34", "123456", "12345", "((((((1))))))", "0".repeat(30), "03 89 12 34 56 poste 2", "+ 3 3 3 8 9 1"]
  };
  const ecarts = [];
  for (const [nm, liste] of Object.entries(saisies)) {
    for (const v of liste) {
      const serveur = !validerMessage(Object.assign({ nom: "Jeanne", email: "jeanne@exemple.fr", telephone: "", message: "Bonjour, une question." }, { [nm]: v })).erreurs[nm];
      if (navigateur[nm](v) !== serveur) ecarts.push(nm + " " + JSON.stringify(v) + " : navigateur " + (navigateur[nm](v) ? "accepte" : "refuse") + ", serveur " + (serveur ? "accepte" : "refuse"));
    }
  }
  verifier("contact : le navigateur accepte exactement ce qu'accepte le serveur (nom, e-mail, téléphone)", ecarts.length === 0, ecarts.join(" ; "));
  verifier("formulaire : le motif du téléphone est la règle même du serveur",
    validerMessage({ nom: "J", email: "j@e.fr", message: "0123456789", telephone: "06/12/34/56/78" }).erreurs.telephone === ERREURS_CONTACT.telephone &&
    !validerMessage({ nom: "J", email: "j@e.fr", message: "0123456789", telephone: "+33 (0)6 12.34-56 78" }).erreurs.telephone);
  verifier("contact : le piège à robots, caché, hors du clavier, sans remplissage automatique",
    /<div class="contact__piege" aria-hidden="true"><label for="formulaire-contact-1-site-web">[^<]+<\/label><input type="text" id="formulaire-contact-1-site-web" name="site_web" value="" tabindex="-1" autocomplete="off"><\/div>/.test(s) &&
    /\.contact__piege\s*\{[^}]*left:\s*-10000px/.test(readFileSync(racine + "socle/public/css/blocs/contact.css", "utf8")));
  verifier("contact : le bouton, puis la notice avec le lien des mentions légales",
    s.includes('<button class="bouton bouton--plein contact__bouton" type="submit">Envoyer</button>') &&
    s.includes('<p class="contact__notice"><span>' + LIBELLES.contactNotice + '</span> <a href="/mentions-legales">Mentions légales</a></p>'));
  verifier("contact : sans la page des mentions, la notice seule",
    corps(avec(true, (c) => { delete c.pages[PAGE_MENTIONS]; delete c.blocs["texte-1"]; })).includes('<p class="contact__notice"><span>' + LIBELLES.contactNotice + "</span></p>"));
  verifier("contact : les libellés se changent", corps(avec(true, (c) => { c.libelles.contactNom = "Votre prénom"; c.libelles.contactEnvoyer = "C'est parti"; }))
    .includes("<span>Votre prénom</span>") && corps(avec(true, (c) => { c.libelles.contactEnvoyer = "C'est parti"; })).includes(">C&#39;est parti</button>"));
  verifier("contact : les libellés de la spécification",
    LIBELLES.contactNom === "Votre nom" && LIBELLES.contactEmail === "Votre adresse e-mail" && LIBELLES.contactTelephone === "Votre téléphone (facultatif)" &&
    LIBELLES.contactMessage === "Votre message" && LIBELLES.contactEnvoyer === "Envoyer" &&
    LIBELLES.contactMerci === "Merci, votre message est bien parti. Nous vous répondons au plus vite." &&
    LIBELLES.contactNotice === "Vos coordonnées servent uniquement à répondre à votre message.");
  // La notice ne promet que ce que le site tient : « gardées un an au
  // plus », écrit sous le bouton, ne l'était pas sur un site calme
  // (relecture du 3 octobre 2026). La durée vit dans les mentions légales.
  verifier("contact : la notice ne promet aucune durée de garde", !/un an|gard/i.test(LIBELLES.contactNotice));
  verifier("contact : en dehors de l'accueil, la page d'où l'on écrit",
    rendreCorps({ contenu: avec(true, (c) => { c.pages.tarifs = { titre: "Tarifs", ordre: ["contact-1"] }; }), client, pageId: "tarifs" }).includes('<input type="hidden" name="page" value="tarifs">'));

  // Un envoi refusé : ce qui avait été écrit revient, chaque erreur à sa place.
  const saisi = { nom: "Jeanne", email: "jeanne@", telephone: "", message: '<i>"</i>' };
  const bon = () => ({ nom: "Jeanne", email: "jeanne@exemple.fr", telephone: "", message: "Bonjour, une question." });
  const refus = validerMessage(saisi);
  const n = avec(true);
  const err = section(rendrePage({ contenu: n, client, formulaire: { bloc: "contact-1", etat: "erreur", valeurs: refus.valeurs, erreurs: refus.erreurs } }));
  verifier("contact, erreur : les valeurs saisies reviennent, échappées",
    /name="nom" required maxlength="100" pattern="[^"]+" autocomplete="name" value="Jeanne">/.test(err) && err.includes('value="jeanne@"') &&
    err.includes(">\n&lt;i&gt;&quot;&lt;/i&gt;</textarea>") && !/<i>/.test(err), err.slice(0, 300));
  verifier("contact, erreur : seuls les champs fautifs sont marqués, et leur message y est relié",
    /id="formulaire-contact-1-email"[^>]* aria-invalid="true" aria-describedby="formulaire-contact-1-email-erreur"/.test(err) &&
    err.includes('<p class="contact__erreur" id="formulaire-contact-1-email-erreur">' + echapper(ERREURS_CONTACT.email) + "</p>") &&
    /id="formulaire-contact-1-message"[^>]* aria-invalid="true"/.test(err) && !/id="formulaire-contact-1-nom"[^>]*aria-invalid/.test(err) &&
    (err.match(/aria-invalid/g) || []).length === 2);
  const ids = [...err.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  verifier("contact, erreur : chaque aria-describedby vise un élément qui existe, les identifiants sont uniques",
    [...err.matchAll(/aria-describedby="([^"]+)"/g)].every((m) => ids.includes(m[1])) && ids.length === new Set(ids).size);
  verifier("contact, erreur : un résumé en tête (role=alert), qui mène à chaque champ",
    /<form [^>]*><div class="contact__alerte" role="alert"><p>Votre message n&#39;est pas encore parti :<\/p><ul role="list"><li><a href="#formulaire-contact-1-email">/.test(err) &&
    err.includes('<a href="#formulaire-contact-1-message">' + echapper(ERREURS_CONTACT.message) + "</a>"));
  const general = (erreurs) => section(rendrePage({ contenu: n, client, formulaire: { bloc: "contact-1", etat: "erreur", valeurs: bon(), erreurs } }));
  verifier("contact, erreur : trop d'envois ou service en panne, dit en tête, sans marquer de champ",
    general({ limite: ERREURS_CONTACT.limite }).includes('<div class="contact__alerte" role="alert"><p>' + echapper(ERREURS_CONTACT.limite) + "</p></div>") &&
    general({ indisponible: "texte ignoré : celui du code fait foi" }).includes("<p>" + echapper(ERREURS_CONTACT.indisponible) + "</p>") &&
    !general({ limite: ERREURS_CONTACT.limite }).includes("aria-invalid") && general({ limite: 1 }).includes('value="Jeanne"'));
  verifier("contact, erreur : sans message, il dit quand même que rien n'est parti ; un message inconnu est échappé",
    general({}).includes(echapper(ERREURS_CONTACT.indisponible)) && general(null).includes(echapper(ERREURS_CONTACT.indisponible)) &&
    general({ autre: "<b>x</b>" }).includes("<p>&lt;b&gt;x&lt;/b&gt;</p>"));
  // Envoyé : le remerciement à la place du formulaire.
  const envoye = section(rendrePage({ contenu: n, client, formulaire: { bloc: "contact-1", etat: "envoye" } }));
  verifier("contact, envoyé : le remerciement (role=status) à la place du formulaire",
    envoye.includes('<p class="contact__merci" role="status">' + LIBELLES.contactMerci + "</p>") && !envoye.includes("<form"));
  verifier("contact : seule la section visée par l'envoi s'en sert",
    !section(rendrePage({ contenu: n, client, formulaire: { bloc: "contact-2", etat: "envoye" } })).includes("contact__merci") &&
    !section(rendrePage({ contenu: n, client, formulaire: { bloc: "contact-2", etat: "erreur", valeurs: saisi, erreurs: refus.erreurs } })).includes("Jeanne"));
  const deux = avec(true, (c) => { c.blocs["contact-2"] = Object.assign(nouveauBloc("contact"), { formulaire: true }); c.pages.accueil.ordre.push("contact-2"); });
  const page2 = rendreCorps({ contenu: deux, client });
  const tous = [...page2.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  verifier("contact : deux formulaires sur une page, aucun identifiant en double", tous.length === new Set(tous).size && page2.includes('for="formulaire-contact-2-nom"'));

  // En édition : inerte, mais chaque mot reste cliquable.
  const edi = section(rendreCorps({ contenu: n, client, edition: true, formulaire: { bloc: "contact-1", etat: "envoye" } }));
  verifier("contact, édition : les champs désactivés, le bouton ne soumet rien",
    (edi.match(/<(input|textarea) class="contact__saisie"[^>]* disabled/g) || []).length === 4 && /name="site_web"[^>]* disabled/.test(edi) &&
    edi.includes('<button class="bouton bouton--plein contact__bouton" type="button"><span data-edit="libelles.contactEnvoyer">Envoyer</span></button>') &&
    !edi.includes('type="submit"'));
  verifier("contact, édition : les libellés gardent leurs marques",
    CHAMPS_CONTACT.every((nm) => edi.includes('<span data-edit="libelles.' + PRESENTATION_LIB[nm] + '">')) && edi.includes('data-edit="libelles.contactNotice"') &&
    edi.includes('href="/mentions-legales" data-edit="libelles.mentionsLegales"'));
  verifier("contact, édition : le remerciement s'affiche dessous pour qu'on puisse le réécrire ; l'état d'un envoi est ignoré",
    edi.includes('<p class="contact__merci"><span data-edit="libelles.contactMerci">') && edi.includes("<form") && !edi.includes('role="status"'));
  verifier("contact : sur le site, ni ce remerciement d'avance ni aucune marque d'édition",
    !s.includes("Après l") && !s.includes("contact__merci") && !/data-edit/.test(s));
}

/* ----- Les feuilles : contrastes mesurés, champs à la taille du doigt ----- */
{
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  // Les couples que posent le formulaire et le lien du bas de page (voir
  // l'en-tête du formulaire dans contact.css) : tous doivent être DÉCLARÉS
  // dans COUPLES, donc contrôlés par verifier-themes à chaque changement de
  // palette, et tenir 4,5:1. Le bord des champs (non textuel) : 3:1.
  const TEXTES = [["texte", "surface"], ["texte", "fond"], ["texteDoux", "surface"], ["accent", "surface"], ["texte", "doux"], ["accent", "doux"],
    ["surAccent", "accent"], ["surSombre", "sombre"]];
  const BORDS = [["texteDoux", "surface"], ["texteDoux", "fond"], ["accent", "fond"]];
  const declares = new Set(COUPLES.map((c) => c.join("/")));
  const faibles = [];
  for (const [id, t] of Object.entries(THEMES)) {
    for (const [a, b] of TEXTES) {
      if (!declares.has(a + "/" + b)) faibles.push(a + "/" + b + " non déclaré");
      const r = contraste(t.couleurs[a], t.couleurs[b]);
      if (r < 4.5) faibles.push(id + " " + a + "/" + b + " " + r.toFixed(2));
    }
    for (const [a, b] of BORDS) {
      const r = contraste(t.couleurs[a], t.couleurs[b]);
      if (r < 3) faibles.push(id + " bord " + a + "/" + b + " " + r.toFixed(2));
    }
  }
  verifier("feuilles : chaque couple du formulaire et du lien des mentions est déclaré et tient 4,5:1 (les bords 3:1), dans chaque thème", faibles.length === 0, faibles.join(", "));
  const css = readFileSync(racine + "socle/public/css/blocs/contact.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  verifier("feuilles : aucune couleur écrite en dur dans contact.css", !/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b(white|black|red)\b/i.test(css));
  const saisie = (css.match(/\.contact__saisie\s*\{([^}]*)\}/) || ["", ""])[1];
  verifier("feuilles : des champs d'au moins 44 px de haut, en 16 px, bordés d'une couleur mesurée",
    Number((saisie.match(/min-height:\s*(\d+)px/) || [])[1]) >= 44 && /font-size:\s*1rem/.test(saisie) && /border:\s*1px solid var\(--texte-doux\)/.test(saisie), saisie);
  verifier("feuilles : le focus des champs se voit", /\.contact__saisie:focus[^{]*\{[^}]*outline:\s*3px solid var\(--accent\)/.test(css));
  verifier("feuilles : le formulaire vit dans une carte (couleurs claires, même dans une section foncée)",
    rendreCorps({ contenu: normaliser(Object.assign(copieDe(contenuLivre), {})), client }).includes('<div class="carte contact__envoi"><form'));
}

/* ----- La démo ----- */
{
  const m = contenuLivre.pages[PAGE_MENTIONS];
  const texte = JSON.stringify(contenuLivre.blocs["texte-1"] || {});
  verifier("démo : une page de mentions légales, visiblement fictive, sans aucun trou",
    !!m && m.ordre.join() === "texte-1" && contenuLivre.blocs["texte-1"].type === "texte" &&
    texte.includes("SIRET : 000 000 000 00000 — entreprise fictive, site de démonstration") && !contientUnTrou(contenuLivre.blocs["texte-1"]));
  // Les mêmes rubriques que le modèle, dans le même ordre, remplies de
  // données visiblement fictives (relecture du 3 octobre 2026).
  const modele = pageMentionsLegales(sansMentions()).blocs["texte-1"].paragraphes.map((x) => x.titre);
  const demo = (contenuLivre.blocs["texte-1"].paragraphes || []).map((x) => x.titre);
  const brut = texteBrut(texte);
  verifier("démo : les rubriques du modèle, dans son ordre", JSON.stringify(demo) === JSON.stringify(modele), demo.join(" | "));
  verifier("démo : médiateur, RNE, TVA, identité de l'entrepreneur et article 13 du RGPD — fictifs, et dits tels",
    /médiateur fictif/.test(brut) && /Registre national des entreprises \(RNE\)/.test(brut) && /article 293 B du CGI/.test(brut) &&
    /Entreprise individuelle \(EI\) fictive — Ernestine Exemple/.test(brut) && !/r[ée]pertoire des m[ée]tiers/i.test(brut) &&
    ["Base légale", "sous-traitant", "hors de l'Union européenne", "vous opposer", "limitation", "portabilité", "Google Fonts"].every((m) => brut.includes(m)));
  verifier("démo : le formulaire de contact activé", contenuLivre.blocs["contact-1"].formulaire === true);
  let sortie = "";
  let code = 0;
  // Sans `ATELIER_RACINE` : c'est la VRAIE démo qu'on contrôle ici.
  const env = Object.assign({}, process.env);
  delete env.ATELIER_RACINE;
  try { sortie = execFileSync(process.execPath, [racine + "outils/rendre.mjs", "demo-boulangerie", "--controle"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env }); }
  catch (e) { code = e.status; sortie = String(e.stderr || e.stdout); }
  verifier("rendre.mjs --controle : la démo passe, données structurées comprises", code === 0 && /hors données structurées/.test(sortie) && /sur 2 pages/.test(sortie), sortie.trim());

  // Un client dont la page des mentions n'affiche rien (sa section est
  // masquée) : le contrôle le refuse, au lieu de passer comme avant.
  const copie = mkdtempSync(join(tmpdir(), "atelier-rendre-"));
  try {
    mkdirSync(join(copie, "clients", "masque"), { recursive: true });
    const c = copieDe(contenuLivre);
    c.blocs["texte-1"].masque = true;
    writeFileSync(join(copie, "clients", "masque", "client.json"), JSON.stringify(client));
    writeFileSync(join(copie, "clients", "masque", "contenu.json"), JSON.stringify(c));
    let sortieM = "";
    let codeM = 0;
    try { sortieM = execFileSync(process.execPath, [racine + "outils/rendre.mjs", "masque", "--controle"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: Object.assign({}, process.env, { ATELIER_RACINE: copie }) }); }
    catch (e) { codeM = e.status; sortieM = String(e.stderr || e.stdout); }
    verifier("rendre.mjs --controle : une page des mentions qui n'affiche rien est refusée", codeM === 1 && /mentions légales n'affiche rien/.test(sortieM), sortieM.trim());
  } finally {
    rmSync(copie, { recursive: true, force: true });
  }
}

/* ----- Bilan ----- */
if (echecs.length) {
  for (const e of echecs) console.error("✗ " + e);
  console.error(`\n${echecs.length} échec(s), ${ok} réussite(s).`);
  process.exit(1);
}
console.log(`✓ ${ok} vérifications réussies`);
