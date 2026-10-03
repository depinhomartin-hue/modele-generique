/* La présentation : un texte et une photo côte à côte — « Qui sommes-nous »,
   « Notre histoire », « L'atelier ». `inverse` met la photo à gauche ;
   alterner d'un bloc à l'autre évite une page en escalier toujours penché
   du même côté. */

import { ed, image, bouton, afficher } from "../outils.js";
import { chemin, ouvrir, fermer, tete, riche } from "./commun.js";

function rendre(bloc, id, ctx) {
  const photo = image(ctx, bloc.image, bloc.imageAlt, chemin(id, "image"), "presentation__image");
  const texte = afficher(ctx, bloc.texte)
    ? '<div class="presentation__texte texte-courant"' + ed(ctx, chemin(id, "texte"), { riche: true, lignes: true }) + ">" + riche(bloc.texte) + "</div>"
    : "";
  const appel = bouton(ctx, bloc.bouton, chemin(id, "bouton"));
  return ouvrir(bloc, id, ctx, bloc.inverse ? "presentation--inverse" : "") +
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

export default { type: "presentation", nom: "Présentation", rendre, modele };
