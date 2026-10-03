/* =========================================================
   Les fenêtres de l'éditeur, et les annonces
   =========================================================

   Des fenêtres ACCESSIBLES : `role="dialog"` (ou `alertdialog` pour une
   question qui exige une réponse), `aria-modal`, un titre qui les nomme,
   le focus piégé dedans, Échap qui ferme quand il y a une façon sûre de
   fermer, et le focus rendu à l'élément d'où l'on venait.

   Pourquoi pas l'élément <dialog> du navigateur : sur une question qui
   n'a pas de réponse « sûre » (reprendre la copie de cet appareil ou la
   jeter ?), Chrome force la fermeture au second Échap. Une décision
   prise par une touche pressée deux fois par réflexe serait le pire des
   deux maux. Ici, Échap ne fait que ce qu'on lui confie.

   Le reste de l'éditeur (iframe comprise) devient `inert` tant qu'une
   fenêtre est ouverte : rien ne se modifie derrière elle.

   Venu de la PAGE (une photo, un texte), le focus y retourne vraiment.
   Retenir l'<iframe> ne suffisait pas : le navigateur retire le focus de
   la photo quand le cadre devient `inert`, et le rendre à l'<iframe> le
   posait sur la page entière — plus d'anneau, et Entrée ne rouvrait rien
   (relecture du 3 octobre 2026). On retient donc aussi l'élément du cadre,
   et sa MARQUE (`data-edit-img`, `data-edit`…) pour le retrouver si un
   redessin l'a remplacé. */

import { h, focusables, idUnique, icone } from "./dom.js";

let racineFenetres = null;
let racineApplication = null;
let zoneAnnonces = null;
let zoneAlertes = null;
const pile = [];

export function initialiserDialogues({ fenetres, application, annonces, alertes }) {
  racineFenetres = fenetres;
  racineApplication = application;
  zoneAnnonces = annonces;
  zoneAlertes = alertes;
}

export const fenetreOuverte = () => pile.length > 0;

/* Une phrase pour les lecteurs d'écran (et rien à l'écran). `urgent` passe
   par la zone « assertive » : une erreur qui ne doit pas attendre. */
const enRoute = new Map();
export function annoncer(message, { urgent = false } = {}) {
  const zone = urgent ? zoneAlertes : zoneAnnonces;
  if (!zone || !message) return;
  // Le même message déjà en route vers la même zone n'est pas doublé :
  // `notifier` annonce lui-même, et un geste qui annonce AUSSI ce qu'il
  // vient d'afficher (« C'est en ligne. ») le ferait lire deux fois.
  if (enRoute.get(zone) === message) return;
  enRoute.set(zone, message);
  zone.textContent = "";
  // Vider puis réécrire au tour suivant : sans ça, deux annonces identiques
  // de suite ne seraient lues qu'une fois.
  setTimeout(() => {
    zone.textContent = message;
    if (enRoute.get(zone) === message) enRoute.delete(zone);
  }, 60);
}

/* L'élément du cadre qui avait le focus quand `el` (l'<iframe>) l'avait
   dans l'éditeur — à retenir AVANT de rendre l'éditeur `inert`. */
const MARQUES_CADRE = ["data-edit-img", "data-edit", "data-edit-dest"];
function repererDansCadre(el) {
  if (!el || el.tagName !== "IFRAME") return null;
  let d = null;
  try { d = el.contentDocument; } catch { return null; }
  const a = d ? d.activeElement : null;
  if (!a || a === d.body || a === d.documentElement || typeof a.getAttribute !== "function") return null;
  const marque = MARQUES_CADRE.find((m) => a.hasAttribute(m)) || null;
  return { element: a, marque, valeur: marque ? a.getAttribute(marque) : null };
}
function rendreDansCadre(iframe, repere) {
  let d = null;
  try { d = iframe.contentDocument; } catch { return; }
  if (!d) return;
  let cible = repere.element.isConnected && repere.element.ownerDocument === d ? repere.element : null;
  if (!cible && repere.marque) {
    cible = [...d.querySelectorAll("[" + repere.marque + "]")].find((n) => n.getAttribute(repere.marque) === repere.valeur) || null;
  }
  if (!cible || typeof cible.focus !== "function") return;
  try { iframe.contentWindow.focus(); } catch { return; }
  cible.focus({ preventScroll: true });
}

