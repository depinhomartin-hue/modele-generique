/* L'appel à l'action : un bandeau court qui pousse à UN geste — appeler,
   passer, réserver. Un seul bouton, exprès : deux boutons de même poids
   font hésiter. Par défaut sur le fond sombre du thème, pour trancher
   avec les sections voisines. */

import { ed, bouton, afficher } from "../outils.js";
import { chemin, ouvrir, fermer, niveau, riche } from "./commun.js";

function rendre(bloc, id, ctx) {
  const h = niveau(ctx);
  const appel = bouton(ctx, bloc.bouton, chemin(id, "bouton"));
  return ouvrir(bloc, id, ctx) +
    '<div class="conteneur appel__contenu">' +
      '<div class="appel__texte">' +
        (afficher(ctx, bloc.titre) ? "<" + h + ' class="appel__titre"' + ed(ctx, chemin(id, "titre"), { riche: true }) + ">" + riche(bloc.titre) + "</" + h + ">" : "") +
        (afficher(ctx, bloc.texte) ? '<p class="appel__phrase"' + ed(ctx, chemin(id, "texte"), { riche: true }) + ">" + riche(bloc.texte) + "</p>" : "") +
      "</div>" +
      (appel ? '<div class="appel__bouton">' + appel + "</div>" : "") +
    "</div>" +
    fermer();
}

function modele() {
  return {
    type: "appel",
    fond: "sombre",
    titre: "Une envie, une question ?",
    texte: "Le plus simple est de nous appeler.",
    bouton: { texte: "Nous appeler", vers: "", style: "plein" }
  };
}

export default { type: "appel", nom: "Appel à l'action", rendre, modele };
