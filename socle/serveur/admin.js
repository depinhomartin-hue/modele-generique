/* =========================================================
   L'administration — /admin et /admin/api/*
   =========================================================

   Ce module reçoit tout ce qui commence par /admin, AVANT la logique des
   pages publiques (worker.js). Il sert :
   — les pages de connexion, de simples formulaires HTML qui marchent SANS
     JavaScript et ne chargent AUCUNE ressource extérieure ;
   — la coquille de l'éditeur (le reste est servi depuis socle/public/editeur) ;
   — l'API JSON de l'éditeur, dont le contrat est le § 2 de la
     spécification de la phase 2.

   L'état vit dans le Durable Object `ATELIER` (atelier-coeur.js) : ce
   module ne garde rien, il vérifie la forme de la demande, passe la main et
   met en forme la réponse. Un appel au Durable Object par lecture d'API
   (la session est vérifiée dans le même appel que l'opération) ; deux pour
   une écriture avec un corps JSON (la session d'abord, AVANT de lire le
   corps) et pour le dépôt d'une photo, qui écrit dans R2 entre les deux.

   Jamais d'erreur 500 : sans liaison ATELIER, une page dit que
   l'administration n'est pas encore activée ; une panne, qu'elle est
   momentanément indisponible. Le site public, lui, n'est jamais touché. */

import { echapper, texteBrut } from "../public/rendu/outils.js";
import { lireContenu } from "./contenu.js";
import { enTetesAdmin, reponseHtmlAdmin, reponseJsonAdmin, reponseRedirectionAdmin } from "./reponses.js";
import { DUREE_JETON_MIN, DUREE_SESSION_S } from "./atelier-coeur.js";
import { adresseEmail, adressesAutorisees, jetonValide, lireOctetsBornes, objetJson, objetSimple, LIMITES_CONTENU, secretDemo, egalEnTempsConstant, ADRESSE_LIEN_DEMO } from "./validation.js";
import { envoyerLienConnexion, modeJournalLocal, requeteLocale } from "./courriel.js";
import { lireDepot, deposerFichiers, retirerFichiers, LIMITE_DEPOT } from "./medias.js";

export function estAdresseAdmin(chemin) {
  return chemin === "/admin" || chemin.startsWith("/admin/");
}

// Un corps JSON au-delà de cette borne n'est même pas lu : le contenu est
// borné à 300 000 octets (validation.js), le reste n'est que l'enveloppe
// (`{"contenu":…,"revision":…,"ecraser":true}`, moins de cent octets).
// Elle était d'un mégaoctet : trois fois plus de travail pour un corps
// que le serveur refuserait de toute façon (relecture du 3 octobre 2026).
const LIMITE_CORPS_JSON = LIMITES_CONTENU.octets + 10_000;
const LIMITE_FORMULAIRE = 8 * 1024;

const MESSAGES = {
  inactive: "L'administration n'est pas encore activée sur ce site.",
  indisponible: "L'administration est momentanément indisponible. Réessayez dans quelques minutes.",
  non_connecte: "Votre connexion a expiré. Reconnectez-vous pour continuer.",
  origine_refusee: "Cette demande a été refusée par sécurité. Rechargez la page et recommencez.",
  type_refuse: "Format de demande non accepté.",
  requete_invalide: "La demande est incomplète. Rechargez la page et réessayez.",
  contenu_trop_lourd: "Le contenu est trop volumineux pour être enregistré.",
  introuvable: "Cette adresse n'existe pas.",
  methode_refusee: "Cette adresse ne s'utilise pas ainsi.",
  medias_indisponibles: "L'ajout de photos n'est pas encore activé sur ce site.",
  depot_impossible: "La photo n'a pas pu être enregistrée. Réessayez dans un instant.",
  trop_lourd: "Cette photo est trop lourde : 8 Mo au plus."
};

