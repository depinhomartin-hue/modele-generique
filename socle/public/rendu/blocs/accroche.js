/* L'accroche : la grande entrée de la page.

   Deux dispositions :
   — « image-fond » : la photo en plein cadre, le texte posé sur un PANNEAU
     sombre à 88 % d'opacité. Un simple voile en dégradé ne suffisait pas :
     sur une photo claire, le titre tombait à 1,65:1 (relecture du
     3 octobre 2026). Le panneau tient le contraste quelle que soit la photo
     — `npm run verifier` le mesure sur une photo blanche ;
   — « cote-a-cote » : le texte sur le fond du thème, la photo à côté. Le
     contraste est alors celui de la palette, mesuré. C'est la disposition
     par défaut, la plus sûre avec des photos qu'on ne connaît pas encore. */

import { ed, image, imageSure, bouton, afficher } from "../outils.js";
import { chemin, ouvrir, fermer, niveau, riche, liste } from "./commun.js";

function rendre(bloc, id, ctx) {
  // Sans photo, « image-fond » n'a plus de fond : le bloc passe côte à côte
  // plutôt que de poser un texte clair sur le vide (relecture du 3 octobre).
  const pleine = bloc.disposition === "image-fond" && (!!imageSure(bloc.image) || ctx.edition);
  const h = niveau(ctx);
  const boutons = liste(bloc.boutons).slice(0, 2)
    .map((b, i) => bouton(ctx, b, chemin(id, "boutons", i)))
    .join("");
  const photo = image(ctx, bloc.image, bloc.imageAlt, chemin(id, "image"), "accroche__image", ctx.premier ? "eager" : "lazy");

  let texte = "";
  if (afficher(ctx, bloc.surtitre)) {
    texte += '<p class="surtitre"' + ed(ctx, chemin(id, "surtitre"), { riche: true }) + ">" + riche(bloc.surtitre) + "</p>";
  }
  if (afficher(ctx, bloc.titre)) {
    texte += "<" + h + ' class="accroche__titre"' + ed(ctx, chemin(id, "titre"), { riche: true }) + ">" + riche(bloc.titre) + "</" + h + ">";
  }
  if (afficher(ctx, bloc.texte)) {
    texte += '<p class="accroche__texte"' + ed(ctx, chemin(id, "texte"), { riche: true, lignes: true }) + ">" + riche(bloc.texte) + "</p>";
  }
  if (boutons) texte += '<div class="accroche__boutons">' + boutons + "</div>";

  return ouvrir(bloc, id, ctx, pleine ? "accroche--pleine" : "accroche--cote") +
    (pleine
      ? '<div class="accroche__media">' + photo + '<span class="accroche__voile" aria-hidden="true"></span></div>' +
        '<div class="conteneur accroche__contenu"><div class="accroche__panneau">' + texte + "</div></div>"
      : '<div class="conteneur accroche__grille"><div class="accroche__contenu">' + texte + "</div>" +
        (photo ? '<div class="accroche__media">' + photo + "</div>" : "") + "</div>") +
    fermer();
}

function modele() {
  return {
    type: "accroche",
    disposition: "cote-a-cote",
    surtitre: "Votre métier · votre ville",
    titre: "Une phrase qui dit ce que vous faites",
    texte: "Deux ou trois lignes pour donner envie d'en savoir plus.",
    image: "/illustrations/neutre.svg",
    imageAlt: "",
    boutons: [
      { texte: "Découvrir", vers: "", style: "plein" },
      { texte: "Nous contacter", vers: "", style: "contour" }
    ]
  };
}

export default { type: "accroche", nom: "Accroche", rendre, modele };
