/* Tests de la logique de l'éditeur — `node outils/tester-editeur.mjs`.

   Seuls les modules PURS de l'éditeur sont testés ici (état, annulation,
   file d'enregistrement, opérations sur la structure, liens, phrases,
   API) : sans navigateur, sans DOM. L'affichage se vérifie à l'écran.

   Les modules de l'éditeur importent le rendu par son adresse sur le site
   (`/rendu/page.js`) — c'est ainsi que le navigateur partage UNE copie de
   chaque module entre l'éditeur et la page. Sous Node, « /rendu/ » désignerait
   la racine du disque : un crochet de résolution le ramène au dossier
   `socle/public/rendu/`. Rien d'autre n'est réécrit. */
import { registerHooks } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const racine = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC = pathToFileURL(racine + "socle/public/").href;
registerHooks({
  resolve(specifier, context, suivant) {
    if (specifier.startsWith("/rendu/") || specifier.startsWith("/editeur/")) {
      return suivant(new URL(specifier.slice(1), PUBLIC).href, context);
    }
    return suivant(specifier, context);
  }
});

const { creerEtat, TAILLE_HISTORIQUE } = await import("../socle/public/editeur/etat.js");
const Enr = await import("../socle/public/editeur/enregistrement.js");
const { creerFile, analyserCopie, creerStockage, cleCopie, RELANCES } = Enr;
const Op = await import("../socle/public/editeur/operations.js");
const Liens = await import("../socle/public/editeur/liens.js");
const Textes = await import("../socle/public/editeur/textes.js");
const { creerApi, ErreurApi } = await import("../socle/public/editeur/api.js");
const PanneauPage = await import("../socle/public/editeur/panneau-page.js");
const { dimensionsReduites } = await import("../socle/public/editeur/images.js");
const { valeurDuChamp, soumissionAnnulee, saisieDeFormulaire } = await import("../socle/public/editeur/cadre.js");
const Messages = await import("../socle/public/editeur/messages.js");
const PanneauSite = await import("../socle/public/editeur/panneau-site.js");
const { defilementApres } = await import("../socle/public/editeur/panneau.js");
const { normaliser, rendreCorps } = await import("../socle/public/rendu/page.js");
const { lireChemin, descripteurListe, contientUnTrou, compterTrous } = await import("../socle/public/rendu/structure.js");
const { PAGE_MENTIONS, pageMentionsLegales } = await import("../socle/public/rendu/modeles-pages.js");

const contenuLivre = JSON.parse(readFileSync(racine + "clients/demo-boulangerie/contenu.json", "utf8"));
const neuf = () => normaliser(JSON.parse(JSON.stringify(contenuLivre)));
const depart = (contenu = contenuLivre, revision = 3) => ({
  site: { id: "demo-boulangerie", demo: true },
  utilisateur: { email: "essai@example.com" },
  brouillon: { contenu: JSON.parse(JSON.stringify(contenu)), revision, empreinte: "aaa", modifie_le: 1, modifie_par: "essai@example.com" },
  publie: { empreinte: "aaa", publie_le: 1, publie_par: "essai@example.com" }
});

let ok = 0;
const echecs = [];
function verifier(nom, condition, detail = "") {
  if (condition) ok++;
  else echecs.push(nom + (detail ? " — " + detail : ""));
}
function leve(fn, Classe) {
  try { fn(); return false; } catch (e) { return !Classe || e instanceof Classe; }
}
const attendre = () => new Promise((r) => setImmediate(r));

/* ----- L'état et l'annulation ----- */
{
  const e = creerEtat(depart());
  const evts = [];
  e.ecouter((x) => evts.push(x));
  const chemin = "blocs.accroche-1.titre";
  e.modifier(chemin, "A", { fusion: "texte:" + chemin });
  e.modifier(chemin, "AB", { fusion: "texte:" + chemin });
  e.modifier(chemin, "ABC", { fusion: "texte:" + chemin });
  verifier("la frappe dans un même champ ne fait qu'un pas", e.annuler() && lireChemin(e.contenu, chemin) === contenuLivre.blocs["accroche-1"].titre && !e.peutAnnuler());
  verifier("rétablir rend la frappe entière", e.retablir() && lireChemin(e.contenu, chemin) === "ABC");
  e.couperFusion();
  e.modifier(chemin, "ABCD", { fusion: "texte:" + chemin });
  verifier("quitter le champ coupe le pas", e.annuler() && lireChemin(e.contenu, chemin) === "ABC");
  verifier("une valeur identique n'empile rien", e.modifier(chemin, "ABC") === false);
  verifier("chemin piégé refusé sans effet", e.modifier("__proto__.pollue", "x") === false && ({}).pollue === undefined);
  verifier("les écouteurs reçoivent le chemin modifié", evts.some((x) => x.type === "texte" && x.chemin === chemin));
}
{
  const e = creerEtat(depart());
  for (let i = 0; i < TAILLE_HISTORIQUE + 20; i++) e.modifier("site.nom", "Nom " + i);
  let n = 0;
  while (e.annuler()) n++;
  verifier("annulation bornée à " + TAILLE_HISTORIQUE + " pas", n === TAILLE_HISTORIQUE, String(n));
}
{
  const e = creerEtat(depart());
  const r = e.transformer(() => 42);
  verifier("une transformation sans effet n'empile rien", r === 42 && !e.peutAnnuler());
  verifier("une transformation qui lève n'applique rien", leve(() => e.transformer((c) => { c.site.nom = "x"; throw new Op.Refus("non"); }), Op.Refus) && e.contenu.site.nom === contenuLivre.site.nom && !e.peutAnnuler());
  const { pageId } = e.transformer((c) => Op.ajouterPage(c, "Nos tarifs"));
  e.allerA(pageId);
  e.allerA("accueil");
  e.annuler();
  verifier("annuler l'ajout d'une page ramène sur une page qui existe", e.pageId === "accueil" && !e.contenu.pages[pageId]);
  e.transformer((c) => { c.site.nom = "Autre"; });
  e.allerA("accueil");
  verifier("une nouvelle modification efface « rétablir »", !e.peutRetablir());
}
{
  const e = creerEtat(depart());
  e.modifier("pages.accueil.titre", "Titre");
  const { pageId } = e.transformer((c) => Op.ajouterPage(c, "Contact pro"));
  e.allerA(pageId);
  e.modifier("blocs." + e.contenu.pages[pageId].ordre[0] + ".surtitre", "Bonjour");
  e.allerA("accueil");
  e.annuler();
  verifier("annuler montre la page où la modification a été faite", e.pageId === pageId, e.pageId);
  e.changerMode("version", { id: 1, contenu: contenuLivre });
  verifier("une version se regarde sans se modifier", e.modifier("site.nom", "X") === false && e.transformer((c) => { c.site.nom = "Y"; }) === undefined && !e.peutAnnuler());
  verifier("revenir d'une version garde le brouillon", e.changerMode("edition") && e.contenu.site.nom === contenuLivre.site.nom);
}

/* ----- La file d'enregistrement -----
   Minuterie à la main : on décide quand le temps passe. */
function fausseMinuterie() {
  let n = 0;
  const minuteurs = new Map();
  return {
    poser(f, ms) { minuteurs.set(++n, { f, ms }); return n; },
    retirer(id) { minuteurs.delete(id); },
    async passer(ms) {
      for (const [id, m] of [...minuteurs]) {
        if (m.ms <= ms) { minuteurs.delete(id); m.f(); }
      }
      for (let i = 0; i < 8; i++) await attendre();
    },
    delais: () => [...minuteurs.values()].map((m) => m.ms),
    taille: () => minuteurs.size
  };
}
function fauxStockage() {
  const m = new Map();
  return {
    m,
    ls: {
      getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
      get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null
    }
  };
}
function monter({ reponses, st = fauxStockage(), cle = cleCopie("demo") }) {
  const e = creerEtat(depart());
  const min = fausseMinuterie();
  const envois = [];
  const statuts = [];
  const appels = { conflit: 0, expiration: 0, refus: 0 };
  const file = creerFile({
    envoyer: async (json, revision, opts) => {
      envois.push({ json, revision, opts });
      const r = reponses.shift();
      if (r instanceof Error) throw r;
      if (typeof r === "function") return r(json, revision);
      return r || { revision: revision + 1, empreinte: "e" + (revision + 1), modifie_le: 5 };
    },
    lire: () => ({ json: e.json(), revision: e.brouillon.revision }),
    surSucces: (rep) => e.majBrouillon(rep),
    surConflit: () => { appels.conflit++; },
    surExpiration: () => { appels.expiration++; },
    surRefus: () => { appels.refus++; },
    surStatut: (s) => statuts.push(s),
    stockage: creerStockage(st.ls, cle),
    minuterie: min,
    maintenant: () => 1000
  });
  file.marquerEnregistre(e.json());
  e.ecouter((x) => { if (x.type === "texte" || x.type === "structure") file.planifier(); });
  return { e, file, min, st, envois, statuts, appels };
}
{
  const t = monter({ reponses: [] });
  t.e.modifier("site.nom", "A", { fusion: "f" });
  t.e.modifier("site.nom", "AB", { fusion: "f" });
  t.e.modifier("site.nom", "ABC", { fusion: "f" });
  verifier("rien ne part avant 1,2 s", t.envois.length === 0 && t.min.delais().includes(1200));
  await t.min.passer(1200);
  verifier("un seul envoi pour une rafale de frappe", t.envois.length === 1 && JSON.parse(t.envois[0].json).site.nom === "ABC");
  verifier("la révision du serveur est retenue", t.e.brouillon.revision === 4 && t.file.statut() === "enregistre");
  verifier("enregistré : plus rien en attente", !t.file.enAttente());
}
{
  // Un envoi lent : on modifie pendant qu'il voyage ; le dernier état gagne.
  let liberer;
  const t = monter({ reponses: [(json, rev) => new Promise((r) => { liberer = () => r({ revision: rev + 1, empreinte: "x" }); })] });
  t.e.modifier("site.nom", "Premier");
  await t.min.passer(1200);
  t.e.modifier("site.nom", "Second");
  await t.min.passer(1200);
  verifier("un seul envoi à la fois", t.envois.length === 1);
  liberer();
  for (let i = 0; i < 10; i++) await attendre();
  verifier("le dernier état part après le premier envoi", t.envois.length === 2 && JSON.parse(t.envois[1].json).site.nom === "Second" && t.envois[1].revision === 4, String(t.envois.length));
}
{
  // Frappe pendant un envoi qui réussit, puis onglet fermé avant le suivant :
  // la copie laissée doit porter la NOUVELLE révision, sinon elle passe au
  // démarrage pour « modifiée ailleurs » (contrôle du 3 octobre 2026).
  let liberer;
  const t = monter({ reponses: [(json, rev) => new Promise((r) => { liberer = () => r({ revision: rev + 1, empreinte: "x" }); })] });
  t.e.modifier("site.nom", "Envoyé");
  await t.min.passer(1200);
  t.e.modifier("site.nom", "Tapé pendant l'envoi");
  liberer();
  for (let i = 0; i < 10; i++) await attendre();
  const copie = JSON.parse(t.st.m.get(cleCopie("demo")) || "null");
  verifier("copie écrite pendant un envoi : réécrite avec la révision du serveur",
    !!copie && copie.contenu.site.nom === "Tapé pendant l'envoi" && copie.revisionBase === t.e.brouillon.revision && t.e.brouillon.revision === 4,
    JSON.stringify(copie && { r: copie.revisionBase, e: t.e.brouillon.revision }));
}
{
  const reseau = new ErreurApi({ statut: 0, erreur: "reseau" });
  const t = monter({ reponses: [reseau, reseau] });
  t.e.modifier("site.nom", "Hors ligne");
  await t.min.passer(1200);
  verifier("réseau en panne : statut « hors ligne »", t.file.statut() === "hors_ligne");
  const copie = t.st.m.get(cleCopie("demo"));
  verifier("réseau en panne : copie locale écrite", !!copie && JSON.parse(copie).contenu.site.nom === "Hors ligne" && JSON.parse(copie).revisionBase === 3);
  verifier("première relance à 5 s", t.min.delais().includes(RELANCES[0]), t.min.delais().join(","));
  t.e.modifier("site.nom", "Hors ligne 2");
  verifier("taper hors ligne ne bouscule pas la relance", t.min.delais().join(",") === String(RELANCES[0]) && JSON.parse(t.st.m.get(cleCopie("demo"))).contenu.site.nom === "Hors ligne 2");
  await t.min.passer(RELANCES[0]);
  verifier("seconde relance à 15 s", t.min.delais().includes(RELANCES[1]), t.min.delais().join(","));
  t.file.reessayer();
  for (let i = 0; i < 10; i++) await attendre();
  verifier("le réseau revient : la copie est effacée au premier succès", t.file.statut() === "enregistre" && !t.st.m.has(cleCopie("demo")) && t.min.taille() === 0);
}
{
  const conflit = new ErreurApi({ statut: 409, erreur: "conflit", donnees: { brouillon: { contenu: contenuLivre, revision: 9 } } });
  const t = monter({ reponses: [conflit] });
  t.e.modifier("site.nom", "Moi");
  await t.min.passer(1200);
  verifier("conflit : la file s'arrête et demande", t.appels.conflit === 1 && t.file.enPause() === "conflit" && t.min.taille() === 0);
  t.e.modifier("site.nom", "Moi encore");
  await t.min.passer(1200);
  verifier("conflit : rien ne repart tout seul", t.envois.length === 1);
  // « Garder mes modifications » : on repart de la révision du serveur.
  t.e.majBrouillon({ revision: 9 });
  await t.file.reprendre();
  verifier("garder mes modifications : réécrit avec la nouvelle révision", t.envois.length === 2 && t.envois[1].revision === 9 && t.file.statut() === "enregistre");
}
{
  const t = monter({ reponses: [new ErreurApi({ statut: 401, erreur: "non_connecte" })] });
  t.e.modifier("site.nom", "Expiré");
  await t.min.passer(1200);
  verifier("401 : connexion expirée, copie gardée", t.appels.expiration === 1 && t.file.statut() === "expiration" && t.st.m.has(cleCopie("demo")));
}
{
  const t = monter({ reponses: [new ErreurApi({ statut: 413, erreur: "contenu_trop_lourd" })] });
  t.e.modifier("site.nom", "Lourd");
  await t.min.passer(1200);
  verifier("413 : refus annoncé, pas de relance", t.appels.refus === 1 && t.min.taille() === 0);
  t.e.annuler();
  await t.min.passer(1200);
  verifier("413 : la modification suivante retente", t.envois.length === 1 && t.file.statut() === "enregistre", t.file.statut());
}
{
  const t = monter({ reponses: [] });
  t.e.modifier("site.nom", "À publier");
  const vide = await t.file.vider();
  verifier("vider envoie sans attendre le délai", vide && t.envois.length === 1 && t.min.taille() === 0);
  t.e.modifier("site.nom", "Fermeture");
  t.file.auDepart();
  for (let i = 0; i < 5; i++) await attendre();
  verifier("au départ : envoi « keepalive » et copie locale", t.envois.length === 2 && t.envois[1].opts.keepalive === true);
}
{
  const b = { contenu: contenuLivre, revision: 3 };
  const c = JSON.parse(JSON.stringify(contenuLivre));
  c.site.nom = "Modifié hors ligne";
  verifier("copie absente : rien à proposer", analyserCopie(null, b) === null);
  verifier("copie illisible : signalée", analyserCopie("{pas du json", b).illisible === true);
  const a = analyserCopie(JSON.stringify({ contenu: c, revisionBase: 3, quand: 7 }), b);
  verifier("copie différente, brouillon inchangé", a && !a.identique && !a.aChange && a.quand === 7);
  const a2 = analyserCopie(JSON.stringify({ contenu: c, revisionBase: 2, quand: 7 }), b);
  verifier("copie différente, brouillon modifié depuis", a2 && a2.aChange);
  verifier("copie identique au serveur", analyserCopie(JSON.stringify({ contenu: contenuLivre, revisionBase: 1 }), b).identique === true);
  const piege = { getItem() { throw new Error("bloqué"); }, setItem() { throw new Error("plein"); }, removeItem() { throw new Error("x"); } };
  const s = creerStockage(piege, "k");
  verifier("stockage local bloqué : jamais d'exception", s.lire() === null && s.ecrire("x") === false && (s.effacer(), true));
}

