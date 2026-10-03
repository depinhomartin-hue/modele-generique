/* Le contact.

   Un texte et les moyens de joindre l'entreprise, écrits en clair — et,
   depuis le 3 octobre 2026, un FORMULAIRE, sur réglage (« Afficher un
   formulaire de contact »). Il s'ajoute DANS ce bloc, sans changer le
   reste de son contenu : un client qui ne le coche pas garde exactement la
   section qu'il avait.

   Le formulaire marche SANS JavaScript : un vrai <form> envoyé à
   `/contact` (socle/serveur/contact.js), qui répond par la page elle-même.
   Les règles (bornes, champs obligatoires, messages d'erreur) viennent de
   formulaire.js, celui-là même que lit le serveur : une seule règle.

   Trois états, choisis par `ctx.formulaire` (page.js), et pour CE bloc
   seulement (`formulaire.bloc === id`) :
   - rien : le formulaire vide ;
   - « erreur » : le formulaire rempli de ce que la visiteuse avait écrit,
     chaque champ fautif marqué (`aria-invalid`, son message lié par
     `aria-describedby`), et un résumé en tête (`role="alert"`) ;
   - « envoyé » : le remerciement (`role="status"`) à la place du
     formulaire.

   En ÉDITION, le formulaire est inerte (champs `disabled`, bouton
   `type="button"`) mais ses libellés restent cliquables, et le
   remerciement s'affiche dessous : sans ça, l'éditrice ne pourrait jamais
   le relire ni le changer — un réglage qu'on ne peut pas vérifier n'est
   pas un réglage. */

import { echapper, ed, adresseSure, afficher, lienTelephone, texte } from "../outils.js";
import { chemin, ouvrir, fermer, tete, riche, ancre, REGLAGE_FOND } from "./commun.js";
import { lib, libHtml } from "../libelles.js";
import { CHAMPS_CONTACT, CHAMP_PIEGE, REGLES_CONTACT, ERREURS_CONTACT, MOTIF_NOM, MOTIF_EMAIL, MOTIF_TELEPHONE } from "../formulaire.js";

const aEnPropre = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const estObjet = (v) => !!v && typeof v === "object" && !Array.isArray(v);

function moyen(ctx, id, champ, cleLibelle, lien) {
  const valeur = ctx.contenuBloc[champ];
  if (!afficher(ctx, valeur)) return "";
  const vers = ctx.edition ? "" : lien(valeur);   // en édition, le texte seul : le lien ne servirait pas
  return '<li class="contact__moyen"><span class="contact__etiquette">' + libHtml(ctx, cleLibelle) + "</span>" +
    (vers
      ? '<a class="contact__valeur" href="' + echapper(vers) + '">' + echapper(valeur) + "</a>"
      : '<span class="contact__valeur"' + ed(ctx, chemin(id, champ)) + ">" + echapper(valeur) + "</span>") +
    "</li>";
}

/* ----- Le formulaire ----- */

/* Ce que la page dit de chaque champ ; les bornes et les motifs, eux,
   viennent de formulaire.js (`REGLES_CONTACT`, `MOTIF_…`), celui-là même
   que lit le serveur. Le motif (`pattern`) arrête dans le navigateur ce
   que le serveur refuserait : sans lui, « 06/12/34/56/78 » partait et
   revenait refusé (relecture du 3 octobre 2026). Le message n'en a pas :
   un <textarea> ne connaît pas `pattern`. */
const PRESENTATION = Object.freeze({
  nom: { libelle: "contactNom", type: "text", autocomplete: "name", motif: MOTIF_NOM },
  email: { libelle: "contactEmail", type: "email", autocomplete: "email", motif: MOTIF_EMAIL },
  telephone: { libelle: "contactTelephone", type: "tel", autocomplete: "tel", motif: MOTIF_TELEPHONE },
  message: { libelle: "contactMessage", type: "textarea", autocomplete: "" }
});

/* Le résumé d'un envoi refusé. Figé dans le code, comme les messages
   d'erreur : on ne le voit qu'après un envoi raté. */
const RESUME_ERREURS = "Votre message n'est pas encore parti :";

/* Les erreurs à afficher : celles d'un champ (dans l'ordre de la page) et
   les autres (`limite`, `indisponible`), dites en tête. Un message connu
   est toujours celui du code (`ERREURS_CONTACT`) ; un message inconnu est
   affiché tel qu'il est passé, échappé. Une erreur annoncée sans aucun
   message dit au moins que l'envoi n'est pas parti. */
