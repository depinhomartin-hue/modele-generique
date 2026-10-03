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

   Un seul message existe aujourd'hui : le lien de connexion. Un envoi raté
   ne lève JAMAIS : il rend `{ ok: false, cause }`, que l'appelant inscrit
   au journal de l'atelier. Sans cette ligne, une adresse d'expédition mal
   réglée se traduirait par des clients qui « ne reçoivent rien », sans
   aucune trace. */

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
   de ligne ne doit pouvoir y entrer (injection d'en-têtes). */
const uneLigne = (s) => String(s || "").replace(/[\r\n\u0000-\u001F\u007F]+/g, " ").trim().slice(0, 120);
const echapper = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ADRESSE_EXPEDITEUR = /^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[^\s@<>"',;:()[\]\\]+$/;

function cause(e) {
  const code = e && e.code ? String(e.code) + " : " : "";
  const message = e && e.message ? e.message : String(e);
  return (code + message).slice(0, 300);
}

async function envoyer(env, message) {
  const liaison = env && env.COURRIEL;
  if (!liaison || typeof liaison.send !== "function") {
    return { ok: false, cause: "Aucun service d'envoi n'est relié à ce site (liaison COURRIEL absente)." };
  }
  const expediteur = typeof env.COURRIEL_EXPEDITEUR === "string" ? env.COURRIEL_EXPEDITEUR.trim() : "";
  if (!ADRESSE_EXPEDITEUR.test(expediteur)) {
    return { ok: false, cause: "Aucune adresse d'expédition valable n'est réglée (COURRIEL_EXPEDITEUR)." };
  }
  try {
    const r = await liaison.send({
      to: message.a,
      from: { email: expediteur, name: message.nomExpediteur },
      subject: message.objet,
      html: message.html,
      text: message.texte
    });
    return { ok: true, id: r && r.messageId ? String(r.messageId) : "" };
  } catch (e) {
    return { ok: false, cause: cause(e) };
  }
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
  const p = "margin:0 0 16px;font-size:16px;line-height:1.5";
  const doux = "margin:0 0 16px;font-size:14px;line-height:1.5;color:#565E68";
  const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>' + echapper(objet) + "</title></head>" +
    '<body style="margin:0;padding:24px 12px;background:#F4F3EF;color:#1E2328;font-family:system-ui,-apple-system,\'Segoe UI\',Roboto,sans-serif">' +
    '<div style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #D9D6CE;border-radius:8px;padding:28px 24px">' +
    '<p style="' + doux + '">' + echapper(nom) + "</p>" +
    '<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">Votre lien de connexion</h1>' +
    '<p style="' + p + '">Bonjour,</p>' +
    '<p style="' + p + '">Pour entrer dans l\'administration de votre site, cliquez sur ce bouton :</p>' +
    '<p style="margin:0 0 20px"><a href="' + echapper(lien) + '" style="display:inline-block;background:#1F5A8A;color:#FFFFFF;' +
    'padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:16px">Entrer dans l\'administration</a></p>' +
    '<p style="' + p + '">' + echapper(validite) + "</p>" +
    '<p style="' + doux + '">Le bouton ne marche pas ? Copiez cette adresse dans votre navigateur :<br>' +
    '<span style="word-break:break-all">' + echapper(lien) + "</span></p>" +
    '<p style="' + doux + '">' + echapper(rassurer) + "</p>" +
    "</div></body></html>";
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
