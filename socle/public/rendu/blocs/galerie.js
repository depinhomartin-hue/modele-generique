/* La galerie : des photos en grille, avec une légende facultative.
   Une photo sans adresse sûre n'est pas rendue sur le site (et garde son
   cadre cliquable en édition). */

import { ed, edListe, image, imageSure, afficher } from "../outils.js";
import { chemin, ouvrir, fermer, tete, riche, liste, REGLAGE_FOND } from "./commun.js";

function rendre(bloc, id, ctx) {
  const photos = liste(bloc.images).map((p, i) => {
    if (!p) return "";
    if (!ctx.edition && !imageSure(p.src)) return "";
    const base = chemin(id, "images", i);
    const legende = afficher(ctx, p.legende)
      ? '<figcaption class="galerie__legende"' + ed(ctx, base + ".legende", { riche: true }) + ">" + riche(p.legende) + "</figcaption>"
      : "";
    return '<li class="galerie__element"' + edListe(ctx, chemin(id, "images"), i) + '><figure class="galerie__figure">' +
      image(ctx, p.src, p.alt || p.legende, base + ".src", "galerie__image") + legende +
      "</figure></li>";
  }).join("");
  return ouvrir(bloc, id, ctx) +
    '<div class="conteneur">' + tete(bloc, id, ctx) +
      (photos ? '<ul class="galerie__grille" role="list">' + photos + "</ul>" : "") +
    "</div>" +
    fermer();
}

function modele() {
  return {
    type: "galerie",
    surtitre: "En images",
    titre: "Notre galerie",
    intro: "",
    images: [
      { src: "/illustrations/neutre.svg", alt: "", legende: "" },
      { src: "/illustrations/neutre.svg", alt: "", legende: "" },
      { src: "/illustrations/neutre.svg", alt: "", legende: "" }
    ]
  };
}

export default {
  type: "galerie",
  nom: "Galerie",
  description: "Vos photos en grille, chacune avec une légende si vous le souhaitez.",
  reglages: [REGLAGE_FOND],
  // Les champs du modèle qui sont des TEXTES À REMPLACER (pas des titres
  // génériques qu'on garde volontiers) : l'éditeur prévient avant de les
  // publier tels quels (`restesDuModele`, structure.js).
  exemples: ["images.*.src"],
  listes: { images: { libelle: "une photo", max: 24 } },
  rendre,
  modele
};