function majInert() {
  if (racineApplication) racineApplication.inert = pile.length > 0;
  pile.forEach((f, i) => { f.voile.inert = i < pile.length - 1; });
}

/* Ouvre une fenêtre et rend une promesse résolue à sa fermeture, avec la
   valeur de l'action choisie.
   - `corps` : un nœud (ou une liste) posé sous le titre ;
   - `actions` : [{ libelle, valeur, style: "principal"|"danger"|"secondaire", fermer: true, quand }] ;
     `quand(fenetre)` peut rendre `false` (ou une promesse de `false`) pour
     garder la fenêtre ouverte (une saisie à corriger) ;
   - `echap` : la valeur rendue par Échap ; `undefined` = Échap ne ferme pas ;
   - `focus` : l'élément à focaliser à l'ouverture (sinon le premier). */
export function ouvrirFenetre({ titre, texte = null, corps = null, actions = [], echap = undefined, role = "dialog", classe = "", focus = null, large = false }) {
  const idTitre = idUnique("fenetre-titre");
  const idTexte = texte ? idUnique("fenetre-texte") : null;
  const precedent = document.activeElement;
  const dansCadre = repererDansCadre(precedent);
  let resoudre;
  const promesse = new Promise((r) => { resoudre = r; });

  const pied = h("div", { classe: "ed-fenetre__actions" });
  const boite = h("div", {
    classe: "ed-fenetre" + (large ? " ed-fenetre--large" : "") + (classe ? " " + classe : ""),
    role,
    "aria-modal": "true",
    "aria-labelledby": idTitre,
    "aria-describedby": idTexte
  },
  h("div", { classe: "ed-fenetre__tete" },
    h("h2", { classe: "ed-fenetre__titre", id: idTitre, tabindex: "-1" }, titre),
    echap !== undefined
      ? h("button", { type: "button", classe: "ed-bouton ed-bouton--icone ed-fenetre__fermer", "data-bulle": "Fermer", quand: { click: () => fermer(echap) } },
          icone("fermer"), h("span", { classe: "ed-cache" }, "Fermer"))
      : null),
  h("div", { classe: "ed-fenetre__corps" },
    texte ? h("p", { classe: "ed-fenetre__texte", id: idTexte }, texte) : null,
    corps),
  actions.length ? pied : null);
  const voile = h("div", { classe: "ed-voile" }, boite);

  const fenetre = { element: boite, voile, fermer, promesse };
  let ferme = false;

  function fermer(valeur) {
    if (ferme) return;
    ferme = true;
    const i = pile.indexOf(fenetre);
    if (i >= 0) pile.splice(i, 1);
    voile.remove();
    majInert();
    // Le focus revient d'où l'on venait, s'il existe encore ; sinon à la
    // fenêtre précédente, sinon au début de l'éditeur.
    const retour = precedent && precedent.isConnected && !precedent.closest("[inert]") ? precedent
      : pile.length ? focusables(pile[pile.length - 1].element)[0] : null;
    if (retour && typeof retour.focus === "function") retour.focus({ preventScroll: true });
    if (retour === precedent && dansCadre) rendreDansCadre(precedent, dansCadre);
    resoudre(valeur);
  }

  for (const a of actions) {
    const b = h("button", {
      type: "button",
      classe: "ed-bouton ed-bouton--" + (a.style || "secondaire"),
      quand: {
        click: async () => {
          if (a.quand) {
            b.disabled = true;
            let garder;
            try { garder = await a.quand(fenetre); } finally { b.disabled = false; }
            if (garder === false) return;
          }
          if (a.fermer !== false) fermer(a.valeur);
        }
      }
    }, a.libelle);
    if (a.id) b.dataset.action = a.id;
    pied.append(b);
  }

  boite.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (echap !== undefined) fermer(echap);
      return;
    }
    if (e.key !== "Tab") return;
    const liste = focusables(boite);
    if (!liste.length) { e.preventDefault(); return; }
    const premier = liste[0];
    const dernier = liste[liste.length - 1];
    if (e.shiftKey && (document.activeElement === premier || !boite.contains(document.activeElement))) {
      e.preventDefault();
      dernier.focus();
    } else if (!e.shiftKey && document.activeElement === dernier) {
      e.preventDefault();
      premier.focus();
    }
  });
  // Un clic sur le voile ne ferme rien : un clic à côté par mégarde ne
  // doit pas faire perdre une saisie.

  pile.push(fenetre);
  racineFenetres.append(voile);
  majInert();
  const cible = typeof focus === "function" ? focus(boite) : focus;
  const premier = cible || focusables(boite.querySelector(".ed-fenetre__corps"))[0] || pied.querySelector("button") || boite.querySelector(".ed-fenetre__titre");
  if (premier) premier.focus();
  return fenetre;
}

