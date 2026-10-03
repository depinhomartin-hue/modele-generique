/* Le contact.

   Phase 1 : un texte et les moyens de joindre l'entreprise, écrits en
   clair. Le formulaire viendra en phase 3, avec son alerte gratuite vers
   l'adresse vérifiée du client — il s'ajoutera DANS ce bloc, sans changer
   son contenu. */

import { echapper, ed, adresseSure, afficher, lienTelephone, texte } from "../outils.js";
import { chemin, ouvrir, fermer, tete, riche } from "./commun.js";
import { libHtml } from "../libelles.js";

function moyen(ctx, id, champ, cleLibelle, lien) {
  const valeur = ctx.contenuBloc[champ];
  if (!afficher(ctx, valeur)) return "";
  const vers = lien(valeur);
  return '<li class="contact__moyen"><span class="contact__etiquette">' + libHtml(ctx, cleLibelle) + "</span>" +
    (vers && !ctx.edition
      ? '<a class="contact__valeur" href="' + echapper(vers) + '">' + echapper(valeur) + "</a>"
      : '<span class="contact__valeur"' + ed(ctx, chemin(id, champ)) + ">" + echapper(valeur) + "</span>") +
    "</li>";
}

function rendre(bloc, id, ctx) {
  const c = Object.assign({}, ctx, { contenuBloc: bloc });
  const moyens =
    moyen(c, id, "telephone", "telephone", lienTelephone) +
    moyen(c, id, "email", "email", (v) => adresseSure("mailto:" + texte(v).trim()));
  return ouvrir(bloc, id, ctx) +
    '<div class="conteneur contact__grille">' +
      '<div class="contact__texte">' + tete(bloc, id, ctx) +
        (afficher(ctx, bloc.texte) ? '<div class="texte-courant"' + ed(ctx, chemin(id, "texte"), { riche: true, lignes: true }) + ">" + riche(bloc.texte) + "</div>" : "") +
      "</div>" +
      (moyens ? '<ul class="carte contact__moyens" role="list">' + moyens + "</ul>" : "") +
    "</div>" +
    fermer();
}

function modele() {
  return {
    type: "contact",
    surtitre: "Contact",
    titre: "Écrivez-nous",
    intro: "",
    texte: "Une question, une commande spéciale ? Nous répondons dans la journée.",
    telephone: "",
    email: ""
  };
}

export default { type: "contact", nom: "Contact", rendre, modele };
