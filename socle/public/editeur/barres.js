/* =========================================================
   Les barres flottantes — section, élément de liste, lien
   =========================================================

   Elles vivent dans le document de l'ÉDITEUR, posées par-dessus le cadre
   (position fixe, calculée depuis le rectangle de l'iframe et celui de
   l'élément), jamais dans la page du site : le DOM du cadre reste celui que
   recevra une visiteuse, plus les marques d'édition.

   — la barre de SECTION, en haut à droite de la section survolée ou
     choisie : Monter, Descendre, Réglages, Masquer, Dupliquer, Supprimer ;
   — la barre d'ÉLÉMENT (une carte, une photo, une question, un lien du
     menu) : Monter, Descendre, Dupliquer, Ajouter après, Supprimer ;
   — la pastille « Lien » d'un bouton ou d'un lien, au survol ET au focus :
     le second déclencheur la rend atteignable sur un écran tactile.

   Elles visent leur cible par ses MARQUES (`data-bloc`, `data-liste` +
   `data-index`, `data-edit-dest`), jamais par un élément retenu : un
   redessin remplace tous les éléments du cadre.

   Le clavier : Alt+F10 (depuis la page) entre dans la barre, les flèches
   passent d'un bouton à l'autre, Échap ramène dans la page. Et le panneau
   offre les mêmes gestes — aucune opération n'existe QUE dans une barre.

   Deux règles de la relecture du 3 octobre 2026 :
   — une barre ne reste jamais SOUS la barre de mise en forme. Sur un
     téléphone, elles se posaient dans la même bande, et un appui sur
     « Taille » faisait descendre la section. La mise en forme passe
     au-dessus (editeur.css) et la barre recouverte se cache, le temps de
     l'écriture : ses gestes restent dans le panneau ;
   — un bouton qui se grise sous le focus (« Monter » quand la section
     arrive en tête) passe le focus à son voisin. Sans ça, le navigateur le
     posait sur la page entière, et Échap ou les flèches ne répondaient
     plus. */

import { h, bouton, icone } from "./dom.js";
import { descripteurListe, lireChemin, nomDuBloc } from "/rendu/structure.js";

const DELAI_DEPART = 350;