function lireErreurs(envoi) {
  const brutes = estObjet(envoi.erreurs) ? envoi.erreurs : {};
  const champs = {};
  const generales = [];
  for (const cle of Object.keys(brutes)) {
    const passe = typeof brutes[cle] === "string" ? brutes[cle].trim() : "";
    const message = aEnPropre(ERREURS_CONTACT, cle) ? ERREURS_CONTACT[cle] : passe;
    if (!message) continue;
    if (CHAMPS_CONTACT.includes(cle)) champs[cle] = message;
    else if (!generales.includes(message)) generales.push(message);
  }
  if (!generales.length && !Object.keys(champs).length) generales.push(ERREURS_CONTACT.indisponible);
  return { champs, generales };
}

function champ(nom, ctx, prefixe, valeurs, erreurs) {
  const p = PRESENTATION[nom];
  const r = REGLES_CONTACT[nom];
  const idChamp = prefixe + "-" + nom;
  const idErreur = idChamp + "-erreur";
  const erreur = aEnPropre(erreurs, nom) ? erreurs[nom] : "";
  const valeur = aEnPropre(valeurs, nom) ? texte(valeurs[nom]) : "";
  const attributs = ' id="' + echapper(idChamp) + '" name="' + nom + '"' +
    (r.requis ? " required" : "") +
    (r.min > 1 ? ' minlength="' + r.min + '"' : "") +
    ' maxlength="' + r.max + '"' +
    (p.motif && p.type !== "textarea" ? ' pattern="' + echapper(p.motif) + '"' : "") +
    (p.autocomplete ? ' autocomplete="' + p.autocomplete + '"' : "") +
    (erreur ? ' aria-invalid="true" aria-describedby="' + echapper(idErreur) + '"' : "") +
    (ctx.edition ? " disabled" : "");
  // Un saut de ligne juste après <textarea> est avalé par le navigateur :
  // on en écrit un, pour qu'un message qui commencerait par une ligne vide
  // revienne intact.
  const saisie = p.type === "textarea"
    ? '<textarea class="contact__saisie" rows="6"' + attributs + ">\n" + echapper(valeur) + "</textarea>"
    : '<input class="contact__saisie" type="' + p.type + '"' + attributs + (valeur ? ' value="' + echapper(valeur) + '"' : "") + ">";
  return '<div class="contact__champ' + (erreur ? " contact__champ--erreur" : "") + '">' +
    '<label class="contact__libelle" for="' + echapper(idChamp) + '">' + libHtml(ctx, p.libelle) + "</label>" +
    (erreur ? '<p class="contact__erreur" id="' + echapper(idErreur) + '">' + echapper(erreur) + "</p>" : "") +
    saisie +
    "</div>";
}

/* Le lien vers les mentions légales, si la page existe (`ctx.mentions`,
   page.js) : c'est elle qui dit ce que deviennent les messages. */
function lienMentions(ctx) {
  if (!ctx.mentions) return "";
  return ' <a href="' + echapper(ctx.mentions) + '"' + ed(ctx, "libelles.mentionsLegales") + ">" + echapper(lib(ctx, "mentionsLegales")) + "</a>";
}