/* ----- Les sections ----- */
{
  const c = neuf();
  const n = c.pages.accueil.ordre.length;
  verifier("monter la première section : sans effet", Op.deplacerBloc(c, "accueil", "accroche-1", -1) === false);
  Op.deplacerBloc(c, "accueil", "presentation-1", -1);
  verifier("monter une section", c.pages.accueil.ordre[0] === "presentation-1" && c.pages.accueil.ordre[1] === "accroche-1");
  verifier("masquer : masque === true", Op.basculerMasque(c, "faq-1") === true && c.blocs["faq-1"].masque === true);
  verifier("afficher : la clé disparaît", Op.basculerMasque(c, "faq-1") === false && !("masque" in c.blocs["faq-1"]));
  const id = Op.dupliquerBloc(c, "accueil", "horaires-1");
  verifier("dupliquer : identifiant neuf, juste après, sans l'ancre", id === "horaires-2" && c.pages.accueil.ordre.indexOf(id) === c.pages.accueil.ordre.indexOf("horaires-1") + 1 && !("ancre" in c.blocs[id]) && c.blocs[id].telephone === c.blocs["horaires-1"].telephone);
  const nouveau = Op.ajouterBloc(c, "accueil", "faq", "accroche-1");
  verifier("ajouter après la section choisie", nouveau === "faq-2" && c.pages.accueil.ordre[c.pages.accueil.ordre.indexOf("accroche-1") + 1] === "faq-2" && c.blocs["faq-2"].questions.length > 0);
  verifier("ajouter un genre inconnu : refusé", leve(() => Op.ajouterBloc(c, "accueil", "carrousel"), Op.Refus));
  Op.supprimerBloc(c, "accueil", "faq-2");
  verifier("supprimer : la section et son contenu partent", !c.pages.accueil.ordre.includes("faq-2") && !c.blocs["faq-2"]);
  verifier("le résultat reste un contenu normal", c.pages.accueil.ordre.length === n + 1 && JSON.stringify(normaliser(c)) === JSON.stringify(c));
  verifier("liens qui mènent à une section", Op.liensVersBloc(c, "accueil", "horaires-1").length >= 3);
}

/* ----- Les ancres ----- */
{
  const c = neuf();
  // Un lien vers les horaires depuis une autre page, sous les deux formes.
  const { pageId } = Op.ajouterPage(c, "Tarifs", { auMenu: false });
  c.blocs[c.pages[pageId].ordre[0]].boutons[0].vers = "/#horaires";
  const r = Op.renommerAncre(c, "accueil", "horaires-1", "Nous trouver");
  verifier("renommer une ancre : texte → identifiant", r.ancre === "nous-trouver" && c.blocs["horaires-1"].ancre === "nous-trouver");
  verifier("renommer : le menu suit", c.entete.liens.find((l) => l.texte === "Horaires").vers === "#nous-trouver");
  verifier("renommer : le bouton de l'accroche suit", c.blocs["accroche-1"].boutons[1].vers === "#nous-trouver");
  verifier("renommer : le pied suit", c.pied.liens.some((l) => l.vers === "#nous-trouver"));
  verifier("renommer : le lien d'une autre page suit, sous sa forme", c.blocs[c.pages[pageId].ordre[0]].boutons[0].vers === "/#nous-trouver");
  verifier("renommer : le compte des liens suivis", r.liens === 4, String(r.liens));
  verifier("ancre déjà prise : refusée", leve(() => Op.renommerAncre(c, "accueil", "faq-1", "nos-pains"), Op.Refus));
  verifier("ancre réservée « contenu » : refusée", leve(() => Op.renommerAncre(c, "accueil", "faq-1", "contenu"), Op.Refus));
  const r2 = Op.renommerAncre(c, "accueil", "horaires-1", "");
  verifier("ancre vidée : retour à l'identifiant, liens suivis", r2.ancre === "horaires-1" && !("ancre" in c.blocs["horaires-1"]) && c.entete.liens.find((l) => l.texte === "Horaires").vers === "#horaires-1");
  // Une section d'une autre page qui demande la même ancre : pas touchée.
  const autre = Op.ajouterBloc(c, pageId, "faq");
  c.blocs[autre].ancre = "questions";
  c.blocs["faq-1"].ancre = "questions";
  c.entete.liens[0].vers = "/" + pageId + "#questions";
  Op.renommerAncre(c, "accueil", "faq-1", "aide");
  verifier("renommer : un lien vers la même ancre d'une AUTRE page n'est pas touché", c.entete.liens[0].vers === "/" + pageId + "#questions");
}

/* ----- Les listes ----- */
{
  const c = neuf();
  const chemin = "blocs.prestations-1.elements";
  const n = c.blocs["prestations-1"].elements.length;
  verifier("monter le premier élément : sans effet", Op.operationListe(c, chemin, 0, "monter") === 0);
  const titre1 = c.blocs["prestations-1"].elements[1].titre;
  verifier("monter un élément", Op.operationListe(c, chemin, 1, "monter") === 0 && c.blocs["prestations-1"].elements[0].titre === titre1);
  verifier("dupliquer un élément", Op.operationListe(c, chemin, 0, "dupliquer") === 1 && c.blocs["prestations-1"].elements[1].titre === titre1 && c.blocs["prestations-1"].elements.length === n + 1);
  c.blocs["prestations-1"].elements[1].titre = "Changé";
  verifier("une copie n'est pas liée à l'original", c.blocs["prestations-1"].elements[0].titre === titre1);
  verifier("ajouter après : le modèle du bloc", Op.operationListe(c, chemin, 0, "ajouter-apres") === 1 && c.blocs["prestations-1"].elements[1].titre === "Première prestation");
  while (c.blocs["prestations-1"].elements.length < 12) Op.operationListe(c, chemin, 0, "ajouter");
  verifier("liste pleine : refus expliqué", leve(() => Op.operationListe(c, chemin, 0, "dupliquer"), Op.Refus));
  verifier("supprimer un élément", Op.operationListe(c, chemin, 11, "supprimer") === 10 && c.blocs["prestations-1"].elements.length === 11);
  verifier("liste du menu : le modèle du site", Op.operationListe(c, "entete.liens", 0, "ajouter") === 4 && c.entete.liens[4].texte === "Nouveau lien" && c.entete.liens[4].vers === "");
  verifier("chemin qui n'est pas une liste : refusé", leve(() => Op.operationListe(c, "site.nom", 0, "ajouter"), Op.Refus));
  verifier("nom d'un élément : son premier texte", Op.nomElement({ titre: "<em>Baguette</em> tradition" }, "une carte", 0) === "Baguette tradition");
  verifier("nom d'un élément sans texte", Op.nomElement({ titre: "" }, "une carte", 2) === "Carte 3");
}

/* ----- Les pages ----- */
{
  const c = neuf();
  const r = Op.ajouterPage(c, "Nos tarifs d'été");
  verifier("nouvelle page : adresse tirée du nom", r.pageId === "nos-tarifs-d-ete" && c.pages[r.pageId].titre === "Nos tarifs d'été");
  verifier("nouvelle page : ajoutée au menu", r.auMenu && c.entete.liens.at(-1).vers === "/nos-tarifs-d-ete");
  verifier("nouvelle page : naît avec une section", c.pages[r.pageId].ordre.length === 1 && c.blocs[c.pages[r.pageId].ordre[0]].type === "accroche");
  verifier("deux pages du même nom : deux adresses", Op.ajouterPage(c, "Nos tarifs d'été", { auMenu: false }).pageId === "nos-tarifs-d-ete-2");
  verifier("adresse réservée évitée", Op.ajouterPage(c, "Admin", { auMenu: false }).pageId === "admin-2");
  verifier("page sans nom : refusée", leve(() => Op.ajouterPage(c, "   "), Op.Refus));
  verifier("nom de page : celui du menu", Liens.nomDePage(c, "nos-tarifs-d-ete") === "Nos tarifs d'été" && Liens.nomDePage(c, "accueil") === "Accueil");
  while (c.entete.liens.length < 8) c.entete.liens.push({ texte: "x", vers: "#x" });
  const plein = Op.ajouterPage(c, "Galerie");
  verifier("menu plein : page créée, pas ajoutée au menu, et on le dit", plein.pageId === "galerie" && !plein.auMenu && plein.menuPlein);
}
{
  const c = neuf();
  const { pageId } = Op.ajouterPage(c, "Tarifs");
  c.pied.liens.push({ texte: "Tarifs", vers: "/tarifs" });
  c.entete.bouton.vers = "/tarifs#prix";
  c.blocs["appel-1"].bouton.vers = "/tarifs";
  const propre = c.pages[pageId].ordre[0];
  const bilan = Op.analyserSuppressionPage(c, pageId);
  verifier("suppression de page : le bilan d'avance", bilan.sections === 1 && bilan.retires === 2 && bilan.vides === 2, JSON.stringify(bilan));
  Op.supprimerPage(c, pageId);
  verifier("suppression : la page et ses sections partent", !c.pages[pageId] && !c.blocs[propre]);
  verifier("suppression : retirée du menu et du pied", !c.entete.liens.some((l) => l.vers.startsWith("/tarifs")) && !c.pied.liens.some((l) => l.vers.startsWith("/tarifs")));
  verifier("suppression : les autres liens sont vidés", c.entete.bouton.vers === "" && c.blocs["appel-1"].bouton.vers === "");
  verifier("suppression : les autres liens du menu restent", c.entete.liens.length === 4);
  verifier("l'accueil ne se supprime pas", leve(() => Op.supprimerPage(c, "accueil"), Op.Refus));
}

/* ----- Les liens ----- */
{
  const c = neuf();
  const A = Liens.analyserDestination;
  verifier("analyse : aucun", A("").genre === "aucun" && A("#").genre === "aucun");
  verifier("analyse : section", A("#horaires").genre === "section" && A("#horaires").ancre === "horaires");
  verifier("analyse : accueil et section", A("/#horaires").genre === "page" && A("/#horaires").page === "accueil" && A("/#horaires").ancre === "horaires");
  verifier("analyse : autre page", A("/tarifs").page === "tarifs" && A("/tarifs#prix").ancre === "prix");
  verifier("analyse : téléphone relisible", A("tel:+33199001234").valeur === "01 99 00 12 34");
  verifier("analyse : e-mail", A("mailto:bonjour@example.com").valeur === "bonjour@example.com");
  verifier("analyse : web", A("https://example.com").genre === "web");
  const C = (choix, ctx) => Liens.composerDestination(choix, ctx);
  verifier("composer : section", C({ genre: "section", ancre: "horaires" }) === "#horaires");
  verifier("composer : accueil", C({ genre: "page", page: "accueil" }, { pageContexte: "tarifs" }) === "/");
  verifier("composer : section de l'accueil depuis une autre page", C({ genre: "page", page: "accueil", ancre: "horaires" }, { pageContexte: "tarifs" }) === "/#horaires");
  verifier("composer : section de la page même", C({ genre: "page", page: "tarifs", ancre: "prix" }, { pageContexte: "tarifs" }) === "#prix");
  verifier("composer : autre page et section", C({ genre: "page", page: "tarifs", ancre: "prix" }, { pageContexte: "accueil" }) === "/tarifs#prix");
  verifier("composer : téléphone", C({ genre: "telephone", valeur: "03 89 12 34 56" }) === "tel:0389123456");
  verifier("composer : téléphone incomplet refusé", leve(() => C({ genre: "telephone", valeur: "03 89" }), Liens.Refus));
  verifier("composer : e-mail", C({ genre: "email", valeur: " bonjour@example.com " }) === "mailto:bonjour@example.com");
  verifier("composer : e-mail incomplet refusé", leve(() => C({ genre: "email", valeur: "bonjour@" }), Liens.Refus));
  verifier("composer : web sans https complété", C({ genre: "web", valeur: "www.example.com" }) === "https://www.example.com");
  verifier("composer : javascript refusé", leve(() => C({ genre: "web", valeur: "javascript:alert(1)" }), Liens.Refus));
  verifier("composer : web sans domaine refusé", leve(() => C({ genre: "web", valeur: "bonjour" }), Liens.Refus));
  verifier("composer : aucun lien", C({ genre: "aucun" }) === "");
  verifier("contexte : un lien du menu parle de l'accueil", Liens.pageDuLien(c, "entete.liens.0.vers", "tarifs") === "accueil");
  verifier("genre : bouton (il a un style)", Liens.genreDeLien(c, "blocs.accroche-1.boutons.0.vers") === "bouton" && Liens.genreDeLien(c, "entete.bouton.vers") === "bouton");
  verifier("genre : lien du menu", Liens.genreDeLien(c, "entete.liens.0.vers") === "lien");
  verifier("genre : plan", Liens.genreDeLien(c, "blocs.horaires-1.lienPlan") === "plan");
  verifier("sections : l'ancre du site", Liens.sectionsDe(c, "accueil").find((s) => s.id === "prestations-1").ancre === "nos-pains");
  verifier("description d'une destination", Liens.decrireDestination(c, "#horaires", "accueil") === "Section « Horaires et accès — Horaires et accès »");
  verifier("description : téléphone", Liens.decrireDestination(c, "tel:+33199001234", "accueil") === "Téléphone 01 99 00 12 34");
  // Une section masquée : grisée en édition (cadre.css lit `data-masque`),
  // absente du site.
  const m = JSON.parse(JSON.stringify(c));
  Op.basculerMasque(m, "faq-1");
  const enEdition = rendreCorps({ contenu: normaliser(m), client: {}, edition: true });
  const enPublic = rendreCorps({ contenu: normaliser(m), client: {}, edition: false });
  verifier("section masquée : data-masque en édition, absente du site", /data-bloc="faq-1"[^>]*data-masque/.test(enEdition) && !enPublic.includes('data-bloc="faq-1"'));
  // Le premier rendu en édition doit porter les marques que l'éditeur lit.
  const html = rendreCorps({ contenu: c, client: {}, edition: true });
  verifier("le rendu en édition porte data-edit, data-edit-dest, data-edit-img, data-liste", /data-edit="/.test(html) && /data-edit-dest="/.test(html) && /data-edit-img="/.test(html) && /data-liste="/.test(html));
}

