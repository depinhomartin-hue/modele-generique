/* Tests de non-régression du socle — `npm test`.

   Chaque cas rejoue un défaut RÉEL, trouvé par la relecture contradictoire
   du 3 octobre 2026, ou une règle du projet. Un test qui casse le jour où
   quelqu'un « simplifie » le code, c'est précisément son rôle.

   Le Worker est appelé directement (creerSite().fetch), sans serveur : Node
   connaît Request, Response et Headers. */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { creerSite } from "../socle/worker.js";
import { normaliser, rendrePage, rendreCorps, rendreBloc, ancresDeLaPage } from "../socle/public/rendu/page.js";
import { texteRiche, texteBrut, adresseSure, imageSure, lienTelephone, destination, identifiantValide } from "../socle/public/rendu/outils.js";
import { echelleValide, themeDe } from "../socle/public/rendu/themes.js";
import { BLOCS, CATALOGUE, nouveauBloc, valeurReglage, reglageActif } from "../socle/public/rendu/registre.js";
import { restesDuModele } from "../socle/public/rendu/structure.js";
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
  const ORDRE = ["accroche", "presentation", "prestations", "galerie", "avis", "horaires", "faq", "appel", "contact"];
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
  const REGLAGES_ATTENDUS = { accroche: "disposition,fond", presentation: "fond,inverse", prestations: "fond", galerie: "fond", avis: "fond", horaires: "fond", faq: "fond", appel: "fond", contact: "fond" };
  const LISTES_ATTENDUES = { accroche: "boutons:2", presentation: "", prestations: "elements:12", galerie: "images:24", avis: "avis:12", horaires: "jours:14", faq: "questions:20", appel: "", contact: "" };
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
    ids === "accroche-9,avis-9,faq-9,galerie-9,horaires-9,presentation-9,prestations-9", ids);
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

/* ----- Bilan ----- */
if (echecs.length) {
  for (const e of echecs) console.error("✗ " + e);
  console.error(`\n${echecs.length} échec(s), ${ok} réussite(s).`);
  process.exit(1);
}
console.log(`✓ ${ok} vérifications réussies`);