/* Une question oui / non. Pour un geste qui détruit, le focus part sur
   « Annuler » : Entrée par réflexe ne supprime rien. */
export function confirmer({ titre, texte, oui = "Confirmer", non = "Annuler", danger = false, corps = null }) {
  const f = ouvrirFenetre({
    titre, texte, corps, role: "alertdialog", echap: false,
    actions: [
      { libelle: non, valeur: false, style: "secondaire", id: "non" },
      { libelle: oui, valeur: true, style: danger ? "danger" : "principal", id: "oui" }
    ],
    focus: (boite) => boite.querySelector(danger ? '[data-action="non"]' : '[data-action="oui"]')
  });
  return f.promesse;
}

export function informer({ titre, texte, corps = null, ok = "D'accord" }) {
  return ouvrirFenetre({ titre, texte, corps, role: "alertdialog", echap: true, actions: [{ libelle: ok, valeur: true, style: "principal" }] }).promesse;
}

/* Un message qui ne bloque rien, en bas de l'écran (« C'est en ligne. »),
   lu par les lecteurs d'écran, fermable, qui s'efface seul.

   La lecture passe par les zones d'annonce, présentes dès le démarrage,
   et non par un `role="status"` posé sur la boîte : une région insérée
   AVEC son texte n'est pas lue de façon sûre (VoiceOver et Safari, l'outil
   d'un artisan sur Mac ou iPhone, la taisent souvent). « Section masquée »,
   « La page … est créée » ne passaient que par là (relecture du
   3 octobre 2026). La boîte reste au-dessus d'une fenêtre ouverte : elle
   rapporte aussi les erreurs des gestes faits DANS la fenêtre. */
let notification = null;
export function notifier(message, { lien = null, duree = 12000, genre = "succes" } = {}) {
  if (notification) notification.remove();
  // Une erreur s'annonce sans attendre (zone « assertive ») ; le reste poliment.
  annoncer(message, { urgent: genre === "erreur" });
  const n = h("div", { classe: "ed-notification ed-notification--" + genre },
    h("p", null, message),
    lien ? h("a", { href: lien.href, target: "_blank", rel: "noopener", classe: "ed-notification__lien" }, lien.texte, icone("externe")) : null,
    h("button", { type: "button", classe: "ed-bouton ed-bouton--icone ed-notification__fermer", "data-bulle": "Fermer", quand: { click: () => n.remove() } },
      icone("fermer"), h("span", { classe: "ed-cache" }, "Fermer le message")));
  document.body.append(n);
  notification = n;
  if (duree) {
    setTimeout(() => {
      // On ne retire pas un message qu'on est en train de lire au clavier.
      if (n.isConnected && !n.contains(document.activeElement)) n.remove();
    }, duree);
  }
  return n;
}