/* ----- Les phrases ----- */
{
  const ref = new Date(2026, 9, 3, 16, 0).getTime();
  const quand = new Date(2026, 9, 3, 14, 2).getTime();
  verifier("date longue", Textes.dateLongue(quand, ref) === "3 octobre à 14 h 02", Textes.dateLongue(quand, ref));
  verifier("date courte", Textes.dateCourte(quand, ref) === "3 oct., 14 h 02", Textes.dateCourte(quand, ref));
  verifier("le 1er du mois", Textes.dateLongue(new Date(2026, 9, 1, 9, 5).getTime(), ref) === "1er octobre à 9 h 05");
  verifier("une autre année se dit", Textes.dateLongue(new Date(2025, 0, 2, 9, 5).getTime(), ref) === "2 janvier 2025 à 9 h 05");
  verifier("aujourd'hui", Textes.momentLisible(quand, ref) === "aujourd'hui à 14 h 02");
  verifier("hier", Textes.momentLisible(new Date(2026, 9, 2, 8, 0).getTime(), ref) === "hier à 8 h 00");
  verifier("version publiée", Textes.phraseVersion({ origine: "publication", quand, par: "essai@example.com" }, ref) === "Publiée le 3 octobre à 14 h 02 par essai@example.com");
  verifier("brouillon mis de côté", Textes.phraseVersion({ origine: "sauvegarde", quand }, ref) === "Brouillon mis de côté le 3 octobre à 14 h 02");
  verifier("journal", Textes.phraseJournal({ action: "publication", quand, par: "essai@example.com" }, ref) === "Publication — 3 oct., 14 h 02, essai@example.com");
  verifier("journal : action inconnue gardée", Textes.phraseJournal({ action: "nouveaute", quand }, ref).startsWith("Autre opération"));
  verifier("erreur réseau : dit quoi faire", /réessayez/i.test(Textes.messageErreur(new ErreurApi({ statut: 0, erreur: "reseau" }))));
  verifier("erreur du serveur : sa phrase + le geste", Textes.messageErreur(new ErreurApi({ statut: 400, erreur: "contenu_invalide", message: "Le contenu dépasse 20 pages." })) === "Le contenu dépasse 20 pages. Annulez votre dernière modification (bouton « Annuler »), puis réessayez.");
  verifier("erreur inconnue : jamais de code brut", !/http_/.test(Textes.messageErreur(new ErreurApi({ statut: 418, erreur: "http_418" }))));
}

/* ----- L'API ----- */
{
  const journal = [];
  const fauxFetch = async (url, init) => {
    journal.push({ url, init });
    if (url.endsWith("/brouillon")) return new Response(JSON.stringify({ erreur: "conflit", message: "Modifié ailleurs.", brouillon: { revision: 8 } }), { status: 409 });
    if (url.endsWith("/etat")) return new Response(JSON.stringify({ site: { id: "x" } }), { status: 200 });
    if (url.endsWith("/publier")) return new Response("<html>passerelle</html>", { status: 502 });
    throw new TypeError("Failed to fetch");
  };
  const api = creerApi({ fetch: fauxFetch });
  verifier("API : réponse JSON", (await api.etat()).site.id === "x");
  let e409;
  try { await api.enregistrer('{"site":{}}', 7); } catch (e) { e409 = e; }
  verifier("API : conflit avec le brouillon du serveur", e409 instanceof ErreurApi && e409.statut === 409 && e409.donnees.brouillon.revision === 8);
  verifier("API : corps du brouillon tel quel", journal[1].init.body === '{"contenu":{"site":{}},"revision":7}' && journal[1].init.method === "PUT" && journal[1].init.headers["Content-Type"] === "application/json");
  let e502;
  try { await api.publier(7); } catch (e) { e502 = e; }
  verifier("API : erreur sans JSON lisible", e502 instanceof ErreurApi && e502.statut === 502 && e502.erreur === "http_502");
  let eReseau;
  try { await api.versions(); } catch (e) { eReseau = e; }
  verifier("API : réseau en panne", eReseau instanceof ErreurApi && eReseau.statut === 0 && eReseau.erreur === "reseau");
  let eId;
  try { await api.retirerMedia("../../x"); } catch (e) { eId = e; }
  verifier("API : identifiant de photo vérifié avant l'appel", eId instanceof ErreurApi && journal.length === 4);
}

/* ----- Ce qu'on lit dans un champ de la page -----
   Un faux élément suffit : `valeurDuChamp` ne lit que ses attributs, son
   HTML et son texte. */
{
  const champ = (html, { riche = true, texte = null } = {}) => ({
    hasAttribute: (n) => n === "data-edit-riche" && riche,
    innerHTML: html,
    textContent: texte === null ? html : texte
  });
  verifier("champ riche : balises inconnues retirées", valeurDuChamp(champ('Bon<script>x</script>jour <b>pain</b> <div>frais</div>')) === "Bonxjour <b>pain</b> frais");
  verifier("champ riche : espace insécable de fin rendue ordinaire", valeurDuChamp(champ("Nos pains&nbsp;")) === "Nos pains ");
  verifier("champ riche : insécable voulue gardée", valeurDuChamp(champ("14&nbsp;h")) === "14&nbsp;h");
  verifier("champ riche : <br> de fin retiré", valeurDuChamp(champ("Ligne<br><br>")) === "Ligne");
  verifier("champ riche vidé : chaîne vide", valeurDuChamp(champ("<br>")) === "");
  verifier("champ riche : police inconnue refusée", valeurDuChamp(champ('<span data-police="comic">x</span>')) === "<span>x</span>");
  verifier("champ riche : police d'un duo gardée", valeurDuChamp(champ('<span data-police="classique">x</span>')) === '<span data-police="classique">x</span>');
  verifier("champ simple : saut de ligne → espace", valeurDuChamp(champ("", { riche: false, texte: "Nos\npains" })) === "Nos pains");
  verifier("champ simple : insécable de fin rendue ordinaire", valeurDuChamp(champ("", { riche: false, texte: "Nos pains\u00a0" })) === "Nos pains ");
}

/* ----- Les photos ----- */
{
  const d = dimensionsReduites(4032, 3024, 1600);
  verifier("photo réduite à 1600 px, proportions gardées", d.largeur === 1600 && d.hauteur === 1200);
  const p = dimensionsReduites(3024, 4032, 400);
  verifier("portrait réduit à 400 px de haut", p.hauteur === 400 && p.largeur === 300);
  const petit = dimensionsReduites(800, 600, 1600);
  verifier("une petite photo n'est pas agrandie", petit.largeur === 800 && petit.hauteur === 600);
}

/* ===== Relecture du 3 octobre 2026 : chaque défaut corrigé a son essai ===== */

/* Écraser après un conflit : le serveur doit le SAVOIR (pour mettre de côté
   le brouillon remplacé). « Garder mes modifications » marque le prochain
   envoi, une seule fois. */
{
  const conflit = new ErreurApi({ statut: 409, erreur: "conflit", donnees: { brouillon: { contenu: contenuLivre, revision: 9 } } });
  const t = monter({ reponses: [conflit] });
  t.e.modifier("site.nom", "Moi");
  await t.min.passer(1200);
  const marquable = typeof t.file.ecraserAuProchainEnvoi === "function";
  if (marquable) {
    t.e.majBrouillon({ revision: 9 });
    t.file.ecraserAuProchainEnvoi(true);
    t.file.marquerEnregistre(null);
    await t.file.reprendre();
  }
  verifier("garder mes modifications : l'envoi porte « ecraser »", marquable && t.envois.length === 2 && t.envois[1].opts.ecraser === true && t.envois[1].revision === 9);
  t.e.modifier("site.nom", "Moi, ensuite");
  await t.min.passer(1200);
  verifier("« ecraser » ne sert qu'une fois", t.envois.length === 3 && !t.envois[2].opts.ecraser);
  const reseau = new ErreurApi({ statut: 0, erreur: "reseau" });
  const t2 = monter({ reponses: [reseau] });
  if (marquable) t2.file.ecraserAuProchainEnvoi(true);
  t2.e.modifier("site.nom", "Perdu en route");
  await t2.min.passer(1200);
  await t2.min.passer(RELANCES[0]);
  verifier("« ecraser » survit à un envoi perdu en route", marquable && t2.envois.length === 2 && t2.envois[0].opts.ecraser === true && t2.envois[1].opts.ecraser === true);
}
{
  const journal = [];
  const api = creerApi({ fetch: async (url, init) => { journal.push(init); return new Response('{"revision":2}', { status: 200 }); } });
  await api.enregistrer('{"a":1}', 1, { ecraser: true });
  await api.enregistrer('{"a":1}', 2);
  verifier("journal : l'écrasement se lit en clair", Textes.phraseJournal({ action: "ecrasement", quand: 1 }).startsWith("Brouillon modifié ailleurs remplacé"));
  verifier("API : « ecraser » transmis au serveur, et seulement quand on le demande", journal[0].body === '{"contenu":{"a":1},"revision":1,"ecraser":true}' && journal[1].body === '{"contenu":{"a":1},"revision":2}');
}
{
  // Annuler par-dessus la version chargée après un conflit remplace le
  // travail de l'autre appareil : l'état le signale.
  const e = creerEtat(depart());
  const evts = [];
  e.ecouter((x) => evts.push(x));
  e.modifier("site.nom", "Mon travail");
  const ailleurs = JSON.parse(JSON.stringify(contenuLivre));
  ailleurs.site.nom = "Le travail de l'autre appareil";
  e.remplacerBrouillon({ contenu: ailleurs, revision: 9 }, { ailleurs: true });
  e.annuler();
  const annulation = evts.at(-1);
  verifier("annuler au-delà d'une version chargée : marqué « ecrase »", annulation.origine === "annulation" && annulation.ecrase === true && e.contenu.site.nom === "Mon travail");
  e.retablir();
  verifier("rétablir la version chargée : marqué « ecrase » aussi", evts.at(-1).ecrase === true && e.contenu.site.nom === "Le travail de l'autre appareil");
  e.annuler();
  e.annuler();
  verifier("une annulation ordinaire n'est pas marquée", evts.at(-1).origine === "annulation" && !evts.at(-1).ecrase);
  const e2 = creerEtat(depart());
  const evts2 = [];
  e2.ecouter((x) => evts2.push(x));
  e2.modifier("site.nom", "Avant la reprise");
  e2.remplacerBrouillon({ contenu: ailleurs, revision: 9 });
  e2.annuler();
  verifier("une reprise de version (déjà mise de côté par le serveur) n'est pas marquée", !evts2.at(-1).ecrase);
}

/* Deux onglets : l'enregistrement de l'un n'efface plus la copie de l'autre. */
{
  const st = fauxStockage();
  const cleA = cleCopie("demo", "ongletA");
  const cleB = cleCopie("demo", "ongletB");
  verifier("une clé de copie par onglet", cleA !== cleB && cleA.startsWith(cleCopie("demo") + ":"));
  const conflit = new ErreurApi({ statut: 409, erreur: "conflit", donnees: { brouillon: { contenu: contenuLivre, revision: 9 } } });
  const A = monter({ reponses: [conflit], st, cle: cleA });
  const B = monter({ reponses: [], st, cle: cleB });
  A.e.modifier("site.nom", "TEXTE DE A, jamais enregistré");
  await A.min.passer(1200);
  verifier("A en conflit : sa copie est écrite", A.file.enPause() === "conflit" && st.m.has(cleA));
  B.e.modifier("site.nom", "B enregistre");
  await B.min.passer(1200);
  verifier("B enregistre : la copie de A est toujours là", B.file.statut() === "enregistre" && st.m.has(cleA) && JSON.parse(st.m.get(cleA)).contenu.site.nom === "TEXTE DE A, jamais enregistré");
  const copies = typeof Enr.copiesDuSite === "function" ? Enr.copiesDuSite(st.ls, "demo") : [];
  verifier("au démarrage suivant, la copie de A est retrouvée", copies.some((x) => x.cle === cleA && analyserCopie(x.chaine, { contenu: contenuLivre, revision: 9 }).contenu.site.nom === "TEXTE DE A, jamais enregistré"));
  st.ls.setItem(cleCopie("demo"), "{}");
  st.ls.setItem(cleCopie("demo-2"), "{}");
  const toutes = typeof Enr.copiesDuSite === "function" ? Enr.copiesDuSite(st.ls, "demo").map((x) => x.cle) : [];
  verifier("l'ancienne clé est relue, la copie d'un autre site non", toutes.includes(cleCopie("demo")) && !toutes.includes(cleCopie("demo-2")));
  verifier("stockage bloqué : aucune copie, aucune exception", Array.isArray(Enr.copiesDuSite?.({ get length() { throw new Error("x"); } }, "demo")) && Enr.copiesDuSite(null, "demo").length === 0);
}

