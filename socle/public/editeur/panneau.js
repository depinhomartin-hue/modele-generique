/* =========================================================
   Le panneau — la STRUCTURE du site, onglet par onglet
   =========================================================

   340 px à droite sur un grand écran, tiroir sous 900 px. Cinq onglets :
   Page, Site, Thème, Versions, Compte (spécification § 6.4).

   ⚠️ Le panneau se reconstruit après un geste de structure, un changement
   de page ou de section choisie — JAMAIS à chaque lettre tapée sur la page
   (leçon de Graine de Pensée : reconstruire à chaque frappe refermait les
   listes dépliées et perdait le focus). Une lettre tapée ne fait que mettre
   à jour le nom des sections. Et si l'artisan est en train d'écrire dans un
   champ du panneau, la reconstruction attend qu'il en sorte. */

import { h, bouton, vider } from "./dom.js";
import { construirePage } from "./panneau-page.js";
import { construireSite } from "./panneau-site.js";
import { construireTheme } from "./panneau-theme.js";
import { construireVersions, construireCompte } from "./panneau-versions.js";
import { nomDuBloc } from "/rendu/structure.js";

const ONGLETS = [
  { id: "page", libelle: "Page", construire: construirePage, modifie: true },
  { id: "site", libelle: "Site", construire: construireSite, modifie: true },
  { id: "theme", libelle: "Thème", construire: construireTheme, modifie: true },
  { id: "versions", libelle: "Versions", construire: construireVersions },
  { id: "compte", libelle: "Compte", construire: construireCompte }
];

