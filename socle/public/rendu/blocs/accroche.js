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

import { ed, edListe, image, imageSure, bouton, afficher } from "../outils.js";
import { chemin, ouvrir, fermer, niveau, riche, liste, REGLAGE_FOND } from "./commun.js";

/* Les boutons forment une LISTE (jusqu'à deux) : en édition, chacun porte
   les marques d'un élément de liste, comme une carte ou une question, pour
   que l'éditrice puisse le déplacer, le dupliquer ou le retirer sur la
   page. Les marques vont sur le <a> lui-même et non sur une enveloppe : une
   enveloppe changerait la mise en page des boutons, et l'aperçu ne
   montrerait plus exactement le site.

   `bouton()` (outils.js) écrit toujours un lien qui commence par « <a » ;
   s'il cessait de le faire, le bouton resterait affiché sans ses marques
   plutôt que d'être abîmé. */
function enElementDeListe(html, ctx, cheminListe, i) {
  if (!html || !ctx.edition || !html.startsWith("<a ")) return html;
  return "<a" + edListe(ctx, cheminListe, i) + html.slice(2);
}

function rendre(bloc, id, ctx) {
  // Sans photo, « image-fond » n'a plus de fond : le bloc passe côte à côte
  // plutôt que de poser un texte clair sur le vide (relecture du 3 octobre).
  // En édition AUSSI : l'éditeur gardait le grand cadre sombre pendant que
  // le site montrait un côte-à-côte clair — l'aperçu mentait (contrôle du
  // 3 octobre 2026). Le cadre de la photo à choisir reste cliquable dans la
  // colonne de droite ; une fois la photo posée, la section passe en plein.
  const pleine = bloc.disposition === "image-fond" && !!imageSure(bloc.image);
  // Et ce repli se fait sur le fond CLAIR, quel que soit le fond enregistré.
  // Relecture du 3 octobre 2026 : il reprenait le fond choisi avant de
  // passer la photo en fond — « Foncé », par exemple —, que l'éditeur ne
  // montre plus et ne laisse plus régler dans cette disposition
  // (`seulementSi`, plus bas). Le site dessinait une section foncée que
  // rien, dans l'éditeur, ne permettait de voir ni de changer.
  const repli = bloc.disposition === "image-fond" && !pleine;
  const section = repli ? Object.assign({}, bloc, { fond: "clair" }) : bloc;
  const h = niveau(ctx);
  const boutons = liste(bloc.boutons).slice(0, LISTES.boutons.max)
    .map((b, i) => enElementDeListe(bouton(ctx, b, chemin(id, "boutons", i)), ctx, chemin(id, "boutons"), i))
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

  return ouvrir(section, id, ctx, pleine ? "accroche--pleine" : "accroche--cote") +
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

const LISTES = { boutons: { libelle: "un bouton", max: 2 } };

export default {
  type: "accroche",
  nom: "Accroche",
  description: "La grande entrée de la page : un titre, quelques mots, une photo et un ou deux boutons.",
  reglages: [
    {
      cle: "disposition",
      libelle: "Disposition",
      choix: [
        { valeur: "cote-a-cote", libelle: "Texte et photo côte à côte" },
        { valeur: "image-fond", libelle: "Texte posé sur la photo" }
      ]
    },
    // Photo en fond, le fond de la section ne se voit plus : on ne propose
    // pas un réglage qui ne change rien (essai du 3 octobre 2026).
    Object.assign({}, REGLAGE_FOND, { seulementSi: { disposition: "cote-a-cote" } })
  ],
  // Les champs du modèle qui sont des TEXTES À REMPLACER (pas des titres
  // génériques qu'on garde volontiers) : l'éditeur prévient avant de les
  // publier tels quels (`restesDuModele`, structure.js).
  exemples: ["surtitre", "titre", "texte", "image"],
  listes: LISTES,
  rendre,
  modele
};
