/* =========================================================
   Les petits mots de l'interface
   =========================================================

   « Menu », « Voir le plan », « Téléphone » : ils se répètent d'un bloc à
   l'autre, et ce sont des mots du CLIENT, pas du code. Ils vivent dans
   `contenu.libelles`, se modifient en cliquant dessus sur la page, et
   retombent sur ces valeurs quand le client les vide (leçon de Graine de
   Pensée : un champ vidé par mégarde ne doit pas laisser un bouton muet).

   Restent écrits dans le code, exprès, les textes qu'on ne voit jamais à
   l'écran en temps normal (le lien d'évitement « Aller au contenu »), ceux
   qui appartiennent à l'atelier (la mention de démonstration) et les
   messages d'erreur du formulaire de contact (formulaire.js), qu'on ne
   voit qu'après un envoi raté. Un réglage qu'on ne peut pas vérifier à
   l'écran n'est pas un réglage.

   Le remerciement du formulaire (`contactMerci`), lui, se voit : en
   édition, la section contact l'affiche sous le formulaire, pour qu'on
   puisse cliquer dessus (3 octobre 2026). */

import { echapper, ed } from "./outils.js";

export const LIBELLES = {
  menu: "Menu",
  // Le lien qui referme le menu plein écran (page.js, 4 octobre 2026).
  fermerMenu: "Fermer",
  voirPlan: "Voir le plan",
  telephone: "Téléphone",
  email: "E-mail",
  // Le formulaire de contact (blocs/contact.js).
  contactNom: "Votre nom",
  contactEmail: "Votre adresse e-mail",
  contactTelephone: "Votre téléphone (facultatif)",
  contactMessage: "Votre message",
  contactEnvoyer: "Envoyer",
  contactMerci: "Merci, votre message est bien parti. Nous vous répondons au plus vite.",
  // La notice ne promet que ce que le site tient : la durée de garde vit
  // dans les mentions légales, auxquelles elle mène (blocs/contact.js).
  // « Gardées un an au plus » n'y est plus : écrit sous le bouton, c'était
  // une promesse que rien ne tenait sur un site calme, où aucune purge ne
  // passait (relecture du 3 octobre 2026).
  contactNotice: "Vos coordonnées servent uniquement à répondre à votre message.",
  // Le lien du bas de page, et celui de la notice du formulaire.
  mentionsLegales: "Mentions légales"
};

export function lib(ctx, cle) {
  const v = ctx && ctx.contenu && ctx.contenu.libelles ? ctx.contenu.libelles[cle] : undefined;
  return typeof v === "string" && v.trim() ? v : (LIBELLES[cle] ?? "");
}

/* Le libellé prêt à poser dans la page, avec sa marque d'édition. */
export function libHtml(ctx, cle) {
  return "<span" + ed(ctx, "libelles." + cle) + ">" + echapper(lib(ctx, cle)) + "</span>";
}