/* « Charger la dernière version » : les modifications écartées sont gardées
   sous une clé que la file n'efface pas, et se reconnaissent au démarrage. */
{
  const st = fauxStockage();
  const t = monter({ reponses: [], st, cle: cleCopie("demo", "x") });
  const cleEcartee = cleCopie("demo", "x") + ":ecartee-1";
  const ecrite = typeof Enr.chaineCopie === "function" ? Enr.chaineCopie('{"site":{"nom":"Écarté"}}', 5, 7, { ecartee: true }) : null;
  if (ecrite) st.ls.setItem(cleEcartee, ecrite);
  t.e.modifier("site.nom", "Chargé puis modifié");
  await t.min.passer(1200);
  verifier("la file n'efface pas la copie écartée", t.file.statut() === "enregistre" && st.m.has(cleEcartee));
  const a = ecrite ? analyserCopie(ecrite, { contenu: contenuLivre, revision: 9 }) : null;
  verifier("une copie écartée se reconnaît au démarrage", !!a && a.ecartee === true && a.contenu.site.nom === "Écarté" && a.aChange === true);
}

/* Un envoi qui ne répond jamais : abandonné au bout d'un délai, et ce qu'on
   tape pendant ce temps est copié sur l'appareil. */
{
  const pend = (url, init) => new Promise((_, rejeter) => {
    if (init.signal) init.signal.addEventListener("abort", () => rejeter(new Error("abandonné")));
  });
  const api = creerApi({ fetch: pend, delai: () => 15 });
  // Une course contre la montre : sans délai d'abandon, l'appel ne finirait
  // jamais, et l'essai avec lui.
  const e = await Promise.race([
    api.enregistrer('{"a":1}', 1).then(() => "fini", (x) => x),
    new Promise((r) => setTimeout(() => r("toujours en attente"), 1000))
  ]);
  verifier("un envoi qui pend est abandonné comme une panne du réseau", e instanceof ErreurApi && e.statut === 0 && e.erreur === "reseau", String(e));
  const vus = [];
  const api2 = creerApi({ fetch: async (url, init) => { vus.push(init); return new Response("{}", { status: 200 }); }, delai: () => 15 });
  await api2.enregistrer('{"a":1}', 1, { keepalive: true });
  verifier("un envoi « keepalive » n'est jamais abandonné", !vus[0].signal && vus[0].keepalive === true);
  const { delaiAppel } = await import("../socle/public/editeur/api.js");
  verifier("le délai laisse partir 300 Ko sur une liaison lente", typeof delaiAppel === "function" && delaiAppel(300000) >= 60000 && delaiAppel(0) >= 20000);

  const t = monter({ reponses: [() => new Promise(() => {})] });
  t.e.modifier("site.nom", "Premier");
  await t.min.passer(1200);
  t.e.modifier("site.nom", "Tapé pendant l'envoi");
  const copie = t.st.m.get(cleCopie("demo"));
  verifier("modifié pendant un envoi qui traîne : copie locale écrite", t.file.statut() === "en_cours" && !!copie && JSON.parse(copie).contenu.site.nom === "Tapé pendant l'envoi");
}

/* Le bouton de l'en-tête : le masquer ne vide plus son texte. */
{
  const c = neuf();
  c.entete.bouton.texte = "Réserver votre kougelhopf";
  const fn = Op.afficherBoutonEntete;
  verifier("masquer le bouton de l'en-tête : une marque, le texte reste", typeof fn === "function" && fn(c, false) === false && c.entete.bouton.masque === true && c.entete.bouton.texte === "Réserver votre kougelhopf" && !Op.boutonEnteteAffiche(c));
  const recharge = normaliser(JSON.parse(JSON.stringify(c)));
  verifier("la marque survit à l'enregistrement (forme canonique)", recharge.entete.bouton.masque === true && recharge.entete.bouton.texte === "Réserver votre kougelhopf");
  verifier("réafficher : même texte, plus de marque", typeof fn === "function" && fn(recharge, true) === false && !("masque" in recharge.entete.bouton) && recharge.entete.bouton.texte === "Réserver votre kougelhopf" && Op.boutonEnteteAffiche(recharge));
  const enEdition = rendreCorps({ contenu: normaliser(JSON.parse(JSON.stringify(c))), client: {}, edition: true });
  verifier("bouton masqué : absent de la page, même en édition (la case a un effet visible)", !enEdition.includes("entete__bouton"));
  const vide = neuf();
  vide.entete.bouton = { texte: "", vers: "" };
  verifier("bouton sans texte, non masqué : « affiché », comme le rendu le dessine en édition", Op.boutonEnteteAffiche(vide));
  verifier("réafficher un bouton sans texte ni lien : un mot, et on demande où il mène", typeof fn === "function" && fn(vide, true) === true && vide.entete.bouton.texte === Op.TEXTE_BOUTON_ENTETE);
}

/* 60 sections par page au plus : refusé AVANT d'écrire, comme le serveur. */
{
  const c = neuf();
  while (c.pages.accueil.ordre.length < 60) Op.ajouterBloc(c, "accueil", "faq");
  const avant = JSON.stringify(c);
  verifier("61e section ajoutée : refus clair", Op.MAX_SECTIONS_PAGE === 60 && leve(() => Op.ajouterBloc(c, "accueil", "faq"), Op.Refus));
  verifier("61e section dupliquée : refus clair", leve(() => Op.dupliquerBloc(c, "accueil", "faq-1"), Op.Refus) && JSON.stringify(c) === avant);
  const autre = Op.ajouterPage(c, "Encore", { auMenu: false });
  verifier("une autre page reste libre", !!Op.ajouterBloc(c, autre.pageId, "faq"));
}

/* Les liens écrits DANS un texte suivent le renommage d'une ancre et la
   suppression d'une page, et comptent dans les confirmations. */
{
  const c = neuf();
  c.blocs["presentation-1"].texte = 'Découvrez <a href="#nos-pains">nos pains</a> et <a href="#nos-pains">nos viennoiseries</a> du jour.';
  c.pied.texte = 'Voir <a href="#nos-pains">la carte</a>.';
  const avant = Op.liensVersBloc(c, "accueil", "prestations-1").length;
  verifier("les liens d'un texte comptent pour une section", avant === Op.liensVersBloc(neuf(), "accueil", "prestations-1").length + 3, String(avant));
  const r = Op.renommerAncre(c, "accueil", "prestations-1", "notre-pain");
  verifier("renommer : le lien d'un texte suit", c.blocs["presentation-1"].texte === 'Découvrez <a href="#notre-pain">nos pains</a> et <a href="#notre-pain">nos viennoiseries</a> du jour.', c.blocs["presentation-1"].texte);
  verifier("renommer : le lien du texte du pied suit", c.pied.texte === 'Voir <a href="#notre-pain">la carte</a>.');
  verifier("renommer : le compte annoncé inclut les liens des textes", r.liens === avant, String(r.liens));
  const { pageId } = Op.ajouterPage(c, "Tarifs");
  const propre = c.pages[pageId].ordre[0];
  c.blocs["faq-1"].intro = 'Voir <a href="/' + pageId + '">nos tarifs</a> ou <a href="https://example.com">ailleurs</a>.';
  c.blocs[propre].texte = 'Retour <a href="/' + pageId + '#prix">ici</a>.';
  const bilan = Op.analyserSuppressionPage(c, pageId);
  verifier("suppression de page : les liens des textes sont comptés à part", bilan.textes === 1 && bilan.retires === 1, JSON.stringify(bilan));
  Op.supprimerPage(c, pageId);
  verifier("suppression de page : le lien du texte est défait, ses mots restent", c.blocs["faq-1"].intro === 'Voir nos tarifs ou <a href="https://example.com">ailleurs</a>.', c.blocs["faq-1"].intro);
}

/* « Voir le plan » : la fenêtre et le rendu appliquent la même règle. */
{
  const C = (valeur) => Liens.composerDestination({ genre: "web", valeur }, { plan: true });
  verifier("plan : une adresse http:// devient https://", C("http://maps.google.com/?q=Rieddorf") === "https://maps.google.com/?q=Rieddorf");
  verifier("plan : https:// gardé tel quel", C("https://www.openstreetmap.org/#map=18/48.3/7.4") === "https://www.openstreetmap.org/#map=18/48.3/7.4");
  verifier("plan : une adresse rangée en http:// se signale", typeof Liens.planAffiche === "function" && !Liens.planAffiche("http://maps.google.com") && Liens.planAffiche("https://maps.google.com"));
  const { rendreCorps: rendre } = await import("../socle/public/rendu/page.js");
  const c = neuf();
  c.blocs["horaires-1"].lienPlan = C("http://maps.google.com/?q=Rieddorf");
  verifier("plan composé : visible sur le site public", rendre({ contenu: c, client: {}, edition: false }).includes("maps.google.com/?q=Rieddorf"));
  verifier("un autre lien garde son http://", Liens.composerDestination({ genre: "web", valeur: "http://example.com" }) === "http://example.com");
}

/* Un lien vers une section masquée : la description le dit. */
{
  const c = neuf();
  Op.basculerMasque(c, "horaires-1");
  verifier("description d'un lien vers une section masquée", /masquée/.test(Liens.decrireDestination(c, "#horaires", "accueil")) && /nulle part/.test(Liens.decrireDestination(c, "#horaires", "accueil")));
  verifier("description d'un lien vers une section visible : inchangée", Liens.decrireDestination(c, "#nos-pains", "accueil") === "Section « " + Liens.sectionsDe(c, "accueil").find((x) => x.ancre === "nos-pains").nom + " »");
}

/* Les messages d'erreur : un seul geste, jamais de jargon. */
{
  const M = (erreur, message) => Textes.messageErreur(new ErreurApi({ statut: 400, erreur, message }));
  const pub = M("publication_impossible", "La publication n'a pas pu se faire. Rien n'a changé sur le site : réessayez dans un instant.");
  verifier("phrase du serveur qui dit déjà quoi faire : pas de second geste", (pub.match(/essayez/gi) || []).length === 1, pub);
  verifier("phrase du serveur sans geste : le geste est ajouté", M("publication_impossible", "La publication n'a pas pu se faire. Rien n'a changé sur le site.") === "La publication n'a pas pu se faire. Rien n'a changé sur le site. Réessayez dans quelques minutes.");
  const quota = M("quota_atteint", "La médiathèque est pleine (1 000 photos ou 1 Go). Retirez des photos pour en ajouter d'autres.");
  verifier("médiathèque pleine : une seule consigne", (quota.match(/retirez/gi) || []).length === 1, quota);
  verifier("refus de sécurité : notre phrase, pas le jargon du serveur", M("type_refuse", "Format de demande non accepté.") === "L'opération a été refusée. Rechargez la page, puis réessayez." && !/Rechargez.*Rechargez/.test(M("origine_refusee", "Refusée par sécurité. Rechargez la page et recommencez.")));
}

/* Les champs « Pour Google » : le conseil dit ce qui s'affichera vraiment. */
{
  const c = neuf();
  const g = Textes.conseilsGooglePage ? Textes.conseilsGooglePage(c, "tarifs") : null;
  const ga = Textes.conseilsGooglePage ? Textes.conseilsGooglePage(c, "accueil") : null;
  verifier("titre vide : c'est le nom du site", !!g && Textes.conseilLongueur(0, 60, g.titre).includes(c.site.nom));
  verifier("description vide : celle du site", !!g && /description du site/.test(Textes.conseilLongueur(0, 160, g.description)));
  const sansDesc = neuf();
  sansDesc.site.description = "";
  verifier("description vide et site sans description : Google choisit", !!g && /Google choisira/.test(Textes.conseilLongueur(0, 160, Textes.conseilsGooglePage(sansDesc, "tarifs").description)));
  verifier("titre de 58 caractères sur une autre page : trop long avec le nom du site", !!g && Textes.conseilLongueur(58, 60, g.titre) !== "" && g.titre.ajout === Array.from(" · " + c.site.nom).length);
  verifier("titre de 58 caractères sur l'accueil : rien à dire", !!ga && ga.titre.ajout === 0 && Textes.conseilLongueur(58, 60, ga.titre) === "");
  verifier("sans options : le conseil d'avant", Textes.conseilLongueur(0, 60) === "Vide : Google choisira lui-même un texte." && Textes.conseilLongueur(61, 60) !== "");
}

/* La note d'un avis : lue comme le rendu la dessine, proposée par le
   panneau dès que le modèle de la liste porte la clé, et un avis neuf n'en
   hérite aucune. */
{
  const c = neuf();
  const d = descripteurListe(c, "blocs.avis-1.avis");
  verifier("le panneau propose la note d'un avis (le modèle porte la clé), et un avis neuf naît sans note", !!d && Object.prototype.hasOwnProperty.call(d.modele, "note") && typeof PanneauPage.noteLue === "function" && PanneauPage.noteLue(d.modele.note) === "");
  const n = PanneauPage.noteLue;
  verifier("note d'un avis : de 1 à 5, sinon pas de note", typeof n === "function" && n(5) === "5" && n("4") === "4" && n(4.4) === "4" && n("") === "" && n(0) === "" && n(9) === "" && n(null) === "" && n({ toString() { throw new Error("x"); } }) === "");
}

/* ===== Socle 0.3.0 : les messages, les mentions légales, le cadre ===== */

