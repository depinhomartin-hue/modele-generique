/* =========================================================
   Ce que les onglets du panneau partagent
   =========================================================

   Le panneau fait la STRUCTURE (ajouter, retirer, réordonner, régler) ;
   le texte se modifie sur la page (règle de Graine de Pensée). Les seuls
   champs de texte du panneau sont ceux qui n'ont aucun point de clic sur
   la page : le titre et la description pour Google, l'adresse d'une
   section, le nom d'une nouvelle page.

   Chaque élément interactif porte une clé (`data-cle`) : quand le panneau
   se reconstruit après un geste, le focus revient au même bouton (ou à son
   plus proche voisin), au lieu de retomber en haut de la page — un
   utilisateur au clavier qui « monte » une section trois fois de suite ne
   doit pas avoir à la rechercher trois fois. */

import { h, bouton, idUnique } from "./dom.js";
import { conseilLongueur } from "./textes.js";
import { descripteurListe, lireChemin } from "/rendu/structure.js";
import { nomElement } from "./operations.js";

export function groupe(titre, ...enfants) {
  return h("section", { classe: "ed-groupe" }, titre ? h("h3", { classe: "ed-groupe__titre" }, titre) : null, ...enfants);
}

export const aide = (texte, props = {}) => h("p", Object.assign({ classe: "ed-aide" }, props), texte);

/* « une carte » → « carte » ; « carte » → « cartes ». */
export const motDe = (libelle) => String(libelle || "élément").replace(/^(un|une)\s+/i, "");
export const pluriel = (mot) => (/[sxz]$/i.test(mot) ? mot : mot + "s");
export const majuscule = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/* Un champ de texte du panneau, avec son compteur quand il y a une
   longueur conseillée. Chaque frappe passe par `etat.modifier` (un seul pas
   d'annulation pour toute la saisie). */
/* `vide` et `ajout` : ce que le site affiche quand le champ est vide, et ce
   qu'il ajoute à sa valeur (le « · nom du site » d'un titre de page) — le
   compteur et le conseil en tiennent compte (relecture du 3 octobre 2026 :
   ils l'ignoraient, et l'aide affirmait le contraire de ce que faisait le
   site). */
export function champTexte(app, { libelle, chemin, max = 0, multiligne = false, aide: texteAide = "", cle, vide, ajout = 0 }) {
  const id = idUnique("champ");
  const idAide = idUnique("champ-aide");
  const valeur = lireChemin(app.etat.contenu, chemin);
  const champ = h(multiligne ? "textarea" : "input", {
    id, classe: "ed-champ", "data-cle": cle || "champ:" + chemin, "aria-describedby": idAide,
    type: multiligne ? null : "text", rows: multiligne ? "3" : null
  });
  champ.value = typeof valeur === "string" ? valeur : "";
  const compteur = h("span", { classe: "ed-compteur", "aria-hidden": "true" });
  const conseil = h("span", { classe: "ed-compteur__conseil" });
  const majCompteur = () => {
    if (!max) return;
    const n = Array.from(champ.value).length;
    compteur.textContent = n + " / " + max;
    compteur.classList.toggle("est-long", n + ajout > max);
    conseil.textContent = conseilLongueur(n, max, vide === undefined ? { ajout } : { vide, ajout });
  };
  champ.addEventListener("input", () => {
    majCompteur();
    app.etat.modifier(chemin, champ.value, { fusion: "panneau:" + chemin, origine: "panneau" });
  });
  champ.addEventListener("blur", () => app.etat.couperFusion());
  majCompteur();
  return h("div", { classe: "ed-ligne-champ" },
    h("div", { classe: "ed-ligne-champ__tete" }, h("label", { for: id }, libelle), max ? compteur : null),
    champ,
    h("p", { classe: "ed-aide", id: idAide }, texteAide, max ? [" ", conseil] : null));
}

/* Une rangée de petits boutons d'outils. */
export function outils(...boutons) {
  return h("div", { classe: "ed-outils" }, ...boutons);
}

