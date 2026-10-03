/* =========================================================
   La barre du haut
   =========================================================

   Nom du site · page affichée · Annuler / Rétablir · largeur (Ordinateur,
   Tablette 820 px, Téléphone 390 px) · Aperçu · état de l'enregistrement ·
   Publier. Sous 900 px elle se resserre : les libellés passent en bulles,
   et un bouton « Outils » ouvre le panneau en tiroir.

   « Publier » n'est actif que s'il y a quelque chose à publier (le
   brouillon diffère du site en ligne, ou rien n'a jamais été publié). Sinon
   il dit « Publié », en vert avec une coche : l'artisan sait d'un coup
   d'œil que son site est à jour. */

import { h, bouton, icone, idUnique } from "./dom.js";
import { listePages } from "./liens.js";
import { libellePastille, phraseNonLus } from "./messages.js";
import { texteBrut } from "/rendu/outils.js";

const ETATS = {
  enregistre: { texte: "Enregistré", icone: "coche", classe: "ok" },
  modifie: { texte: "Enregistrement…", icone: null, classe: "attente" },
  en_cours: { texte: "Enregistrement…", icone: null, classe: "attente" },
  hors_ligne: { texte: "Hors ligne — gardé sur cet appareil", icone: "horsLigne", classe: "alerte" },
  conflit: { texte: "Modifié ailleurs — votre choix est attendu", icone: "alerte", classe: "alerte" },
  expiration: { texte: "Connexion expirée — gardé sur cet appareil", icone: "alerte", classe: "alerte" },
  refus: { texte: "Non enregistré", icone: "alerte", classe: "alerte" }
};

export const LARGEURS = [
  { id: "ordinateur", libelle: "Ordinateur", icone: "ordinateur", largeur: null },
  { id: "tablette", libelle: "Tablette", icone: "tablette", largeur: 820 },
  { id: "telephone", libelle: "Téléphone", icone: "telephone", largeur: 390 }
];

