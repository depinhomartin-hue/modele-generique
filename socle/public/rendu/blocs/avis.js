/* Les avis de clients.

   ⚠️ Un avis publié doit être VRAI. Inventer des avis est une pratique
   commerciale trompeuse (Code de la consommation) : le bloc ne fabrique
   rien, il affiche ce que le client a recopié de ses vrais avis.

   Sur un site de démonstration (`client.demo`), le bloc l'écrit en clair
   sous les avis : ce sont des exemples, pas les clients de quelqu'un.

   La note est facultative, de 1 à 5, dite en toutes lettres aux lecteurs
   d'écran — cinq étoiles muettes ne disent rien à qui ne les voit pas. */

import { echapper, ed, edListe, afficher, estVide } from "../outils.js";
import { chemin, ouvrir, fermer, tete, riche, liste, REGLAGE_FOND } from "./commun.js";

/* La note : un nombre (ou un texte de chiffres), de 1 à 5. Tout autre
   chose n'affiche pas de note — `Number()` sur un objet piégé lèverait.
   Les étoiles vides sont dessinées CREUSES (☆) et non pâles : la forme
   suffit à les distinguer, sans dépendre d'un contraste trop faible. */
function etoiles(note) {
  if (typeof note !== "number" && typeof note !== "string") return "";
  const n = Math.round(Number(note));
  if (!Number.isFinite(n) || n < 1 || n > 5) return "";
  return '<p class="avis__note" role="img" aria-label="Note : ' + n + ' sur 5">' +
    '<span aria-hidden="true">' + "★".repeat(n) + '<span class="avis__note-vide">' + "☆".repeat(5 - n) + "</span></span></p>";
}

function rendre(bloc, id, ctx) {
  const avis = liste(bloc.avis).map((a, i) => {
    if (!a) return "";
    // Sur le site, un avis sans texte n'est pas un avis.
    if (!ctx.edition && estVide(a.texte)) return "";
    const base = chemin(id, "avis", i);
    return '<li class="carte avis"' + edListe(ctx, chemin(id, "avis"), i) + "><figure>" +
      etoiles(a.note) +
      '<blockquote class="avis__texte"' + ed(ctx, base + ".texte", { riche: true, lignes: true }) + ">" + riche(a.texte) + "</blockquote>" +
      '<figcaption class="avis__auteur"><span' + ed(ctx, base + ".auteur") + ">" + echapper(a.auteur) + "</span>" +
        (afficher(ctx, a.detail) ? '<span class="avis__detail"' + ed(ctx, base + ".detail") + ">" + echapper(a.detail) + "</span>" : "") +
      "</figcaption></figure></li>";
  }).join("");
  const mention = ctx.client && ctx.client.demo
    ? '<p class="avis__mention">Avis fictifs, écrits pour la démonstration.</p>'
    : "";
  return ouvrir(bloc, id, ctx) +
    '<div class="conteneur">' + tete(bloc, id, ctx, { centre: true }) +
      (avis ? '<ul class="avis__grille" role="list">' + avis + "</ul>" : "") + mention +
    "</div>" +
    fermer();
}

/* Un avis neuf naît SANS note (`note: ""`, qu'`etoiles()` ne dessine
   pas). Relecture du 3 octobre 2026 : le modèle portait `note: 5`, et tout
   avis ajouté depuis l'éditeur — copie de ce modèle — partait en ligne
   avec cinq étoiles que le client n'avait peut-être pas données, sans que
   l'avertissement de publication le signale une fois le texte réécrit.
   Une note se CHOISIT, elle ne s'hérite pas. */
function modele() {
  return {
    type: "avis",
    surtitre: "Ils en parlent",
    titre: "Ce que disent nos clients",
    intro: "",
    avis: [
      { texte: "Recopiez ici un vrai avis laissé par un client.", auteur: "Prénom N.", detail: "", note: "" }
    ]
  };
}

export default {
  type: "avis",
  nom: "Avis",
  description: "Les vrais avis de vos clients, recopiés tels qu'ils les ont laissés.",
  reglages: [REGLAGE_FOND],
  // Les champs du modèle qui sont des TEXTES À REMPLACER (pas des titres
  // génériques qu'on garde volontiers) : l'éditeur prévient avant de les
  // publier tels quels (`restesDuModele`, structure.js).
  exemples: ["avis.*.texte", "avis.*.auteur"],
  listes: { avis: { libelle: "un avis", max: 12 } },
  rendre,
  modele
};