/* Une liste éditable du contenu (cartes, photos, questions, liens du menu…) :
   chaque élément avec Monter, Descendre, Dupliquer, Ajouter après, Supprimer
   — les gestes de la barre flottante, au clavier — et « Ajouter … » à la fin.
   `details(element, i)` : ce qu'on affiche sous le nom ; `plus(element, i)` :
   des boutons en plus (« Lien… »). */
export function listeEditable(app, ctx, chemin, { titre = null, details = null, plus = null, apresAjout = null, nommer = null } = {}) {
  const contenu = app.etat.contenu;
  const d = descripteurListe(contenu, chemin);
  if (!d) return null;
  const lu = lireChemin(contenu, chemin);
  const liste = Array.isArray(lu) ? lu : [];
  const mot = motDe(d.libelle);
  const n = liste.length;
  const plein = n >= d.max;
  const cle = (i, action) => "liste:" + chemin + ":" + i + ":" + action;

  const ol = h("ol", { classe: "ed-elements" });
  liste.forEach((el, i) => {
    const nom = nommer ? nommer(el, i) : nomElement(el, d.libelle, i);
    const agir = (action, cible) => () => {
      ctx.viser(cible);
      app.actionListe(action, chemin, i);
    };
    const li = h("li", { classe: "ed-element" },
      h("div", { classe: "ed-element__ligne" },
        h("button", {
          type: "button", classe: "ed-element__nom", "data-cle": cle(i, "nom"),
          quand: { click: () => app.montrerElement(chemin, i) }
        }, h("span", { classe: "ed-cache" }, "Montrer sur la page : "), nom),
        outils(
          bouton({ libelle: "Monter « " + nom + " »", bulle: "Monter", icone: "haut", seuleIcone: true, desactive: i === 0, quand: agir("monter", cle(i - 1, "monter")), attributs: { "data-cle": cle(i, "monter") } }),
          bouton({ libelle: "Descendre « " + nom + " »", bulle: "Descendre", icone: "bas", seuleIcone: true, desactive: i === n - 1, quand: agir("descendre", cle(i + 1, "descendre")), attributs: { "data-cle": cle(i, "descendre") } }),
          bouton({ libelle: "Dupliquer « " + nom + " »", bulle: plein ? "Liste complète" : "Dupliquer", icone: "dupliquer", seuleIcone: true, desactive: plein, quand: agir("dupliquer", cle(i + 1, "nom")), attributs: { "data-cle": cle(i, "dupliquer") } }),
          bouton({ libelle: "Ajouter " + d.libelle + " après « " + nom + " »", bulle: plein ? "Liste complète" : "Ajouter après", icone: "ajouterApres", seuleIcone: true, desactive: plein, quand: agir("ajouter-apres", cle(i + 1, "nom")), attributs: { "data-cle": cle(i, "ajouter-apres") } }),
          bouton({ libelle: "Supprimer « " + nom + " »", bulle: "Supprimer", icone: "supprimer", seuleIcone: true, classe: "ed-bouton--discret-danger", quand: agir("supprimer", n > 1 ? cle(Math.min(i, n - 2), "nom") : "liste:" + chemin + ":ajouter"), attributs: { "data-cle": cle(i, "supprimer") } }),
          plus ? plus(el, i) : null)),
      details ? details(el, i) : null);
    ol.append(li);
  });

  const ajouter = bouton({
    libelle: "Ajouter " + d.libelle, icone: "ajouter", desactive: plein,
    attributs: { "data-cle": "liste:" + chemin + ":ajouter" },
    quand: () => {
      ctx.viser(cle(n, "nom"));
      const i = app.actionListe("ajouter", chemin, n - 1);
      if (apresAjout && typeof i === "number" && i >= 0) apresAjout(i);
    }
  });
  return h("div", { classe: "ed-liste" },
    h("h4", { classe: "ed-liste__titre" }, (titre || majuscule(pluriel(mot))) + " — " + n + " sur " + d.max + " au plus"),
    n ? ol : aide("Aucun élément pour l'instant."),
    ajouter,
    plein ? aide("La liste est complète. Supprimez un élément pour en ajouter un autre.") : null);
}
