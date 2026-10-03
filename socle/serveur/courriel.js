/* =========================================================
   Les e-mails — SEUL point de sortie vers le fournisseur
   =========================================================

   Règle reprise de Graine de Pensée : le reste du socle n'appelle jamais
   le fournisseur directement. Changer de prestataire ne doit toucher que
   `envoyer()`, plus bas.

   Fournisseur : Cloudflare Email Service, liaison `COURRIEL`
   (`env.COURRIEL.send({ to, from, subject, html, text })`, qui renvoie
   `{ messageId }` et lève une erreur portant un `.code`). Offre payante de
   l'atelier : 3 000 e-mails par mois, vers n'importe quelle adresse.

   Deux messages existent : le lien de connexion, et depuis le socle 0.3.0
   l'alerte « nouveau message » du formulaire de contact. Un envoi raté ne
   lève JAMAIS : il rend `{ ok: false, cause }`, que l'appelant inscrit au
   journal de l'atelier. Sans cette ligne, une adresse d'expédition mal
   réglée se traduirait par des clients qui « ne reçoivent rien », sans
   aucune trace. */

import { adresseTelleQuelle } from "./validation.js";

/* ----- Le mode « journal » du développement local -----

   Les DEUX conditions sont exigées : la variable `COURRIEL_JOURNAL=1` ET
   une requête arrivée sur localhost. La variable seule, posée par erreur en
   production, ne fait rien — sinon un oubli dans un `wrangler.toml`
   afficherait le lien de connexion à quiconque le demande. */
