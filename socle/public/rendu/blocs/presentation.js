/* La présentation : un texte et une photo côte à côte — « Qui sommes-nous »,
   « Notre histoire », « L'atelier ». `inverse` met la photo à gauche ;
   alterner d'un bloc à l'autre évite une page en escalier toujours penché
   du même côté.

   La photo ne passe à gauche que pour un vrai `true` : c'est la règle par
   laquelle l'éditeur coche sa case « Photo à gauche ». Un simple test de
   vérité aurait basculé la photo pour un texte « non » pendant que la case
   restait décochée — l'écran et la page se seraient contredits. */

import { ed, image, bouton, afficher } from "../outils.js";
import { chemin, ouvrir, fermer, tete, riche, REGLAGE_FOND } from "./commun.js";

function rendre(bloc, id, ctx) {
  const photo = image(ctx, bloc.image, bloc.imageAlt, chemin(id, "image"), "presentation__image");
  const texte = afficher(ctx, bloc.texte)
    ? '<div class="presentation__texte texte-courant"' + ed(ctx, chemin(id, "texte"), { riche: true, lignes: true }) + ">" + riche(bloc.texte) + "</div>"
    : "";
  const appel = bouton(ctx, bloc.bouton, chemin(id, "bouton"));
  return ouvrir(bloc, id, ctx, bloc.inverse === true ? "presentation--inverse" : "") +
    '<div class="conteneur presentation__grille">' +
      '<div class="presentation__contenu">' + tete(bloc, id, ctx) + texte +
        (appel ? '<div class="presentation__appel">' + appel + "</div>" : "") +
      "</div>" +
      (photo ? '<div class="presentation__media">' + photo + "</div>" : "") +
    "</div>" +
    fermer();
}

function modele() {
  return {
    type: "presentation",
    surtitre: "Qui sommes-nous",
    titre: "Votre histoire en une phrase",
    texte: "Racontez d'où vous venez, ce que vous aimez faire et ce qui vous distingue.<br><br>Un second paragraphe pour les détails qui comptent.",
    image: "/illustrations/neutre.svg",
    imageAlt: "",
    inverse: false,
    bouton: { texte: "", vers: "", style: "contour" }
  };
}

export default {
  type: "presentation",
  nom: "Présentation",
  description: "Un texte et une photo côte à côte, pour raconter votre histoire ou votre savoir-faire.",
  reglages: [REGLAGE_FOND, { cle: "inverse", libelle: "Photo à gauche", type: "case" }],
  // Les champs du modèle qui sont des TEXTES À REMPLACER (pas des titres
  // génériques qu'on garde volontiers) : l'éditeur prévient avant de les
  // publier tels quels (`restesDuModele`, structure.js).
  exemples: ["titre", "texte", "image"],
  listes: {},
  rendre,
  modele
};