export function creerBarres(app, calque) {
  let survol = { bloc: null, liste: null, index: null, dest: null };
  let focusCadre = { liste: null, index: null, dest: null };
  let minuteur = null;
  let dansBarre = false;

  /* ----- Section ----- */
  const nomSection = h("span", { classe: "ed-barre__nom" });
  const bMonter = bouton({ libelle: "Monter la section", icone: "haut", seuleIcone: true, bulle: "Monter", quand: () => agirBloc("monter") });
  const bDescendre = bouton({ libelle: "Descendre la section", icone: "bas", seuleIcone: true, bulle: "Descendre", quand: () => agirBloc("descendre") });
  const bReglages = bouton({ libelle: "Réglages", icone: "reglages", quand: () => agirBloc("reglages") });
  const bMasquer = bouton({ libelle: "Masquer la section", icone: "oeilBarre", seuleIcone: true, bulle: "Masquer", quand: () => agirBloc("masquer") });
  const bDupliquer = bouton({ libelle: "Dupliquer la section", icone: "dupliquer", seuleIcone: true, bulle: "Dupliquer", quand: () => agirBloc("dupliquer") });
  const bSupprimer = bouton({ libelle: "Supprimer la section", icone: "supprimer", seuleIcone: true, bulle: "Supprimer", classe: "ed-bouton--discret-danger", quand: () => agirBloc("supprimer") });
  const barreSection = h("div", { classe: "ed-barre ed-barre--section", role: "toolbar", "aria-label": "Section", hidden: true },
    nomSection, bMonter, bDescendre, bReglages, bMasquer, bDupliquer, bSupprimer);

  /* ----- Élément de liste ----- */
  const eMonter = bouton({ libelle: "Monter", icone: "haut", seuleIcone: true, quand: () => agirElement("monter") });
  const eDescendre = bouton({ libelle: "Descendre", icone: "bas", seuleIcone: true, quand: () => agirElement("descendre") });
  const eDupliquer = bouton({ libelle: "Dupliquer", icone: "dupliquer", seuleIcone: true, quand: () => agirElement("dupliquer") });
  const eAjouter = bouton({ libelle: "Ajouter après", icone: "ajouterApres", seuleIcone: true, quand: () => agirElement("ajouter-apres") });
  const eSupprimer = bouton({ libelle: "Supprimer", icone: "supprimer", seuleIcone: true, classe: "ed-bouton--discret-danger", quand: () => agirElement("supprimer") });
  const barreElement = h("div", { classe: "ed-barre ed-barre--element", role: "toolbar", "aria-label": "Élément de la liste", hidden: true },
    eMonter, eDescendre, eDupliquer, eAjouter, eSupprimer);

  /* ----- Lien ----- */
  const pastille = bouton({ libelle: "Lien", icone: "lien", classe: "ed-pastille", quand: () => { const d = cibleLien(); if (d) app.ouvrirLien(d); } });
  pastille.hidden = true;
  const textePastille = pastille.querySelector(".ed-bouton__texte");

  calque.append(barreSection, barreElement, pastille);

  for (const b of [barreSection, barreElement, pastille]) {
    b.addEventListener("pointerenter", () => { dansBarre = true; clearTimeout(minuteur); });
    b.addEventListener("pointerleave", () => { dansBarre = false; planifierDepart(); });
  }
  for (const barre of [barreSection, barreElement]) {
    barre.addEventListener("keydown", (e) => {
      const boutons = [...barre.querySelectorAll("button:not([disabled])")];
      const i = boutons.indexOf(document.activeElement);
      if (e.key === "ArrowRight") { e.preventDefault(); boutons[(i + 1) % boutons.length].focus(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); boutons[(i - 1 + boutons.length) % boutons.length].focus(); }
      else if (e.key === "Escape") { e.preventDefault(); app.revenirAuCadre(); }
    });
  }
  pastille.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); app.revenirAuCadre(); } });

  /* ----- Les cibles ----- */
  const blocCible = () => survol.bloc || app.etat.blocChoisi;
  const elementCible = () => (survol.liste ? { liste: survol.liste, index: survol.index } : focusCadre.liste ? { liste: focusCadre.liste, index: focusCadre.index } : null);
  const cibleLien = () => survol.dest || focusCadre.dest;

  function agirBloc(action) {
    const id = blocCible();
    if (id) app.actionBloc(action, id);
  }
  function agirElement(action) {
    const c = elementCible();
    if (c) app.actionListe(action, c.liste, c.index);
  }

  function trouver(selecteur, test) {
    const doc = app.cadre.document();
    if (!doc) return null;
    return [...doc.querySelectorAll(selecteur)].find(test) || null;
  }
  const elementDeSection = (id) => app.cadre.sectionDe(id);
  const elementDeListe = (c) => trouver("[data-liste][data-index]", (el) => el.getAttribute("data-liste") === c.liste && el.getAttribute("data-index") === String(c.index));
  const elementDeLien = (chemin) => trouver("[data-edit-dest]", (el) => el.getAttribute("data-edit-dest") === chemin);

  /* Pose une barre en haut à droite de `el`, dans la partie visible du
     cadre ; la cache si l'élément est hors de vue. `decalage` : la barre
     d'élément se pose juste au-dessus de l'élément. */
  /* Le haut UTILE du cadre : sous l'en-tête collant du site. Une barre
     posée plus haut couvrirait le menu et son bouton, qu'on veut pouvoir
     cliquer. */
  function hautUtile(zone) {
    const doc = app.cadre.document();
    const entete = doc ? doc.querySelector(".entete") : null;
    const bas = entete ? entete.getBoundingClientRect().bottom : 0;
    return zone.top + Math.max(0, bas);
  }

  /* La barre de mise en forme (et son menu ouvert) occupe-t-elle ce
     rectangle ? Une barre de structure ne se pose jamais dessous. */
  const chevauche = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  function sousLaMiseEnForme(rect) {
    const forme = app.forme;
    if (!forme || typeof forme.zones !== "function") return false;
    return forme.zones().some((z) => chevauche(rect, z));
  }

  function poser(barre, el, { dessus = false } = {}) {
    if (!el) { barre.hidden = true; return; }
    const zone = app.cadre.zone();
    const r = app.cadre.rect(el);
    const haut = el.closest && el.closest(".entete") ? zone.top : hautUtile(zone);
    if (r.bottom < haut + 8 || r.top > zone.bottom - 8 || r.width === 0) {
      // Hors de vue — souvent le temps d'un défilement : « Descendre » au
      // clavier emmène la section plus bas, puis la page la rejoint. Une
      // barre qui a le focus reste où elle est ; le défilement la reposera.
      if (!barre.contains(document.activeElement)) barre.hidden = true;
      return;
    }
    barre.hidden = false;
    const lb = barre.offsetWidth;
    const hb = barre.offsetHeight;
    let top = dessus ? r.top - hb - 4 : Math.max(r.top, haut) + 8;
    top = Math.max(haut + 4, Math.min(top, zone.bottom - hb - 4));
    let left = r.right - lb - 8;
    left = Math.max(zone.left + 4, Math.min(left, zone.right - lb - 4));
    // Sous la mise en forme : cachée le temps de l'écriture (sauf si le
    // clavier est dedans — on ne retire pas une barre qu'on utilise).
    if (!barre.contains(document.activeElement) && sousLaMiseEnForme({ left, top, right: left + lb, bottom: top + hb })) {
      barre.hidden = true;
      return;
    }
    barre.style.top = Math.round(top) + "px";
    barre.style.left = Math.round(left) + "px";
  }

  /* Le focus était sur un bouton de `barre`, et ce bouton vient de se
     griser (ou la barre de se cacher) : le navigateur le jetterait sur la
     page entière. On le passe au bouton actif le plus proche — le suivant,
     sinon le précédent —, ou, la barre partie, à l'élément de la page d'où
     l'on venait. */
  function garderFocus(barre, avant) {
    if (!avant || !barre.contains(avant)) return;
    if (barre.hidden) { app.revenirAuCadre(); return; }
    if (!avant.disabled) return;
    const tous = [...barre.querySelectorAll("button")];
    const i = tous.indexOf(avant);
    const actif = (b) => b && !b.disabled;
    const voisin = tous.slice(i + 1).find(actif) || tous.slice(0, i).reverse().find(actif);
    if (voisin) voisin.focus();
    else app.revenirAuCadre();
  }

  function majSection() {
    const avant = document.activeElement;
    const id = app.etat.mode === "edition" ? blocCible() : null;
    const el = id ? elementDeSection(id) : null;
    if (!el) { barreSection.hidden = true; garderFocus(barreSection, avant); return; }
    const contenu = app.etat.contenu;
    const ordre = contenu.pages[app.etat.pageId].ordre;
    const i = ordre.indexOf(id);
    const bloc = contenu.blocs[id];
    nomSection.textContent = nomDuBloc(bloc);
    bMonter.disabled = i <= 0;
    bDescendre.disabled = i < 0 || i >= ordre.length - 1;
    const masque = !!(bloc && bloc.masque === true);
    bMasquer.querySelector(".ed-cache").textContent = masque ? "Afficher la section" : "Masquer la section";
    bMasquer.dataset.bulle = masque ? "Afficher" : "Masquer";
    bMasquer.replaceChild(icone(masque ? "oeil" : "oeilBarre"), bMasquer.querySelector("svg"));
    barreSection.classList.toggle("est-choisie", id === app.etat.blocChoisi);
    poser(barreSection, el);
    garderFocus(barreSection, avant);
  }

  function majElement() {
    const avant = document.activeElement;
    const c = app.etat.mode === "edition" ? elementCible() : null;
    const el = c ? elementDeListe(c) : null;
    if (!el) { barreElement.hidden = true; garderFocus(barreElement, avant); return; }
    const contenu = app.etat.contenu;
    const d = descripteurListe(contenu, c.liste);
    const liste = lireChemin(contenu, c.liste);
    const n = Array.isArray(liste) ? liste.length : 0;
    if (!d) { barreElement.hidden = true; garderFocus(barreElement, avant); return; }
    const mot = d.libelle.replace(/^(un|une)\s+/i, "");
    barreElement.setAttribute("aria-label", "Cet élément : " + mot);
    eMonter.disabled = c.index <= 0;
    eDescendre.disabled = c.index >= n - 1;
    eDupliquer.disabled = n >= d.max;
    eAjouter.disabled = n >= d.max;
    eAjouter.dataset.bulle = n >= d.max ? "Liste complète (" + d.max + " au plus)" : "Ajouter " + d.libelle + " après";
    eDupliquer.dataset.bulle = n >= d.max ? "Liste complète (" + d.max + " au plus)" : "Dupliquer";
    poser(barreElement, el, { dessus: true });
    garderFocus(barreElement, avant);
  }

  function majLien() {
    const d = app.etat.mode === "edition" ? cibleLien() : null;
    const el = d ? elementDeLien(d) : null;
    if (!el) { pastille.hidden = true; return; }
    const zone = app.cadre.zone();
    const r = app.cadre.rect(el);
    if (r.bottom < zone.top || r.top > zone.bottom) { pastille.hidden = true; return; }
    pastille.hidden = false;
    // Un bouton sans lien n'existe pas sur le site (`data-sans-lien`, posé
    // par le rendu). La pastille se pose sur la mention qui le dit
    // (cadre.css) : elle doit donc le dire aussi.
    const libelle = el.hasAttribute("data-sans-lien") ? "Ajouter un lien" : "Lien";
    if (textePastille && textePastille.textContent !== libelle) textePastille.textContent = libelle;
    // SOUS l'élément, calée à gauche : au-dessus, elle tomberait sur la
    // barre de l'élément (un lien du menu est aussi un élément de liste).
    const hp = pastille.offsetHeight;
    let top = r.bottom + 4;
    if (top + hp > zone.bottom - 4) top = r.top - hp - 4;
    top = Math.max(zone.top + 4, Math.min(top, zone.bottom - hp - 4));
    const left = Math.max(zone.left + 4, Math.min(r.left, zone.right - pastille.offsetWidth - 4));
    pastille.style.top = Math.round(top) + "px";
    pastille.style.left = Math.round(left) + "px";
  }

  function repositionner() {
    majSection();
    majElement();
    majLien();
  }

  function planifierDepart() {
    clearTimeout(minuteur);
    minuteur = setTimeout(() => {
      if (dansBarre || contientFocus()) return;
      survol = { bloc: null, liste: null, index: null, dest: null };
      repositionner();
    }, DELAI_DEPART);
  }

  const contientFocus = () => [barreSection, barreElement, pastille].some((b) => b.contains(document.activeElement));

  return {
    /* La souris passe sur un élément du cadre. */
    survoler(cible) {
      if (app.etat.mode !== "edition" || !cible || !cible.closest) return;
      clearTimeout(minuteur);
      const section = cible.closest("section[data-bloc]");
      const element = cible.closest("[data-liste][data-index]");
      const dest = cible.closest("[data-edit-dest]");
      const neuf = {
        bloc: section ? section.getAttribute("data-bloc") : null,
        liste: element ? element.getAttribute("data-liste") : null,
        index: element ? Number(element.getAttribute("data-index")) : null,
        dest: dest ? dest.getAttribute("data-edit-dest") : null
      };
      if (neuf.bloc === survol.bloc && neuf.liste === survol.liste && neuf.index === survol.index && neuf.dest === survol.dest) return;
      // On ne quitte pas une barre qu'on est en train d'utiliser au clavier.
      if (contientFocus()) return;
      survol = neuf;
      repositionner();
    },
    /* Le focus clavier entre dans un élément du cadre. */
    focus(cible) {
      const el = cible && cible.closest ? cible : null;
      const element = el ? el.closest("[data-liste][data-index]") : null;
      const dest = el ? el.closest("[data-edit-dest]") : null;
      focusCadre = {
        liste: element ? element.getAttribute("data-liste") : null,
        index: element ? Number(element.getAttribute("data-index")) : null,
        dest: dest ? dest.getAttribute("data-edit-dest") : null
      };
      repositionner();
    },
    quitterCadre() {
      planifierDepart();
    },
    sortieFocus() {
      if (contientFocus()) return;
      focusCadre = { liste: null, index: null, dest: null };
      repositionner();
    },
    repositionner,
    /* Après un geste sur un élément de liste, la barre suit l'élément là
       où il est allé (monté, dupliqué…), au lieu de rester sur l'indice
       qu'occupe désormais son voisin. */
    suivre(liste, index) {
      const garder = typeof index === "number" && index >= 0;
      if (survol.liste === liste) {
        survol.index = garder ? index : null;
        if (!garder) survol.liste = null;
      }
      if (focusCadre.liste === liste) {
        focusCadre.index = garder ? index : null;
        if (!garder) focusCadre.liste = null;
      }
      repositionner();
    },
    masquerTout() {
      survol = { bloc: null, liste: null, index: null, dest: null };
      focusCadre = { liste: null, index: null, dest: null };
      for (const b of [barreSection, barreElement, pastille]) b.hidden = true;
    },
    contientFocus,
    /* Alt+F10 : la pastille d'abord (le lien qu'on est en train d'écrire),
       puis la barre de l'élément, puis celle de la section. */
    focaliser() {
      repositionner();
      for (const b of [pastille, barreElement, barreSection]) {
        if (b.hidden) continue;
        const premier = b.matches("button") ? b : b.querySelector("button:not([disabled])");
        if (premier) { premier.focus(); return true; }
      }
      return false;
    }
  };
}