function formulaire(bloc, id, ctx) {
  const envoi = !ctx.edition && estObjet(ctx.formulaire) && ctx.formulaire.bloc === id ? ctx.formulaire : null;
  if (envoi && envoi.etat === "envoye") {
    return '<div class="carte contact__envoi"><p class="contact__merci" role="status">' + echapper(lib(ctx, "contactMerci")) + "</p></div>";
  }
  const enErreur = !!envoi && envoi.etat === "erreur";
  const valeurs = enErreur && estObjet(envoi.valeurs) ? envoi.valeurs : {};
  const { champs: erreurs, generales } = enErreur ? lireErreurs(envoi) : { champs: {}, generales: [] };
  // Des identifiants propres à CE bloc : deux formulaires sur une page ne
  // doivent pas se disputer un même `id`.
  const prefixe = "formulaire-" + id;

  let alerte = "";
  if (enErreur) {
    const fautifs = CHAMPS_CONTACT.filter((n) => aEnPropre(erreurs, n));
    alerte = '<div class="contact__alerte" role="alert">' +
      generales.map((m) => "<p>" + echapper(m) + "</p>").join("") +
      (fautifs.length
        ? "<p>" + echapper(RESUME_ERREURS) + '</p><ul role="list">' +
          fautifs.map((n) => '<li><a href="#' + echapper(prefixe + "-" + n) + '">' + echapper(erreurs[n]) + "</a></li>").join("") +
          "</ul>"
        : "") +
      "</div>";
  }

  /* L'adresse d'envoi porte l'ancre de la section : après un envoi
     refusé, la page revient AU FORMULAIRE, avec ses erreurs, au lieu de
     s'ouvrir tout en haut, où la visiteuse croirait que rien ne s'est
     passé (le navigateur garde l'ancre de l'adresse d'un formulaire). Le
     serveur ne la voit pas : elle ne quitte jamais le navigateur. */
  const cible = "/contact#" + ((ctx && ctx.ancre) || ancre(bloc, id));
  const piege = '<div class="contact__piege" aria-hidden="true">' +
    '<label for="' + echapper(prefixe + "-site-web") + '">Votre site web</label>' +
    '<input type="text" id="' + echapper(prefixe + "-site-web") + '" name="' + CHAMP_PIEGE + '" value="" tabindex="-1" autocomplete="off"' +
    (ctx.edition ? " disabled" : "") + "></div>";
  const bouton = ctx.edition
    ? '<button class="bouton bouton--plein contact__bouton" type="button">' + libHtml(ctx, "contactEnvoyer") + "</button>"
    : '<button class="bouton bouton--plein contact__bouton" type="submit">' + echapper(lib(ctx, "contactEnvoyer")) + "</button>";

  const form = '<form class="contact__formulaire" method="post" action="' + echapper(cible) + '">' +
    alerte +
    '<input type="hidden" name="page" value="' + echapper(ctx.pageId) + '">' +
    '<input type="hidden" name="bloc" value="' + echapper(id) + '">' +
    CHAMPS_CONTACT.map((n) => champ(n, ctx, prefixe, valeurs, erreurs)).join("") +
    piege +
    '<div class="contact__pied">' + bouton +
      '<p class="contact__notice">' + libHtml(ctx, "contactNotice") + lienMentions(ctx) + "</p>" +
    "</div>" +
    "</form>";

  // En édition, le remerciement se montre sous le formulaire, pour qu'on
  // puisse le relire et le réécrire. Jamais sur le site.
  const apresEnvoi = ctx.edition
    ? '<div class="contact__apres-envoi"><p class="contact__apres-envoi-titre">Après l\'envoi, vos visiteurs liront :</p>' +
      '<p class="contact__merci">' + libHtml(ctx, "contactMerci") + "</p></div>"
    : "";
  return '<div class="carte contact__envoi">' + form + apresEnvoi + "</div>";
}

function rendre(bloc, id, ctx) {
  const c = Object.assign({}, ctx, { contenuBloc: bloc });
  const moyens =
    moyen(c, id, "telephone", "telephone", lienTelephone) +
    moyen(c, id, "email", "email", (v) => adresseSure("mailto:" + texte(v).trim()));
  const listeMoyens = moyens ? '<ul class="carte contact__moyens" role="list">' + moyens + "</ul>" : "";
  const texteCourant = afficher(ctx, bloc.texte)
    ? '<div class="texte-courant"' + ed(ctx, chemin(id, "texte"), { riche: true, lignes: true }) + ">" + riche(bloc.texte) + "</div>"
    : "";
  // Sans formulaire, la section d'avant, à l'identique. Avec, les moyens de
  // joindre passent sous le texte, et le formulaire prend la colonne de
  // droite (dessous, sur un téléphone).
  if (bloc.formulaire !== true) {
    return ouvrir(bloc, id, ctx) +
      '<div class="conteneur contact__grille">' +
        '<div class="contact__texte">' + tete(bloc, id, ctx) + texteCourant + "</div>" +
        listeMoyens +
      "</div>" +
      fermer();
  }
  return ouvrir(bloc, id, ctx) +
    '<div class="conteneur contact__grille contact__grille--formulaire">' +
      '<div class="contact__texte">' + tete(bloc, id, ctx) + texteCourant + listeMoyens + "</div>" +
      formulaire(bloc, id, ctx) +
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
    email: "",
    formulaire: false
  };
}

export default {
  type: "contact",
  nom: "Contact",
  description: "Quelques mots d'accueil, votre téléphone et votre adresse e-mail.",
  reglages: [REGLAGE_FOND, { cle: "formulaire", libelle: "Afficher un formulaire de contact", type: "case" }],
  // Les champs du modèle qui sont des TEXTES À REMPLACER (pas des titres
  // génériques qu'on garde volontiers) : l'éditeur prévient avant de les
  // publier tels quels (`restesDuModele`, structure.js).
  exemples: [],
  listes: {},
  rendre,
  modele
};
