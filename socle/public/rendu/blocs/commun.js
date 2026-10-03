/* =========================================================
   Ce que tous les blocs partagent
   =========================================================

   Un bloc est un objet rangé dans `contenu.blocs[id]`, avec au moins un
   `type`. Son identifiant (`accroche-1`) est stable : déplacer un bloc ne
   change que `pages.<page>.ordre`, jamais les chemins de ses textes. C'est
   ce qui permettra à l'éditeur de réécrire un mot sans reconstruire la
   page.

   Tous les blocs sont égaux. Graine de Pensée distinguait des blocs
   « d'origine » et des « exemplaires », héritage d'un site construit avant
   le système de blocs ; ce socle part sans cette distinction. */

import { echapper, texteRiche, ed, afficher, identifiantValide } from "../outils.js";
import { POLICES } from "../themes.js";

export const FONDS = ["clair", "doux", "sombre"];

export function chemin(id, ...suite) {
  return ["blocs", id, ...suite].join(".");
}

/* L'ancre d'un bloc : celle choisie dans le contenu, sinon son identifiant.
   Une ancre invalide est ignorée plutôt que d'écrire un `id` cassé. */
export function ancre(bloc, id) {
  return identifiantValide(bloc.ancre) ? bloc.ancre : id;
}

export function riche(html) {
  return texteRiche(html, { polices: POLICES });
}

/* L'ouverture de la <section> d'un bloc.

   `data-bloc` et `data-type` sont posés MÊME hors édition : ils ne
   révèlent rien et permettent au CSS comme au JavaScript visiteur de
   viser un bloc sans dépendre de sa position. */
export function ouvrir(bloc, id, ctx, classes = "") {
  const fond = FONDS.includes(bloc.fond) ? bloc.fond : "clair";
  const a = (ctx && ctx.ancre) || ancre(bloc, id);
  return '<section id="' + echapper(a) + '" class="bloc bloc-' + echapper(bloc.type) +
    " bloc--" + fond + (classes ? " " + classes : "") + '" data-bloc="' + echapper(id) + '" data-type="' +
    echapper(bloc.type) + '">';
}

export function fermer() {
  return "</section>";
}

/* Le niveau du titre principal d'un bloc. Une page n'a qu'un <h1> : celui
   du PREMIER bloc s'il en porte un. Sinon la page ajoute un <h1> réservé
   aux lecteurs d'écran (voir page.js). */
export function niveau(ctx) {
  return ctx.premier ? "h1" : "h2";
}

/* Sur-titre, titre et introduction d'une section : la tête commune à
   presque tous les blocs. Chaque morceau vide disparaît sur le site et
   reste cliquable en édition. */
export function tete(bloc, id, ctx, { centre = false } = {}) {
  const h = niveau(ctx);
  let html = "";
  if (afficher(ctx, bloc.surtitre)) {
    html += '<p class="surtitre"' + ed(ctx, chemin(id, "surtitre"), { riche: true }) + ">" + riche(bloc.surtitre) + "</p>";
  }
  if (afficher(ctx, bloc.titre)) {
    html += "<" + h + ' class="titre-section"' + ed(ctx, chemin(id, "titre"), { riche: true }) + ">" + riche(bloc.titre) + "</" + h + ">";
  }
  if (afficher(ctx, bloc.intro)) {
    html += '<p class="intro"' + ed(ctx, chemin(id, "intro"), { riche: true, lignes: true }) + ">" + riche(bloc.intro) + "</p>";
  }
  return html ? '<header class="tete-section' + (centre ? " tete-section--centre" : "") + '">' + html + "</header>" : "";
}

/* Une liste du contenu, toujours un tableau. Un contenu abîmé (un objet à
   la place d'une liste) donne une liste vide ; un ÉLÉMENT abîmé (null, un
   nombre) devient `null` et le bloc le saute — sans le retirer du tableau.

   ⚠️ On ne FILTRE pas : l'indice de chaque élément est celui du contenu,
   et les marques d'édition (`data-index`, `blocs.x.elements.3.titre`) en
   dépendent. Filtrer décalait tous les éléments suivants : l'éditeur
   aurait réécrit le mauvais (relecture du 3 octobre 2026). */
export function liste(v) {
  return Array.isArray(v) ? v.map((x) => (x && typeof x === "object" && !Array.isArray(x) ? x : null)) : [];
}

/* Combien d'éléments réels dans une liste rendue par `liste()`. */
export function nombre(elements) {
  return elements.reduce((n, x) => n + (x ? 1 : 0), 0);
}