/* L'API des messages : les bonnes adresses, les bons corps, et un
   identifiant vérifié AVANT l'appel (rien d'autre n'entre dans l'adresse). */
{
  const vus = [];
  const api = creerApi({ fetch: async (url, init) => { vus.push({ url, init }); return new Response(url.endsWith("/messages") ? '{"messages":[]}' : '{"ok":true}', { status: 200 }); } });
  await api.messages();
  await api.marquerMessage(12, true);
  await api.marquerMessage("12", "oui");
  await api.supprimerMessage(12);
  verifier("API messages : la liste", vus[0] && vus[0].url === "/admin/api/messages" && vus[0].init.method === "GET");
  verifier("API messages : marquer lu", vus[1] && vus[1].url === "/admin/api/messages/12/lu" && vus[1].init.method === "POST" && vus[1].init.body === '{"lu":true}' && vus[1].init.headers["Content-Type"] === "application/json");
  verifier("API messages : seul le vrai `true` marque lu", vus[2] && vus[2].init.body === '{"lu":false}');
  verifier("API messages : supprimer", vus[3] && vus[3].url === "/admin/api/messages/12/supprimer" && vus[3].init.method === "POST" && vus[3].init.body === "{}");
  const refuse = async (f) => { try { await f(); return false; } catch (e) { return e instanceof ErreurApi && e.statut === 404; } };
  const tous = await Promise.all([
    refuse(() => api.supprimerMessage("12/../../brouillon")), refuse(() => api.supprimerMessage(0)),
    refuse(() => api.marquerMessage(-3, true)), refuse(() => api.marquerMessage(1.5, true)), refuse(() => api.supprimerMessage("012"))
  ]);
  verifier("API messages : identifiant douteux refusé sans appel", tous.every(Boolean) && vus.length === 4, JSON.stringify(tous));
}

/* La liste reçue du serveur, mise en forme sûre. */
{
  const N = Messages.normaliserMessages({ messages: [
    { id: 3, quand: 30, nom: "<b>Zoé</b>", email: "z@example.fr", telephone: "", message: "Bonjour", lu: false, page: "accueil" },
    { id: "7", quand: 70, nom: 5, lu: 1 },
    { id: 0 }, { id: -1 }, { id: "x" }, null, [1],
    { id: 3, quand: 99, nom: "Doublon" },
    { id: 9, quand: 70, lu: "true", message: { toString() { throw new Error("piège"); } } }
  ] });
  verifier("messages : du plus récent au plus ancien, sans identifiant douteux ni doublon", N.map((m) => m.id).join(",") === "9,7,3", N.map((m) => m.id).join(","));
  verifier("messages : un champ qui n'est pas du texte devient vide", N.find((m) => m.id === 7).nom === "" && N.find((m) => m.id === 9).message === "");
  verifier("messages : « lu » seulement pour true (ou le 1 d'une colonne)", N.find((m) => m.id === 7).lu === true && N.find((m) => m.id === 9).lu === false && N.find((m) => m.id === 3).lu === false);
  verifier("messages : le texte du visiteur est gardé tel quel (il sera posé en texte)", N.find((m) => m.id === 3).nom === "<b>Zoé</b>");
  verifier("messages : réponse abîmée → liste vide", Messages.normaliserMessages(null).length === 0 && Messages.normaliserMessages({ messages: "x" }).length === 0);
  const beaucoup = { messages: Array.from({ length: 250 }, (_, i) => ({ id: i + 1, quand: i })) };
  verifier("messages : jamais plus de 200", Messages.normaliserMessages(beaucoup).length === Messages.MAX_MESSAGES && Messages.MAX_MESSAGES === 200);
}

/* « Répondre » et l'appel : fabriqués, jamais recopiés. */
{
  const L = Messages.lienRepondre;
  verifier("Répondre : l'adresse et l'objet tout prêt", L("marie@example.fr", "Boulangerie <em>Muller</em>") === "mailto:marie@example.fr?subject=" + encodeURIComponent("Votre message sur Boulangerie Muller"), String(L("marie@example.fr", "Boulangerie <em>Muller</em>")));
  verifier("Répondre : sans nom de site, une formule neutre", L("marie@example.fr", "").endsWith(encodeURIComponent("Votre message sur notre site")));
  const piege = L("a@b.fr?bcc=espion@example.fr", "Site");
  verifier("Répondre : une adresse piégée n'ajoute ni copie cachée ni texte", !!piege && piege.split("?").length === 2 && !/[?&]bcc=/i.test(piege), String(piege));
  const piege2 = L("moi@exemple.fr&body=Virez%20500%20euros", "Site");
  verifier("Répondre : « &body= » encodé, donc inerte", !!piege2 && !/[?&]body=/i.test(piege2) && piege2.indexOf("&") === -1, String(piege2));
  verifier("Répondre : pas d'adresse, pas de lien", [null, "", "pas une adresse", "a b@c.fr", "a@b", "@b.fr", "a@", "a@b.fr\nBcc: x@y.fr", "a@" + "b".repeat(260) + ".fr"].every((x) => L(x, "S") === null));
  verifier("Répondre : un caractère que l'encodage refuse ne fait pas planter", L("a\uD800@b.fr", "S") === null);
  verifier("appel : la règle du site", Messages.lienAppel("03 89 12 34 56") === "tel:0389123456" && Messages.lienAppel("+41 22 123 45 67") === "tel:+41221234567");
  verifier("appel : ce qui n'est pas un numéro ne fait pas de lien", Messages.lienAppel("appelez-moi") === null && Messages.lienAppel("javascript:alert(1)") === null && Messages.lienAppel(null) === null);
}

/* Ce que la liste affiche. */
{
  const A = Messages.apercuMessage;
  verifier("aperçu : sur une ligne", A("Bonjour,\n\nje voudrais   un gâteau.") === "Bonjour, je voudrais un gâteau.");
  const long = A("Bonjour je voudrais commander un grand kougelhopf pour dimanche prochain avec des amandes et du sucre glace merci beaucoup");
  verifier("aperçu : coupé sur un mot, avec « … »", Array.from(long).length <= 90 && long.endsWith("…") && !/\s…$/.test(long), long);
  verifier("aperçu : les caractères qui retournent le texte sont retirés", A("Bon\u202Ejour") === "Bonjour");
  verifier("nom vide : « Sans nom »", Messages.nomVisiteur("  ") === "Sans nom" && Messages.nomVisiteur("Zoé") === "Zoé");
  const P = Messages.libellePastille;
  verifier("pastille : rien à zéro, le chiffre, puis « 99+ »", P(0) === "" && P(3) === "3" && P(99) === "99" && P(100) === "99+" && P(-2) === "" && P(1.5) === "" && P("4") === "");
  verifier("non-lus en phrase", Messages.phraseNonLus(1) === "1 message non lu" && Messages.phraseNonLus(4) === "4 messages non lus" && Messages.phraseNonLus(0) === "aucun message non lu");
  verifier("résumé de la liste", Messages.resumeMessages([{ lu: true }, { lu: false }]) === "2 messages, dont 1 non lu." && Messages.resumeMessages([{ lu: true }]) === "1 message." && Messages.resumeMessages([]) === "Aucun message.");
}

/* La boîte : lu à l'ouverture, non lu, supprimer, compte des non-lus. */
function fausseApiMessages(serveur) {
  const echecs = { lu: [], supprimer: [], messages: [] };
  const appels = [];
  const introuvable = () => new ErreurApi({ statut: 404, erreur: "introuvable" });
  return {
    serveur, echecs, appels,
    async messages() {
      appels.push(["messages"]);
      const e = echecs.messages.shift();
      if (e) throw e;
      return { messages: serveur.map((m) => Object.assign({}, m)) };
    },
    async marquerMessage(id, lu) {
      appels.push(["lu", id, lu]);
      const e = echecs.lu.shift();
      if (e) throw e;
      const m = serveur.find((x) => x.id === id);
      if (!m) throw introuvable();
      m.lu = lu;
      return { ok: true };
    },
    async supprimerMessage(id) {
      appels.push(["supprimer", id]);
      const e = echecs.supprimer.shift();
      if (e) throw e;
      const i = serveur.findIndex((x) => x.id === id);
      if (i < 0) throw introuvable();
      serveur.splice(i, 1);
      return { ok: true };
    }
  };
}
{
  const api = fausseApiMessages([
    { id: 1, quand: 10, nom: "Ancien", email: "a@example.fr", message: "Vieux", lu: true, page: "accueil" },
    { id: 2, quand: 20, nom: "Marie", email: "m@example.fr", message: "Bonjour", lu: false, page: "accueil" },
    { id: 3, quand: 30, nom: "Paul", email: "p@example.fr", message: "Salut", lu: false, page: "accueil" }
  ]);
  let t = 1000;
  const boite = Messages.creerBoiteMessages({ api, nonLus: 5, maintenant: () => t });
  let prevenu = 0;
  boite.ecouter(() => prevenu++);
  // Le compte du démarrage vaut un chargement récent (`age` 0) : la
  // minuterie ne repart pas au serveur juste après l'ouverture ; l'onglet,
  // lui, charge la liste (`doitCharger`).
  verifier("boîte : au démarrage, le compte du serveur", boite.nonLus === 5 && boite.liste === null && boite.doitCharger() && boite.age() === 0);
  const p = boite.charger();
  verifier("boîte : charger ne prévient pas en partant (le panneau se construit)", prevenu === 0 && boite.enCours && !boite.doitCharger());
  verifier("boîte : deux chargements à la fois, un seul appel", boite.charger() === p);
  await p;
  verifier("boîte : chargée, du plus récent au plus ancien, compte recalculé", boite.liste.map((m) => m.id).join(",") === "3,2,1" && boite.nonLus === 2 && prevenu === 1 && api.appels.filter((a) => a[0] === "messages").length === 1);
  verifier("boîte : fraîche, elle ne repart pas au serveur", !boite.doitCharger());
  t += Messages.FRAICHEUR_MS + 1;
  verifier("boîte : plus d'une minute, elle se recharge à l'ouverture de l'onglet", boite.doitCharger());

  const ouverture = boite.ouvrir(2);
  verifier("ouvrir : le message est lu tout de suite à l'écran", boite.estOuvert(2) && boite.liste.find((m) => m.id === 2).lu === true && boite.nonLus === 1);
  await ouverture;
  verifier("ouvrir : le serveur l'apprend", api.appels.some((a) => a[0] === "lu" && a[1] === 2 && a[2] === true) && api.serveur.find((m) => m.id === 2).lu === true);
  const avant = api.appels.length;
  await boite.ouvrir(1);
  verifier("ouvrir un message déjà lu : aucun appel", api.appels.length === avant && boite.estOuvert(1));
  boite.fermer(1);
  verifier("fermer un message", !boite.estOuvert(1));

  const nonLu = await boite.marquerNonLu(2);
  verifier("marquer comme non lu : refermé, non lu, compté, et le serveur le sait", nonLu.ok && !boite.estOuvert(2) && boite.liste.find((m) => m.id === 2).lu === false && boite.nonLus === 2 && api.serveur.find((m) => m.id === 2).lu === false);

  api.echecs.lu.push(new ErreurApi({ statut: 0, erreur: "reseau" }));
  const rate = await boite.ouvrir(3);
  verifier("marque refusée : le message redevient non lu, l'erreur remonte", !rate.ok && rate.erreur.erreur === "reseau" && boite.liste.find((m) => m.id === 3).lu === false && boite.nonLus === 2 && boite.estOuvert(3));

  const suppr = await boite.supprimer(3);
  verifier("supprimer : retiré de la liste et du serveur, compte suivi", suppr.ok && !boite.liste.some((m) => m.id === 3) && !boite.estOuvert(3) && boite.nonLus === 1 && !api.serveur.some((m) => m.id === 3));
  api.serveur.splice(api.serveur.findIndex((m) => m.id === 1), 1);
  const ailleurs = await boite.supprimer(1);
  verifier("supprimé depuis un autre appareil : retiré quand même, et on le dit", ailleurs.ok && ailleurs.introuvable && !boite.liste.some((m) => m.id === 1));
  api.echecs.supprimer.push(new ErreurApi({ statut: 503, erreur: "indisponible" }));
  const panne = await boite.supprimer(2);
  verifier("suppression en panne : le message reste", !panne.ok && boite.liste.some((m) => m.id === 2));
  verifier("sans compte du serveur, la liste fait foi", boite.nonLus === 1 && boite.total === null && boite.tronquee === false && !boite.peutChargerPlusAnciens);
}
{
  // Un écouteur en panne (un défaut d'affichage) n'empêche pas les autres
  // d'être prévenus. La panne est écrite dans la console : on la fait taire
  // le temps de l'essai.
  const boite = Messages.creerBoiteMessages({ api: { async messages() { return { messages: [] }; } } });
  let prevenu = 0;
  boite.ecouter(() => { throw new Error("écouteur en panne"); });
  boite.ecouter(() => prevenu++);
  const ecrire = console.error;
  console.error = () => {};
  try { await boite.charger(); } finally { console.error = ecrire; }
  verifier("boîte : un écouteur en panne n'empêche pas les autres", prevenu === 1);
}
{
  // Une liste rechargée pendant qu'une marque « lu » voyage : le serveur dit
  // encore « non lu », mais le message est ouvert sous les yeux de l'artisan.
  const serveur = [{ id: 5, quand: 1, nom: "A", lu: false }];
  let liberer = null;
  const api = {
    async messages() { return { messages: serveur.map((m) => Object.assign({}, m)) }; },
    marquerMessage(id, lu) { return new Promise((r) => { liberer = () => { serveur[0].lu = lu; r({ ok: true }); }; }); },
    async supprimerMessage() { return { ok: true }; }
  };
  const boite = Messages.creerBoiteMessages({ api });
  await boite.charger();
  const p = boite.ouvrir(5);
  await boite.charger();
  verifier("rechargée pendant une marque en route : le message ouvert reste lu", boite.liste[0].lu === true && boite.estOuvert(5) && boite.nonLus === 0);
  if (liberer) liberer();
  await p;
}
{
  const api = { async messages() { throw new ErreurApi({ statut: 0, erreur: "reseau" }); } };
  let t = 0;
  const boite = Messages.creerBoiteMessages({ api, nonLus: 2, maintenant: () => t });
  t = 5;
  const r = await boite.charger();
  verifier("chargement en panne : l'erreur est gardée, le compte du serveur aussi", !r.ok && boite.erreur && boite.erreur.erreur === "reseau" && boite.liste === null && boite.nonLus === 2);
  verifier("chargement en panne : pas de relance à chaque reconstruction", !boite.doitCharger());
}

