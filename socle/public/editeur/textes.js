/* =========================================================
   Les phrases de l'éditeur — dates, versions, journal, erreurs
   =========================================================

   Module PUR : ni `document` ni `window`. Il est testé sous Node
   (outils/tester-editeur.mjs).

   Tout ce que lit l'artisan est écrit ici en français courant, au
   vouvoiement, sans un mot technique : ni « révision », ni « session »,
   ni « JSON ». Un code d'erreur du serveur ne s'affiche JAMAIS tel quel —
   il dit à l'écran ce qui s'est passé et ce qu'il faut faire. */

import { PAGE_ACCUEIL } from "/rendu/page.js";
import { texteBrut } from "/rendu/outils.js";

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function dateValide(ms) {
  if (typeof ms !== "number" && !(ms instanceof Date)) return null;
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? d : null;
}

/* « 14 h 02 » : l'écriture française de l'heure, sans « : ». */
export function heureLisible(ms) {
  const d = dateValide(ms);
  return d ? d.getHours() + " h " + String(d.getMinutes()).padStart(2, "0") : "";
}

/* « 1er octobre », « 3 octobre » ; l'année seulement si ce n'est pas
   celle d'aujourd'hui (une version de l'an dernier doit le dire). */
function jourEtMois(d, maintenant, mois) {
  const jour = d.getDate() === 1 ? "1er" : String(d.getDate());
  const annee = d.getFullYear() !== new Date(maintenant).getFullYear() ? " " + d.getFullYear() : "";
  return jour + " " + mois[d.getMonth()] + annee;
}

/* « 3 octobre à 14 h 02 » — versions, conflits. */
export function dateLongue(ms, maintenant = Date.now()) {
  const d = dateValide(ms);
  return d ? jourEtMois(d, maintenant, MOIS) + " à " + heureLisible(d) : "";
}

/* « 3 oct., 14 h 02 » — le journal, où les lignes se suivent. */
export function dateCourte(ms, maintenant = Date.now()) {
  const d = dateValide(ms);
  return d ? jourEtMois(d, maintenant, MOIS_COURTS) + ", " + heureLisible(d) : "";
}

/* « aujourd'hui à 14 h 02 », « hier à 9 h 05 », « le 2 octobre à … ».
   Pour dire QUAND quelqu'un d'autre a touché au brouillon : « aujourd'hui »
   se lit plus vite qu'une date, et c'est le cas le plus fréquent. */
export function momentLisible(ms, maintenant = Date.now()) {
  const d = dateValide(ms);
  if (!d) return "";
  const jour = (x) => new Date(x).toDateString();
  if (jour(d) === jour(maintenant)) return "aujourd'hui à " + heureLisible(d);
  const hier = new Date(maintenant);
  hier.setDate(hier.getDate() - 1);
  if (jour(d) === jour(hier)) return "hier à " + heureLisible(d);
  return "le " + dateLongue(d.getTime(), maintenant);
}

/* « 1 section », « 3 sections », « aucune section ». */
export function compte(n, singulier, pluriel, aucun = "") {
  if (!n && aucun) return aucun;
  return n + " " + (n > 1 ? pluriel : singulier);
}

/* ----- Les versions ----- */
export function phraseVersion(v, maintenant = Date.now()) {
  if (!v || typeof v !== "object") return "";
  const quand = dateLongue(v.quand, maintenant);
  const par = typeof v.par === "string" && v.par ? " par " + v.par : "";
  if (v.origine === "publication") return "Publiée le " + quand + par;
  if (v.origine === "depart") return "Le site tel qu'il était avant vos premières modifications";
  return "Brouillon mis de côté le " + quand + par;
}

/* ----- Le journal -----

   Un libellé par action du serveur (contrat HTTP, § 2). Une action
   inconnue — un socle plus récent côté serveur — s'affiche quand même,
   sous un libellé neutre, plutôt que de disparaître. */
export const ACTIONS_JOURNAL = Object.freeze({
  connexion: "Connexion",
  lien_demande: "Lien de connexion demandé",
  lien_refuse: "Lien de connexion refusé (trop de demandes)",
  // Depuis le socle 0.3.0, l'alerte d'un message de contact qui ne part pas
  // s'inscrit sous la même action que le lien de connexion : « Le lien de
  // connexion n'a pas pu partir » aurait été faux une fois sur deux
  // (3 octobre 2026). La cause dit lequel (`detailJournal`).
  envoi_echoue: "Un e-mail n'a pas pu partir",
  publication: "Publication",
  reprise: "Reprise d'une ancienne version",
  abandon: "Modifications non publiées abandonnées",
  media_ajoute: "Photo ajoutée",
  media_retire: "Photo retirée de la médiathèque",
  deconnexion: "Déconnexion",
  deconnexion_partout: "Déconnexion de tous les appareils",
  // Un brouillon modifié ailleurs, remplacé sciemment (« Garder mes
  // modifications ») : le serveur l'a mis de côté avant (relecture du
  // 3 octobre 2026).
  ecrasement: "Brouillon modifié ailleurs remplacé (l'ancien est dans les versions)",
  hors_editeur: "Le site a changé hors de l'éditeur",
  // Le formulaire de contact (socle 0.3.0). Le texte du message n'est
  // jamais dans le journal : il est dans l'onglet « Messages ».
  // `message_recu` n'est plus écrit (le serveur, relecture du 3 octobre
  // 2026 : cent messages de robots chassaient du journal les connexions,
  // celle d'un intrus comprise) ; son libellé reste pour les lignes déjà
  // écrites. À la place, une ligne par jour au plus quand le site atteint
  // son plafond de messages.
  message_recu: "Message reçu par le formulaire de contact",
  message_plafond: "Trop de messages reçus en 24 heures : le formulaire de contact refuse les suivants pour l'instant",
  message_supprime: "Message supprimé"
});