export function creerBarreHaut(app) {
  const nom = h("p", { classe: "ed-haut__nom" });
  const idPage = idUnique("page-affichee");
  const choixPage = h("select", { id: idPage, classe: "ed-champ ed-haut__page" });
  choixPage.addEventListener("change", () => app.allerA(choixPage.value));

  const bAnnuler = bouton({ libelle: "Annuler", icone: "annuler", seuleIcone: true, bulle: "Annuler (Cmd ou Ctrl + Z)", quand: () => app.annuler() });
  const bRetablir = bouton({ libelle: "Rétablir", icone: "retablir", seuleIcone: true, bulle: "Rétablir (Cmd ou Ctrl + Maj + Z)", quand: () => app.retablir() });
  const boutonsLargeur = LARGEURS.map((l) => bouton({
    libelle: l.libelle + (l.largeur ? " (" + l.largeur + " px)" : ""), bulle: l.libelle, icone: l.icone, seuleIcone: true, presse: l.id === "ordinateur",
    quand: () => app.changerLargeur(l.id)
  }));
  const bApercu = bouton({ libelle: "Aperçu", icone: "oeil", presse: false, classe: "ed-haut__apercu", quand: () => app.basculerApercu(), attributs: { "data-bulle": "Voir la page comme vos visiteurs" } });
  const etat = h("p", { classe: "ed-etat-enregistrement" });
  const bOutils = bouton({ libelle: "Outils", icone: "panneau", classe: "ed-haut__outils", quand: () => app.basculerTiroir(), attributs: { "aria-expanded": "false", "aria-controls": "ed-panneau" } });
  /* Sous 900 px, l'onglet « Messages » est caché dans le tiroir : sa
     pastille ne se verrait qu'une fois « Outils » ouvert. Le bouton porte
     donc la sienne — un message de client qui attend ne doit pas attendre
     qu'on aille fouiller (socle 0.3.0). */
  const phraseOutils = h("span", { classe: "ed-cache" });
  const pastilleOutils = h("span", { classe: "ed-pastille-compte", "aria-hidden": "true", hidden: true });
  bOutils.append(phraseOutils, pastilleOutils);
  const bPublier = h("button", { type: "button", classe: "ed-bouton ed-bouton--principal ed-haut__publier" }, "Publier");
  bPublier.addEventListener("click", () => app.publier());

  const element = h("header", { classe: "ed-haut" },
    h("div", { classe: "ed-haut__site" }, nom,
      h("label", { for: idPage, classe: "ed-cache" }, "Page affichée"), choixPage),
    h("div", { classe: "ed-haut__groupe", role: "group", "aria-label": "Annuler ou rétablir" }, bAnnuler, bRetablir),
    h("div", { classe: "ed-haut__groupe ed-haut__largeurs", role: "group", "aria-label": "Largeur de l'aperçu" }, ...boutonsLargeur),
    bApercu,
    h("div", { classe: "ed-haut__fin" }, etat, bOutils, bPublier));

  function majPages() {
    const contenu = app.etat.contenuAffiche();
    const pages = listePages(contenu);
    const voulu = pages.map((p) => p.id + "\u0000" + p.nom).join("\u0001");
    if (choixPage.dataset.liste !== voulu) {
      choixPage.replaceChildren(...pages.map((p) => h("option", { value: p.id }, p.nom)));
      choixPage.dataset.liste = voulu;
    }
    choixPage.value = app.etat.pageId;
  }

  return {
    element,
    maj() {
      const e = app.etat;
      nom.textContent = texteBrut(e.contenu.site.nom) || "Votre site";
      majPages();
      bAnnuler.disabled = !e.peutAnnuler();
      bRetablir.disabled = !e.peutRetablir();
      const apercu = e.mode === "apercu";
      bApercu.setAttribute("aria-pressed", String(apercu));
      bApercu.querySelector(".ed-bouton__texte").textContent = apercu ? "Revenir à l'édition" : "Aperçu";
      bApercu.replaceChild(icone(apercu ? "reglages" : "oeil"), bApercu.querySelector("svg"));
      bApercu.disabled = e.mode === "version";
      const s = ETATS[app.file.statut()] || ETATS.enregistre;
      etat.className = "ed-etat-enregistrement ed-etat-enregistrement--" + s.classe;
      etat.replaceChildren(...(s.icone ? [icone(s.icone)] : [h("span", { classe: "ed-roue", "aria-hidden": "true" })]), h("span", null, s.texte));
      // Publier : actif s'il y a du nouveau, ou si rien n'a jamais été publié.
      const aPublier = e.mode !== "version" && (app.file.enAttente() || !e.publie.empreinte || e.brouillon.empreinte !== e.publie.empreinte);
      const enCours = app.publicationEnCours();
      bPublier.disabled = !aPublier || enCours;
      // « Publié » est un ÉTAT, pas un bouton éteint : couleur de succès et
      // coche (editeur.css), au lieu d'un bleu à demi transparent qui ne
      // laissait au mot que 2,35:1 (relecture du 3 octobre 2026).
      const aJour = !enCours && !aPublier && e.mode !== "version";
      bPublier.classList.toggle("est-a-jour", aJour);
      const libelle = enCours ? "Publication…" : aJour ? "Publié" : "Publier";
      if (bPublier.textContent !== libelle) bPublier.replaceChildren(...(aJour ? [icone("coche")] : []), libelle);
    },
    majLargeur(id) {
      LARGEURS.forEach((l, i) => boutonsLargeur[i].setAttribute("aria-pressed", String(l.id === id)));
    },
    majTiroir(ouvert) {
      bOutils.setAttribute("aria-expanded", String(ouvert));
    },
    majMessages(n) {
      const t = libellePastille(n);
      pastilleOutils.textContent = t;
      pastilleOutils.hidden = !t;
      phraseOutils.textContent = t ? ", " + phraseNonLus(n) : "";
    },
    focusTiroir: () => bOutils.focus()
  };
}