/* ----- Relecture du 3 octobre 2026 : la liste au-delà de 200 messages -----
   Un faux serveur PAGINÉ, comme celui du socle 0.3.0 : les 200 plus
   récents, ou ceux d'avant `avant`, avec les comptes de toute la boîte. */
function fausseApiPaginee(serveur, { paginee = true, comptes = true } = {}) {
  const appels = [];
  const introuvable = () => new ErreurApi({ statut: 404, erreur: "introuvable" });
  return {
    serveur, appels,
    async messages(avant = null) {
      appels.push(avant);
      const tries = serveur.slice().sort((a, b) => b.id - a.id);
      const reste = paginee && avant !== null ? tries.filter((m) => m.id < avant) : tries;
      const r = { messages: reste.slice(0, 200).map((m) => Object.assign({}, m)) };
      if (comptes) Object.assign(r, { total: serveur.length, nonLus: serveur.filter((m) => !m.lu).length, suite: reste.length > 200 });
      return r;
    },
    async marquerMessage(id, lu) {
      const m = serveur.find((x) => x.id === id);
      if (!m) throw introuvable();
      m.lu = lu;
      return { ok: true };
    },
    async supprimerMessage(id) {
      const i = serveur.findIndex((x) => x.id === id);
      if (i < 0) throw introuvable();
      serveur.splice(i, 1);
      return { ok: true };
    }
  };
}
{
  const L = Messages.lireReponseMessages;
  const r = L({ messages: [{ id: 5, quand: 1 }], total: 201, nonLus: 7, suite: true });
  verifier("réponse paginée : la liste, les comptes, la suite", r.liste.length === 1 && r.total === 201 && r.nonLus === 7 && r.suite === true);
  verifier("réponse paginée : « suite » écrite par l'identifiant d'où repartir, ou absente",
    L({ messages: [], suite: 42 }).suite === true && L({ messages: [], suite: false }).suite === false && L({ messages: [], suite: null }).suite === false && L({ messages: [] }).suite === null);
  verifier("réponse paginée : un compte douteux est ignoré", L({ messages: [], total: -1, nonLus: "3" }).total === null && L({ messages: [], total: 1.5 }).total === null &&
    L({ messages: [], nonLus: "3" }).nonLus === null && L(null).total === null && L(null).liste.length === 0);
}
{
  const vus = [];
  const api = creerApi({ fetch: async (url) => { vus.push(url); return new Response('{"messages":[]}', { status: 200 }); } });
  await api.messages();
  await api.messages(1234);
  await api.messages("56");
  let refus = false;
  try { await api.messages("12&x=1"); } catch (e) { refus = e instanceof ErreurApi && e.statut === 404; }
  verifier("API messages : les plus anciens par « ?avant= », identifiant vérifié avant l'appel",
    vus.join(" ") === "/admin/api/messages /admin/api/messages?avant=1234 /admin/api/messages?avant=56" && refus, vus.join(" "));
}
{
  // Le scénario de la relecture : la cliente écrit, puis deux jours de
  // robots (100 par jour, la limite du site). 201 messages, tous non lus.
  const serveur = [{ id: 1, quand: 1, nom: "Marie Dupont", email: "marie@example.fr", message: "La pièce montée du mariage du 14.", lu: false }];
  for (let i = 2; i <= 201; i++) serveur.push({ id: i, quand: i, nom: "Promo SEO " + i, email: "seo" + i + "@spam.example", message: "Boostez votre référencement", lu: false });
  const api = fausseApiPaginee(serveur);
  const boite = Messages.creerBoiteMessages({ api, nonLus: 201 });
  await boite.charger();
  const marie = () => boite.liste.some((m) => m.nom === "Marie Dupont");
  verifier("déluge : 200 messages affichés, celui de Marie n'en fait pas partie", boite.liste.length === 200 && !marie());
  verifier("déluge : la pastille garde le compte du serveur, 201", boite.nonLus === 201 && boite.total === 201, boite.nonLus + " / " + boite.total);
  verifier("déluge : la liste se sait coupée, et peut aller plus loin", boite.tronquee && boite.peutChargerPlusAnciens);
  const resume = Messages.resumeMessages(boite.liste, boite);
  const note = Messages.phraseListeCoupee({ affiches: boite.liste.length, total: boite.total, peutCharger: boite.peutChargerPlusAnciens });
  verifier("déluge : le résumé dit 201, la note dit 200 sur 201, le bouton et où trouver le reste",
    resume === "201 messages, dont 201 non lus." && /Seuls les 200 plus récents sont affichés \(sur 201\)/.test(note) &&
    note.includes("« " + Messages.LIBELLE_PLUS_ANCIENS + " »") && Messages.LIBELLE_PLUS_ANCIENS === "Afficher les messages plus anciens" && /onglet « Compte »/.test(note), resume + " | " + note);
  verifier("sans bouton, la note ne le promet pas", !/Afficher les messages plus anciens/.test(Messages.phraseListeCoupee({ affiches: 200, total: 201, peutCharger: false })));
  /* Contrôle du 3 octobre 2026 : la copie de l'onglet « Compte » n'emporte
     que les 2 000 plus récents (atelier-coeur.js). « Les contient tous »
     n'est dit que lorsque c'est vrai. */
  const coeurSrc = readFileSync(racine + "socle/serveur/atelier-coeur.js", "utf8");
  const exportes = /const MESSAGES_EXPORTES = (\d+);/.exec(coeurSrc);
  verifier("la limite de l'export est la même côté éditeur et côté serveur", !!exportes && Number(exportes[1]) === Messages.MESSAGES_EXPORTES, exportes && exportes[1]);
  const grosse = Messages.phraseListeCoupee({ affiches: 200, total: 36500, peutCharger: true });
  verifier("au-delà de 2 000 messages, la note ne promet plus que la copie les contient tous",
    !/les contient tous/.test(grosse) && grosse.includes("contient les 2 000 plus récents") && grosse.includes("(sur 36 500)") &&
    /les contient tous/.test(Messages.phraseListeCoupee({ affiches: 200, total: 2000, peutCharger: true })), grosse);
  const r = await boite.chargerPlusAnciens();
  verifier("plus anciens : demandés depuis le plus petit identifiant affiché", api.appels.length === 2 && api.appels[0] === null && api.appels[1] === 2, JSON.stringify(api.appels));
  verifier("plus anciens : le message de Marie arrive, en bas de la liste", r.ok && r.ajoutes === 1 && r.premier === 1 && marie() && boite.liste[boite.liste.length - 1].id === 1);
  verifier("plus anciens : plus rien de coupé, le compte n'a pas bougé", !boite.tronquee && !boite.peutChargerPlusAnciens && boite.total === 201 && boite.nonLus === 201 &&
    Messages.resumeMessages(boite.liste, boite) === "201 messages, dont 201 non lus.");
  await boite.ouvrir(1);
  verifier("ouvrir un message d'une page plus ancienne : la pastille baisse d'un", boite.nonLus === 200 && serveur.find((m) => m.id === 1).lu === true);
  await boite.supprimer(150);
  verifier("supprimer un non-lu : total et non-lus baissent d'un", boite.total === 200 && boite.nonLus === 199);
  const deux = boite.chargerPlusAnciens();
  verifier("plus anciens : deux clics, un seul appel", boite.chargerPlusAnciens() === deux);
  await deux;
}
{
  // 250 messages, le seul non-lu tout en bas.
  const serveur = [];
  for (let i = 1; i <= 250; i++) serveur.push({ id: i, quand: i, nom: "V" + i, lu: i !== 1 });
  const api = fausseApiPaginee(serveur);
  const boite = Messages.creerBoiteMessages({ api });
  await boite.charger();
  verifier("un non-lu hors de la liste compte sur la pastille", boite.liste.length === 200 && boite.nonLus === 1 && boite.total === 250 && boite.tronquee);
  await boite.chargerPlusAnciens();
  serveur.push({ id: 251, quand: 251, nom: "Nouveau", lu: false });
  await boite.charger({ discret: true });
  verifier("un rafraîchissement garde les messages plus anciens déjà affichés", boite.liste.length === 251 && boite.liste[0].id === 251 &&
    boite.liste.some((m) => m.id === 1) && !boite.tronquee && boite.nonLus === 2, boite.liste.length + " / " + boite.nonLus);
  for (let i = 252; i <= 460; i++) serveur.push({ id: i, quand: i, nom: "V" + i, lu: true });
  await boite.charger();
  verifier("plus de 200 messages arrivés entre-temps : on repart de la première page, sans trou",
    boite.liste.length === 200 && boite.liste[0].id === 460 && boite.liste[199].id === 261 && boite.tronquee && boite.total === 460 && boite.nonLus === 2);
}
{
  // Une marque « lu » en route pendant un rechargement : le serveur compte
  // encore ce message non lu, la boîte ne le compte pas deux fois.
  const serveur = [{ id: 1, quand: 1, nom: "A", lu: false }, { id: 2, quand: 2, nom: "B", lu: false }];
  let liberer = null;
  const api = fausseApiPaginee(serveur);
  api.marquerMessage = (id, lu) => new Promise((r) => { liberer = () => { serveur.find((m) => m.id === id).lu = lu; r({ ok: true }); }; });
  const boite = Messages.creerBoiteMessages({ api });
  await boite.charger();
  const p = boite.ouvrir(2);
  await boite.charger();
  verifier("marque en route pendant un rechargement : comptée une seule fois", boite.nonLus === 1 && boite.liste.find((m) => m.id === 2).lu === true, String(boite.nonLus));
  liberer();
  await p;
  await boite.charger();
  verifier("…et toujours une fois après son arrivée", boite.nonLus === 1);
}
{
  const serveur = [];
  for (let i = 1; i <= 230; i++) serveur.push({ id: i, quand: i, lu: false });
  const boite = Messages.creerBoiteMessages({ api: fausseApiPaginee(serveur, { paginee: false, comptes: false }), nonLus: 230 });
  await boite.charger();
  verifier("serveur sans comptes : la liste fait foi, rien n'est promis", boite.liste.length === 200 && boite.nonLus === 200 && boite.total === null && !boite.tronquee && !boite.peutChargerPlusAnciens);
}
{
  // Un serveur qui compte mais ignore `avant` : le bouton ne tourne pas à vide.
  const serveur = [];
  for (let i = 1; i <= 230; i++) serveur.push({ id: i, quand: i, lu: true });
  const boite = Messages.creerBoiteMessages({ api: fausseApiPaginee(serveur, { paginee: false }) });
  await boite.charger();
  const r = await boite.chargerPlusAnciens();
  verifier("serveur qui ignore « avant » : rien d'ajouté, le bouton disparaît, la note reste", r.ok && r.ajoutes === 0 && boite.liste.length === 200 && boite.tronquee && !boite.peutChargerPlusAnciens);
}
{
  /* Contrôle du 3 octobre 2026. Des messages arrivent EN HAUT entre le
     premier chargement et « Afficher les messages plus anciens » : le compte
     du serveur dépasse alors la liste, mais rien de plus ancien ne reste. La
     note annonçait « Seuls les 250 plus récents (sur 255) » et le bouton ne
     ramenait rien ; ce clic sans résultat retirait le bouton pour toute la
     session, même après un déluge qui recoupait la liste. */
  const serveur = [];
  for (let i = 1; i <= 250; i++) serveur.push({ id: i, quand: i, nom: "V" + i, lu: true });
  const api = fausseApiPaginee(serveur);
  const boite = Messages.creerBoiteMessages({ api });
  await boite.charger();
  for (let i = 251; i <= 255; i++) serveur.push({ id: i, quand: i, nom: "Nouveau " + i, lu: false });
  await boite.chargerPlusAnciens();
  verifier("nouveaux arrivés en haut : la liste n'est pas dite coupée par le bas, pas de bouton qui ne ramène rien",
    boite.liste.length === 250 && boite.total === 255 && boite.nonLus === 5 && !boite.tronquee && !boite.peutChargerPlusAnciens,
    boite.liste.length + " / " + boite.total + " / " + boite.tronquee + " / " + boite.peutChargerPlusAnciens);
  await boite.charger({ discret: true });
  verifier("…et le rechargement suivant les apporte", boite.liste.length === 255 && boite.liste[0].id === 255 && !boite.tronquee);

  // Des plus anciens supprimés depuis un autre appareil : le clic ne ramène
  // rien, le bouton s'en va — puis REVIENT quand le bas de la liste bouge.
  const s2 = [];
  for (let i = 1; i <= 250; i++) s2.push({ id: i, quand: i, nom: "V" + i, lu: true });
  const api2 = fausseApiPaginee(s2);
  const b2 = Messages.creerBoiteMessages({ api: api2 });
  await b2.charger();
  s2.splice(0, 50);
  const vide = await b2.chargerPlusAnciens();
  verifier("plus anciens supprimés ailleurs : rien d'ajouté, ni bouton ni liste dite coupée", vide.ok && vide.ajoutes === 0 && !b2.peutChargerPlusAnciens && !b2.tronquee);
  for (let i = 251; i <= 600; i++) s2.push({ id: i, quand: i, nom: "Robot " + i, lu: false });
  await b2.charger({ discret: true });
  verifier("le bas de la liste a bougé (350 de plus) : le bouton revient", b2.liste.length === 200 && b2.tronquee && b2.peutChargerPlusAnciens,
    b2.tronquee + " / " + b2.peutChargerPlusAnciens);
  const suite = await b2.chargerPlusAnciens();
  verifier("…et ramène bien la suite", suite.ok && suite.ajoutes === 200 && b2.liste.length === 400 && b2.tronquee && b2.peutChargerPlusAnciens, suite.ajoutes + " / " + b2.liste.length);
}

