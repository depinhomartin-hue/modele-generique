/* Le texte : un titre et des paragraphes, chacun sous son sous-titre.

   C'est le bloc des pages d'INFORMATION — mentions légales, conditions,
   engagements — qu'aucun autre bloc ne savait porter : un site vitrine
   doit ses mentions légales (LCEN), et il fallait jusqu'ici les écrire à
   la main dans un autre bloc (3 octobre 2026).

   Une colonne étroite, comme la FAQ : un texte long se lit mal sur toute
   la largeur d'un écran d'ordinateur.

   Les paragraphes forment une LISTE (`edListe`) : l'éditrice les ajoute,
   les déplace, les retire sur la page. Leurs indices restent ceux du
   contenu, même quand un élément abîmé est sauté (voir `liste`,
   commun.js). Un sous-titre vide disparaît sur le site et reste cliquable
   en édition ; un paragraphe sans sous-titre ni texte n'est pas rendu sur
   le site. */

import { ed, edListe, afficher, estVide } from "../outils.js";
import { chemin, ouvrir, fermer, tete, riche, liste, sousNiveau, REGLAGE_FOND } from "./commun.js";

function rendre(bloc, id, ctx) {
  // Un niveau sous le titre du bloc tel qu'il sera rendu (`sousNiveau`,
  // commun.js) : h2 s'il porte le <h1> de la page ou s'il n'a pas de titre
  // sur le site, h3 sinon.
  const h = sousNiveau(bloc, ctx);
  const paragraphes = liste(bloc.paragraphes).map((p, i) => {
    if (!p) return "";
    if (!ctx.edition && estVide(p.titre) && estVide(p.texte)) return "";
    const base = chemin(id, "paragraphes", i);
    return '<li class="texte__paragraphe"' + edListe(ctx, chemin(id, "paragraphes"), i) + ">" +
      (afficher(ctx, p.titre)
        ? "<" + h + ' class="texte__sous-titre"' + ed(ctx, base + ".titre", { riche: true }) + ">" + riche(p.titre) + "</" + h + ">"
        : "") +
      (afficher(ctx, p.texte)
        ? '<div class="texte-courant"' + ed(ctx, base + ".texte", { riche: true, lignes: true }) + ">" + riche(p.texte) + "</div>"
        : "") +
      "</li>";
  }).join("");
  return ouvrir(bloc, id, ctx) +
    '<div class="conteneur conteneur--etroit">' + tete(bloc, id, ctx) +
      (paragraphes ? '<ul class="texte__liste" role="list">' + paragraphes + "</ul>" : "") +
    "</div>" +
    fermer();
}

function modele() {
  return {
    type: "texte",
    surtitre: "",
    titre: "Un titre",
    intro: "",
    paragraphes: [
      { titre: "Un sous-titre", texte: "Un paragraphe de texte." }
    ]
  };
}

export default {
  type: "texte",
  nom: "Texte",
  description: "Un titre et des paragraphes, pour les pages d'information : mentions légales, conditions, engagements.",
  reglages: [REGLAGE_FOND],
  // Les champs du modèle qui sont des TEXTES À REMPLACER (pas des titres
  // génériques qu'on garde volontiers) : l'éditeur prévient avant de les
  // publier tels quels (`restesDuModele`, structure.js).
  exemples: ["titre", "paragraphes.*.titre", "paragraphes.*.texte"],
  listes: { paragraphes: { libelle: "un paragraphe", max: 40 } },
  rendre,
  modele
};
