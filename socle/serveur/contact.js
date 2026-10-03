/* =========================================================
   Le formulaire de contact — POST /contact
   =========================================================

   La seule écriture qu'une INCONNUE puisse faire sur un site du socle
   (socle 0.3.0). Le formulaire est dessiné par le bloc « contact »
   (rendu/blocs/contact.js) quand sa case « Afficher un formulaire de
   contact » est cochée ; il marche SANS JavaScript, comme tout le site
   public : un envoi, une redirection, une page.

   Le parcours, dans cet ordre, et chaque étape a sa raison :
   1. l'origine — un autre site ne fait pas écrire celui-ci (403) ;
   2. le corps — borné à ce que le formulaire peut envoyer au pire
      (`LIMITE_CORPS_CONTACT`, 42 Ko et demi), lu en comptant
      (`lireOctetsBornes`) ;
   3. la section — elle doit exister dans le contenu PUBLIÉ, être visible,
      de type contact, avec son formulaire coché : sinon 404. On n'accepte
      pas un message pour une section que le site ne montre pas ;
   4. le piège à robots — rempli, on répond « envoyé » sans rien garder :
      le robot ne doit pas apprendre qu'il a été reconnu ;
   5. le message — `validerMessage` (rendu/formulaire.js), la MÊME règle
      que celle de la page : en erreur, la page revient en 400 avec ce que
      la personne avait écrit. Sans JavaScript, c'est la seule façon de ne
      pas lui faire tout retaper ;
   6. le dépôt — le Durable Object tient les limites et écrit ;
   7. la redirection 303 vers la page, qui dit « merci » (et qu'un
      « Actualiser » ne renvoie pas une seconde fois) ;
   8. APRÈS seulement, l'alerte e-mail, dans `ctx.waitUntil` : un e-mail
      qui ne part pas ne fait jamais échouer un message.

   Jamais d'erreur 500 : sans Durable Object, ou s'il ne répond pas, la
   page revient avec « Votre message n'a pas pu partir », et ce qui avait
   été écrit. */

import { rendrePage, ancresDeLaPage, PAGE_ACCUEIL } from "../public/rendu/page.js";
import { validerMessage, ERREURS_CONTACT, CHAMPS_CONTACT, CHAMP_PIEGE, REGLES_CONTACT } from "../public/rendu/formulaire.js";
import { echapper, texteBrut, identifiantValide } from "../public/rendu/outils.js";
import { lireContenu } from "./contenu.js";
import { reponseHtml, reponseRedirection } from "./reponses.js";
import { adresseEmail, aEnPropre, lireOctetsBornes, objetSimple } from "./validation.js";
import { envoiConfigure, envoyerAlerteMessage, modeJournalLocal } from "./courriel.js";

export const CHEMIN_CONTACT = "/contact";

/* La borne du corps : ce que le formulaire peut envoyer AU PIRE, et pas un
   octet de moins. Elle était de 16 Ko, comptés sur du français : un
   message de 3 300 caractères en ukrainien, ou de 1 900 en chinois — que
   le champ (`maxlength`) et `validerMessage` acceptent tous deux — partait
   en 413, sur une page sans le formulaire ni le texte écrit (relecture du
   3 octobre 2026). C'est justement ce que le 400 avec la page rendue évite
   pour toutes les autres erreurs.

   Le calcul : `maxlength` compte en unités UTF-16 ; le pire est un
   caractère du plan de base hors ASCII, 3 octets en UTF-8, donc neuf une
   fois encodé (« 中 » → « %E4%B8%AD »). Un émoji fait 12 octets mais
   compte pour deux unités (6 par unité), un saut de ligne part en
   « %0D%0A » (6). Les quatre champs à leur maximum (`REGLES_CONTACT`,
   4 384 unités) font donc 39 456 octets ; l'enveloppe — page, bloc,
   piège, noms des champs, séparateurs — tient largement dans 4 Ko. Le
   message enregistré, lui, ne change pas : `validerMessage` le borne
   toujours à 4 000 caractères. Une règle qui changerait ces maximums
   déplacerait la borne avec elle ; une règle illisible ne l'ouvrirait pas
   (`Number.isSafeInteger`, sinon le maximum du message). */