/* ----- Le contexte d'une requête ----- */
function contexte(request, env, ctx, { client, contenuLivre, origine }) {
  const url = new URL(request.url);
  const fiche = objetSimple(client) ? client : {};
  // La version du socle sert à forcer le rechargement des fichiers de
  // l'éditeur (`?v=`) : elle entre dans une adresse, d'où le filtre.
  const socle = typeof fiche.socle === "string" && /^[0-9A-Za-z.-]{1,20}$/.test(fiche.socle) ? fiche.socle : "0";
  return {
    request, env, ctx, url, fiche, socle,
    methode: request.method,
    livre: contenuLivre,
    // L'adresse PUBLIQUE du site (domaine de la fiche, sinon celle de la
    // requête) : celle des liens envoyés par e-mail et de l'export.
    origine,
    autorisees: adressesAutorisees(fiche, env),
    infoSite: {
      id: typeof fiche.id === "string" ? fiche.id : "",
      demo: !!fiche.demo,
      mentionDemo: typeof fiche.mentionDemo === "string" ? fiche.mentionDemo : "",
      domaine: typeof fiche.domaine === "string" ? fiche.domaine : "",
      socle,
      adresse: origine
    },
    nom: null
  };
}

/* Le nom du site tel que le client l'a écrit (contenu publié, sinon
   livré), en texte brut : il va dans un <title> et dans l'objet d'un
   e-mail. */
async function nomDuSite(cx) {
  if (cx.nom === null) {
    try {
      const contenu = await lireContenu(cx.env, cx.livre);
      cx.nom = texteBrut(contenu.site.nom);
    } catch {
      cx.nom = "";
    }
    if (!cx.nom) cx.nom = cx.infoSite.id || "Votre site";
  }
  return cx.nom;
}

function atelier(env) {
  return env.ATELIER.get(env.ATELIER.idFromName("site"));
}

/* ----- Le cookie de session -----

   `__Host-` interdit qu'un sous-domaine pose ou remplace ce cookie, et
   impose `Secure` et `Path=/`. En http://localhost seulement, `atelier-`
   suivi du port, sans `Secure` : Safari refuse un cookie `Secure` en http,
   et le développement local deviendrait impossible sur Mac.

   ⚠️ Le port est DANS le nom parce que les navigateurs ne séparent pas les
   cookies par port : deux sites lancés en même temps (localhost:8790 et
   localhost:8791) partageaient le même cookie `atelier`, et se connecter à
   l'un déconnectait l'autre, qui effaçait à son tour le cookie des deux
   (relecture du 3 octobre 2026). En ligne, chaque site a son domaine, et
   `__Host-atelier` suffit. `nomCookie` est la SEULE source du nom : pose,
   lecture et effacement passent tous par elle. */
const cookieLocal = (url) => url.protocol === "http:" && requeteLocale(url);
const nomCookie = (url) => (cookieLocal(url) ? "atelier-" + (url.port || "80") : "__Host-atelier");

function cookieSession(url, valeur, duree = DUREE_SESSION_S) {
  return nomCookie(url) + "=" + valeur + "; Path=/" + (cookieLocal(url) ? "" : "; Secure") +
    "; HttpOnly; SameSite=Lax; Max-Age=" + duree;
}
const cookieEfface = (url) => cookieSession(url, "", 0);

function lireCookie(request, nom) {
  for (const morceau of (request.headers.get("cookie") || "").split(";")) {
    const i = morceau.indexOf("=");
    if (i > 0 && morceau.slice(0, i).trim() === nom) return morceau.slice(i + 1).trim();
  }
  return "";
}

/* ----- Le contrôle d'origine (CSRF) -----

   Toute écriture doit venir du site lui-même. `SameSite=Lax` empêche
   déjà l'envoi du cookie depuis un autre site ; ce contrôle est la
   seconde ceinture.

   ⚠️ `Origin: null` n'est PAS un refus en soi : les pages d'administration
   portent `Referrer-Policy: no-referrer`, et le standard Fetch fait alors
   envoyer `Origin: null` par leurs propres formulaires. On se rabat sur
   `Sec-Fetch-Site`, que les navigateurs récents posent toujours. Sans
   aucun des deux (vieux navigateurs) : refus pour l'API, accord pour les
   trois formulaires de connexion — un faux envoi n'y peut rien de pire
   que demander un lien ou déconnecter. */
function origineAcceptee(request, url, { stricte }) {
  const origine = request.headers.get("origin");
  if (origine && origine !== "null") return origine === url.origin;
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  return !stricte;
}

