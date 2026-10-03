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
import { readFileSync } from "node:fs";
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
const { valeurDuChamp } = await import("../socle/public/editeur/cadre.js");
const { normaliser, rendreCorps } = await import("../socle/public/rendu/page.js");
const { lireChemin, descripteurListe } = await import("../socle/public/rendu/structure.js");

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

/* ----- Bilan ----- */
if (echecs.length) {
  for (const e of echecs) console.error("✗ " + e);
  console.error(`\n${echecs.length} échec(s), ${ok} réussite(s).`);
  process.exit(1);
}
console.log(`✓ éditeur : ${ok} vérifications réussies`);
