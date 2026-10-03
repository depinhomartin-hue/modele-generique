/* Les questions fréquentes, en <details> : elles s'ouvrent et se ferment
   sans une ligne de JavaScript, au clavier comme au doigt, et un lecteur
   d'écran sait les annoncer.

   En édition, toutes les réponses sont ouvertes : on ne réécrit pas un
   texte qu'on ne voit pas. */

import { ed, edListe, estVide } from "../outils.js";
import { chemin, ouvrir, fermer, tete, riche, liste, REGLAGE_FOND } from "./commun.js";

function rendre(bloc, id, ctx) {
  const questions = liste(bloc.questions).map((q, i) => {
    if (!q || (!ctx.edition && estVide(q.question))) return "";
    const base = chemin(id, "questions", i);
    return '<li class="faq__element"' + edListe(ctx, chemin(id, "questions"), i) + "><details class=\"faq__question\"" + (ctx.edition ? " open" : "") + ">" +
      '<summary><span' + ed(ctx, base + ".question", { riche: true }) + ">" + riche(q.question) + "</span></summary>" +
      '<div class="faq__reponse texte-courant"' + ed(ctx, base + ".reponse", { riche: true, lignes: true }) + ">" + riche(q.reponse) + "</div>" +
      "</details></li>";
  }).join("");
  return ouvrir(bloc, id, ctx) +
    '<div class="conteneur conteneur--etroit">' + tete(bloc, id, ctx) +
      (questions ? '<ul class="faq__liste" role="list">' + questions + "</ul>" : "") +
    "</div>" +
    fermer();
}

function modele() {
  return {
    type: "faq",
    surtitre: "Questions fréquentes",
    titre: "Vous vous demandez peut-être…",
    intro: "",
    questions: [
      { question: "Une question qu'on vous pose souvent ?", reponse: "La réponse, simplement." },
      { question: "Une deuxième question ?", reponse: "La réponse, simplement." }
    ]
  };
}

export default {
  type: "faq",
  nom: "Questions fréquentes",
  description: "Les questions qu'on vous pose souvent, avec leurs réponses, qui s'ouvrent d'un clic.",
  reglages: [REGLAGE_FOND],
  // Les champs du modèle qui sont des TEXTES À REMPLACER (pas des titres
  // génériques qu'on garde volontiers) : l'éditeur prévient avant de les
  // publier tels quels (`restesDuModele`, structure.js).
  exemples: ["questions.*.question", "questions.*.reponse"],
  listes: { questions: { libelle: "une question", max: 20 } },
  rendre,
  modele
};