const OCTETS_PAR_UNITE = 9;
const ENVELOPPE_CONTACT = 4 * 1024;
const uniteMax = (champ) => {
  const r = REGLES_CONTACT && REGLES_CONTACT[champ];
  return r && Number.isSafeInteger(r.max) && r.max > 0 ? r.max : 4000;
};
export const LIMITE_CORPS_CONTACT = CHAMPS_CONTACT.reduce((total, c) => total + uniteMax(c) * OCTETS_PAR_UNITE, ENVELOPPE_CONTACT);

function atelier(env) {
  return env.ATELIER.get(env.ATELIER.idFromName("site"));
}

/* ----- L'origine -----

   Toute écriture doit venir du site lui-même. Les pages publiques portent
   `Referrer-Policy: strict-origin-when-cross-origin` : un formulaire envoyé
   depuis l'une d'elles porte TOUJOURS son `Origin`. À défaut (ou
   `Origin: null`), `Sec-Fetch-Site: same-origin`. Sans aucun des deux :
   refus — à la différence des formulaires de connexion (admin.js), un faux
   envoi ici écrirait chez le client, et le compterait dans ses limites. */
function origineAcceptee(request, url) {
  const origine = request.headers.get("origin");
  if (origine && origine !== "null") return origine === url.origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

/* L'adresse d'une page : « / » pour l'accueil, « /<id> » sinon. */
export function cheminDePage(pageId) {
  return pageId === PAGE_ACCUEIL ? "/" : "/" + pageId;
}

/* La section visée par un envoi, si elle accepte des messages : sur la page
   annoncée, visible, de type contact, formulaire coché. `aEnPropre` partout :
   « constructor » existe sur tout objet, par son prototype. */
function sectionDuFormulaire(contenu, pageId, blocId) {
  if (!identifiantValide(pageId) || !aEnPropre(contenu.pages, pageId)) return null;
  const page = contenu.pages[pageId];
  if (!identifiantValide(blocId) || !page.ordre.includes(blocId) || !aEnPropre(contenu.blocs, blocId)) return null;
  const bloc = contenu.blocs[blocId];
  if (bloc.type !== "contact" || bloc.masque === true || bloc.formulaire !== true) return null;
  return { page, bloc };
}

/* « Votre message est bien parti », sur la page publique : l'adresse de la
   redirection porte `?contact=envoye&bloc=<id>`. Seulement pour une section
   contact de CETTE page — un paramètre inventé ne fait rien d'autre
   qu'afficher la page telle quelle. Le Worker l'appelle à chaque rendu
   public ; elle ne réveille jamais le Durable Object. */
export function formulaireDeLAdresse(url, contenu, pageId) {
  if (url.searchParams.get("contact") !== "envoye") return undefined;
  const bloc = url.searchParams.get("bloc") || "";
  if (!identifiantValide(bloc) || !aEnPropre(contenu.pages, pageId) || !contenu.pages[pageId].ordre.includes(bloc)) return undefined;
  if (!aEnPropre(contenu.blocs, bloc) || contenu.blocs[bloc].type !== "contact") return undefined;
  return { bloc, etat: "envoye" };
}

/* La redirection après un envoi réussi (ou un piège rempli : même réponse,
   au caractère près). Absolue, vers l'origine de la requête : la
   visiteuse reste sur l'adresse où elle a écrit. L'ancre est celle que la
   page donne réellement à la section (`ancresDeLaPage`, qui dédoublonne). */
function redirectionEnvoye(url, contenu, pageId, blocId) {
  const ancre = ancresDeLaPage(contenu, contenu.pages[pageId])[blocId] || blocId;
  return reponseRedirection(url.origin + cheminDePage(pageId) + "?contact=envoye&bloc=" + encodeURIComponent(blocId) + "#" + encodeURIComponent(ancre), 303);
}

/* Le résultat de `validerMessage`, lu prudemment : `{ valeurs, erreurs }`,
   et `valide` s'il n'y a aucune erreur. Elle promet de ne jamais lever ; si
   elle le faisait un jour, ce serait « indisponible », pas une erreur 500. */
function verifierSaisie(saisies) {
  try {
    const v = validerMessage(saisies);
    const erreurs = v && objetSimple(v.erreurs) ? v.erreurs : {};
    const valeurs = v && objetSimple(v.valeurs) ? v.valeurs : saisies;
    return { valeurs, erreurs, valide: Object.keys(erreurs).length === 0 };
  } catch (e) {
    console.error("validerMessage a levé :", e);
    return { valeurs: saisies, erreurs: erreurGenerale("indisponible"), valide: false };
  }
}

/* L'erreur qui ne vise aucun champ (trop de messages, service muet) : le
   bloc l'affiche en tête du formulaire. Sa clé est celle de
   `ERREURS_CONTACT` (« limite », « indisponible »). */
function erreurGenerale(code) {
  return { [code]: ERREURS_CONTACT[code] };
}

/* Une page minimale, quand la page du site ne peut pas servir : un envoi
   refusé avant même d'être lu (origine, format, taille), ou un rendu qui
   lève. Elle garde un lien vers le site ; elle ne s'indexe jamais. */
function pageSimple(client, statut, titre, texte) {
  const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>" + echapper(titre) + '</title><meta name="robots" content="noindex, nofollow"></head>' +
    '<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.5">' +
    "<h1>" + echapper(titre) + "</h1><p>" + echapper(texte) + '</p><p><a href="/">Retour au site</a></p></body></html>';
  return reponseHtml(html, { client, statut, indexable: false });
}

/* La page du formulaire, rendue avec son état (erreurs, valeurs saisies).
   Jamais indexée : c'est une réponse à un envoi, pas une page du site. */
function pageDuFormulaire(cx, statut, formulaire) {
  try {
    const html = rendrePage({
      contenu: cx.contenu, client: cx.client, pageId: cx.pageId, origine: cx.origine,
      chemin: cheminDePage(cx.pageId), indexable: false, formulaire
    });
    return reponseHtml(html, { client: cx.client, statut, indexable: false });
  } catch (e) {
    console.error("Rendu de la page du formulaire impossible :", e);
    const premiere = Object.values(formulaire.erreurs || {}).find((x) => typeof x === "string") || ERREURS_CONTACT.indisponible;
    return pageSimple(cx.client, statut, "Votre message n'est pas parti", premiere);
  }
}

/* Les destinataires de l'alerte : les adresses du CLIENT, et elles seules.
   Jamais `ADRESSES_ATELIER` : l'atelier n'a pas à lire le courrier des
   clients de ses clients, et chaque destinataire coûte sur son quota.

   Cinq au plus, les cinq premières de la fiche. Le plafond des alertes
   compte des E-MAILS (atelier-coeur.js, `LIMITE_ALERTES`) : une fiche à
   vingt adresses ne recevrait qu'une alerte par jour, et au-delà de vingt
   plus aucune. Les adresses suivantes gardent leur accès à
   l'administration : seule l'alerte ne leur parvient pas. */
export const DESTINATAIRES_ALERTE_MAX = 5;
export function destinatairesAlerte(client) {
  const admin = objetSimple(client) && objetSimple(client.administration) ? client.administration : {};
  const adresses = (Array.isArray(admin.adresses) ? admin.adresses : []).map(adresseEmail).filter(Boolean);
  return [...new Set(adresses)].slice(0, DESTINATAIRES_ALERTE_MAX);
}

/* L'alerte, après coup. Un échec d'envoi va au journal du site, avec le
   numéro du message : le client sait qu'il en a manqué une, et le message
   l'attend dans l'onglet Messages.

   `alerte: true` : le Durable Object n'en note que le PREMIER par jour et
   par adresse. Une inconnue déclenche ces échecs en écrivant — vingt par
   jour quand l'envoi est en panne — et ils chassaient du journal les
   connexions qu'il sert à voir (relecture du 3 octobre 2026). Une ligne
   suffit à dire que les alertes ne partent plus, et pourquoi. */
async function alerter(cx, id, valeurs, alertesRestantes) {
  try {
    const r = await envoyerAlerteMessage(cx.env, {
      a: cx.destinataires,
      nomSite: texteBrut(cx.contenu.site.nom) || (typeof cx.client.id === "string" ? cx.client.id : ""),
      message: Object.assign({ id }, valeurs),
      adresseAdmin: cx.origine.replace(/\/$/, "") + "/admin",
      derniere: alertesRestantes === 0
    }, { url: cx.url });
    for (const echec of r.echecs) {
      console.error("Alerte du message n° " + id + " non envoyée à " + echec.a + " : " + echec.cause);
      await atelier(cx.env).signalerEchecEnvoi({
        email: echec.a, alerte: true,
        cause: "Alerte du message n° " + id + " (seul le premier échec du jour est noté) : " + echec.cause
      });
    }
  } catch (e) {
    console.error("Alerte du message n° " + id + " impossible :", e);
  }
}

/* Le point d'entrée. `introuvable(contenu)` : la page 404 du site, fournie
   par le Worker (worker.js), qui la sert aussi aux adresses inconnues. */
export async function recevoirMessage(request, env, ctx, { client, contenuLivre, origine, introuvable }) {
  const fiche = objetSimple(client) ? client : {};
  const url = new URL(request.url);
  const e = env && typeof env === "object" ? env : {};
  try {
    if (!origineAcceptee(request, url)) {
      return pageSimple(fiche, 403, "Votre message n'a pas pu partir",
        "Par sécurité, il a été refusé : il ne venait pas d'une page de ce site. Revenez sur la page du formulaire, rechargez-la et recommencez.");
    }
    const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (type !== "application/x-www-form-urlencoded") {
      return pageSimple(fiche, 415, "Votre message n'a pas pu partir",
        "Le formulaire n'a pas été envoyé comme prévu. Revenez sur la page du formulaire, rechargez-la et recommencez.");
    }
    const octets = await lireOctetsBornes(request, LIMITE_CORPS_CONTACT);
    if (!octets) {
      return pageSimple(fiche, 413, "Votre message est trop long",
        "Il dépasse ce que le formulaire peut recevoir. Raccourcissez-le et recommencez, ou appelez-nous.");
    }
    const champs = new URLSearchParams(new TextDecoder().decode(octets));
    const lire = (nom) => champs.get(nom) ?? "";

    const contenu = await lireContenu(e, contenuLivre);
    const pageId = lire("page");
    const blocId = lire("bloc");
    if (!sectionDuFormulaire(contenu, pageId, blocId)) return introuvable(contenu);

    if (lire(CHAMP_PIEGE).trim()) return redirectionEnvoye(url, contenu, pageId, blocId);

    // Les champs tels que le bloc les nomme (formulaire.js), et eux seuls.
    const saisies = Object.fromEntries(CHAMPS_CONTACT.map((c) => [c, lire(c)]));
    const cx = { env: e, url, client: fiche, contenu, pageId, origine, destinataires: destinatairesAlerte(fiche) };
    const echec = (statut, erreurs) => pageDuFormulaire(cx, statut, { bloc: blocId, etat: "erreur", valeurs: saisies, erreurs });
    const v = verifierSaisie(saisies);
    if (!v.valide) return echec(400, v.erreurs);

    if (!e.ATELIER) return echec(503, erreurGenerale("indisponible"));
    const alerteActive = cx.destinataires.length > 0 && (envoiConfigure(e) || modeJournalLocal(e, url));
    let depot = null;
    try {
      depot = await atelier(e).deposerMessage({
        ip: request.headers.get("cf-connecting-ip") || "",
        page: pageId, bloc: blocId,
        nom: v.valeurs.nom, email: v.valeurs.email, telephone: v.valeurs.telephone, message: v.valeurs.message,
        // Le plafond compte des e-mails : une alerte part vers chaque adresse.
        alerter: alerteActive, destinataires: cx.destinataires.length
      });
    } catch (err) {
      console.error("Dépôt d'un message impossible :", err);
    }
    if (depot && depot.ok === false && depot.motif === "limite") return echec(429, erreurGenerale("limite"));
    if (!depot || depot.ok !== true) return echec(503, erreurGenerale("indisponible"));

    if (depot.alerte === true) {
      const tache = alerter(cx, depot.id, v.valeurs, depot.alertesRestantes);
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(tache);
      else await tache;
    }
    return redirectionEnvoye(url, contenu, pageId, blocId);
  } catch (err) {
    console.error("Formulaire de contact indisponible :", err);
    return pageSimple(fiche, 503, "Votre message n'a pas pu partir", ERREURS_CONTACT.indisponible);
  }
}
