/* Horaires et accès : le bloc qu'on vient chercher sur un site vitrine.

   Le téléphone et l'adresse e-mail sont TOUJOURS écrits en clair, à côté
   du lien qui les compose : un lien `tel:` ou `mailto:` ne fonctionne pas
   partout, et la visiteuse doit pouvoir recopier le numéro (même
   principe que le numéro de suivi en clair de Graine de Pensée). */

import { echapper, ed, edDest, edListe, adresseSure, afficher, lienTelephone, estVide, texte } from "../outils.js";
import { chemin, ouvrir, fermer, tete, riche, liste } from "./commun.js";
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
  const tel = lienTelephone(bloc.telephone);
  if (afficher(ctx, bloc.telephone)) {
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
  const plan = adresseSure(bloc.lienPlan);
  if (/^https:\/\//i.test(plan) || ctx.edition) {
    acces += '<p><a class="lien-fleche" href="' + echapper(plan || "#") + '" target="_blank" rel="noopener"' +
      edDest(ctx, chemin(id, "lienPlan")) + ">" + libHtml(ctx, "voirPlan") + '<span aria-hidden="true"> →</span></a></p>';
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

export default { type: "horaires", nom: "Horaires et accès", rendre, modele };
