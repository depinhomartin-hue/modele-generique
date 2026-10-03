/* Horaires et accès : le bloc qu'on vient chercher sur un site vitrine.

   Le téléphone et l'adresse e-mail sont TOUJOURS écrits en clair, à côté
   du lien qui les compose : un lien `tel:` ou `mailto:` ne fonctionne pas
   partout, et la visiteuse doit pouvoir recopier le numéro (même
   principe que le numéro de suivi en clair de Graine de Pensée). */

import { echapper, ed, edDest, edListe, adresseSure, afficher, lienTelephone, estVide, texte, sansLien } from "../outils.js";
import { chemin, ouvrir, fermer, tete, riche, liste, REGLAGE_FOND } from "./commun.js";
import { libHtml } from "../libelles.js";

function rendre(bloc, id, ctx) {
  const jours = liste(bloc.jours).map((j, i) => {
    if (!j || (!ctx.edition && estVide(j.jour))) return "";
    const base = chemin(id, "jours", i);
    return '<div class="horaires__ligne"' + edListe(ctx, chemin(id, "jours"), i) + ">" +
      '<dt class="horaires__jour"' + ed(ctx, base + ".jour") + ">" + echapper(j.jour) + "</dt>" +
      '<dd class="horaires__heures"' + ed(ctx, base + ".heures") + ">" + echapper(j.heures) + "</dd></div>";
  }).join("");

  let acces = "";
  if (afficher(ctx, bloc.adresse)) {
    acces += '<p class="horaires__adresse"' + ed(ctx, chemin(id, "adresse"), { riche: true, lignes: true }) + ">" + riche(bloc.adresse) + "</p>";
  }
  if (afficher(ctx, bloc.telephone)) {
    // Le lien n'est cherché que s'il sert : sur le site, champ affiché.
    // (Il l'était à chaque visite, même pour un champ vide ou en édition.)
    const tel = ctx.edition ? "" : lienTelephone(bloc.telephone);
    acces += '<p class="horaires__contact"><span class="horaires__etiquette">' + libHtml(ctx, "telephone") + "</span>" +
      (tel && !ctx.edition ? '<a href="' + echapper(tel) + '">' + echapper(bloc.telephone) + "</a>"
        : "<span" + ed(ctx, chemin(id, "telephone")) + ">" + echapper(bloc.telephone) + "</span>") + "</p>";
  }
  if (afficher(ctx, bloc.email)) {
    const mail = adresseSure("mailto:" + texte(bloc.email).trim());
    acces += '<p class="horaires__contact"><span class="horaires__etiquette">' + libHtml(ctx, "email") + "</span>" +
      (mail && !ctx.edition ? '<a href="' + echapper(mail) + '">' + echapper(bloc.email) + "</a>"
        : "<span" + ed(ctx, chemin(id, "email")) + ">" + echapper(bloc.email) + "</span>") + "</p>";
  }
  // Le plan n'existe sur le site qu'avec une adresse https ; en édition le
  // lien reste dessiné pour qu'on puisse lui en donner une, et porte alors
  // `data-sans-lien` (outils.js) : il manque au site.
  const plan = adresseSure(bloc.lienPlan);
  const planSur = /^https:\/\//i.test(plan);
  if (planSur || ctx.edition) {
    acces += '<p><a class="lien-fleche" href="' + echapper(plan || "#") + '" target="_blank" rel="noopener"' +
      edDest(ctx, chemin(id, "lienPlan")) + sansLien(ctx, planSur ? plan : "") + ">" + libHtml(ctx, "voirPlan") + '<span aria-hidden="true"> →</span></a></p>';
  }

  return ouvrir(bloc, id, ctx) +
    '<div class="conteneur">' + tete(bloc, id, ctx) +
      '<div class="horaires__grille">' +
        (jours ? '<dl class="carte horaires__jours">' + jours + "</dl>" : "") +
        (acces ? '<div class="horaires__acces">' + acces + "</div>" : "") +
      "</div>" +
    "</div>" +
    fermer();
}

function modele() {
  return {
    type: "horaires",
    surtitre: "Nous trouver",
    titre: "Horaires et accès",
    intro: "",
    jours: [
      { jour: "Lundi", heures: "Fermé" },
      { jour: "Mardi", heures: "9 h – 18 h" },
      { jour: "Mercredi", heures: "9 h – 18 h" },
      { jour: "Jeudi", heures: "9 h – 18 h" },
      { jour: "Vendredi", heures: "9 h – 18 h" },
      { jour: "Samedi", heures: "9 h – 13 h" },
      { jour: "Dimanche", heures: "Fermé" }
    ],
    adresse: "Numéro et rue<br>Code postal Ville",
    telephone: "",
    email: "",
    lienPlan: ""
  };
}

export default {
  type: "horaires",
  nom: "Horaires et accès",
  description: "Vos jours et heures d'ouverture, votre adresse et le moyen de vous joindre.",
  reglages: [REGLAGE_FOND],
  // Les champs du modèle qui sont des TEXTES À REMPLACER (pas des titres
  // génériques qu'on garde volontiers) : l'éditeur prévient avant de les
  // publier tels quels (`restesDuModele`, structure.js).
  exemples: ["jours", "adresse"],
  listes: { jours: { libelle: "une ligne", max: 14 } },
  rendre,
  modele
};