export function phraseJournal(e, maintenant = Date.now()) {
  if (!e || typeof e !== "object") return "";
  const libelle = Object.prototype.hasOwnProperty.call(ACTIONS_JOURNAL, e.action) ? ACTIONS_JOURNAL[e.action] : "Autre opération";
  const morceaux = [libelle + " — " + dateCourte(e.quand, maintenant)];
  if (typeof e.par === "string" && e.par) morceaux.push(e.par);
  return morceaux.join(", ");
}

/* La cause d'un e-mail qui n'est pas parti, telle que le serveur l'a
   écrite. PROCESSUS.md (§ 4) envoie la lire dans le journal quand « rien
   n'arrive » — et elle n'y était pas : le journal n'affichait que
   l'action, la date et l'adresse (3 octobre 2026). Elle est technique
   (« E_SENDER_NOT_VERIFIED »…) : l'onglet la range sous « Détail pour
   l'atelier », repliée. Les autres actions n'ont rien à montrer de plus. */
const DETAIL_UTILE = new Set(["envoi_echoue"]);
export function detailJournal(e) {
  if (!e || typeof e !== "object" || !DETAIL_UTILE.has(e.action)) return "";
  return typeof e.detail === "string" ? e.detail.trim() : "";
}

/* Le formulaire de contact ne part jamais du cadre de l'éditeur (cadre.js) :
   il enregistrerait un vrai message, envoyé par l'artisan à lui-même. En
   aperçu, où l'on peut le remplir, on dit pourquoi rien ne se passe ; en
   édition ses champs sont désactivés, il n'y a rien à dire. */
export function phraseFormulaireNonEnvoye(mode) {
  const suite = " Sur votre site, les messages de vos visiteurs arrivent dans l'onglet « Messages ».";
  if (mode === "apercu") return "Le formulaire ne s'envoie pas depuis l'aperçu." + suite;
  if (mode === "version") return "Le formulaire ne s'envoie pas depuis une ancienne version." + suite;
  return "";
}

/* ----- Les erreurs du serveur, en clair -----

   Le serveur envoie déjà une phrase lisible (`message`) ; on la préfère.
   Ces textes-ci servent quand il n'a pas pu répondre du tout (réseau), ou
   pour un code connu dont on veut dire QUOI FAIRE. Jamais d'impasse : chaque
   message finit par un geste possible. */
/* [ce qui s'est passé (si le serveur ne l'a pas dit), ce qu'il faut faire]

   Le geste ne s'écrit qu'UNE fois. La relecture du 3 octobre 2026 a trouvé
   « …réessayez dans un instant. Réessayez dans quelques minutes. » : la
   phrase du serveur portait déjà sa consigne, et l'éditeur en ajoutait une
   seconde, avec un autre délai. Le serveur ne dit plus que ce qui s'est
   passé ; et si une phrase porte quand même un geste (un serveur plus
   ancien, une route oubliée), on n'en ajoute pas un second (`DIT_LE_GESTE`). */
const ERREURS = {
  reseau: ["Pas de connexion à Internet pour l'instant.", "Vérifiez votre connexion, puis réessayez."],
  non_connecte: ["Votre connexion a expiré.", "Reconnectez-vous : vos modifications sont gardées sur cet appareil."],
  origine_refusee: ["L'opération a été refusée par sécurité.", "Rechargez la page, puis réessayez."],
  type_refuse: ["L'opération a été refusée.", "Rechargez la page, puis réessayez."],
  contenu_invalide: ["Ce contenu n'a pas pu être enregistré.", "Annulez votre dernière modification (bouton « Annuler »), puis réessayez."],
  contenu_trop_lourd: ["Votre site est devenu trop volumineux pour être enregistré.", "Retirez une section ou une page, puis réessayez."],
  publication_impossible: ["La publication n'a pas pu se faire : rien n'a changé sur votre site.", "Réessayez dans quelques minutes."],
  trop_lourd: ["Cette photo est trop lourde, même réduite.", "Essayez avec une photo plus petite."],
  format_refuse: ["Ce format de photo n'est pas accepté.", "Enregistrez la photo en JPEG, puis réessayez."],
  quota_atteint: ["Votre médiathèque est pleine.", "Retirez des photos dont vous ne vous servez plus, puis réessayez."],
  introuvable: ["Cet élément n'existe plus.", "Rechargez la page pour voir la liste à jour."]
};