export function requeteLocale(url) {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

export function modeJournalLocal(env, url) {
  return !!env && env.COURRIEL_JOURNAL === "1" && requeteLocale(url);
}

/* Le nom du site va dans l'objet et dans le nom d'expéditeur : aucun saut
   de ligne ne doit pouvoir y entrer (injection d'en-têtes).

   ⚠️ L'adresse de la visiteuse n'est PAS coupée à 120 caractères comme le
   reste : le formulaire en accepte 254, et c'est elle qui devient le
   `Reply-To`. Coupée, « …@exemple.fr » pouvait devenir « …@exemple.f »,
   une AUTRE adresse, valable, vers laquelle partait la réponse de
   l'artisan (relecture du 3 octobre 2026). */
const surUneLigne = (s, max) => String(s || "").replace(/[\r\n\u0000-\u001F\u007F]+/g, " ").trim().slice(0, max);
const uneLigne = (s) => surUneLigne(s, 120);
const echapper = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ADRESSE_EXPEDITEUR = /^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[^\s@<>"',;:()[\]\\]+$/;

function cause(e) {
  const code = e && e.code ? String(e.code) + " : " : "";
  const message = e && e.message ? e.message : String(e);
  return (code + message).slice(0, 300);
}

/* Ce qui manque pour qu'un e-mail puisse partir, en clair ; vide si rien ne
   manque. Partagé par `envoyer` (qui en fait la cause d'un échec) et par
   l'alerte de message (pour qui ce manque n'est PAS un échec, voir plus bas). */
function configurationManquante(env) {
  const liaison = env && env.COURRIEL;
  if (!liaison || typeof liaison.send !== "function") {
    return "Aucun service d'envoi n'est relié à ce site (liaison COURRIEL absente).";
  }
  const expediteur = typeof env.COURRIEL_EXPEDITEUR === "string" ? env.COURRIEL_EXPEDITEUR.trim() : "";
  if (!ADRESSE_EXPEDITEUR.test(expediteur)) return "Aucune adresse d'expédition valable n'est réglée (COURRIEL_EXPEDITEUR).";
  return "";
}

export function envoiConfigure(env) {
  return !configurationManquante(env);
}

async function envoyer(env, message) {
  const manque = configurationManquante(env);
  if (manque) return { ok: false, cause: manque };
  const envoi = {
    to: message.a,
    from: { email: env.COURRIEL_EXPEDITEUR.trim(), name: message.nomExpediteur },
    subject: message.objet,
    html: message.html,
    text: message.texte
  };
  /* « Répondre » doit viser la personne qui a écrit, pas l'atelier. Le champ
     est `replyTo` (chaîne ou `{ email, name }`), lu le 3 octobre 2026 dans
     le simulateur de la liaison (miniflare, wrangler 4.147). L'adresse vient
     d'une visiteuse : elle n'entre dans l'en-tête que si elle passe la
     règle du formulaire (`adresseTelleQuelle`) — ni espace, ni saut de
     ligne, ni chevron, ni guillemet. Sinon le message part sans `replyTo`,
     et son texte le dit (`messageAlerte`) au lieu de promettre une réponse
     qui reviendrait à l'atelier. La règle de l'adresse d'EXPÉDITION, qui
     servait ici, refusait l'apostrophe (relecture du 3 octobre 2026). */
  const repondreA = adresseTelleQuelle(message.repondreA);
  if (repondreA) envoi.replyTo = repondreA;
  try {
    const r = await env.COURRIEL.send(envoi);
    return { ok: true, id: r && r.messageId ? String(r.messageId) : "" };
  } catch (e) {
    return { ok: false, cause: cause(e) };
  }
}

/* L'enveloppe commune des deux messages : une carte blanche sur fond gris,
   le nom du site en tête. Le texte brut, lui, est écrit à part pour chaque
   message, complet à lui seul. */
const STYLE_P = "margin:0 0 16px;font-size:16px;line-height:1.5";
const STYLE_DOUX = "margin:0 0 16px;font-size:14px;line-height:1.5;color:#565E68";
function enveloppeHtml(objet, nom, corps) {
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>' + echapper(objet) + "</title></head>" +
    '<body style="margin:0;padding:24px 12px;background:#F4F3EF;color:#1E2328;font-family:system-ui,-apple-system,\'Segoe UI\',Roboto,sans-serif">' +
    '<div style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #D9D6CE;border-radius:8px;padding:28px 24px">' +
    '<p style="' + STYLE_DOUX + '">' + echapper(nom) + "</p>" +
    corps +
    "</div></body></html>";
}

/* ----- Le lien de connexion -----

   Sobre, vouvoiement, la durée de validité dite en clair, et la phrase
   qui rassure la personne qui n'a rien demandé. Le texte brut est complet
   à lui seul : certaines messageries n'affichent que lui. */
export function messageLienConnexion({ lien, nomSite, minutes }) {
  const nom = uneLigne(nomSite) || "votre site";
  const objet = "Votre lien de connexion — " + nom;
  const validite = "Ce lien est valable " + minutes + " minutes et ne sert qu'une fois.";
  const rassurer = "Si vous n'avez rien demandé, ignorez ce message : personne ne peut entrer sans ce lien.";
  const texte = [
    "Bonjour,",
    "",
    "Pour entrer dans l'administration de votre site « " + nom + " », ouvrez ce lien :",
    lien,
    "",
    validite,
    "",
    rassurer
  ].join("\n");
  const p = STYLE_P;
  const doux = STYLE_DOUX;
  const html = enveloppeHtml(objet, nom,
    '<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">Votre lien de connexion</h1>' +
    '<p style="' + p + '">Bonjour,</p>' +
    '<p style="' + p + '">Pour entrer dans l\'administration de votre site, cliquez sur ce bouton :</p>' +
    '<p style="margin:0 0 20px"><a href="' + echapper(lien) + '" style="display:inline-block;background:#1F5A8A;color:#FFFFFF;' +
    'padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:16px">Entrer dans l\'administration</a></p>' +
    '<p style="' + p + '">' + echapper(validite) + "</p>" +
    '<p style="' + doux + '">Le bouton ne marche pas ? Copiez cette adresse dans votre navigateur :<br>' +
    '<span style="word-break:break-all">' + echapper(lien) + "</span></p>" +
    '<p style="' + doux + '">' + echapper(rassurer) + "</p>");
  return { objet, texte, html, nomExpediteur: nom };
}

/* L'envoi du lien. En mode journal local (`url` = l'adresse de la
   requête), rien ne part : le lien est écrit dans la console, et
   `journal: true` dit à la page de l'afficher.
   → `{ ok: true, id }` | `{ ok: true, journal: true }` | `{ ok: false, cause }` */
export async function envoyerLienConnexion(env, { a, lien, nomSite, minutes }, { url } = {}) {
  const message = messageLienConnexion({ lien, nomSite, minutes });
  if (url && modeJournalLocal(env, url)) {
    console.log("[Développement local] Lien de connexion pour " + a + " : " + lien);
    return { ok: true, journal: true };
  }
  return envoyer(env, Object.assign({ a }, message));
}

/* ----- L'alerte « nouveau message » (formulaire de contact) -----

   Partie de l'atelier, elle va au CLIENT : ses adresses à lui
   (`client.administration.adresses`), jamais celles de l'atelier — c'est
   l'appelant qui les choisit (contact.js), et ce module n'en connaît pas
   d'autres. `Reply-To` porte l'adresse de la personne qui a écrit : le
   client répond depuis sa messagerie, sans rien recopier (leçon de Graine
   de Pensée, où c'était le seul message dont la réponse visait la cliente).

   Tout ce qui vient du message est écrit par une INCONNUE : échappé dans
   la version HTML, jamais placé dans un en-tête (l'objet est fixe, le nom
   d'expéditeur est celui du site). Le texte brut est complet à lui seul.

   `derniere` : cette alerte est la dernière de la journée (plafond tenu par
   le Durable Object, atelier-coeur.js). Elle le dit, pour que le silence
   qui suit ne passe pas pour une absence de messages.

   « Votre réponse partira vers … » n'est écrit que si l'adresse entre
   VRAIMENT dans `Reply-To` (même test qu'`envoyer`) : le texte ne doit
   jamais promettre ce que l'en-tête ne fait pas (relecture du 3 octobre
   2026, où une apostrophe faisait sauter l'en-tête en silence).

   La garde : le site promet aux visiteurs « un an au plus », et le Durable
   Object tient cette promesse pour SA copie (purge et alarme,
   atelier-coeur.js). Celle-ci arrive dans la boîte du client, que le site
   ne peut pas purger : l'e-mail le lui rappelle. */
export const OBJET_ALERTE = "Nouveau message depuis votre site";

export function messageAlerte({ nomSite, message, adresseAdmin = "", derniere = false }) {
  const nom = uneLigne(nomSite) || "votre site";
  const m = message && typeof message === "object" ? message : {};
  const champ = (v) => (typeof v === "string" ? v : "");
  const qui = uneLigne(champ(m.nom)) || "(sans nom)";
  const email = surUneLigne(champ(m.email), 254);
  const repondreA = adresseTelleQuelle(email);
  const telephone = uneLigne(champ(m.telephone));
  const corps = champ(m.message).replace(/\r\n?/g, "\n");
  const ouverture = "Quelqu'un vous a écrit depuis le formulaire de contact de votre site « " + nom + " ».";
  const repondre = repondreA
    ? "Pour lui répondre, utilisez simplement « Répondre » dans votre messagerie : votre réponse partira vers " + repondreA + "."
    : "Pour lui répondre, écrivez à l'adresse indiquée : " + (email || "(aucune)") + ". Le bouton « Répondre » de votre messagerie ne la viserait pas.";
  const rangement = "Ce message est aussi rangé dans l'administration de votre site, onglet Messages" + (adresseAdmin ? " :" : ".");
  const garde = "Votre site annonce que les messages sont gardés un an au plus : supprimez ce courriel quand vous n'en avez plus besoin, et au plus tard dans un an.";
  const plafond = "Vous avez reçu beaucoup de messages aujourd'hui : les suivants ne seront plus annoncés par e-mail avant demain. " +
    "Ils restent tous rangés dans l'onglet Messages.";
  const texte = [
    "Bonjour,",
    "",
    ouverture,
    "",
    "Nom : " + qui,
    "E-mail : " + email
  ].concat(telephone ? ["Téléphone : " + telephone] : [], [
    "",
    "Son message :",
    corps,
    "",
    repondre,
    "",
    rangement
  ], adresseAdmin ? [adresseAdmin] : [], ["", garde], derniere ? ["", plafond] : []).join("\n");

  const p = STYLE_P;
  const doux = STYLE_DOUX;
  const ligne = (etiquette, valeur) => '<p style="margin:0 0 4px;font-size:16px;line-height:1.5"><strong>' + etiquette + "</strong> " + echapper(valeur) + "</p>";
  const html = enveloppeHtml(OBJET_ALERTE, nom,
    '<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">Nouveau message</h1>' +
    '<p style="' + p + '">' + echapper(ouverture) + "</p>" +
    ligne("Nom :", qui) + ligne("E-mail :", email) + (telephone ? ligne("Téléphone :", telephone) : "") +
    '<div style="margin:16px 0;padding:16px;background:#F4F3EF;border-radius:6px;font-size:16px;line-height:1.5;white-space:pre-wrap;word-break:break-word">' +
      echapper(corps) + "</div>" +
    '<p style="' + p + '">' + echapper(repondre) + "</p>" +
    '<p style="' + doux + '">' + echapper(rangement) +
      (adresseAdmin ? ' <a href="' + echapper(adresseAdmin) + '" style="color:#1F5A8A">' + echapper(adresseAdmin) + "</a>" : "") + "</p>" +
    '<p style="' + doux + '">' + echapper(garde) + "</p>" +
    (derniere ? '<p style="' + doux + '">' + echapper(plafond) + "</p>" : ""));
  return { objet: OBJET_ALERTE, texte, html, nomExpediteur: nom, repondreA };
}

/* L'envoi de l'alerte, UN message par adresse : un destinataire refusé
   (boîte pleine, adresse morte) ne prive pas les autres, et chacun ne voit
   que sa propre adresse.

   Sans destinataire, ou sans service d'envoi réglé, RIEN NE PART ET RIEN
   N'ÉCHOUE : c'est l'état normal d'un site dont l'atelier n'a pas encore
   activé les e-mails (socle 0.3.0), et le message attend de toute façon
   dans l'administration. Seul un envoi TENTÉ puis refusé est un échec.
   En développement local (`COURRIEL_JOURNAL`), l'alerte va dans la console.
   → `{ envoyes, echecs: [{ a, cause }], inactive?: "raison" }` — ne lève jamais. */
export async function envoyerAlerteMessage(env, { a, nomSite, message, adresseAdmin = "", derniere = false }, { url } = {}) {
  const adresses = (Array.isArray(a) ? a : []).filter((x) => typeof x === "string" && x);
  if (!adresses.length) return { envoyes: 0, echecs: [], inactive: "Aucune adresse du client n'est enregistrée." };
  const contenu = messageAlerte({ nomSite, message, adresseAdmin, derniere });
  if (url && modeJournalLocal(env, url)) {
    console.log("[Développement local] Alerte de message pour " + adresses.join(", ") + " :\n" + contenu.texte);
    return { envoyes: 0, echecs: [], inactive: "Développement local." };
  }
  const manque = configurationManquante(env);
  if (manque) return { envoyes: 0, echecs: [], inactive: manque };
  let envoyes = 0;
  const echecs = [];
  for (const adresse of adresses) {
    const r = await envoyer(env, Object.assign({ a: adresse }, contenu));
    if (r.ok) envoyes++;
    else echecs.push({ a: adresse, cause: r.cause });
  }
  return { envoyes, echecs };
}
