/* =========================================================
   La barre de mise en forme — pour les textes « riches »
   =========================================================

   Elle flotte au-dessus de la sélection, dans le document de l'éditeur
   (jamais dans la page du site). Gras, Italique, Lien, Taille, Police,
   Effacer la mise en forme.

   Les boutons agissent au `mousedown` + `preventDefault` : un clic à la
   souris ne retire donc pas le focus du texte, et la sélection reste où
   elle est. Au clavier (Alt+F10 depuis le texte), le focus passe dans la
   barre : la sélection est alors MÉMORISÉE et rendue au texte avant chaque
   action. Échap ramène au texte.

   Taille et police : la spécification suggère `execCommand("fontSize")`
   puis le remplacement des <font> produits. On fait plus direct, avec un
   `Range` : le passage choisi est enveloppé, SORTI des tailles (ou
   polices) qui l'entouraient — sans quoi deux « Grand » imbriqués feraient
   1,25 × 1,25 —, puis marqué `data-taille` / `data-police`, les seules
   formes que `texteRiche` laisse passer. Gras, italique et lien restent
   confiés au navigateur (`execCommand`), qui sait les annuler lui-même.

   ⚠️ L'annulation du navigateur (Cmd+Z dans le texte) ne connaît pas les
   changements faits par script : après une taille, une police ou un
   effacement, le champ porte `data-ed-forme` et Cmd+Z y passe par
   l'annulation de l'éditeur (voir cadre.js). */

import { h, icone } from "./dom.js";
import { DUOS } from "/rendu/themes.js";
import { pageDuLien } from "./liens.js";
import { ouvrirFenetreLien } from "./fenetre-lien.js";

/* Les tailles que le rendu accepte (`texteRiche`, outils.js), avec le mot
   que lit l'artisan. « Normal » retire la taille. */
const TAILLES = [
  { valeur: "petit", libelle: "Petit" },
  { valeur: "", libelle: "Normal" },
  { valeur: "grand", libelle: "Grand" },
  { valeur: "tres-grand", libelle: "Très grand" }
];
const FORMATS = new Set(["b", "strong", "i", "em", "u", "a", "span", "font"]);

/* Les polices de titre des duos, pour écrire chaque nom dans sa police
   (menu « Police », onglet « Thème »). Chargées une fois, à la demande :
   six familles que l'artisan n'ouvrira peut-être jamais. */
let policesChargees = false;
export function chargerPolicesDesDuos() {
  if (policesChargees) return;
  policesChargees = true;
  for (const d of DUOS) {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?" + d.google + "&display=swap";
    document.head.append(l);
  }
}

function deballer(el) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

const aDuContenu = (n) => n.textContent !== "" || !!(n.querySelector && n.querySelector("br"));

/* Sort `noeud` de son ancêtre `ancetre` : l'ancêtre est coupé en deux
   autour de lui (`extractContents` recopie de chaque côté les éléments
   intermédiaires à moitié pris), puis retiré autour du nœud. */
function isoler(doc, ancetre, noeud) {
  const parent = ancetre.parentNode;
  const avant = doc.createRange();
  avant.setStart(ancetre, 0);
  avant.setEndBefore(noeud);
  const fragAvant = avant.extractContents();
  const apres = doc.createRange();
  apres.setStartAfter(noeud);
  apres.setEnd(ancetre, ancetre.childNodes.length);
  const fragApres = apres.extractContents();
  if (aDuContenu(fragAvant)) {
    const c = ancetre.cloneNode(false);
    c.append(fragAvant);
    parent.insertBefore(c, ancetre);
  }
  if (aDuContenu(fragApres)) {
    const c = ancetre.cloneNode(false);
    c.append(fragApres);
    parent.insertBefore(c, ancetre.nextSibling);
  }
  deballer(ancetre);
}

function ancetreQui(noeud, champ, test) {
  for (let n = noeud.parentNode; n && n !== champ; n = n.parentNode) {
    if (n.nodeType === 1 && test(n)) return n;
  }
  return null;
}