/* Les codes dont NOTRE phrase l'emporte toujours sur celle du serveur :
   le réseau et la connexion expirée (le serveur n'a parfois même pas
   répondu), et les deux refus de sécurité, que le navigateur ne provoque
   presque jamais et que le serveur décrivait en jargon (« Format de demande
   non accepté. », relecture du 3 octobre 2026). */
const PHRASE_DE_L_EDITEUR = new Set(["reseau", "non_connecte", "origine_refusee", "type_refuse"]);

/* Une phrase qui dit déjà quoi faire. Les verbes sont ceux des consignes
   écrites ici et par le serveur ; un geste oublié dans cette liste ne
   produit qu'un doublon, jamais un message sans consigne. */
const DIT_LE_GESTE = /\b(réessayez|rechargez|recommencez|retirez|annulez|essayez|vérifiez|enregistrez|reconnectez|supprimez)\b/i;

export function messageErreur(e) {
  if (!e || typeof e !== "object") return "Une erreur inattendue s'est produite. Rechargez la page, puis réessayez.";
  const connu = typeof e.erreur === "string" && Object.prototype.hasOwnProperty.call(ERREURS, e.erreur) ? ERREURS[e.erreur] : null;
  if (connu && PHRASE_DE_L_EDITEUR.has(e.erreur)) return connu.join(" ");
  // Sinon la phrase du serveur dit le plus précisément CE QUI s'est passé
  // (« Le contenu dépasse 20 pages. ») ; on y ajoute le geste à faire. Une
  // « phrase » qui n'est qu'un code (`contenu_invalide`) n'en est pas une.
  const brut = typeof e.message === "string" ? e.message.trim() : "";
  const phrase = brut && !/^[a-z_0-9]+$/.test(brut) ? (/[.!?…]$/.test(brut) ? brut : brut + ".") : "";
  if (connu) return phrase && DIT_LE_GESTE.test(phrase) ? phrase : (phrase || connu[0]) + " " + connu[1];
  if (phrase) return phrase;
  if (e.statut >= 500) return "Le serveur ne répond pas correctement pour l'instant. Réessayez dans quelques minutes.";
  return "L'opération n'a pas abouti. Rechargez la page, puis réessayez.";
}

/* Les compteurs des champs pour Google : 60 caractères pour un titre,
   160 pour une description — au-delà, Google coupe. Ce n'est pas une
   limite : on prévient, on n'empêche pas.

   Options (relecture du 3 octobre 2026, le conseil disait faux) :
   — `vide` : ce qui s'affiche VRAIMENT quand le champ est vide. Un titre de
     page vide prend le nom du site, une description de page vide prend
     celle du site (page.js) : « Google choisira lui-même un texte » n'est
     vrai que s'il n'y a rien pour la remplacer ;
   — `ajout` : les caractères que le site ajoute à la suite (« · nom du
     site » après le titre d'une page autre que l'accueil). Un titre de
     58 caractères en faisait 82 à l'arrivée, coupé sans un mot. */
export function conseilLongueur(n, max, { vide = "Vide : Google choisira lui-même un texte.", ajout = 0 } = {}) {
  if (n === 0) return vide;
  if (n + ajout > max) {
    return ajout && n <= max
      ? "Avec le nom du site ajouté à la suite, " + (n + ajout) + " caractères : Google risque de couper la fin."
      : "Un peu long : Google risque de couper la fin.";
  }
  return "";
}

/* Ce que les champs « Pour Google » d'une page affichent quand on les
   laisse vides, et ce que le site ajoute au titre : la règle vient du
   rendu (`titreDePage`, `descriptionDePage`, page.js), on n'en décrit que
   l'effet. */
export function conseilsGooglePage(contenu, pageId) {
  const site = contenu && contenu.site && typeof contenu.site === "object" ? contenu.site : {};
  const nom = texteBrut(site.nom);
  const description = texteBrut(site.description);
  const suffixe = pageId !== PAGE_ACCUEIL && nom ? " · " + nom : "";
  return {
    titre: {
      vide: nom ? "Vide : c'est le nom du site, « " + nom + " », qui s'affichera." : "Vide : Google choisira lui-même un texte.",
      ajout: Array.from(suffixe).length,
      suffixe
    },
    description: {
      vide: description ? "Vide : la description du site (onglet « Site ») sera utilisée." : "Vide : Google choisira lui-même un texte.",
      ajout: 0
    }
  };
}