/* ----- La pastille se met à jour toute seule (relecture du 3 octobre 2026) ----- */
{
  const F = Messages.fautRafraichir;
  const M = Messages.RAFRAICHIR_MESSAGES_MS;
  verifier("pastille : toutes les deux minutes au plus", M === 2 * 60 * 1000);
  verifier("pastille : visible depuis plus de deux minutes, ou jamais chargée → on recharge", F({ visible: true, age: M + 1, enCours: false }) && F({ visible: true, age: Infinity, enCours: false }));
  verifier("pastille : moins de deux minutes → non", !F({ visible: true, age: M - 1000, enCours: false }));
  verifier("pastille : page cachée, ou chargement en cours → jamais", !F({ visible: false, age: 2 * 3600e3, enCours: false }) && !F({ visible: true, age: 2 * 3600e3, enCours: true }) && !F({}));
  verifier("pastille : au retour sur l'onglet, dès quelques secondes", F({ visible: true, age: Messages.RETOUR_MIN_MS + 1, enCours: false, retour: true }) &&
    !F({ visible: true, age: 1000, enCours: false, retour: true }) && !F({ visible: false, age: Infinity, enCours: false, retour: true }));
  // Deux heures au premier plan, la minuterie de l'éditeur toutes les 30 s,
  // une cliente qui écrit à la cinquième minute.
  let t = 1e9;
  const debut = t;
  const serveur = [];
  const api = fausseApiPaginee(serveur);
  const boite = Messages.creerBoiteMessages({ api, nonLus: 0, maintenant: () => t });
  let pastille = null;
  boite.ecouter(() => { pastille = boite.nonLus; });
  for (let s = 0; s <= 2 * 3600; s += 30) {
    t = debut + s * 1000;
    if (s === 5 * 60) serveur.push({ id: 1, quand: t, nom: "Cliente", lu: false });
    if (F({ visible: true, age: boite.age(), enCours: boite.enCours })) await boite.charger({ discret: true });
  }
  verifier("pastille : deux heures au premier plan, le message de 10 h 05 y arrive", pastille === 1 && boite.nonLus === 1);
  verifier("pastille : jamais plus d'un appel par tranche de deux minutes", api.appels.length >= 40 && api.appels.length <= 60, String(api.appels.length));
  const src = readFileSync(racine + "socle/public/editeur/application.js", "utf8");
  verifier("pastille : l'éditeur a sa minuterie, réglée par messages.js", /setInterval\(/.test(src) && /fautRafraichir\(/.test(src) && /charger\(\{ discret: true \}\)/.test(src) &&
    !/const RAFRAICHIR_MESSAGES_MS/.test(src));
}
{
  // La minuterie ne redessine rien pour rien (le focus serait rendu, un
  // lecteur d'écran le relirait toutes les deux minutes).
  const serveur = [{ id: 1, quand: 1, lu: false }];
  const boite = Messages.creerBoiteMessages({ api: fausseApiPaginee(serveur) });
  let prevenu = 0;
  boite.ecouter(() => prevenu++);
  await boite.charger();
  const n0 = prevenu;
  const p = boite.charger({ discret: true });
  verifier("minuterie : son chargement ne s'affiche pas", boite.enCours && !boite.chargementAffiche);
  await p;
  verifier("minuterie : rien de changé, rien de redessiné", prevenu === n0);
  serveur.push({ id: 2, quand: 2, lu: false });
  await boite.charger({ discret: true });
  verifier("minuterie : un nouveau message redessine, et la pastille monte", prevenu === n0 + 1 && boite.nonLus === 2);
  const q = boite.charger({ discret: true });
  boite.charger();
  verifier("un chargement demandé rejoint celui de la minuterie, et s'affiche", boite.chargementAffiche);
  await q;
  verifier("…et redessine à l'arrivée, même sans changement", prevenu === n0 + 2);
}

/* ----- Un chargement raté se dit (relecture du 3 octobre 2026) ----- */
{
  const e = new ErreurApi({ statut: 0, erreur: "reseau" });
  const P = Messages.phraseEchecChargement;
  verifier("échec : une liste déjà là « n'a pas pu être mise à jour », avec la cause", typeof P === "function" &&
    P(e, { listeDejaLa: true }) === "La liste n'a pas pu être mise à jour : elle peut ne pas montrer les tout derniers messages. Pas de connexion à Internet pour l'instant. Vérifiez votre connexion, puis réessayez.");
  verifier("échec : sans liste, « les messages n'ont pas pu être chargés »", typeof P === "function" && P(e, { listeDejaLa: false }).startsWith("Les messages n'ont pas pu être chargés. Pas de connexion"));
}

/* Une boîte vide dit où arrivent les messages, et comment afficher le
   formulaire s'il ne l'est pas. */
{
  const c = neuf();
  c.blocs["contact-1"].formulaire = true;
  const actif = Messages.phraseSansMessage(c);
  verifier("boîte vide, formulaire activé : on le dit, sans bouton", /arrivent ici/.test(actif.texte) && /activé/.test(actif.texte) && actif.cible === null, actif.texte);
  c.blocs["contact-1"].formulaire = false;
  const inactif = Messages.phraseSansMessage(c);
  verifier("boîte vide, formulaire non coché : la case à cocher, nommée comme dans le panneau", !!inactif.cible && inactif.cible.id === "contact-1" && inactif.texte.includes("« Afficher un formulaire de contact »"), inactif.texte);
  c.blocs["contact-1"].masque = true;
  const masque = Messages.phraseSansMessage(c);
  verifier("boîte vide, section Contact masquée : on le dit", /masquée/.test(masque.texte) && masque.cible && masque.cible.id === "contact-1");
  c.pages.accueil.ordre = c.pages.accueil.ordre.filter((id) => id !== "contact-1");
  const aucune = Messages.phraseSansMessage(c);
  verifier("boîte vide, pas de section Contact : comment en ajouter une", /ajoutez une section « Contact »/.test(aucune.texte) && aucune.cible === null);
  verifier("boîte vide, contenu abîmé : une phrase quand même", /^Aucun message/.test(Messages.phraseSansMessage(null).texte));
  const masqueAvecFormulaire = neuf();
  masqueAvecFormulaire.blocs["contact-1"].masque = true;
  verifier("un formulaire dans une section masquée n'est pas « activé »", Messages.etatFormulaire(masqueAvecFormulaire).actifs.length === 0);
}
{
  /* Relecture du 3 octobre 2026 : section masquée, case DÉJÀ cochée. « Cochez »
     faisait cliquer sur la case, donc la décocher. */
  const c = neuf();
  c.blocs["contact-1"].formulaire = true;
  c.blocs["contact-1"].masque = true;
  const coche = Messages.phraseSansMessage(c);
  verifier("section masquée, formulaire déjà coché : afficher, sans « cochez »", /masquée : affichez-la/.test(coche.texte) && !/cochez/i.test(coche.texte) && /déjà cochée/.test(coche.texte) && coche.cible && coche.cible.id === "contact-1", coche.texte);
  c.blocs["contact-1"].formulaire = false;
  const vide = Messages.phraseSansMessage(c);
  verifier("section masquée, formulaire non coché : affichez-la ET cochez", /affichez-la, cochez « Afficher un formulaire de contact »/.test(vide.texte), vide.texte);
}

/* L'aide sous une section Contact qui affiche le formulaire. */
{
  const A = PanneauPage.aideFormulaire;
  verifier("section Contact avec formulaire : « l'onglet Messages »", typeof A === "function" && /onglet « Messages »/.test(A({ type: "contact", formulaire: true }) || ""));
  verifier("sans formulaire, ou un autre genre : rien", typeof A === "function" && A({ type: "contact", formulaire: false }) === null && A({ type: "contact", formulaire: "true" }) === null && A({ type: "faq", formulaire: true }) === null && A(null) === null);
}

/* Le journal : les nouvelles actions en clair, et un e-mail raté qui n'est
   plus forcément le lien de connexion. */
{
  const ref = new Date(2026, 9, 3, 16, 0).getTime();
  verifier("journal : message reçu", Textes.phraseJournal({ action: "message_recu", quand: ref }, ref).startsWith("Message reçu par le formulaire de contact"));
  verifier("journal : message supprimé", Textes.phraseJournal({ action: "message_supprime", quand: ref, par: "essai@example.com" }, ref).startsWith("Message supprimé — "));
  verifier("journal : un e-mail raté n'est plus forcément le lien de connexion", !/lien de connexion/i.test(Textes.ACTIONS_JOURNAL.envoi_echoue));
  verifier("journal : la cause d'un e-mail raté, pour l'atelier", typeof Textes.detailJournal === "function" && Textes.detailJournal({ action: "envoi_echoue", detail: " Aucune adresse d'expédition. " }) === "Aucune adresse d'expédition." && Textes.detailJournal({ action: "publication", detail: "Version 3" }) === "" && Textes.detailJournal(null) === "");
}

/* Le cadre : aucun formulaire ne part, et l'aperçu dit pourquoi. */
{
  const evenement = () => { const e = { annule: 0, preventDefault() { this.annule++; } }; return e; };
  const ea = evenement();
  const phraseApercu = soumissionAnnulee(ea, "apercu");
  verifier("cadre : un envoi en aperçu est annulé, et on dit pourquoi", ea.annule === 1 && /aperçu/.test(phraseApercu) && /onglet « Messages »/.test(phraseApercu));
  const ee = evenement();
  const phraseEdition = soumissionAnnulee(ee, "edition");
  verifier("cadre : un envoi en édition est annulé, sans message", ee.annule === 1 && phraseEdition === "");
  const ev = evenement();
  verifier("cadre : une ancienne version non plus", /ancienne version/.test(soumissionAnnulee(ev, "version")) && ev.annule === 1);
  const champ = (dansTexteEditable) => ({ closest: (s) => (s.includes("input") ? {} : dansTexteEditable ? {} : null) });
  verifier("cadre : un champ du formulaire garde ses touches (Cmd + Z)", saisieDeFormulaire(champ(false)) === true && saisieDeFormulaire(champ(true)) === false && saisieDeFormulaire(null) === false && saisieDeFormulaire({}) === false);
}

/* La page des mentions légales : créée d'un geste, sans toucher au menu,
   annulable d'un coup, et ses « [À compléter …] » comptés. */
function sansMentions() {
  const c = neuf();
  if (c.pages[PAGE_MENTIONS]) {
    for (const id of c.pages[PAGE_MENTIONS].ordre) delete c.blocs[id];
    delete c.pages[PAGE_MENTIONS];
  }
  return c;
}
{
  const c = sansMentions();
  const menu = JSON.stringify(c.entete.liens);
  const pied = JSON.stringify(c.pied.liens);
  const r = Op.ajouterPageModele(c, pageMentionsLegales(c));
  const page = c.pages[PAGE_MENTIONS];
  verifier("mentions légales : la page et sa section sont rangées", r.pageId === PAGE_MENTIONS && !!page && page.ordre.length === 1 && c.blocs[page.ordre[0]].type === "texte" && page.titre === "Mentions légales");
  verifier("mentions légales : rien n'est ajouté au menu ni au bas de page", JSON.stringify(c.entete.liens) === menu && JSON.stringify(c.pied.liens) === pied);
  verifier("mentions légales : la forme canonique la garde telle quelle", JSON.stringify(normaliser(c)) === JSON.stringify(c));
  verifier("mentions légales : une seconde fois, refusée", leve(() => Op.ajouterPageModele(c, pageMentionsLegales(c)), Op.Refus));
  // Le nom du site est connu : il reste forme juridique, adresse, SIRET,
  // RM / RCS, téléphone, e-mail, responsable, adresse des droits.
  // Le nombre suit le modèle du rendu (8 au premier jet, 10 depuis
  // qu'il demande aussi la TVA et le médiateur) : on le lit dans le modèle
  // plutôt que de l'écrire ici.
  const attendus = compterTrous(Object.values(pageMentionsLegales(sansMentions()).blocs));
  verifier("mentions légales : les « [À compléter …] » comptés", attendus >= 8 && Op.trousACompleter(c, PAGE_MENTIONS) === attendus, attendus + " / " + Op.trousACompleter(c, PAGE_MENTIONS));
  /* Masquer la section ne REMPLIT rien : sur la page des mentions légales,
     les trous d'une section masquée comptent toujours. Avant le 3 octobre
     2026, ils disparaissaient du compte, et l'onglet « Site » disait
     « Relisez-la quand quelque chose change » d'une page vide. */
  const masquer = Op.basculerMasque(c, page.ordre[0]);
  verifier("mentions légales : une section masquée compte toujours ses trous", masquer === true && Op.trousACompleter(c, PAGE_MENTIONS) === attendus, String(Op.trousACompleter(c, PAGE_MENTIONS)));
  verifier("ailleurs, une section masquée ne compte pas (elle n'est pas sur le site)", (() => {
    const x = neuf();
    const id = x.pages.accueil.ordre[0];
    x.blocs[id].titre = "[À compléter : titre]";
    const avant = Op.trousACompleter(x, "accueil");
    x.blocs[id].masque = true;
    return avant === 1 && Op.trousACompleter(x, "accueil") === 0;
  })());
  verifier("mentions légales : une page absente n'a pas de trous", Op.trousACompleter(c, "nulle-part") === 0 && Op.trousACompleter(null, PAGE_MENTIONS) === 0);
}
{
  // Le vrai geste passe par `transformer` : un seul pas d'annulation.
  const e = creerEtat(depart(sansMentions()));
  const r = e.transformer((x) => Op.ajouterPageModele(x, pageMentionsLegales(x)));
  verifier("mentions légales : créée par l'éditeur", !!r && !!e.contenu.pages[PAGE_MENTIONS]);
  verifier("mentions légales : « Annuler » la retire d'un coup", e.annuler() && !e.contenu.pages[PAGE_MENTIONS] && !Object.values(e.contenu.blocs).some((b) => b.type === "texte"));
}
{
  // Un modèle abîmé ne range rien.
  const c = sansMentions();
  const avant = JSON.stringify(c);
  const bon = () => ({ pageId: "tarifs-test", page: { titre: "T", description: "", ordre: ["faq-9"] }, blocs: { "faq-9": { type: "faq", titre: "x", questions: [] } } });
  const refus = (m) => leve(() => Op.ajouterPageModele(c, m), Op.Refus);
  verifier("modèle de page : genre inconnu refusé", refus(Object.assign(bon(), { blocs: { "faq-9": { type: "carrousel" } } })));
  verifier("modèle de page : section déjà prise refusée", refus(Object.assign(bon(), { page: { titre: "T", ordre: ["faq-1"] }, blocs: { "faq-1": { type: "faq" } } })));
  verifier("modèle de page : adresse invalide refusée", refus(Object.assign(bon(), { pageId: "Avec Espaces" })) && refus(null) && refus(Object.assign(bon(), { blocs: [] })));
  verifier("modèle de page : une page sans section refusée", refus(Object.assign(bon(), { page: { titre: "T", ordre: ["absente"] } })));
  verifier("modèle de page : rien n'a été écrit par les refus", JSON.stringify(c) === avant);
  const m = bon();
  m.blocs["faq-10"] = { type: "faq", titre: "orpheline" };
  Op.ajouterPageModele(c, m);
  verifier("modèle de page : une section que la page ne montre pas n'entre pas", !!c.blocs["faq-9"] && !c.blocs["faq-10"]);
  const plein = sansMentions();
  for (let i = 0; Object.keys(plein.pages).length < Op.MAX_PAGES; i++) plein.pages["p-" + i] = { titre: "", description: "", ordre: [] };
  verifier("modèle de page : 20 pages au plus", leve(() => Op.ajouterPageModele(plein, pageMentionsLegales(plein)), Op.Refus));
}
{
  // Le compte de l'onglet « Site » voit exactement ce que voit
  // l'avertissement de publication (`contientUnTrou`, structure.js).
  const cas = ["[À compléter]", "[à compléter : x]", "[A completer]", "[ À  compléter", "[&agrave; compléter", "[À&nbsp;compléter", "Rien à compléter", "[Àcompléter", "[À faire]", "<em>[À</em> compléter"];
  const ecarts = cas.filter((s) => (Op.trousDuBloc({ type: "texte", titre: s }) > 0) !== contientUnTrou({ titre: s }));
  verifier("« [À compléter » : le compte et l'avertissement de publication voient la même chose", ecarts.length === 0, ecarts.join(" | "));
  // Une seule écriture du motif et du parcours : celle de structure.js.
  // L'éditeur en avait une copie qui s'arrêtait à 8 niveaux au lieu de 12 —
  // un trou rangé profond passait sous le compte de l'onglet « Site »
  // pendant que la publication le signalait (3 octobre 2026).
  let profond = "[À compléter : très profond]";
  for (let i = 0; i < 10; i++) profond = [profond];
  verifier("« [À compléter » : un trou rangé profond est compté comme il est signalé",
    Op.trousDuBloc({ type: "texte", titre: "", rangement: profond }) === 1 && contientUnTrou({ rangement: profond }) && compterTrous({ rangement: profond }) === 1,
    String(Op.trousDuBloc({ type: "texte", titre: "", rangement: profond })));
  verifier("« [À compléter » : deux trous dans un même texte font deux", compterTrous("Adresse : [À compléter] — SIRET : [à completer]") === 2 &&
    compterTrous(["[À compléter]", { x: "[A completer]" }, "rien"]) === 2 && compterTrous(null) === 0 && compterTrous("") === 0);
  const sourceOperations = readFileSync(racine + "socle/public/editeur/operations.js", "utf8");
  verifier("« [À compléter » : l'éditeur compte avec structure.js, sans motif à lui",
    /import\s*\{[^}]*\bcompterTrous\b[^}]*\}\s*from\s*"\/rendu\/structure\.js"/.test(sourceOperations) && !/compl\[|compl\(\?:/.test(sourceOperations));
}
{
  // L'onglet « Site » : le bouton et sa phrase.
  const sans = sansMentions();
  const e0 = PanneauSite.etatMentions(sans);
  const p0 = PanneauSite.phraseMentions(e0);
  verifier("onglet Site : sans la page, on propose de l'ajouter et on dit qu'elle est obligatoire", !e0.existe && /obligatoires/.test(p0) && /« \[À compléter …\] »/.test(p0));
  Op.ajouterPageModele(sans, pageMentionsLegales(sans));
  const e1 = PanneauSite.etatMentions(sans);
  const n1 = compterTrous(Object.values(pageMentionsLegales(sansMentions()).blocs));
  verifier("onglet Site : la page existe, le compte des trous est dit", e1.existe && !e1.vide && e1.trous === n1 && new RegExp(n1 + " « \\[À compléter …\\] » restent à remplir : remplacez-les").test(PanneauSite.phraseMentions(e1)), PanneauSite.phraseMentions(e1));
  verifier("onglet Site : un seul trou, au singulier", /un « \[À compléter …\] » reste à remplir : remplacez-le /.test(PanneauSite.phraseMentions({ existe: true, trous: 1 })));
  verifier("onglet Site : plus de trou, plus de consigne de trou", !/À compléter/.test(PanneauSite.phraseMentions({ existe: true, trous: 0 })) && /obligatoires/.test(PanneauSite.phraseMentions({ existe: true, trous: 0 })));
  verifier("onglet Site : la démo a sa page, remplie", PanneauSite.etatMentions(neuf()).existe && PanneauSite.etatMentions(neuf()).trous === 0);
}
{
  /* Relecture du 3 octobre 2026 : masquer la section des mentions légales
     faisait taire l'onglet « Site » (« Relisez-la… ») et l'avertissement de
     publication, sur une page qui n'affichait plus rien. */
  const demo = neuf();
  const idDemo = demo.pages[PAGE_MENTIONS].ordre[0];
  verifier("mentions : la démo affiche sa page, la publication n'a rien à dire", !Op.etatPageMentions(demo).vide && Op.avertissementPublication(demo) === null);
  Op.basculerMasque(demo, idDemo);
  const e = PanneauSite.etatMentions(demo);
  const phrase = PanneauSite.phraseMentions(e);
  verifier("mentions masquées : l'onglet Site le dit, et ne rassure plus", e.existe && e.vide && e.masquees === 1 && /n'affiche rien/.test(phrase) && /sa section est masquée/.test(phrase) &&
    /Affichez-la/.test(phrase) && !/Relisez-la/.test(phrase), phrase);
  const avis = Op.avertissementPublication(demo);
  verifier("mentions masquées : la publication prévient", !!avis && avis.lignes.length === 0 && /mentions légales n'affiche rien : sa section est masquée/.test(avis.mentions || "") && /obligatoires/.test(avis.mentions || ""), JSON.stringify(avis));

  const modele = sansMentions();
  Op.ajouterPageModele(modele, pageMentionsLegales(modele));
  const n = compterTrous(Object.values(pageMentionsLegales(sansMentions()).blocs));
  const visible = Op.avertissementPublication(modele);
  verifier("mentions à compléter : la publication les nomme, sans parler de page vide", !!visible && visible.lignes.length === 1 && /« \[À compléter …\] » à remplir$/.test(visible.lignes[0]) &&
    /contient encore des « \[À compléter …\] »/.test(visible.intro) && visible.mentions === null, JSON.stringify(visible));
  Op.basculerMasque(modele, modele.pages[PAGE_MENTIONS].ordre[0]);
  const em = PanneauSite.etatMentions(modele);
  verifier("modèle masqué : vide, et ses trous toujours comptés", em.vide && em.trous === n && new RegExp("remplacez les " + n + " « \\[À compléter …\\] » qui restent").test(PanneauSite.phraseMentions(em)), PanneauSite.phraseMentions(em));

  const sansSection = neuf();
  sansSection.pages[PAGE_MENTIONS].ordre = [];
  const es = PanneauSite.etatMentions(sansSection);
  verifier("mentions sans section : « elle n'a aucune section », et comment la remplir", es.vide && es.sections === 0 && /aucune section/.test(PanneauSite.phraseMentions(es)) && /section « Texte »/.test(PanneauSite.phraseMentions(es)));
  const videe = neuf();
  const b = videe.blocs[videe.pages[PAGE_MENTIONS].ordre[0]];
  for (const k of ["surtitre", "titre", "intro"]) b[k] = "";
  b.paragraphes = [];
  const ev = PanneauSite.etatMentions(videe);
  verifier("mentions aux textes vidés : vide aussi", ev.vide && ev.masquees === 0 && /ses textes sont vides/.test(PanneauSite.phraseMentions(ev)), PanneauSite.phraseMentions(ev));

  // Une page qui garde une section visible, plus une section masquée à trous.
  const deux = neuf();
  const idTrous = "texte-99";
  deux.blocs[idTrous] = { type: "texte", surtitre: "", titre: "Médiation", intro: "", paragraphes: [{ titre: "Médiateur", texte: "[À compléter : nom du médiateur]" }], masque: true };
  deux.pages[PAGE_MENTIONS].ordre.push(idTrous);
  const ad = Op.avertissementPublication(deux);
  verifier("une section masquée des mentions avec des trous : signalée à part", !Op.etatPageMentions(deux).vide && !!ad && /section masquée de la page des mentions légales/.test(ad.mentions || ""), JSON.stringify(ad));
  verifier("mentions : contenu abîmé, aucune exception", [null, {}, { pages: { "mentions-legales": null } }, { pages: { "mentions-legales": { ordre: "x" } }, blocs: {} }].every((x) => {
    try { Op.etatPageMentions(x); Op.avertissementPublication(x); PanneauSite.phraseMentions(Op.etatPageMentions(x)); return true; } catch { return false; }
  }));
}

/* Le défilement du panneau d'un onglet à l'autre (relecture du 3 octobre
   2026) : « Voir les messages », cliqué en bas de l'onglet « Page »,
   ouvrait la liste défilée de 1 124 px, les plus récents cachés au-dessus. */
{
  verifier("panneau : un autre onglet s'ouvre en haut", defilementApres("page", "messages", 1124) === 0 && defilementApres("site", "page", 86.5) === 0);
  verifier("panneau : le même onglet reconstruit garde sa place", defilementApres("messages", "messages", 1487) === 1487);
  verifier("panneau : le premier dessin part du haut", defilementApres(null, "page", 50) === 0 && defilementApres("page", "page", NaN) === 0);
}

/* À 320 px (un vieux téléphone, ou un ordinateur zoomé à 400 %), la
   pastille faisait déborder l'éditeur et l'onglet « Messages » chevauchait
   « Versions » (relecture du 3 octobre 2026). */
{
  const css = readFileSync(racine + "socle/public/editeur/editeur.css", "utf8");
  const regle = (selecteur, dans = css) => {
    const m = new RegExp("(^|[}\\s])" + selecteur.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}").exec(dans);
    return m ? m[2] : "";
  };
  verifier("feuille : l'onglet passe à la ligne au lieu de déborder", /flex-wrap:\s*wrap/.test(regle(".ed-onglet")));
  const etroit = /@media\s*\(max-width:\s*399px\)\s*\{([\s\S]*?\})\s*\}/.exec(css);
  verifier("feuille : sous 400 px, la barre du haut passe à la ligne", !!etroit && /flex-wrap:\s*wrap/.test(regle(".ed-haut__fin", etroit[1])));
}

/* Le contrat d'editeur.js : chaque nom qu'il annonce existe, et chaque nom
   que l'éditeur importe du rendu y figure. Un nom oublié, c'est l'éditeur
   à moitié construit de Graine de Pensée, le 21 septembre 2026. */
{
  const source = readFileSync(racine + "socle/public/editeur/editeur.js", "utf8");
  const m = /const CONTRAT = (\{[\s\S]*?\n\});/.exec(source);
  let contrat = null;
  try { contrat = m ? new Function("return " + m[1])() : null; } catch { contrat = null; }
  verifier("contrat : le modèle des mentions légales y figure", !!contrat && Array.isArray(contrat["/rendu/modeles-pages.js"]) && contrat["/rendu/modeles-pages.js"].includes("PAGE_MENTIONS") && contrat["/rendu/modeles-pages.js"].includes("pageMentionsLegales"));
  const absents = [];
  for (const [chemin, noms] of Object.entries(contrat || {})) {
    let mod = null;
    try { mod = await import(new URL(chemin.slice(1), PUBLIC).href); } catch { absents.push(chemin + " (module)"); continue; }
    for (const nom of noms) if (!(nom in mod)) absents.push(chemin + " : " + nom);
  }
  verifier("contrat : chaque nom annoncé existe dans son module", absents.length === 0, absents.join(", "));
  const oublies = [];
  const dossier = racine + "socle/public/editeur/";
  for (const f of readdirSync(dossier).filter((x) => x.endsWith(".js"))) {
    const texte = readFileSync(dossier + f, "utf8");
    for (const imp of texte.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(\/rendu\/[^"]+)"/g)) {
      for (const brut of imp[1].split(",")) {
        const nom = brut.trim().split(/\s+as\s+/)[0];
        if (nom && !(contrat && Array.isArray(contrat[imp[2]]) && contrat[imp[2]].includes(nom))) oublies.push(f + " → " + imp[2] + " : " + nom);
      }
    }
  }
  verifier("contrat : chaque nom importé du rendu par l'éditeur y figure", oublies.length === 0, oublies.join(", "));
}

/* Le journal : chaque action que le serveur écrit a son libellé dans
   l'onglet Compte. Sans lui, la ligne s'afficherait « Autre opération » —
   lisible, mais muette sur ce qui s'est passé. Le socle 0.3.0 en a ajouté
   deux (message_recu, message_supprime), écrites par un chantier et
   nommées par un autre (3 octobre 2026). */
{
  const coeur = readFileSync(racine + "socle/serveur/atelier-coeur.js", "utf8");
  const ecrites = new Set([
    ...[...coeur.matchAll(/journaliser\(\s*"([a-z_]+)"/g)].map((m) => m[1]),
    // Les gestes qui passent par `remplacerBrouillon` nomment leur action en argument.
    ...[...coeur.matchAll(/remplacerBrouillon\([^;]*?"([a-z_]+)"/g)].map((m) => m[1])
  ]);
  const sansLibelle = [...ecrites].filter((a) => !Object.prototype.hasOwnProperty.call(Textes.ACTIONS_JOURNAL, a));
  // `message_recu` n'est plus écrit par le serveur (une ligne par message
  // laissait des robots chasser les connexions du journal) ; il garde son
  // libellé pour les lignes anciennes, mais n'est plus exigé ici.
  verifier("journal : chaque action écrite par le serveur a son libellé", ecrites.size >= 12 && ecrites.has("message_supprime") && ecrites.has("message_plafond") &&
    ecrites.has("reprise") && sansLibelle.length === 0, [...ecrites].join(", ") + " — sans libellé : " + sansLibelle.join(", "));
}

/* ----- Bilan ----- */
if (echecs.length) {
  for (const e of echecs) console.error("✗ " + e);
  console.error(`\n${echecs.length} échec(s), ${ok} réussite(s).`);
  process.exit(1);
}
console.log(`✓ éditeur : ${ok} vérifications réussies`);