export function creerPanneau(app) {
  let onglet = "page";
  let enAttente = false;
  let cleVisee = null;
  const etatLocal = { catalogue: false };

  const fermer = bouton({ libelle: "Fermer les outils", icone: "fermer", seuleIcone: true, classe: "ed-panneau__fermer", quand: () => fermerTiroir() });
  const liste = h("div", { classe: "ed-onglets", role: "tablist", "aria-label": "Outils" });
  const corps = h("div", { classe: "ed-panneau__corps", role: "tabpanel", id: "ed-panneau-corps", tabindex: "-1" });
  const element = h("aside", { classe: "ed-panneau", id: "ed-panneau", "aria-label": "Outils de votre site" },
    h("div", { classe: "ed-panneau__tete" }, h("p", { classe: "ed-panneau__marque" }, "Outils"), fermer),
    liste, corps);

  const boutons = ONGLETS.map((o) => {
    const b = h("button", {
      type: "button", role: "tab", id: "ed-onglet-" + o.id, classe: "ed-onglet",
      "aria-controls": "ed-panneau-corps", "aria-selected": "false", tabindex: "-1"
    }, o.libelle);
    b.addEventListener("click", () => montrer(o.id));
    liste.append(b);
    return b;
  });
  // Les flèches passent d'un onglet à l'autre (le motif « onglets » des
  // lecteurs d'écran) ; Tab entre dans le contenu.
  liste.addEventListener("keydown", (e) => {
    const i = boutons.indexOf(document.activeElement);
    if (i < 0) return;
    let j = null;
    if (e.key === "ArrowRight") j = (i + 1) % boutons.length;
    if (e.key === "ArrowLeft") j = (i - 1 + boutons.length) % boutons.length;
    if (e.key === "Home") j = 0;
    if (e.key === "End") j = boutons.length - 1;
    if (j === null) return;
    e.preventDefault();
    montrer(ONGLETS[j].id);
    boutons[j].focus();
  });

  const saisieDansPanneau = () => {
    const a = document.activeElement;
    return !!(a && element.contains(a) && (a.matches("textarea") || (a.matches("input") && /^(text|email|tel|url|search)$/.test(a.type))));
  };

  const ctx = {
    etat: etatLocal,
    viser(cle) { cleVisee = cle; },
    reconstruire: () => reconstruire({ forcer: true })
  };

  function reconstruire({ forcer = false } = {}) {
    if (!forcer && saisieDansPanneau()) { enAttente = true; return; }
    enAttente = false;
    // Le focus n'est rendu que s'il ÉTAIT dans le panneau (ou perdu avec le
    // bouton retiré). Une clé visée par un geste qui n'a rien reconstruit
    // ne doit pas, plus tard, arracher le focus d'un texte en cours de
    // frappe dans la page.
    const a = document.activeElement;
    const dansPanneau = !!a && (element.contains(a) || a === document.body);
    const cleFocus = dansPanneau ? cleVisee || (element.contains(a) && a.dataset ? a.dataset.cle : null) : null;
    cleVisee = null;
    const defilement = corps.scrollTop;
    const o = ONGLETS.find((x) => x.id === onglet);
    boutons.forEach((b, i) => {
      const actif = ONGLETS[i].id === onglet;
      b.setAttribute("aria-selected", String(actif));
      b.tabIndex = actif ? 0 : -1;
    });
    corps.setAttribute("aria-labelledby", "ed-onglet-" + onglet);
    vider(corps);
    if (app.etat.mode === "version" && o.modifie) {
      corps.append(h("div", { classe: "ed-groupe" },
        h("p", { classe: "ed-aide ed-aide--note" }, "Vous regardez une ancienne version : revenez au brouillon pour modifier votre site."),
        bouton({ libelle: "Revenir au brouillon", classe: "ed-bouton--principal", quand: () => app.revenirAuBrouillon() })));
    } else {
      try {
        corps.append(...[].concat(o.construire(app, ctx)).filter(Boolean));
      } catch (e) {
        // Un onglet qui ne se construit pas le DIT, au lieu d'un panneau à
        // moitié vide qui aurait l'air de marcher (Graine de Pensée).
        console.error("Onglet " + onglet + " :", e);
        corps.append(h("p", { classe: "ed-erreur", role: "alert" }, "Cet onglet n'a pas pu s'afficher. Rechargez la page ; si cela se reproduit, prévenez l'atelier."));
      }
    }
    corps.scrollTop = defilement;
    if (cleFocus) rendreFocus(cleFocus);
  }

  /* Le focus revient au même bouton, ou à son plus proche voisin s'il a
     disparu ou s'est désactivé (une section montée tout en haut). */
  function rendreFocus(cle) {
    const trouver = (k) => [...corps.querySelectorAll("[data-cle]")].find((el) => el.dataset.cle === k && !el.disabled);
    let el = trouver(cle);
    if (!el) {
      const morceaux = cle.split(":");
      morceaux[morceaux.length - 1] = "nom";
      el = trouver(morceaux.join(":"));
    }
    if (!el && cle.startsWith("liste:")) el = trouver(cle.replace(/:\d+:[^:]+$/, ":ajouter"));
    if (el) el.focus({ preventScroll: false });
    else if (element.contains(document.activeElement) === false && document.activeElement === document.body) corps.focus();
  }

  function montrer(id, { focus = false } = {}) {
    if (!ONGLETS.some((o) => o.id === id)) return;
    onglet = id;
    reconstruire({ forcer: true });
    if (focus) corps.focus();
  }

  /* Le tiroir (sous 900 px). Au-dessus, le panneau est déjà là, en
     colonne : « ouvrir » ne fait qu'y porter le focus. Relecture du
     3 octobre 2026 : sur grand écran, la classe du tiroir se posait quand
     même, `aria-expanded` annonçait un tiroir ouvert que rien ne montrait,
     et le tiroir apparaissait d'office par-dessus la page dès que la
     fenêtre passait sous 900 px. */
  const tiroirPossible = window.matchMedia("(max-width: 899px)");
  const premierOnglet = () => boutons.find((b) => b.getAttribute("aria-selected") === "true") || boutons[0];
  function ouvrirTiroir({ focus = true } = {}) {
    if (!tiroirPossible.matches) {
      if (focus) premierOnglet().focus();
      return;
    }
    document.body.classList.add("ed-tiroir-ouvert");
    app.haut.majTiroir(true);
    if (focus) premierOnglet().focus();
  }
  function fermerTiroir() {
    if (!document.body.classList.contains("ed-tiroir-ouvert")) return;
    const dedans = element.contains(document.activeElement);
    document.body.classList.remove("ed-tiroir-ouvert");
    app.haut.majTiroir(false);
    if (dedans) app.haut.focusTiroir();
  }
  element.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("ed-tiroir-ouvert")) {
      e.preventDefault();
      fermerTiroir();
    }
  });
  element.addEventListener("focusout", () => {
    setTimeout(() => { if (enAttente && !saisieDansPanneau()) reconstruire(); }, 0);
  });
  // La fenêtre s'élargit au-delà de 900 px, tiroir ouvert : le panneau
  // redevient une colonne, et le tiroir ne doit pas rester « ouvert » pour
  // réapparaître tout seul au prochain rétrécissement. Le focus reste où il
  // est : le panneau, visible, le garde.
  const quandLargeurChange = (e) => {
    if (e.matches || !document.body.classList.contains("ed-tiroir-ouvert")) return;
    document.body.classList.remove("ed-tiroir-ouvert");
    app.haut.majTiroir(false);
  };
  if (typeof tiroirPossible.addEventListener === "function") tiroirPossible.addEventListener("change", quandLargeurChange);
  else if (typeof tiroirPossible.addListener === "function") tiroirPossible.addListener(quandLargeurChange);

  return {
    element,
    onglet: () => onglet,
    montrer,
    reconstruire,
    /* Une lettre tapée sur la page : seul le nom des sections suit. */
    majNoms() {
      for (const el of corps.querySelectorAll("[data-libelle-bloc]")) {
        const b = app.etat.contenu.blocs[el.dataset.libelleBloc];
        if (b) el.textContent = nomDuBloc(b);
      }
    },
    /* Montre une section ou un bouton du panneau et y met le focus (après
       « Réglages » dans la barre d'une section, ou un ajout). `avant` : un
       changement d'état à faire d'abord (choisir la section). */
    focaliser(cle, { avant = null } = {}) {
      if (avant) avant();
      reconstruire({ forcer: true });
      rendreFocus(cle);
      const el = document.activeElement;
      if (el && element.contains(el)) el.scrollIntoView({ block: "nearest" });
    },
    ouvrirTiroir,
    fermerTiroir,
    estTiroir: () => tiroirPossible.matches
  };
}