export function creerMiseEnForme(app, calque) {
  let champ = null;         // le champ riche qui a le focus (dans le cadre)
  let memo = null;          // la dernière sélection connue dans ce champ
  let menuOuvert = null;
  let n = 0;

  const doc = () => app.cadre.document();

  const barre = h("div", { classe: "ed-forme", role: "toolbar", "aria-label": "Mise en forme du texte", hidden: true });
  const bGras = boutonBarre("Gras", h("b", { "aria-hidden": "true" }, "G"), () => commande("bold"), "Gras (Cmd ou Ctrl + B)");
  const bItalique = boutonBarre("Italique", h("i", { "aria-hidden": "true" }, "I"), () => commande("italic"), "Italique (Cmd ou Ctrl + I)");
  const bLien = boutonBarre("Lien", icone("lien"), () => lien(), "Transformer en lien (Cmd ou Ctrl + K)");
  // Taille et Police ont leur bulle comme les autres : sans elle, rien ne
  // disait qu'ils agissent sur les MOTS CHOISIS (relecture du 3 octobre
  // 2026). Ils n'ont pas de raccourci : c'est Alt+F10 qui mène à la barre,
  // annoncé au premier passage du clavier dans un texte (cadre.js).
  const bTaille = boutonBarre("Taille", h("span", { "aria-hidden": "true" }, "Taille ▾"), () => basculerMenu("taille"), "Agrandir ou réduire les mots choisis", true);
  const bPolice = boutonBarre("Police", h("span", { "aria-hidden": "true" }, "Police ▾"), () => basculerMenu("police"), "Changer la police des mots choisis", true);
  const bEffacer = boutonBarre("Effacer la mise en forme", icone("effacer"), () => effacer(), "Effacer la mise en forme");
  barre.append(bGras, bItalique, bLien, bTaille, bPolice, bEffacer);
  const menus = {
    taille: menu("taille", "Taille du texte", TAILLES.map((t) => ({ libelle: t.libelle, quand: () => taille(t.valeur), classe: t.valeur ? "ed-menu__taille--" + t.valeur : "" }))),
    police: menu("police", "Police", [{ libelle: "Police du site", quand: () => police("") }].concat(
      DUOS.map((d) => ({ libelle: d.nom, quand: () => police(d.id), famille: d.display }))))
  };
  calque.append(barre, menus.taille, menus.police);

  function boutonBarre(libelle, contenu, action, bulle = null, menuBouton = false) {
    const b = h("button", {
      type: "button", classe: "ed-forme__bouton", "aria-label": libelle,
      "data-bulle": bulle, "aria-haspopup": menuBouton ? "menu" : null, "aria-expanded": menuBouton ? "false" : null,
      tabindex: "-1"
    }, contenu);
    // La souris : rien ne quitte le texte. Le clavier : `click`.
    b.addEventListener("mousedown", (e) => { e.preventDefault(); });
    b.addEventListener("click", () => action());
    return b;
  }

  function menu(nom, libelle, elements) {
    const m = h("div", { classe: "ed-menu", role: "menu", "aria-label": libelle, hidden: true });
    for (const el of elements) {
      const item = h("button", { type: "button", role: "menuitem", classe: "ed-menu__item " + (el.classe || ""), tabindex: "-1" }, el.libelle);
      if (el.famille) item.style.fontFamily = el.famille;
      item.addEventListener("mousedown", (e) => e.preventDefault());
      item.addEventListener("click", () => { fermerMenu(); el.quand(); });
      m.append(item);
    }
    m.addEventListener("keydown", (e) => {
      const items = [...m.querySelectorAll("[role=menuitem]")];
      const i = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); const b = nom === "taille" ? bTaille : bPolice; fermerMenu(); b.focus(); }
      else if (e.key === "Tab") { fermerMenu(); }
    });
    return m;
  }

  function basculerMenu(nom) {
    if (menuOuvert === nom) { fermerMenu(); return; }
    fermerMenu();
    if (nom === "police") chargerPolicesDesDuos();
    const m = menus[nom];
    const b = nom === "taille" ? bTaille : bPolice;
    const r = b.getBoundingClientRect();
    m.hidden = false;
    m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + "px";
    m.style.top = (r.bottom + 4) + "px";
    b.setAttribute("aria-expanded", "true");
    menuOuvert = nom;
    signalerBarres();
    // Ouvert au clavier : le focus entre dans le menu. À la souris, le texte
    // garde le focus (et sa sélection).
    if (barre.contains(document.activeElement)) m.querySelector("[role=menuitem]").focus();
  }
  function fermerMenu() {
    const etaitOuvert = menuOuvert !== null;
    for (const [nom, m] of Object.entries(menus)) {
      m.hidden = true;
      (nom === "taille" ? bTaille : bPolice).setAttribute("aria-expanded", "false");
    }
    menuOuvert = null;
    if (etaitOuvert) signalerBarres();
  }

  /* Les barres de section et d'élément se cachent sous la mise en forme
     (barres.js) : elles doivent se reposer quand celle-ci apparaît, bouge,
     ouvre un menu ou disparaît — sinon une barre cachée le temps d'écrire
     ne revenait qu'au prochain survol. */
  function signalerBarres() {
    if (app.barres && typeof app.barres.repositionner === "function") app.barres.repositionner();
  }

  /* Le clavier dans la barre : flèches gauche / droite, Échap retourne au
     texte (avec sa sélection). */
  barre.addEventListener("keydown", (e) => {
    const boutons = [...barre.querySelectorAll("button")];
    const i = boutons.indexOf(document.activeElement);
    if (e.key === "ArrowRight") { e.preventDefault(); boutons[(i + 1) % boutons.length].focus(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); boutons[(i - 1 + boutons.length) % boutons.length].focus(); }
    else if (e.key === "Escape") { e.preventDefault(); fermerMenu(); restaurer(); }
  });

  /* ----- La sélection ----- */
  function memoriser() {
    const d = doc();
    if (!d || !champ) return;
    const sel = d.getSelection();
    if (sel && sel.rangeCount && champ.contains(sel.getRangeAt(0).commonAncestorContainer)) memo = sel.getRangeAt(0).cloneRange();
  }
  function restaurer() {
    const d = doc();
    if (!d || !champ || !champ.isConnected) return false;
    // La sélection d'abord mise de côté : rendre le focus au champ déclenche
    // `focusin`, puis `selectionchange`, qui mémoriseraient le curseur posé
    // par défaut à la place de la vraie sélection.
    const m = memo;
    app.cadre.fenetre().focus();
    champ.focus({ preventScroll: true });
    if (m) {
      const sel = d.getSelection();
      sel.removeAllRanges();
      sel.addRange(m);
      memo = m;
    }
    return true;
  }
  function selectionCourante() {
    if (!restaurer()) return null;
    const sel = doc().getSelection();
    if (!sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    return champ.contains(r.commonAncestorContainer) ? r : null;
  }
  function selectionner(premier, dernier) {
    if (!premier || !dernier) return;
    const d = doc();
    const r = d.createRange();
    r.setStartBefore(premier);
    r.setEndAfter(dernier);
    const sel = d.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    memo = r.cloneRange();
  }

  function apres({ manuel = false } = {}) {
    if (!champ) return;
    if (manuel) champ.setAttribute("data-ed-forme", "");
    for (const s of champ.querySelectorAll("span:empty, b:empty, i:empty, em:empty, strong:empty")) s.remove();
    n += 1;
    // Une mise en forme est un pas d'annulation à elle seule.
    app.cadre.enregistrerChamp(champ, { fusion: "forme:" + n });
    app.etat.couperFusion();
    memoriser();
    majEtats();
    app.cadre.majTete();   // une police citée doit se charger dans la page
  }

  function exigerSelection(message) {
    const r = selectionCourante();
    if (!r || r.collapsed) {
      app.signaler(message);
      return null;
    }
    return r;
  }

  /* ----- Les actions ----- */
  function commande(nom) {
    const r = selectionCourante();
    if (!r) return;
    doc().execCommand("styleWithCSS", false, false);
    doc().execCommand(nom, false, null);
    apres();
  }

  function envelopper(r) {
    const marque = doc().createElement("span");
    marque.append(r.extractContents());
    r.insertNode(marque);
    return marque;
  }

  function appliquerSpan(attribut, valeur, message) {
    const r = exigerSelection(message);
    if (!r) return;
    const marque = envelopper(r);
    const vise = (el) => el.tagName.toLowerCase() === "span" && el.hasAttribute(attribut);
    let a;
    while ((a = ancetreQui(marque, champ, vise))) isoler(doc(), a, marque);
    for (const s of [...marque.querySelectorAll("span[" + attribut + "]")]) deballer(s);
    if (valeur) {
      marque.setAttribute(attribut, valeur);
      selectionner(marque, marque);
    } else {
      const premier = marque.firstChild;
      const dernier = marque.lastChild;
      deballer(marque);
      selectionner(premier, dernier);
    }
    apres({ manuel: true });
  }
  const taille = (v) => appliquerSpan("data-taille", v, "Sélectionnez d'abord les mots à agrandir ou à réduire.");
  const police = (v) => appliquerSpan("data-police", v, "Sélectionnez d'abord les mots à changer de police.");

  /* Effacer : le passage redevient du texte simple — sauts de ligne
     gardés. Sans sélection, c'est tout le champ. */
  function effacer() {
    const r0 = selectionCourante();
    if (!r0) return;
    if (r0.collapsed) r0.selectNodeContents(champ);
    const marque = envelopper(r0);
    let a;
    while ((a = ancetreQui(marque, champ, (el) => FORMATS.has(el.tagName.toLowerCase())))) isoler(doc(), a, marque);
    const morceaux = [];
    const parcourir = (noeud) => {
      for (const x of noeud.childNodes) {
        if (x.nodeType === 3) morceaux.push(doc().createTextNode(x.nodeValue));
        else if (x.nodeName === "BR") morceaux.push(doc().createElement("br"));
        else parcourir(x);
      }
    };
    parcourir(marque);
    marque.replaceChildren(...morceaux);
    const premier = marque.firstChild;
    const dernier = marque.lastChild;
    deballer(marque);
    selectionner(premier, dernier);
    apres({ manuel: true });
  }

  async function lien() {
    if (!champ) return;
    memoriser();
    const r = memo;
    const d = doc();
    const depart = r ? (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode) : null;
    let existant = depart && depart.closest ? depart.closest("a") : null;
    if (existant && !champ.contains(existant)) existant = null;
    if (!existant && (!r || r.collapsed)) {
      restaurer();
      app.signaler("Sélectionnez d'abord les mots qui doivent devenir un lien.");
      return;
    }
    // La fenêtre prend le focus : le champ le perd, la barre se cache et
    // oublie tout. On garde de quoi y revenir.
    const champVise = champ;
    const memoVise = r;
    const chemin = champ.getAttribute("data-edit");
    // `chemin` aussi : un texte du pied de page est commun à toutes les
    // pages, ses ancres visent l'accueil (`lienGlobal`), et la fenêtre doit
    // le proposer comme tel (relecture du 3 octobre 2026).
    const choix = await ouvrirFenetreLien(app, {
      chemin,
      valeur: existant ? existant.getAttribute("href") || "" : "",
      genre: "texte",
      pageContexte: pageDuLien(app.etat.contenu, chemin, app.etat.pageId)
    });
    champ = champVise;
    memo = memoVise;
    if (!restaurer()) return;
    if (choix === null) return;
    if (existant && memo.collapsed) {
      const tout = d.createRange();
      tout.selectNodeContents(existant);
      const sel = d.getSelection();
      sel.removeAllRanges();
      sel.addRange(tout);
    }
    if (choix.vers) d.execCommand("createLink", false, choix.vers);
    else d.execCommand("unlink", false, null);
    apres();
  }

  function majEtats() {
    const d = doc();
    if (!d || !champ) return;
    try {
      bGras.setAttribute("aria-pressed", String(d.queryCommandState("bold")));
      bItalique.setAttribute("aria-pressed", String(d.queryCommandState("italic")));
    } catch { /* un navigateur sans queryCommandState : l'état ne s'affiche pas */ }
  }

  function repositionner() {
    if (barre.hidden || !champ || !champ.isConnected) return;
    const d = doc();
    const sel = d.getSelection();
    let cible = app.cadre.rect(champ);
    const zone = app.cadre.zone();
    if (sel && sel.rangeCount && champ.contains(sel.getRangeAt(0).commonAncestorContainer) && !sel.getRangeAt(0).collapsed) {
      // Le rectangle de la sélection est donné dans la fenêtre du cadre.
      const rs = sel.getRangeAt(0).getBoundingClientRect();
      if (rs.width || rs.height) cible = { left: zone.left + rs.left, top: zone.top + rs.top, bottom: zone.top + rs.bottom };
    }
    const hb = barre.offsetHeight || 44;
    const lb = barre.offsetWidth || 300;
    let top = cible.top - hb - 8;
    if (top < zone.top + 4) top = (cible.bottom || cible.top) + 8;
    top = Math.min(Math.max(top, zone.top + 4), zone.bottom - hb - 4);
    const left = Math.min(Math.max(cible.left, zone.left + 4), Math.max(zone.left + 4, zone.right - lb - 4));
    barre.style.top = top + "px";
    barre.style.left = left + "px";
    if (menuOuvert) {
      const b = menuOuvert === "taille" ? bTaille : bPolice;
      const r = b.getBoundingClientRect();
      menus[menuOuvert].style.top = (r.bottom + 4) + "px";
      menus[menuOuvert].style.left = Math.max(8, r.left) + "px";
    }
  }

  return {
    element: barre,
    afficher(el) {
      if (champ !== el) memo = null;
      champ = el;
      barre.hidden = false;
      // Le premier bouton est le point d'entrée au clavier (Alt+F10).
      for (const b of barre.querySelectorAll("button")) b.tabIndex = -1;
      bGras.tabIndex = 0;
      memoriser();
      majEtats();
      repositionner();
      signalerBarres();
    },
    masquer() {
      if (barre.contains(document.activeElement) || Object.values(menus).some((m) => m.contains(document.activeElement))) return;
      const etaitVisible = !barre.hidden;
      barre.hidden = true;
      fermerMenu();
      champ = null;
      memo = null;
      if (etaitVisible) signalerBarres();
    },
    /* Les rectangles qu'occupe la mise en forme (barre, menu ouvert), dans
       les coordonnées de l'éditeur : aucune barre de structure ne s'y pose. */
    zones() {
      if (barre.hidden) return [];
      return [barre].concat(menuOuvert ? [menus[menuOuvert]] : []).map((x) => x.getBoundingClientRect());
    },
    /* Le focus est-il dans la barre ou ses menus (on la garde alors). */
    contientFocus: () => barre.contains(document.activeElement) || Object.values(menus).some((m) => m.contains(document.activeElement)),
    visible: () => !barre.hidden,
    focaliser() {
      if (barre.hidden) return false;
      memoriser();
      bGras.focus();
      return true;
    },
    surSelection() {
      if (!champ) return;
      memoriser();
      majEtats();
      const avant = barre.style.top + " " + barre.style.left;
      repositionner();
      // La barre a bougé avec la sélection : les barres de structure
      // vérifient qu'elles ne sont pas dessous (ou plus dessous).
      if (barre.style.top + " " + barre.style.left !== avant) signalerBarres();
    },
    repositionner,
    lien
  };
}
