/* Les prestations : une grille de cartes — un service, un produit phare,
   une formule. Le prix est facultatif et s'affiche tel qu'il est écrit
   (« dès 25 € », « sur devis ») : un artisan ne vend pas tout au prix fixe. */

import { echapper, ed, edListe, afficher, estVide } from "../outils.js";
import { chemin, ouvrir, fermer, tete, riche, liste, sousNiveau, REGLAGE_FOND } from "./commun.js";

/* `h` : le niveau du titre d'une carte, un cran sous le titre du bloc tel
   qu'il sera rendu (`sousNiveau`, commun.js). Il se décide pour le BLOC :
   une carte ne sait pas si le titre de sa section est écrit. */
function carte(el, i, id, ctx, h) {
  if (!el) return "";
  // Sur le site, une carte sans titre ni texte n'est pas une carte.
  if (!ctx.edition && estVide(el.titre) && estVide(el.texte)) return "";
  const base = chemin(id, "elements", i);
  let html = '<li class="carte prestation"' + edListe(ctx, chemin(id, "elements"), i) + ">";
  if (afficher(ctx, el.titre)) {
    html += "<" + h + ' class="prestation__titre"' + ed(ctx, base + ".titre", { riche: true }) + ">" + riche(el.titre) + "</" + h + ">";
  }
  if (afficher(ctx, el.texte)) {
    html += '<p class="prestation__texte"' + ed(ctx, base + ".texte", { riche: true, lignes: true }) + ">" + riche(el.texte) + "</p>";
  }
  if (afficher(ctx, el.prix)) {
    html += '<p class="prestation__prix"' + ed(ctx, base + ".prix") + ">" + echapper(el.prix) + "</p>";
  }
  return html + "</li>";
}

function rendre(bloc, id, ctx) {
  const h = sousNiveau(bloc, ctx);
  const cartes = liste(bloc.elements).map((el, i) => carte(el, i, id, ctx, h)).join("");
  return ouvrir(bloc, id, ctx) +
    '<div class="conteneur">' + tete(bloc, id, ctx) +
      (cartes || ctx.edition ? '<ul class="prestations__grille" role="list">' + cartes + "</ul>" : "") +
    "</div>" +
    fermer();
}

function modele() {
  return {
    type: "prestations",
    surtitre: "Ce que nous proposons",
    titre: "Nos prestations",
    intro: "",
    elements: [
      { titre: "Première prestation", texte: "Ce qu'elle comprend, en une ou deux phrases.", prix: "" },
      { titre: "Deuxième prestation", texte: "Ce qu'elle comprend, en une ou deux phrases.", prix: "" },
      { titre: "Troisième prestation", texte: "Ce qu'elle comprend, en une ou deux phrases.", prix: "" }
    ]
  };
}

export default {
  type: "prestations",
  nom: "Prestations",
  description: "Des cartes pour présenter vos services ou vos produits, avec un prix si vous le souhaitez.",
  reglages: [REGLAGE_FOND],
  // Les champs du modèle qui sont des TEXTES À REMPLACER (pas des titres
  // génériques qu'on garde volontiers) : l'éditeur prévient avant de les
  // publier tels quels (`restesDuModele`, structure.js).
  exemples: ["elements.*.titre", "elements.*.texte"],
  listes: { elements: { libelle: "une carte", max: 12 } },
  rendre,
  modele
};
