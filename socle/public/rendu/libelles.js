/* =========================================================
   Les petits mots de l'interface
   =========================================================

   « Menu », « Voir le plan », « Téléphone » : ils se répètent d'un bloc à
   l'autre, et ce sont des mots du CLIENT, pas du code. Ils vivent dans
   `contenu.libelles`, se modifient en cliquant dessus sur la page, et
   retombent sur ces valeurs quand le client les vide (leçon de Graine de
   Pensée : un champ vidé par mégarde ne doit pas laisser un bouton muet).

   Restent écrits dans le code, exprès, les textes qu'on ne voit jamais à
   l'écran en temps normal (le lien d'évitement « Aller au contenu ») et
   ceux qui appartiennent à l'atelier (la mention de démonstration). Un
   réglage qu'on ne peut pas vérifier à l'écran n'est pas un réglage. */

import { echapper, ed } from "./outils.js";

export const LIBELLES = {
  menu: "Menu",
  voirPlan: "Voir le plan",
  telephone: "Téléphone",
  email: "E-mail"
};

export function lib(ctx, cle) {
  const v = ctx && ctx.contenu && ctx.contenu.libelles ? ctx.contenu.libelles[cle] : undefined;
  return typeof v === "string" && v.trim() ? v : (LIBELLES[cle] ?? "");
}

/* Le libellé prêt à poser dans la page, avec sa marque d'édition. */
export function libHtml(ctx, cle) {
  return "<span" + ed(ctx, "libelles." + cle) + ">" + echapper(lib(ctx, cle)) + "</span>";
}