const typeJson = (request) => (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() === "application/json";

async function lireFormulaire(request) {
  const octets = await lireOctetsBornes(request, LIMITE_FORMULAIRE);
  if (!octets) return null;
  const type = request.headers.get("content-type") || "";
  if (/^multipart\/form-data/i.test(type)) {
    try {
      return await new Response(octets, { headers: { "content-type": type } }).formData();
    } catch {
      return null;
    }
  }
  return new URLSearchParams(new TextDecoder().decode(octets));
}

const champTexte = (formulaire, nom) => {
  const v = formulaire ? formulaire.get(nom) : null;
  return typeof v === "string" ? v : "";
};

/* =========================================================
   Les pages HTML
   ========================================================= */

function gabarit(cx, nom, titre, corps) {
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>" + echapper(titre) + " · " + echapper(nom) + "</title>" +
    '<meta name="robots" content="noindex, nofollow">' +
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">' +
    '<link rel="stylesheet" href="/editeur/connexion.css?v=' + echapper(cx.socle) + '">' +
    "</head><body>" +
    '<main class="cx">' +
    '<p class="cx-site">' + echapper(nom) + "</p>" +
    corps +
    '<p class="cx-retour"><a href="/">Retour au site</a></p>' +
    "</main></body></html>";
}

function formulaireConnexion({ email = "", erreur = "", bouton = "Recevoir le lien" } = {}) {
  return (erreur ? '<p class="cx-message cx-message--erreur" id="email-erreur" role="alert">' + echapper(erreur) + "</p>" : "") +
    '<form class="cx-formulaire" method="post" action="/admin/connexion">' +
    '<label for="email">Votre adresse e-mail</label>' +
    '<input id="email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" required maxlength="254"' +
    ' value="' + echapper(email) + '"' + (erreur ? ' aria-invalid="true" aria-describedby="email-erreur"' : "") + ">" +
    '<button class="cx-bouton" type="submit">' + echapper(bouton) + "</button>" +
    "</form>";
}

const VALIDITE = "Le lien est valable " + DUREE_JETON_MIN + " minutes et ne sert qu'une fois.";

function pageConnexion(cx, nom, options = {}) {
  return gabarit(cx, nom, "Administration",
    "<h1>Administration du site</h1>" +
    '<p class="cx-intro">Indiquez votre adresse e-mail : nous vous envoyons un lien pour entrer. Il n\'y a pas de mot de passe à retenir.</p>' +
    formulaireConnexion(options) +
    '<p class="cx-aide">' + VALIDITE + "</p>");
}

function pageLienEnvoye(cx, nom, email, local) {
  let dev = "";
  if (local) {
    dev = '<aside class="cx-dev" aria-labelledby="cx-dev-titre"><h2 id="cx-dev-titre">Développement local</h2>' +
      (local.lien
        ? "<p>Aucun e-mail n'est parti. Voici le lien de connexion :</p>" +
          '<p class="cx-dev-lien"><a href="' + echapper(local.lien) + '">' + echapper(local.lien) + "</a></p>"
        : "<p>Aucun lien n'a été créé : cette adresse n'est pas autorisée, ou une limite est atteinte." +
          (local.motif ? " " + echapper(local.motif) : "") + "</p>") +
      "</aside>";
  }
  return gabarit(cx, nom, "Lien envoyé",
    "<h1>Regardez votre boîte de réception</h1>" +
    '<p class="cx-message" role="status">Si cette adresse est enregistrée, un lien de connexion vient de partir vers <strong>' +
      echapper(email) + "</strong>.</p>" +
    "<p>" + VALIDITE + "</p>" +
    '<p class="cx-aide">Rien reçu d\'ici quelques minutes ? Regardez dans les courriers indésirables, puis ' +
      '<a href="/admin">demandez un nouveau lien</a>.</p>' +
    dev);
}

function pageEntrer(cx, nom, jeton, email) {
  return gabarit(cx, nom, "Entrer",
    "<h1>Entrer dans l'administration</h1>" +
    "<p>Connexion avec l'adresse <strong>" + echapper(email) + "</strong>.</p>" +
    '<form class="cx-formulaire" method="post" action="/admin/entrer">' +
    '<input type="hidden" name="jeton" value="' + echapper(jeton) + '">' +
    '<button class="cx-bouton" type="submit">Entrer dans l\'administration</button>' +
    "</form>" +
    '<p class="cx-aide">Ce bouton protège votre lien : les logiciels qui ouvrent les liens tout seuls ' +
      "(antivirus, aperçus de messagerie) ne peuvent pas s'en servir à votre place.</p>");
}

function pageLienPerime(cx, nom) {
  return gabarit(cx, nom, "Lien expiré",
    "<h1>Ce lien a expiré ou a déjà servi</h1>" +
    '<p class="cx-intro">Un lien de connexion ne sert qu\'une fois, pendant ' + DUREE_JETON_MIN + " minutes. Demandez-en un nouveau :</p>" +
    formulaireConnexion({ bouton: "Recevoir un nouveau lien" }));
}

function pageMessage(cx, nom, titre, texte, lien = "") {
  return gabarit(cx, nom, titre, "<h1>" + echapper(titre) + "</h1><p>" + echapper(texte) + "</p>" + lien);
}

/* La coquille de l'éditeur : le HTML exact du § 6 de la spécification.
   Tout le reste (panneau, aperçu) est dessiné par /editeur/editeur.js. */
function coquille(nom, socle) {
  const v = echapper(socle);
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    "<title>Administration · " + echapper(nom) + '</title><meta name="robots" content="noindex, nofollow">\n' +
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/editeur/editeur.css?v=' + v + '"></head>\n' +
    '<body><div id="editeur" data-socle="' + v + '"><p class="ed-chargement">Chargement de l\'éditeur…</p></div>\n' +
    "<noscript><p>L'éditeur a besoin de JavaScript. Le site, lui, n'en a pas besoin.</p></noscript>\n" +
    '<script type="module" src="/editeur/editeur.js?v=' + v + '"></script></body></html>\n';
}

/* Le document vide où l'éditeur écrit la page (`document.write`). Seul
   document de l'administration qui accepte d'être encadré — par le site
   lui-même, jamais par un autre. */
const CADRE = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  "<title>Aperçu</title></head><body></body></html>\n";

/* ----- Les routes des pages ----- */

/* La session de ce navigateur → `{ jeton, qui }` : le cookie lu, et
   `{ email }` s'il mène à une session valable, sinon `null`. Sans cookie
   de la bonne forme, le Durable Object n'est pas réveillé. */
async function sessionDuNavigateur(cx) {
  const jeton = lireCookie(cx.request, nomCookie(cx.url));
  const qui = jetonValide(jeton) ? await atelier(cx.env).session({ session: jeton, autorisees: cx.autorisees }) : null;
  return { jeton, qui };
}

async function accueilAdmin(cx) {
  const { jeton, qui } = await sessionDuNavigateur(cx);
  const nom = await nomDuSite(cx);
  if (qui) return reponseHtmlAdmin(coquille(nom, cx.socle), { methode: cx.methode });
  // Un cookie qui ne mène plus à rien (expiré, révoqué) est effacé.
  return reponseHtmlAdmin(pageConnexion(cx, nom), { methode: cx.methode, cookie: jeton ? cookieEfface(cx.url) : "" });
}

/* La demande d'un lien. Pour une adresse VALIDE, la réponse est toujours
   la même page, que l'adresse soit connue ou non, limitée ou non — et elle
   part AVANT tout travail (`ctx.waitUntil`) : même le temps de réponse ne
   dit rien. Une adresse mal formée, elle, peut se signaler : elle ne
   révèle rien, et une faute de frappe mérite d'être montrée. */
async function demanderLien(cx) {
  if (!origineAcceptee(cx.request, cx.url, { stricte: false })) return refusOrigine(cx);
  const formulaire = await lireFormulaire(cx.request);
  const saisie = champTexte(formulaire, "email");
  const email = adresseEmail(saisie);
  const nom = await nomDuSite(cx);
  if (!email) {
    return reponseHtmlAdmin(pageConnexion(cx, nom, {
      email: saisie.slice(0, 254),
      erreur: "Indiquez une adresse e-mail complète, par exemple prenom@exemple.fr."
    }), { statut: 400 });
  }
  const local = modeJournalLocal(cx.env, cx.url);
  const tache = envoyerLien(cx, email, nom);
  let resultat = null;
  if (local || !cx.ctx || typeof cx.ctx.waitUntil !== "function") resultat = await tache;
  else cx.ctx.waitUntil(tache);
  return reponseHtmlAdmin(pageLienEnvoye(cx, nom, email, local ? resultat : null));
}

async function envoyerLien(cx, email, nom) {
  try {
    const stub = atelier(cx.env);
    const ip = cx.request.headers.get("cf-connecting-ip") || "";
    const r = await stub.demanderLien({ email, ip, autorisees: cx.autorisees });
    if (!r || !r.envoyer) return { lien: "", motif: r && r.motif ? r.motif : "" };
    // En développement local, le lien vise la machine locale même si la
    // fiche porte déjà le vrai domaine.
    const base = modeJournalLocal(cx.env, cx.url) ? cx.url.origin : cx.origine;
    const lien = base + "/admin/entrer?jeton=" + r.jeton;
    const envoi = await envoyerLienConnexion(cx.env, { a: r.email, lien, nomSite: nom, minutes: DUREE_JETON_MIN }, { url: cx.url });
    if (!envoi.ok) {
      console.error("Lien de connexion non envoyé à " + r.email + " : " + envoi.cause);
      await stub.signalerEchecEnvoi({ email: r.email, cause: envoi.cause });
    }
    return { lien: envoi.journal ? lien : "", motif: "" };
  } catch (e) {
    console.error("Demande de lien de connexion impossible :", e);
    return { lien: "", motif: "L'administration n'a pas répondu." };
  }
}

/* GET ne consomme PAS le jeton : antivirus et aperçus de messagerie
   ouvrent les liens d'eux-mêmes. Il faut un clic, donc un POST.

   Un lien qui a déjà servi, rouvert depuis un navigateur DÉJÀ connecté,
   mène tout droit à l'administration. Beaucoup gardent l'e-mail comme un
   favori : on leur répondait « Ce lien a expiré, demandez-en un nouveau »
   alors que leur session valait encore 29 jours, et ils redemandaient un
   lien chaque jour sans jamais apprendre qu'il suffisait d'ouvrir /admin
   (relecture du 3 octobre 2026). Le parcours normal — un lien encore
   bon — ne change pas : la session n'est lue que si le lien est refusé. */
async function pageDuLien(cx) {
  const jeton = cx.url.searchParams.get("jeton") || "";
  const r = jetonValide(jeton) ? await atelier(cx.env).verifierLien({ jeton, autorisees: cx.autorisees }) : null;
  if (!r && (await sessionDuNavigateur(cx)).qui) return reponseRedirectionAdmin("/admin");
  const nom = await nomDuSite(cx);
  return reponseHtmlAdmin(r ? pageEntrer(cx, nom, jeton, r.email) : pageLienPerime(cx, nom), { methode: cx.methode });
}

async function entrer(cx) {
  if (!origineAcceptee(cx.request, cx.url, { stricte: false })) return refusOrigine(cx);
  const jeton = champTexte(await lireFormulaire(cx.request), "jeton");
  const ip = cx.request.headers.get("cf-connecting-ip") || "";
  const r = jetonValide(jeton) ? await atelier(cx.env).entrer({ jeton, autorisees: cx.autorisees, ip }) : null;
  if (!r) {
    // Un second clic sur « Entrer » (le premier a déjà ouvert la session) :
    // même règle que ci-dessus.
    if ((await sessionDuNavigateur(cx)).qui) return reponseRedirectionAdmin("/admin");
    return reponseHtmlAdmin(pageLienPerime(cx, await nomDuSite(cx)), { statut: 400 });
  }
  return reponseRedirectionAdmin("/admin", { cookie: cookieSession(cx.url, r.session) });
}

async function deconnexion(cx) {
  if (!origineAcceptee(cx.request, cx.url, { stricte: false })) return refusOrigine(cx);
  const jeton = lireCookie(cx.request, nomCookie(cx.url));
  if (jetonValide(jeton)) await atelier(cx.env).deconnecter({ session: jeton });
  return reponseRedirectionAdmin("/admin", { cookie: cookieEfface(cx.url) });
}

async function refusOrigine(cx) {
  const nom = await nomDuSite(cx);
  return reponseHtmlAdmin(pageMessage(cx, nom, "Demande refusée par sécurité",
    "Cette demande ne venait pas de la page de connexion du site. Rechargez-la et recommencez.",
    '<p><a href="/admin">Aller à la page de connexion</a></p>'), { statut: 403 });
}

const versAccueil = () => reponseRedirectionAdmin("/admin");

/* Le lien d'accès d'une maquette (voir `secretDemo`, validation.js). Une
   clé fausse, ou un site qui n'est pas une maquette, répond exactement
   comme une adresse inconnue : rien ne dit que la porte existe. La
   redirection retire la clé de la barre d'adresse ; `no-referrer` (pages
   d'administration) l'empêche de partir vers un autre site. */
async function lienDemo(cx) {
  const secret = secretDemo(cx.fiche, cx.env);
  const cle = cx.url.searchParams.get("cle") || "";
  if (!secret || !egalEnTempsConstant(cle, secret)) return pageInconnue(cx);
  const r = await atelier(cx.env).entrerParLienDemo({ email: ADRESSE_LIEN_DEMO, autorisees: cx.autorisees });
  if (!r) return pageInconnue(cx);
  return reponseRedirectionAdmin("/admin", { cookie: cookieSession(cx.url, r.session) });
}

async function pageInconnue(cx) {
  return reponseHtmlAdmin(pageMessage(cx, await nomDuSite(cx), "Cette page n'existe pas",
    "L'adresse est peut-être mal recopiée.", '<p><a href="/admin">Aller à l\'administration</a></p>'), { statut: 404, methode: cx.methode });
}

const ROUTES_PAGES = new Map([
  ["/admin", { GET: accueilAdmin }],
  ["/admin/connexion", { POST: demanderLien, GET: versAccueil }],
  ["/admin/entrer", { GET: pageDuLien, POST: entrer }],
  ["/admin/deconnexion", { POST: deconnexion, GET: versAccueil }],
  ["/admin/demo", { GET: lienDemo }],
  ["/admin/cadre", { GET: (cx) => reponseHtmlAdmin(CADRE, { methode: cx.methode, cadre: true }) }]
]);

async function routerPages(cx) {
  const chemin = cx.url.pathname;
  const route = ROUTES_PAGES.get(chemin);
  const lecture = cx.methode === "GET" || cx.methode === "HEAD";
  if (!route) {
    if (chemin === "/admin/" && lecture) return reponseRedirectionAdmin("/admin", { statut: 301 });
    return pageInconnue(cx);
  }
  const traiter = route[cx.methode === "HEAD" ? "GET" : cx.methode];
  if (!traiter) {
    const r = reponseHtmlAdmin(pageMessage(cx, await nomDuSite(cx), "Cette page ne s'ouvre pas ainsi", MESSAGES.methode_refusee,
      '<p><a href="/admin">Aller à l\'administration</a></p>'), { statut: 405, methode: cx.methode });
    r.headers.set("Allow", Object.keys(route).concat(route.GET ? ["HEAD"] : []).join(", "));
    return r;
  }
  if (!cx.env.ATELIER) {
    return reponseHtmlAdmin(pageMessage(cx, await nomDuSite(cx), "L'administration n'est pas encore activée sur ce site",
      "Le site lui-même fonctionne normalement. Si vous pensez que c'est une erreur, prévenez la personne qui s'occupe de votre site."),
    { statut: 503, methode: cx.methode });
  }
  return traiter(cx);
}

/* =========================================================
   L'API de l'éditeur
   ========================================================= */

const ROUTES_API = [
  [/^etat$/, { GET: { operation: "etat" } }],
  [/^brouillon$/, { PUT: { operation: "brouillon", json: true } }],
  [/^publier$/, { POST: { operation: "publier", json: true } }],
  [/^versions$/, { GET: { operation: "versions" } }],
  [/^versions\/([1-9][0-9]{0,14})$/, { GET: { operation: "version" } }],
  [/^versions\/([1-9][0-9]{0,14})\/reprendre$/, { POST: { operation: "reprendre", json: true } }],
  [/^brouillon\/abandonner$/, { POST: { operation: "abandonner", json: true } }],
  [/^medias$/, { GET: { operation: "medias" }, POST: { operation: "medias.deposer" } }],
  [/^medias\/([0-9a-f]{32})\/retirer$/, { POST: { operation: "medias.retirer" } }],
  [/^journal$/, { GET: { operation: "journal" } }],
  [/^export$/, { GET: { operation: "export" } }],
  [/^deconnecter-partout$/, { POST: { operation: "deconnecter-partout" } }],
  // Les messages du formulaire de contact (socle 0.3.0), par pages de 200
  // (`?avant=<numéro>` pour les plus anciens).
  [/^messages$/, { GET: { operation: "messages" } }],
  [/^messages\/([1-9][0-9]{0,14})\/lu$/, { POST: { operation: "messages.lu", json: true } }],
  [/^messages\/([1-9][0-9]{0,14})\/supprimer$/, { POST: { operation: "messages.supprimer" } }]
];

/* Les paramètres sont recopiés UN PAR UN, jamais le corps en bloc : un
   champ en trop glissé par le navigateur n'atteint pas le Durable Object
   (leçon de Graine de Pensée, où un `auto: true` passé tel quel
   contournait toute une grille de contrôles). */
function parametres(operation, m, corps, url) {
  switch (operation) {
    /* `?avant=<numéro>` : la page des messages plus anciens que lui (voir
       opMessages). Une valeur mal formée part telle quelle et le Durable
       Object répond 400 : la prendre pour « pas de paramètre » rendrait la
       première page à un onglet qui croit lire la suivante. */
    case "messages": {
      if (!url.searchParams.has("avant")) return {};
      const avant = url.searchParams.get("avant");
      return { avant: /^[1-9][0-9]{0,14}$/.test(avant) ? Number(avant) : avant };
    }
    // `ecraser` : seulement le vrai booléen `true` (voir opBrouillon).
    case "brouillon": return { contenu: corps.contenu, revision: corps.revision, ecraser: corps.ecraser === true };
    case "publier":
    case "abandonner": return { revision: corps.revision };
    case "version": return { id: Number(m[1]) };
    case "reprendre": return { id: Number(m[1]), revision: corps.revision };
    case "medias.retirer": return { id: m[1] };
    // `lu` tel quel : le Durable Object n'accepte que le vrai booléen.
    case "messages.lu": return { id: Number(m[1]), lu: corps.lu };
    case "messages.supprimer": return { id: Number(m[1]) };
    default: return {};
  }
}

const erreurJson = (statut, code, plus = {}) =>
  reponseJsonAdmin(Object.assign({ erreur: code, message: MESSAGES[code] || MESSAGES.indisponible }, plus.corps || {}),
    { statut, cookie: plus.cookie || "", entetes: plus.entetes || {} });

function appelApi(cx, session, operation, params) {
  return atelier(cx.env).api({ operation, session, autorisees: cx.autorisees, site: cx.infoSite, livre: cx.livre, params });
}

function reponseApi(cx, res) {
  if (!res || !Number.isInteger(res.statut) || !objetSimple(res.corps)) return erreurJson(503, "indisponible");
  return reponseJsonAdmin(res.corps, { statut: res.statut, cookie: res.effacerCookie ? cookieEfface(cx.url) : "" });
}

async function routerApi(cx) {
  const sous = cx.url.pathname.slice("/admin/api/".length);
  let route = null;
  let m = null;
  for (const [motif, methodes] of ROUTES_API) {
    m = motif.exec(sous);
    if (m) { route = methodes; break; }
  }
  if (!route || cx.url.pathname === "/admin/api") return erreurJson(404, "introuvable");
  const action = Object.prototype.hasOwnProperty.call(route, cx.methode) ? route[cx.methode] : null;
  if (!action) return erreurJson(405, "methode_refusee", { entetes: { Allow: Object.keys(route).join(", ") } });
  if (!cx.env.ATELIER) return reponseJsonAdmin({ erreur: "administration_inactive", message: MESSAGES.inactive }, { statut: 503 });
  if (cx.methode !== "GET" && !origineAcceptee(cx.request, cx.url, { stricte: true })) return erreurJson(403, "origine_refusee");
  if (action.json && !typeJson(cx.request)) return erreurJson(415, "type_refuse");
  // Sans cookie de la bonne forme, pas besoin de demander au Durable Object.
  const brut = lireCookie(cx.request, nomCookie(cx.url));
  if (!jetonValide(brut)) return erreurJson(401, "non_connecte", { cookie: brut ? cookieEfface(cx.url) : "" });
  if (action.operation === "medias.deposer") return deposerPhoto(cx, brut);
  let corps = {};
  if (action.json) {
    /* ⚠️ La session est vérifiée AVANT de lire le corps. Un cookie inventé
       n'a que la bonne FORME : il faisait lire, analyser et recopier
       jusqu'au Durable Object un mégaoctet de JSON, désérialisé sur son
       unique fil avant le refus — quelques requêtes anonymes par seconde
       suffisaient à rendre l'éditeur inutilisable (relecture du 3 octobre
       2026). Le dépôt de photo fait de même (`medias.preparer`). `api()`
       revérifie ensuite la session dans le même geste que l'opération. */
    const annonce = Number(cx.request.headers.get("content-length"));
    if (Number.isFinite(annonce) && annonce > LIMITE_CORPS_JSON) return erreurJson(413, "contenu_trop_lourd");
    const qui = await atelier(cx.env).session({ session: brut, autorisees: cx.autorisees });
    if (!qui) return erreurJson(401, "non_connecte", { cookie: cookieEfface(cx.url) });
    const octets = await lireOctetsBornes(cx.request, LIMITE_CORPS_JSON);
    if (!octets) return erreurJson(413, "contenu_trop_lourd");
    corps = objetJson(new TextDecoder().decode(octets));
    if (!corps) return erreurJson(400, "requete_invalide");
  }
  const res = await appelApi(cx, brut, action.operation, parametres(action.operation, m, corps, cx.url));
  if (action.operation === "export" && res && res.statut === 200) return reponseExport(cx, res.corps);
  return reponseApi(cx, res);
}

/* Le dépôt d'une photo, en trois temps : (1) le Durable Object vérifie la
   session et le quota et tire l'identifiant ; (2) le Worker lit et vérifie
   les octets, puis écrit dans R2 ; (3) le Durable Object l'inscrit dans la
   médiathèque. Lire 8 Mo avant de savoir qui envoie coûterait pour rien. */
async function deposerPhoto(cx, session) {
  if (!cx.env.MEDIAS || typeof cx.env.MEDIAS.put !== "function") return erreurJson(503, "medias_indisponibles");
  const annonce = Number(cx.request.headers.get("content-length"));
  if (Number.isFinite(annonce) && annonce > LIMITE_DEPOT) return erreurJson(413, "trop_lourd");
  if (!/^multipart\/form-data\s*;/i.test(cx.request.headers.get("content-type") || "")) return erreurJson(415, "type_refuse");
  const preparation = await appelApi(cx, session, "medias.preparer", {});
  if (!preparation || preparation.statut !== 200) return reponseApi(cx, preparation);
  const depot = await lireDepot(cx.request);
  if (!depot.ok) return reponseJsonAdmin({ erreur: depot.erreur, message: depot.message }, { statut: depot.statut });
  const id = preparation.corps.id;
  try {
    await deposerFichiers(cx.env, id, depot);
  } catch (e) {
    console.error("Écriture d'une photo dans R2 impossible :", e);
    await retirerFichiers(cx.env, id, depot);
    return erreurJson(503, "depot_impossible");
  }
  const decrire = (f) => (f ? { ext: f.ext, type: f.type, largeur: f.largeur, hauteur: f.hauteur, taille: f.taille } : null);
  const res = await appelApi(cx, session, "medias.enregistrer", { id, image: decrire(depot.image), vignette: decrire(depot.vignette), nom: depot.nom });
  // Refusé (quota atteint entre-temps) : les fichiers tout neufs repartent.
  // Une PANNE de l'appel, en revanche, les laisse : la photo est peut-être
  // inscrite, et un fichier orphelin ne coûte rien quand une photo
  // inscrite sans fichier s'afficherait cassée.
  if (res && res.statut !== 201) await retirerFichiers(cx.env, id, depot);
  return reponseApi(cx, res);
}

/* L'export : un fichier à télécharger, lisible par un humain (indenté),
   avec les adresses ABSOLUES des photos — il doit servir hors du site. */
function reponseExport(cx, corps) {
  const base = cx.origine.replace(/\/$/, "");
  const donnees = Object.assign({}, corps, { medias: (Array.isArray(corps.medias) ? corps.medias : []).map((c) => base + c) });
  const jour = new Date(Number(corps.exporte_le) || 0).toISOString().slice(0, 10);
  const id = /^[a-z0-9-]{1,60}$/.test(cx.infoSite.id) ? cx.infoSite.id : "site";
  const h = enTetesAdmin();
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set("Content-Disposition", 'attachment; filename="' + id + "-contenu-" + jour + '.json"');
  return new Response(JSON.stringify(donnees, null, 2), { status: 200, headers: h });
}

/* =========================================================
   Le point d'entrée
   ========================================================= */
export async function routerAdmin(request, env, ctx, options) {
  const cx = contexte(request, env && typeof env === "object" ? env : {}, ctx, options);
  const api = cx.url.pathname === "/admin/api" || cx.url.pathname.startsWith("/admin/api/");
  try {
    return api ? await routerApi(cx) : await routerPages(cx);
  } catch (e) {
    console.error("Administration indisponible :", e);
    if (api) return erreurJson(503, "indisponible");
    return reponseHtmlAdmin(pageMessage(cx, await nomDuSite(cx), "L'administration est momentanément indisponible",
      "Le site lui-même n'est pas touché. Réessayez dans quelques minutes."), { statut: 503, methode: cx.methode });
  }
}
