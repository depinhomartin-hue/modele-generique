/* Tests de l'administration — `npm test` (après tester.mjs).

   Tout passe par le Worker (`creerSite().fetch`), exactement comme une
   requête réelle, avec les simulateurs d'outils/simulateurs.mjs : faux KV,
   faux R2, faux Email Service, et un faux Durable Object qui fait tourner
   le VRAI cœur (atelier-coeur.js) sur une base SQLite.

   Chaque groupe part d'un environnement neuf. Chaque cas rejoue une règle
   de la spécification de la phase 2 ou une leçon de Graine de Pensée : un
   test qui casse le jour où quelqu'un « simplifie », c'est son rôle. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { creerSite } from "../socle/worker.js";
import { METHODES_RPC, connexionDe } from "../socle/serveur/atelier-coeur.js";
import { envoyerAlerteMessage, OBJET_ALERTE } from "../socle/serveur/courriel.js";
import { LIMITE_CORPS_CONTACT, DESTINATAIRES_ALERTE_MAX } from "../socle/serveur/contact.js";
import { adresseTelleQuelle } from "../socle/serveur/validation.js";
import { ERREURS_CONTACT, validerMessage } from "../socle/public/rendu/formulaire.js";
import { echapper } from "../socle/public/rendu/outils.js";
import { creerEnvironnement, fauxCtx, fauxCourriel, MINUTE, HEURE, JOUR } from "./simulateurs.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (f) => JSON.parse(readFileSync(racine + f, "utf8"));
const clientDemo = lire("clients/demo-boulangerie/client.json");
/* La version du socle telle que la fiche de la démo l'annonce : c'est elle
   que l'administration recopie dans ses adresses (`?v=`) et dans `etat`.
   Lue, jamais recopiée : écrite « 0.2.0 » en dur, elle a fait échouer ces
   tests le jour où la démo est passée au socle 0.3.0 (3 octobre 2026). Le
   contrôle qu'elle vaut bien la version du dépôt est dans tester-outils. */
const SOCLE = clientDemo.socle;
const contenuLivre = lire("clients/demo-boulangerie/contenu.json");
const ORIGINE = "https://demo.test";
const LOCAL = "http://localhost:8790";
const NOM = "Au Pétrin d'Ernestine";

let ok = 0;
const echecs = [];
function verifier(nom, condition, detail = "") {
  if (condition) ok++;
  else echecs.push(nom + (detail ? " — " + detail : ""));
}

/* Un groupe qui lève (une réponse inattendue, un champ absent) est compté
   comme un échec, et les groupes suivants s'exécutent quand même : un
   plantage ne doit pas cacher le reste du bilan. */
async function groupe(ligne, fn) {
  try {
    await fn();
  } catch (e) {
    echecs.push("le groupe de la ligne " + ligne + " s'est interrompu : " + (e && e.message ? e.message : e));
  }
}

/* La console est capturée : les erreurs ATTENDUES (KV en panne, envoi
   refusé) ne doivent pas noyer le bilan. Elle n'est montrée qu'en cas
   d'échec. */
const consoleOriginale = { log: console.log, error: console.error, warn: console.warn };
const journalConsole = [];
for (const k of Object.keys(consoleOriginale)) {
  console[k] = (...args) => journalConsole.push(k + " : " + args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
}

/* ----- Des photos minuscules ----- */
// Une vraie photo JPEG de 3 × 2 pixels (fabriquée par l'outil d'images de
// macOS), décodable par n'importe quel navigateur.
const JPEG_REEL = Uint8Array.from(atob(
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAA6ADAAQAAAABAAAAAgAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAgADAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMABAQEBAQEBgQEBgkGBgYJDAkJCQkMDwwMDAwMDxIPDw8PDw8SEhISEhISEhUVFRUVFRkZGRkZHBwcHBwcHBwcHP/bAEMBBAUFBwcHDAcHDB0UEBQdHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHf/dAAQAAf/aAAwDAQACEQMRAD8AvUUUV+Kn68f/2Q=="
), (c) => c.charCodeAt(0));
const PNG_REEL = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEElEQVR4nGM4UaEBQQxwFgBYNAhxWdzeRAAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

// Un en-tête JPEG seul, aux dimensions voulues (le serveur ne décode pas).
function enteteJpeg(largeur, hauteur, total = 0) {
  const tete = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xFF, 0xC0, 0x00, 0x11, 0x08, hauteur >> 8, hauteur & 255, largeur >> 8, largeur & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  const o = new Uint8Array(Math.max(total, tete.length + 2));
  o.set(tete);
  o.set([0xFF, 0xD9], o.length - 2);
  return o;
}

function webpSansPerte(largeur, hauteur) {
  const o = new Uint8Array(30);
  o.set(new TextEncoder().encode("RIFF"), 0);
  o.set([22, 0, 0, 0], 4);
  o.set(new TextEncoder().encode("WEBPVP8L"), 8);
  o.set([10, 0, 0, 0], 16);
  o[20] = 0x2F;
  const b = ((largeur - 1) | ((hauteur - 1) << 14)) >>> 0;
  o.set([b & 255, (b >>> 8) & 255, (b >>> 16) & 255, (b >>> 24) & 255], 21);
  return o;
}

function formulairePhoto(image, { type = "image/jpeg", nom = "photo.jpg", vignette = null } = {}) {
  const f = new FormData();
  f.append("image", new Blob([image], { type }), nom);
  if (vignette) f.append("vignette", new Blob([vignette], { type: "image/jpeg" }), "vignette.jpg");
  f.append("nom", nom);
  return f;
}

/* ----- Le banc d'essai : un site, un environnement, une horloge ----- */
function creerBanc(options = {}) {
  const e = creerEnvironnement(options);
  const client = options.client || clientDemo;
  let site = creerSite({ client, contenu: options.contenu || contenuLivre });
  // Un redéploiement : le contenu livré change, le Durable Object et KV restent.
  e.livrer = (contenu) => { site = creerSite({ client, contenu }); };
  // Une requête fabriquée à la main (corps en flux, par exemple).
  e.fetchBrut = (requete) => { globalThis.caches = e.caches; return site.fetch(requete, e.env, fauxCtx()); };
  let ip = 0;
  e.ipNeuve = () => { ip++; return "198.51." + Math.floor(ip / 250) + "." + ((ip % 250) + 1); };
  e.appeler = async (chemin, o = {}) => {
    globalThis.caches = e.caches;
    const base = o.base || ORIGINE;
    const methode = o.methode || "GET";
    const h = new Headers(o.entetes || {});
    if (o.cookie) h.set("cookie", o.cookie);
    if (methode !== "GET" && methode !== "HEAD" && o.origine !== null && !h.has("origin")) h.set("origin", o.origine || base);
    h.set("cf-connecting-ip", o.ip || "203.0.113.7");
    let body;
    if (o.json !== undefined) {
      body = typeof o.json === "string" ? o.json : JSON.stringify(o.json);
      if (!h.has("content-type")) h.set("content-type", "application/json");
    } else if (o.formulaire) {
      body = new URLSearchParams(o.formulaire).toString();
      h.set("content-type", "application/x-www-form-urlencoded");
    } else if (o.multipart) {
      body = o.multipart;
    }
    const ctx = o.sansCtx ? undefined : fauxCtx();
    const rep = await site.fetch(new Request(base + chemin, { method: methode, headers: h, body }), e.env, ctx);
    const octets = methode === "HEAD" ? new Uint8Array(0) : new Uint8Array(await rep.arrayBuffer());
    if (ctx) await ctx.terminer();
    const texte = new TextDecoder().decode(octets);
    let json = null;
    try { json = JSON.parse(texte); } catch { /* pas du JSON */ }
    return { statut: rep.status, entetes: rep.headers, texte, json, octets, cookies: rep.headers.getSetCookie() };
  };
  return e;
}

const lienDe = (envoi) => {
  const m = envoi && /https?:\/\/[^\s"<>]+\/admin\/entrer\?jeton=[A-Za-z0-9_-]+/.exec(envoi.text);
  return m ? m[0] : "";
};
const jetonDe = (lien) => (lien ? new URL(lien).searchParams.get("jeton") : "");
const cookieDe = (cookies) => {
  const c = cookies.find((x) => /^(__Host-atelier|atelier-[0-9]+)=[A-Za-z0-9_-]{43};/.test(x));
  return c ? c.split(";")[0] : "";
};

/* Une connexion complète : demande, lien reçu, clic. → le cookie. */
async function seConnecter(banc, email = "essai@example.com", { base = ORIGINE } = {}) {
  const avant = banc.courriel.envois.length;
  await banc.appeler("/admin/connexion", { methode: "POST", formulaire: { email }, ip: banc.ipNeuve(), base });
  const jeton = jetonDe(lienDe(banc.courriel.envois[avant]));
  if (!jeton) return "";
  const r = await banc.appeler("/admin/entrer", { methode: "POST", formulaire: { jeton }, base });
  return cookieDe(r.cookies);
}

const api = (banc, cookie, chemin, o = {}) => banc.appeler("/admin/api/" + chemin, Object.assign({ cookie }, o));
const journalDe = async (banc, cookie) => ((await api(banc, cookie, "journal")).json || {}).evenements || [];
const actions = (evenements) => evenements.map((e) => e.action);
const copie = (o) => JSON.parse(JSON.stringify(o));

const CSP_ADMIN = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

/* =========================================================
   Sans liaison ATELIER : une page claire, jamais une 500
   ========================================================= */
await groupe(161, async () => {
  const b = creerBanc({ sansAtelier: true });
  const r = await b.appeler("/admin");
  verifier("sans ATELIER : /admin répond 503", r.statut === 503, "statut " + r.statut);
  verifier("sans ATELIER : la page le dit en clair", r.texte.includes("pas encore activée sur ce site"));
  verifier("sans ATELIER : page non indexée, jamais en cache", /noindex/.test(r.entetes.get("x-robots-tag") || "") && r.entetes.get("cache-control") === "no-store");
  const p = await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "essai@example.com" } });
  verifier("sans ATELIER : demande de lien → 503 lisible, rien ne part", p.statut === 503 && b.courriel.envois.length === 0);
  const a = await b.appeler("/admin/api/etat");
  verifier("sans ATELIER : l'API répond 503 en JSON", a.statut === 503 && a.json && a.json.erreur === "administration_inactive" && !!a.json.message);
  const pub = await b.appeler("/");
  verifier("sans ATELIER : le site public s'affiche", pub.statut === 200 && pub.texte.includes("Au Pétrin"));
});

/* =========================================================
   La connexion complète
   ========================================================= */
await groupe(178, async () => {
  const b = creerBanc();
  const r = await b.appeler("/admin");
  verifier("connexion : /admin sans cookie → la page de connexion", r.statut === 200 && r.texte.includes('action="/admin/connexion"') && r.texte.includes('name="email"'));
  verifier("connexion : en-têtes noindex / no-store / no-referrer", /noindex/.test(r.entetes.get("x-robots-tag") || "") &&
    r.entetes.get("cache-control") === "no-store" && r.entetes.get("referrer-policy") === "no-referrer");
  verifier("connexion : la CSP de l'administration à la lettre", r.entetes.get("content-security-policy") === CSP_ADMIN, r.entetes.get("content-security-policy"));
  verifier("connexion : aucun script, aucune ressource externe", !/<script/i.test(r.texte) && !/(src|href)="(https?:)?\/\//i.test(r.texte));
  verifier("connexion : la feuille de connexion du socle", r.texte.includes('href="/editeur/connexion.css?v=' + SOCLE + '"'));
  verifier("connexion : le Durable Object n'est pas réveillé sans cookie", b.espace.appels === 0, "appels " + b.espace.appels);

  const inconnue = await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "pirate@example.org" } });
  verifier("adresse inconnue : la page « si cette adresse est enregistrée »", inconnue.statut === 200 && inconnue.texte.includes("Si cette adresse est enregistrée"));
  verifier("adresse inconnue : rien ne part", b.courriel.envois.length === 0);

  const connue = await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "  Essai@Example.COM " }, ip: "203.0.113.8" });
  verifier("adresse connue : la même page", connue.statut === 200 &&
    connue.texte.replace("essai@example.com", "X") === inconnue.texte.replace("pirate@example.org", "X"));
  verifier("adresse connue : un e-mail part", b.courriel.envois.length === 1);
  const envoi = b.courriel.envois[0] || {};
  const lien = lienDe(envoi);
  verifier("e-mail : vers l'adresse normalisée", envoi.to === "essai@example.com", envoi.to);
  verifier("e-mail : l'objet nomme le site", envoi.subject === "Votre lien de connexion — " + NOM, envoi.subject);
  verifier("e-mail : l'expéditeur de l'atelier, au nom du site", envoi.from && envoi.from.email === "connexion@atelier.example" && envoi.from.name === NOM);
  verifier("e-mail : la durée et la phrase qui rassure", /15 minutes/.test(envoi.text || "") && (envoi.text || "").includes("personne ne peut entrer sans ce lien"));
  verifier("e-mail : un lien vers /admin/entrer sur l'adresse du site", lien.startsWith(ORIGINE + "/admin/entrer?jeton="), lien);
  verifier("e-mail : la version HTML porte le même lien", (envoi.html || "").includes(lien));
  verifier("e-mail : le jeton fait 43 caractères", /^[A-Za-z0-9_-]{43}$/.test(jetonDe(lien)));

  const jeton = jetonDe(lien);
  const vu1 = await b.appeler("/admin/entrer?jeton=" + jeton);
  const vu2 = await b.appeler("/admin/entrer?jeton=" + jeton);
  verifier("GET /admin/entrer : un bouton, pas de session", vu1.statut === 200 && vu1.texte.includes("Entrer dans l'administration") &&
    vu1.texte.includes('action="/admin/entrer"') && vu1.cookies.length === 0);
  verifier("GET /admin/entrer NE consomme PAS le jeton (antivirus, aperçus)", vu2.texte.includes('name="jeton" value="' + jeton + '"'));
  verifier("GET /admin/entrer : no-referrer (le jeton est dans l'adresse)", vu1.entetes.get("referrer-policy") === "no-referrer");

  const entree = await b.appeler("/admin/entrer", { methode: "POST", formulaire: { jeton } });
  const cookie = cookieDe(entree.cookies);
  verifier("POST /admin/entrer : 303 vers /admin", entree.statut === 303 && entree.entetes.get("location") === "/admin");
  verifier("POST /admin/entrer : cookie __Host- sécurisé de 30 jours", !!cookie && cookie.startsWith("__Host-atelier=") &&
    /; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000$/.test(entree.cookies[0] || ""), entree.cookies[0]);
  const encore = await b.appeler("/admin/entrer", { methode: "POST", formulaire: { jeton } });
  verifier("second POST du même jeton : refusé, aucune session", encore.statut === 400 && encore.cookies.length === 0 && encore.texte.includes("expiré ou a déjà servi"));
  const apres = await b.appeler("/admin/entrer?jeton=" + jeton);
  verifier("lien déjà servi : le dit, et propose un nouveau lien", apres.texte.includes("expiré ou a déjà servi") && apres.texte.includes('action="/admin/connexion"'));

  const coquille = await b.appeler("/admin", { cookie });
  const attendu = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    "<title>Administration · Au Pétrin d&#39;Ernestine</title><meta name=\"robots\" content=\"noindex, nofollow\">\n" +
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/editeur/editeur.css?v=' + SOCLE + '"></head>\n' +
    '<body><div id="editeur" data-socle="' + SOCLE + '"><p class="ed-chargement">Chargement de l\'éditeur…</p></div>\n' +
    "<noscript><p>L'éditeur a besoin de JavaScript. Le site, lui, n'en a pas besoin.</p></noscript>\n" +
    '<script type="module" src="/editeur/editeur.js?v=' + SOCLE + '"></script></body></html>\n';
  verifier("connecté : /admin sert la coquille exacte de l'éditeur", coquille.statut === 200 && coquille.texte === attendu);
  verifier("connecté : la coquille n'est pas encadrable", coquille.entetes.get("x-frame-options") === "DENY");
  const tete = await b.appeler("/admin", { cookie, methode: "HEAD" });
  verifier("HEAD /admin : sans corps", tete.statut === 200 && tete.texte === "");

  // Un jeton expire au bout de 15 minutes.
  await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "essai@example.com" }, ip: b.ipNeuve() });
  const jetonLent = jetonDe(lienDe(b.courriel.envois[1]));
  b.horloge.avancer(14 * MINUTE);
  verifier("jeton : encore bon à 14 minutes", (await b.appeler("/admin/entrer?jeton=" + jetonLent)).texte.includes('name="jeton"'));
  b.horloge.avancer(MINUTE + 1);
  const tardif = await b.appeler("/admin/entrer", { methode: "POST", formulaire: { jeton: jetonLent } });
  verifier("jeton expiré après 15 minutes : refusé", tardif.statut === 400 && tardif.cookies.length === 0);
  const forge = await b.appeler("/admin/entrer", { methode: "POST", formulaire: { jeton: "A".repeat(43) } });
  verifier("jeton inventé : refusé", forge.statut === 400 && forge.cookies.length === 0);
  const appels = b.espace.appels;
  await b.appeler("/admin/entrer?jeton=court");
  verifier("jeton mal formé : refusé sans réveiller le Durable Object", b.espace.appels === appels);

  // En base, jamais le jeton ni la session en clair.
  const base = JSON.stringify([
    b.espace.stockage.sql.exec("SELECT * FROM jetons").toArray(),
    b.espace.stockage.sql.exec("SELECT * FROM sessions").toArray()
  ]);
  verifier("en base : seulement les empreintes des jetons et des sessions", !base.includes(jeton) && !base.includes(cookie.split("=")[1]));

  const j = await journalDe(b, cookie);
  verifier("journal : la demande et la connexion y sont", actions(j).includes("lien_demande") && actions(j).includes("connexion"));
  verifier("journal : aucune trace de l'adresse inconnue", !JSON.stringify(j).includes("pirate@"));
});

/* Une adresse de la fiche du client, écrite avec des majuscules. */
await groupe(264, async () => {
  const client = Object.assign(copie(clientDemo), { administration: { adresses: [" Marie@Exemple.FR ", "pas-une-adresse"] } });
  const b = creerBanc({ client, adresses: "" });
  const cookie = await seConnecter(b, "marie@exemple.fr");
  verifier("fiche du client : son adresse entre (minuscules, espaces retirés)", !!cookie && (await api(b, cookie, "etat")).statut === 200);
});

/* Une adresse ôtée de la liste perd ses sessions sur-le-champ. */
await groupe(272, async () => {
  const b = creerBanc({ adresses: "essai@example.com, deux@example.com" });
  const cookie = await seConnecter(b, "deux@example.com");
  verifier("adresse retirée : la session marchait", (await api(b, cookie, "etat")).statut === 200);
  b.env.ADRESSES_ATELIER = "essai@example.com";
  const r = await api(b, cookie, "etat");
  verifier("adresse retirée : la session ne marche plus", r.statut === 401);
  b.env.ADRESSES_ATELIER = "essai@example.com, deux@example.com";
  verifier("adresse retirée : la session ne revient pas toute seule", (await api(b, cookie, "etat")).statut === 401);
});

/* =========================================================
   Les limites — en base, et en silence vu de la page
   ========================================================= */
await groupe(286, async () => {
  // Les plafonds courts se comptent par adresse ET par connexion.
  const b = creerBanc();
  const IP = "198.51.100.20";
  const demander = (ip = IP) => b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "essai@example.com" }, ip });
  const envois = () => b.courriel.envois.length;
  const reference = await demander();
  await demander();
  await demander();
  const quatrieme = await demander();
  verifier("limite : 3 liens en 15 minutes depuis la même connexion, le 4e ne part pas", envois() === 3, "envois " + envois());
  verifier("limite : le 4e voit la même page", quatrieme.statut === 200 && quatrieme.texte === reference.texte);
  b.horloge.avancer(15 * MINUTE);
  await demander();
  verifier("limite : 15 minutes plus tard, un lien repart", envois() === 4);
  // Une heure d'écart entre les paquets : le plafond par connexion (10 par
  // heure) n'est pas celui qu'on éprouve ici.
  b.horloge.avancer(61 * MINUTE);
  for (let i = 0; i < 3; i++) await demander();
  b.horloge.avancer(61 * MINUTE);
  for (let i = 0; i < 3; i++) await demander();
  verifier("limite : 10 liens en 24 heures depuis la même connexion", envois() === 10, "envois " + envois());
  b.horloge.avancer(16 * MINUTE);
  await demander();
  verifier("limite : le 11e de la journée depuis cette connexion ne part pas", envois() === 10);
  await demander("198.51.100.21");
  verifier("limite : une AUTRE connexion reçoit son lien pour la même adresse", envois() === 11);
  b.horloge.avancer(JOUR);
  await demander();
  verifier("limite : le lendemain, un lien repart", envois() === 12);
  const cookie = await seConnecter(b);
  const refus = (await journalDe(b, cookie)).filter((e) => e.action === "lien_refuse");
  verifier("limite : chaque refus au journal, mais une fois par heure (pas d'inondation)",
    refus.length === 2 && refus.some((e) => /15 minutes/.test(e.detail)) && refus.some((e) => /24 heures/.test(e.detail)),
    JSON.stringify(refus.map((e) => e.detail)));
});

/* Un tiers qui connaît l'adresse ne ferme plus la connexion à sa titulaire
   (relecture du 3 octobre 2026 : dix demandes depuis n'importe où, et plus
   aucun lien ne partait pendant 24 heures). */
await groupe(326, async () => {
  const b = creerBanc();
  const demander = (ip) => b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "essai@example.com" }, ip });
  for (let i = 0; i < 12; i++) {
    await demander("203.0.113.66");
    if (i % 3 === 2) b.horloge.avancer(15 * MINUTE);
  }
  const parLeTiers = b.courriel.envois.length;
  verifier("un tiers : ses demandes restent bornées (10 liens)", parLeTiers === 10, "envois " + parLeTiers);
  b.horloge.avancer(30 * MINUTE);
  await demander("198.51.100.200");
  verifier("un tiers : la titulaire, depuis sa connexion, reçoit quand même son lien", b.courriel.envois.length === parLeTiers + 1);
  const jeton = jetonDe(lienDe(b.courriel.envois[parLeTiers]));
  const entree = await b.appeler("/admin/entrer", { methode: "POST", formulaire: { jeton }, ip: "198.51.100.200" });
  verifier("un tiers : … et elle entre", !!cookieDe(entree.cookies));
});

/* Le plafond par adresse seule (30 en 24 heures) borne le coût ; une
   connexion d'où l'adresse est déjà entrée le franchit, et celui du site
   aussi : sinon viser deux adresses publiques bloquait une troisième
   personne jamais visée (contrôle du 3 octobre 2026). Une connexion
   inconnue, elle, reste tenue par le plafond du site. */
await groupe(346, async () => {
  const b = creerBanc({ adresses: "essai@example.com,autre@example.com" });
  const CONNUE = "203.0.113.7";
  const demander = (ip, email = "essai@example.com") => b.appeler("/admin/connexion", { methode: "POST", formulaire: { email }, ip });
  // Le lien est demandé d'une connexion, cliqué depuis CONNUE (l'adresse
  // par défaut du banc) : c'est la connexion du clic qui devient connue.
  const cookie = await seConnecter(b);
  for (let i = 0; i < 29; i++) await demander(b.ipNeuve());
  verifier("adresse seule : 30 liens en 24 heures, de 30 connexions différentes", b.courriel.envois.length === 30, "envois " + b.courriel.envois.length);
  await demander(b.ipNeuve());
  verifier("adresse seule : le 31e, d'une connexion inconnue, ne part pas", b.courriel.envois.length === 30);
  const refus = b.espace.stockage.sql.exec("SELECT detail FROM journal WHERE action = 'lien_refuse'").toArray();
  verifier("adresse seule : le refus est au journal", refus.some((l) => /30 liens/.test(l.detail)), JSON.stringify(refus));
  await b.appeler("/admin/deconnexion", { methode: "POST", cookie });
  await demander(CONNUE);
  verifier("connexion connue : elle franchit le plafond de l'adresse, même après une déconnexion", b.courriel.envois.length === 31);
  for (let i = 0; i < 19; i++) await demander(b.ipNeuve(), "autre@example.com");
  verifier("connexion connue : le site atteint ses 50 e-mails", b.courriel.envois.length === 50, "envois " + b.courriel.envois.length);
  await demander(b.ipNeuve(), "autre@example.com");
  verifier("site au plafond : une connexion INCONNUE ne reçoit plus rien", b.courriel.envois.length === 50);
  await demander(CONNUE);
  verifier("site au plafond : la connexion CONNUE de la titulaire reçoit encore son lien", b.courriel.envois.length === 51);
  for (let i = 0; i < 12; i++) await demander(CONNUE);
  verifier("connexion connue : toujours tenue par ses plafonds courts", b.courriel.envois.length <= 51 + 3, "envois " + b.courriel.envois.length);
  const brut = JSON.stringify(b.espace.stockage.sql.exec("SELECT * FROM ip_connues").toArray());
  verifier("connexion connue : gardée en empreinte, jamais en clair", brut.includes("essai@example.com:") && !brut.includes(CONNUE));
  // Empreinte SALÉE : celle d'une IP ne se calcule pas sans le sel du site.
  const nue = createHash("sha256").update("ip:" + CONNUE).digest("hex").slice(0, 32);
  verifier("connexion connue : empreinte salée, introuvable sans le sel du site", !brut.includes(nue));
  const autreSite = creerBanc({ adresses: "essai@example.com" });
  await seConnecter(autreSite);
  const brutAutre = JSON.stringify(autreSite.espace.stockage.sql.exec("SELECT cle FROM ip_connues").toArray());
  verifier("connexion connue : la même IP n'a pas la même empreinte sur deux sites", brutAutre.includes("essai@example.com:") &&
    !brut.includes(brutAutre.match(/essai@example\.com:([0-9a-f]{32})/)[1]));
});

/* La connexion d'une adresse IPv6 est son préfixe /64. */
await groupe(371, async () => {
  verifier("IPv6 : réduite à son /64", connexionDe("2001:0db8:0001:0002:0000:0000:0000:0001") === "2001:db8:1:2::/64" &&
    connexionDe("2001:db8:1:2::1") === "2001:db8:1:2::/64" && connexionDe("2001:DB8:1:2:aaaa:bbbb:cccc:dddd") === "2001:db8:1:2::/64",
    connexionDe("2001:db8:1:2::1"));
  verifier("IPv6 : formes courtes", connexionDe("::1") === "0:0:0:0::/64" && connexionDe("2001:db8::") === "2001:db8:0:0::/64");
  verifier("IPv4, IPv4 dans IPv6, vide, illisible", connexionDe("192.0.2.1") === "192.0.2.1" && connexionDe("::ffff:192.0.2.1") === "192.0.2.1" &&
    connexionDe("") === "inconnue" && connexionDe(undefined) === "inconnue" && connexionDe("1:2:3") === "1:2:3" && connexionDe("1::2::3") === "1::2::3");
  const b = creerBanc();
  for (let i = 1; i <= 10; i++) {
    await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "inconnu" + i + "@example.org" }, ip: "2001:db8:1:2:" + i.toString(16) + "::1" });
  }
  await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "essai@example.com" }, ip: "2001:db8:1:2:ffff:eeee:dddd:cccc" });
  verifier("IPv6 : changer d'adresse dans le même /64 ne contourne pas le plafond de connexion", b.courriel.envois.length === 0);
  await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "essai@example.com" }, ip: "2001:db8:1:3::1" });
  verifier("IPv6 : un autre /64 passe", b.courriel.envois.length === 1);
});

/* Une demande anonyme ne coûte que des lectures d'index, et une connexion
   au plafond n'écrit plus rien (relecture du 3 octobre 2026 : chaque
   demande écrivait sa ligne et parcourait toute la table). */
await groupe(391, async () => {
  const b = creerBanc();
  const sql = b.espace.stockage.sql;
  const db = b.espace.stockage.db;
  const lignes = () => sql.exec("SELECT COUNT(*) AS n FROM demandes").one().n;
  const demander = (email, ip) => b.appeler("/admin/connexion", { methode: "POST", formulaire: { email }, ip });
  for (let i = 0; i < 200; i++) await demander("invente" + i + "@example.org", "192.0.2.99");
  verifier("anonyme : 200 demandes d'adresses inventées → 10 lignes, pas une de plus", lignes() === 10, "lignes " + lignes());

  // Toutes les requêtes que fait une demande (adresse connue ou non), et
  // leur plan : aucune ne doit parcourir une table entière.
  const vues = new Map();
  const exec = sql.exec;
  sql.exec = (q, ...l) => { vues.set(q, l); return exec.call(sql, q, ...l); };
  b.horloge.avancer(2 * MINUTE);
  await demander("invente@example.org", "192.0.2.100");
  await demander("essai@example.com", "192.0.2.100");
  for (let i = 0; i < 4; i++) await demander("essai@example.com", "192.0.2.100");
  sql.exec = exec;
  const scans = [];
  for (const [q, l] of vues) {
    if (!/^\s*(SELECT|DELETE|UPDATE)/i.test(q) || !/\b(demandes|jetons|sessions|ip_connues)\b|journal WHERE action/.test(q)) continue;
    const plan = db.prepare("EXPLAIN QUERY PLAN " + q).all(...l).map((r) => r.detail).join(" ; ");
    if (/\bSCAN (demandes|jetons|sessions|ip_connues|journal)\b/.test(plan)) scans.push(q.replace(/\s+/g, " ") + " → " + plan);
  }
  verifier("anonyme : aucune requête ne parcourt une table entière", scans.length === 0, scans.join(" | "));
  verifier("anonyme : la purge a bien été vue (le contrôle des plans porte sur elle)", [...vues.keys()].some((q) => /DELETE FROM demandes/.test(q)));

  // La purge passe une fois par minute, pas à chaque demande.
  let purges = 0;
  sql.exec = (q, ...l) => { if (/DELETE FROM demandes/.test(q)) purges++; return exec.call(sql, q, ...l); };
  for (let i = 0; i < 20; i++) {
    await demander("invente" + i + "@example.org", b.ipNeuve());
    b.horloge.avancer(1000);
  }
  const enUneMinute = purges;
  b.horloge.avancer(JOUR + MINUTE);
  await demander("invente@example.org", b.ipNeuve());
  sql.exec = exec;
  verifier("purge : au plus une fois par minute", enUneMinute <= 4, purges + " suppressions en 20 s");
  verifier("purge : elle passe encore, et retire ce qui a vieilli", purges > enUneMinute && lignes() === 1, "lignes " + lignes());
});
await groupe(433, async () => {
  const b = creerBanc();
  for (let i = 1; i <= 10; i++) {
    await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "inconnu" + i + "@example.org" }, ip: "192.0.2.50" });
  }
  await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "essai@example.com" }, ip: "192.0.2.50" });
  verifier("plafond IP : 10 demandes par heure, même pour des adresses inconnues", b.courriel.envois.length === 0);
  await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "essai@example.com" }, ip: "192.0.2.51" });
  verifier("plafond IP : une autre connexion passe", b.courriel.envois.length === 1);
  b.horloge.avancer(HEURE);
  await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "essai@example.com" }, ip: "192.0.2.50" });
  verifier("plafond IP : une heure plus tard, elle repasse", b.courriel.envois.length === 2);
  const brut = JSON.stringify(b.espace.stockage.sql.exec("SELECT * FROM demandes").toArray());
  verifier("plafond IP : l'adresse IP n'est jamais gardée en clair", !brut.includes("192.0.2.50"));
});
await groupe(448, async () => {
  const adresses = Array.from({ length: 7 }, (_, i) => "atelier" + i + "@example.com");
  const b = creerBanc({ adresses: adresses.join(",") });
  for (let i = 0; i < 50; i++) {
    await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: adresses[i % 6] }, ip: b.ipNeuve() });
    b.horloge.avancer(5 * MINUTE);
  }
  verifier("plafond du site : 50 e-mails passent", b.courriel.envois.length === 50, "envois " + b.courriel.envois.length);
  await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: adresses[6] }, ip: b.ipNeuve() });
  verifier("plafond du site : le 51e en 24 heures ne part pas", b.courriel.envois.length === 50);
  const lignes = b.espace.stockage.sql.exec("SELECT detail FROM journal WHERE action = 'lien_refuse'").toArray();
  verifier("plafond du site : inscrit au journal", lignes.some((l) => /50 e-mails/.test(l.detail)));
});

/* =========================================================
   Le mode journal local : les DEUX conditions
   ========================================================= */
await groupe(465, async () => {
  const b = creerBanc({ journalLocal: true });
  const avant = journalConsole.length;
  const r = await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "essai@example.com" }, base: LOCAL });
  const m = /href="(http:\/\/localhost:8790\/admin\/entrer\?jeton=[A-Za-z0-9_-]{43})"/.exec(r.texte);
  verifier("local : aucun e-mail ne part", b.courriel.envois.length === 0);
  verifier("local : le lien est sur la page, dans l'encadré « Développement local »", !!m && r.texte.includes("Développement local"));
  verifier("local : le lien est aussi dans la console", journalConsole.slice(avant).some((l) => m && l.includes(m[1])));
  const entree = await b.appeler("/admin/entrer", { methode: "POST", formulaire: { jeton: m ? jetonDe(m[1]) : "" }, base: LOCAL });
  verifier("local : cookie « atelier-<port> » sans Secure (Safari en http)", /^atelier-8790=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/.test(entree.cookies[0] || ""), entree.cookies[0]);
  const cookie = cookieDe(entree.cookies);
  verifier("local : la session marche en http://localhost", (await api(b, cookie, "etat", { base: LOCAL })).statut === 200);
  const inconnue = await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "x@example.org" }, base: LOCAL });
  verifier("local : adresse inconnue, l'encadré dit qu'aucun lien n'a été créé", inconnue.texte.includes("Aucun lien n'a été créé"));
  const ip = await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "essai@example.com" }, base: "http://127.0.0.1:8790", ip: b.ipNeuve() });
  verifier("local : 127.0.0.1 aussi", ip.texte.includes("http://127.0.0.1:8790/admin/entrer?jeton=") && b.courriel.envois.length === 0);
  const prod = await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "essai@example.com" }, ip: b.ipNeuve() });
  verifier("COURRIEL_JOURNAL seul, hors localhost : l'e-mail part vraiment", b.courriel.envois.length === 1);
  verifier("COURRIEL_JOURNAL seul, hors localhost : jamais le lien sur la page", !prod.texte.includes("jeton=") && !prod.texte.includes("Développement local"));
});

/* =========================================================
   Un envoi raté : la même page, une ligne au journal
   ========================================================= */
await groupe(489, async () => {
  const b = creerBanc();
  const cookie = await seConnecter(b);
  b.courriel.echec = { code: "E_SENDER_NOT_VERIFIED", message: "Domaine d'expédition non vérifié" };
  const r = await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "essai@example.com" }, ip: b.ipNeuve() });
  verifier("envoi refusé : la page ne change pas", r.statut === 200 && r.texte.includes("Si cette adresse est enregistrée"));
  const j = await journalDe(b, cookie);
  verifier("envoi refusé : « envoi_echoue » avec la cause", j.some((e) => e.action === "envoi_echoue" && e.detail.includes("E_SENDER_NOT_VERIFIED")));
  verifier("envoi refusé : signalé dans la console", journalConsole.some((l) => l.startsWith("error") && l.includes("E_SENDER_NOT_VERIFIED")));
});
await groupe(499, async () => {
  const b = creerBanc({ expediteur: "" });
  await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "essai@example.com" } });
  const l = b.espace.stockage.sql.exec("SELECT detail FROM journal WHERE action = 'envoi_echoue'").toArray();
  verifier("sans expéditeur : rien ne part, la cause est écrite", b.courriel.envois.length === 0 && l.some((x) => x.detail.includes("COURRIEL_EXPEDITEUR")));
});
await groupe(505, async () => {
  const b = creerBanc({ sansCourriel: true });
  const r = await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "essai@example.com" } });
  const l = b.espace.stockage.sql.exec("SELECT detail FROM journal WHERE action = 'envoi_echoue'").toArray();
  verifier("sans liaison COURRIEL : même page, cause au journal", r.statut === 200 && l.some((x) => x.detail.includes("COURRIEL")));
});
await groupe(511, async () => {
  const b = creerBanc();
  const r = await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "pas une adresse" } });
  verifier("adresse mal formée : le formulaire la signale", r.statut === 400 && r.texte.includes("adresse e-mail complète") && r.texte.includes('aria-invalid="true"'));
  const x = await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: '"><script>alert(1)</script>' } });
  verifier("adresse piégée : renvoyée échappée", !x.texte.includes("<script>") && x.texte.includes("&lt;script&gt;"));
});

/* =========================================================
   Les garde-fous de l'API
   ========================================================= */
await groupe(522, async () => {
  const b = creerBanc();
  const cookie = await seConnecter(b);
  const sans = await b.appeler("/admin/api/etat");
  verifier("API sans cookie → 401 non_connecte", sans.statut === 401 && sans.json && sans.json.erreur === "non_connecte" && !!sans.json.message);
  verifier("API : JSON, no-store, noindex", (sans.entetes.get("content-type") || "").startsWith("application/json") &&
    sans.entetes.get("cache-control") === "no-store" && /noindex/.test(sans.entetes.get("x-robots-tag") || ""));
  const faux = await api(b, "__Host-atelier=" + "B".repeat(43), "etat");
  verifier("API avec un cookie inconnu → 401, et le cookie est effacé", faux.statut === 401 && /Max-Age=0/.test(faux.cookies[0] || ""));
  const etat = (await api(b, cookie, "etat")).json;
  const corps = { contenu: etat.brouillon.contenu, revision: etat.brouillon.revision };
  const pirate = await api(b, cookie, "brouillon", { methode: "PUT", json: corps, origine: "https://pirate.example" });
  verifier("mauvaise Origin → 403 origine_refusee", pirate.statut === 403 && pirate.json.erreur === "origine_refusee");
  const aucune = await api(b, cookie, "brouillon", { methode: "PUT", json: corps, origine: null });
  verifier("API sans Origin ni Sec-Fetch-Site → 403", aucune.statut === 403);
  const croise = await api(b, cookie, "brouillon", { methode: "PUT", json: corps, origine: null, entetes: { "sec-fetch-site": "cross-site" } });
  verifier("API : Sec-Fetch-Site cross-site → 403", croise.statut === 403);
  const nulle = await api(b, cookie, "brouillon", { methode: "PUT", json: corps, origine: null, entetes: { origin: "null", "sec-fetch-site": "same-origin" } });
  verifier("API : Origin null + Sec-Fetch-Site same-origin → accepté (no-referrer)", nulle.statut === 200, "statut " + nulle.statut);
  const texte = await api(b, cookie, "brouillon", { methode: "PUT", json: corps, entetes: { "content-type": "text/plain" } });
  verifier("mauvais Content-Type → 415 type_refuse", texte.statut === 415 && texte.json.erreur === "type_refuse");
  const formu = await api(b, cookie, "publier", { methode: "POST", formulaire: { revision: "1" } });
  verifier("formulaire envoyé à l'API JSON → 415", formu.statut === 415);
  verifier("route inconnue → 404 JSON", (await api(b, cookie, "rien")).statut === 404);
  const methode = await api(b, cookie, "brouillon", { methode: "DELETE" });
  verifier("méthode refusée → 405 avec Allow", methode.statut === 405 && methode.entetes.get("allow") === "PUT");
  const illisible = await api(b, cookie, "brouillon", { methode: "PUT", json: "{pas du json" });
  verifier("corps illisible → 400", illisible.statut === 400 && illisible.json.erreur === "requete_invalide");

  const formPirate = await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "essai@example.com" }, origine: "https://pirate.example", ip: b.ipNeuve() });
  verifier("formulaire de connexion depuis un autre site → 403, rien ne part", formPirate.statut === 403 && b.courriel.envois.length === 1);
  await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "essai@example.com" }, origine: null, ip: b.ipNeuve() });
  verifier("formulaire sans Origin ni Sec-Fetch-Site (vieux navigateur) → accepté", b.courriel.envois.length === 2);
  await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "essai@example.com" }, origine: null, entetes: { origin: "null", "sec-fetch-site": "same-origin" }, ip: b.ipNeuve() });
  verifier("formulaire avec Origin null (no-referrer) + same-origin → accepté", b.courriel.envois.length === 3);
});

/* =========================================================
   État et brouillon
   ========================================================= */
await groupe(562, async () => {
  const b = creerBanc();
  const cookie = await seConnecter(b);
  const e = await api(b, cookie, "etat");
  const s = e.json || {};
  verifier("etat : 200", e.statut === 200, "statut " + e.statut);
  verifier("etat : le site", s.site && s.site.id === "demo-boulangerie" && s.site.demo === true && s.site.socle === SOCLE &&
    s.site.adresse === ORIGINE && s.site.domaine === "" && typeof s.site.mentionDemo === "string", JSON.stringify(s.site));
  verifier("etat : l'utilisateur", s.utilisateur && s.utilisateur.email === "essai@example.com");
  verifier("etat : le brouillon naît du contenu livré", s.brouillon && s.brouillon.revision === 1 && s.brouillon.contenu.site.nom === NOM &&
    /^[0-9a-f]{64}$/.test(s.brouillon.empreinte) && typeof s.brouillon.modifie_le === "number");
  verifier("etat : rien de publié depuis l'éditeur", s.publie && s.publie.empreinte === null && s.publie.publie_le === null && s.publie.publie_par === null);

  const modifie = copie(s.brouillon.contenu);
  modifie.site.nom = "Le Fournil d'essai";
  const put = await api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: modifie, revision: 1 } });
  verifier("brouillon : enregistré, révision 2", put.statut === 200 && put.json.revision === 2 && /^[0-9a-f]{64}$/.test(put.json.empreinte) && put.json.modifie_le === b.horloge.maintenant());
  const identique = await api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: modifie, revision: 2 } });
  verifier("brouillon identique : révision inchangée", identique.statut === 200 && identique.json.revision === 2);
  const identiqueVieux = await api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: modifie, revision: 1 } });
  verifier("brouillon identique sur une vieille révision : pas de faux conflit", identiqueVieux.statut === 200 && identiqueVieux.json.revision === 2);
  const autre = copie(modifie);
  autre.site.nom = "Un autre nom";
  const conflit = await api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: autre, revision: 1 } });
  verifier("révision périmée → 409 conflit, avec le brouillon actuel", conflit.statut === 409 && conflit.json.erreur === "conflit" &&
    conflit.json.brouillon && conflit.json.brouillon.revision === 2 && conflit.json.brouillon.contenu.site.nom === "Le Fournil d'essai" &&
    conflit.json.brouillon.modifie_par === "essai@example.com");
  const canon = copie(modifie);
  canon.blocs["inconnu-1"] = { type: "type-inconnu" };
  const normalise = await api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: canon, revision: 2 } });
  verifier("forme canonique : un bloc inconnu ne change pas l'empreinte", normalise.statut === 200 && normalise.json.revision === 2);

  const lourd = copie(modifie);
  for (let i = 1; i <= 16; i++) lourd.blocs["presentation-" + (i + 10)] = { type: "presentation", texte: "x".repeat(20_000) };
  const trop = await api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: lourd, revision: 2 } });
  verifier("contenu de plus de 300 000 octets → 413", trop.statut === 413 && trop.json.erreur === "contenu_trop_lourd", "statut " + trop.statut);
  const enorme = await api(b, cookie, "brouillon", { methode: "PUT", json: '{"revision":2,"contenu":{"x":"' + "y".repeat(1_100_000) + '"}}' });
  verifier("corps de plus de 1 Mo → 413 sans être lu", enorme.statut === 413);

  const invalides = [
    ["21 pages", () => { const c = copie(modifie); for (let i = 0; i < 21; i++) c.pages["page-" + i] = { ordre: [] }; return c; }, /20 pages/],
    ["151 sections", () => { const c = copie(modifie); for (let i = 0; i < 151; i++) c.blocs["appel-" + (i + 10)] = { type: "appel" }; return c; }, /150 sections/],
    ["un texte de 20 001 caractères", () => { const c = copie(modifie); c.site.nom = "x".repeat(20_001); return c; }, /20.000 caractères/],
    ["une liste de 61 éléments", () => { const c = copie(modifie); c.entete.liens = Array.from({ length: 61 }, () => ({ texte: "a", vers: "#a" })); return c; }, /60 éléments/],
    ["11 niveaux d'imbrication", () => { const c = copie(modifie); let n = c.site; for (let i = 0; i < 10; i++) { n.x = {}; n = n.x; } return c; }, /imbriqué/],
    ["un tableau", () => [], /illisible/],
    ["rien", () => undefined, /illisible/]
  ];
  for (const [nom, fabriquer, message] of invalides) {
    const r = await api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: fabriquer(), revision: 2 } });
    verifier("contenu invalide (" + nom + ") → 400 avec un message clair", r.statut === 400 && r.json.erreur === "contenu_invalide" && message.test(r.json.message || ""),
      r.statut + " " + (r.json && r.json.message));
  }
  const sansRevision = await api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: modifie } });
  verifier("révision absente → 400", sansRevision.statut === 400 && sansRevision.json.erreur === "requete_invalide");
  const apres = (await api(b, cookie, "etat")).json;
  verifier("aucun refus n'a touché au brouillon", apres.brouillon.revision === 2 && apres.brouillon.contenu.site.nom === "Le Fournil d'essai");

  b.espace.redemarrer();
  const redemarre = await api(b, cookie, "etat");
  verifier("Durable Object évincé puis réveillé : tout est là (schéma idempotent)", redemarre.statut === 200 && redemarre.json.brouillon.revision === 2);
});

/* Le brouillon naît du contenu EN LIGNE ; KV qui ne répond pas → 503. */
await groupe(626, async () => {
  const b = creerBanc();
  const cookie = await seConnecter(b);
  const enLigne = copie(contenuLivre);
  enLigne.site.nom = "Déjà en ligne";
  b.kv.donnees.set("publie", JSON.stringify(enLigne));
  b.kv.panne.lecture = true;
  const panne = await api(b, cookie, "etat");
  verifier("premier etat, KV en panne → 503 (jamais le contenu livré à la place)", panne.statut === 503);
  b.kv.panne.lecture = false;
  const e = await api(b, cookie, "etat");
  verifier("premier etat : le brouillon naît du contenu en ligne (KV)", e.statut === 200 && e.json.brouillon.contenu.site.nom === "Déjà en ligne");
});

/* =========================================================
   Publication
   ========================================================= */
await groupe(643, async () => {
  const b = creerBanc();
  const cookie = await seConnecter(b);
  const e = (await api(b, cookie, "etat")).json;
  const c = copie(e.brouillon.contenu);
  c.site.nom = "Boulangerie publiée";
  const put = (await api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: c, revision: 1 } })).json;
  const avantPublication = await b.appeler("/");
  verifier("avant publication : le site montre le contenu livré", avantPublication.texte.includes("Au Pétrin"));
  const pub = await api(b, cookie, "publier", { methode: "POST", json: { revision: put.revision } });
  verifier("publier : 200, l'empreinte publiée = celle du brouillon", pub.statut === 200 && pub.json.publie.empreinte === put.empreinte &&
    pub.json.publie.publie_par === "essai@example.com" && pub.json.version && pub.json.version.id === 2);
  verifier("publier : KV écrit", JSON.parse(b.kv.donnees.get("publie") || "{}").site.nom === "Boulangerie publiée");
  const site = await b.appeler("/");
  verifier("publier : la page publique montre le nouveau contenu", site.statut === 200 && site.texte.includes("Boulangerie publiée"));
  verifier("une visite publique ne réveille jamais le Durable Object", await (async () => {
    const n = b.espace.appels; await b.appeler("/"); await b.appeler("/robots.txt"); return b.espace.appels === n;
  })());
  const etat = (await api(b, cookie, "etat")).json;
  verifier("publier : l'état le dit", etat.publie.empreinte === put.empreinte && etat.publie.publie_le === b.horloge.maintenant());
  const encore = await api(b, cookie, "publier", { methode: "POST", json: { revision: put.revision } });
  verifier("publier sans changement → inchange", encore.statut === 200 && encore.json.inchange === true && encore.json.publie.empreinte === put.empreinte);
  const vieux = await api(b, cookie, "publier", { methode: "POST", json: { revision: 1 } });
  verifier("publier une révision périmée → 409", vieux.statut === 409 && vieux.json.brouillon.revision === put.revision);
  let v = (await api(b, cookie, "versions")).json.versions;
  verifier("versions : une publication, active", v.length === 2 && v[0].origine === "publication" && v[0].active === true && v[0].par === "essai@example.com" &&
    v[0].empreinte === put.empreinte && v[0].taille > 1000);
  // Le site tel qu'il était à l'ouverture de l'éditeur reste joignable
  // après la première publication : c'est la version « départ ».
  verifier("versions : le départ (contenu livré) est gardé, en dernier, inactif",
    v[1].origine === "depart" && v[1].active === false && v[1].par === null && v[1].empreinte === e.brouillon.empreinte);
  const depart = (await api(b, cookie, "versions/" + v[1].id)).json.version;
  verifier("versions : le départ contient le contenu livré", depart && depart.contenu.site.nom === "Au Pétrin d'Ernestine");

  // KV refuse l'écriture : 503, et RIEN n'est enregistré.
  c.site.nom = "Jamais en ligne";
  const put2 = (await api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: c, revision: put.revision } })).json;
  b.kv.panne.ecriture = true;
  const echec = await api(b, cookie, "publier", { methode: "POST", json: { revision: put2.revision } });
  verifier("KV en panne → 503 publication_impossible", echec.statut === 503 && echec.json.erreur === "publication_impossible" && !!echec.json.message);
  v = (await api(b, cookie, "versions")).json.versions;
  const etat2 = (await api(b, cookie, "etat")).json;
  verifier("KV en panne : ni version ni marque « publié »", v.length === 2 && etat2.publie.empreinte === put.empreinte);
  verifier("KV en panne : le site n'a pas bougé", JSON.parse(b.kv.donnees.get("publie")).site.nom === "Boulangerie publiée");
  b.kv.panne.ecriture = false;
  const reprise = await api(b, cookie, "publier", { methode: "POST", json: { revision: put2.revision } });
  verifier("KV revenu : la publication passe", reprise.statut === 200 && reprise.json.version.id === 3);
  verifier("journal : la publication y est", (await journalDe(b, cookie)).some((x) => x.action === "publication" && x.par === "essai@example.com"));

  // Pendant que KV traîne, une modification attend son tour : on publie ce
  // qu'on voyait, et la modification arrive ensuite, intacte.
  c.site.nom = "Version A";
  const pa = (await api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: c, revision: put2.revision } })).json;
  b.kv.delaiEcriture = 30;
  const cB = copie(c);
  cB.site.nom = "Version B";
  const [p, m] = await Promise.all([
    api(b, cookie, "publier", { methode: "POST", json: { revision: pa.revision } }),
    api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: cB, revision: pa.revision } })
  ]);
  b.kv.delaiEcriture = 0;
  const fin = (await api(b, cookie, "etat")).json;
  verifier("publication lente + modification : on publie ce qu'on voyait", p.statut === 200 && JSON.parse(b.kv.donnees.get("publie")).site.nom === "Version A");
  verifier("publication lente + modification : la modification passe après", m.statut === 200 && fin.brouillon.contenu.site.nom === "Version B" &&
    fin.publie.empreinte === pa.empreinte && fin.brouillon.revision === pa.revision + 1);
});

/* =========================================================
   Reprendre une version, abandonner — mettre de côté AVANT
   ========================================================= */
await groupe(713, async () => {
  const b = creerBanc();
  const cookie = await seConnecter(b);
  const e = (await api(b, cookie, "etat")).json;
  const a = copie(e.brouillon.contenu);
  a.site.nom = "Contenu A";
  const ra = (await api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: a, revision: 1 } })).json;
  const pa = (await api(b, cookie, "publier", { methode: "POST", json: { revision: ra.revision } })).json;
  const bb = copie(a);
  bb.site.nom = "Contenu B (non publié)";
  const rb = (await api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: bb, revision: ra.revision } })).json;
  const kvAvant = b.kv.donnees.get("publie");

  const rep = await api(b, cookie, "versions/" + pa.version.id + "/reprendre", { methode: "POST", json: { revision: rb.revision } });
  verifier("reprendre : le brouillon prend le contenu de la version", rep.statut === 200 && rep.json.brouillon.contenu.site.nom === "Contenu A" &&
    rep.json.brouillon.revision === rb.revision + 1 && rep.json.brouillon.empreinte === ra.empreinte);
  let v = (await api(b, cookie, "versions")).json.versions;
  const sauvegarde = v.find((x) => x.origine === "sauvegarde");
  verifier("reprendre : l'ancien brouillon a été mis de côté", !!sauvegarde && sauvegarde.empreinte === rb.empreinte);
  const vue = sauvegarde ? (await api(b, cookie, "versions/" + sauvegarde.id)).json : null;
  verifier("reprendre : la sauvegarde contient bien l'ancien brouillon", vue && vue.version.contenu.site.nom === "Contenu B (non publié)" && vue.version.origine === "sauvegarde");
  verifier("reprendre ne publie pas", b.kv.donnees.get("publie") === kvAvant && (await api(b, cookie, "etat")).json.publie.empreinte === ra.empreinte);
  const rep2 = await api(b, cookie, "versions/" + pa.version.id + "/reprendre", { methode: "POST", json: { revision: rep.json.brouillon.revision } });
  v = (await api(b, cookie, "versions")).json.versions;
  verifier("reprendre ce qui est déjà en ligne : pas de sauvegarde inutile", rep2.statut === 200 && v.filter((x) => x.origine === "sauvegarde").length === 1);
  verifier("reprendre une version inconnue → 404", (await api(b, cookie, "versions/999/reprendre", { methode: "POST", json: { revision: 1 } })).statut === 404);
  verifier("lire une version inconnue → 404", (await api(b, cookie, "versions/999")).statut === 404);
  verifier("identifiant de version piégé → 404", (await api(b, cookie, "versions/constructor")).statut === 404);
  const perime = await api(b, cookie, "versions/" + pa.version.id + "/reprendre", { methode: "POST", json: { revision: 1 } });
  verifier("reprendre sur une révision périmée → 409", perime.statut === 409);

  const cc = copie(a);
  cc.site.nom = "Contenu C (abandonné)";
  const rc = (await api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: cc, revision: rep2.json.brouillon.revision } })).json;
  verifier("abandonner sur une révision périmée → 409", (await api(b, cookie, "brouillon/abandonner", { methode: "POST", json: { revision: 1 } })).statut === 409);
  const ab = await api(b, cookie, "brouillon/abandonner", { methode: "POST", json: { revision: rc.revision } });
  verifier("abandonner : le brouillon redevient le contenu publié", ab.statut === 200 && ab.json.brouillon.contenu.site.nom === "Contenu A" && ab.json.brouillon.empreinte === ra.empreinte);
  v = (await api(b, cookie, "versions")).json.versions;
  verifier("abandonner : les modifications sont mises de côté AVANT", v[0].origine === "sauvegarde" && v[0].empreinte === rc.empreinte);
  verifier("abandonner : le publié est inchangé", b.kv.donnees.get("publie") === kvAvant);
  const j = actions(await journalDe(b, cookie));
  verifier("journal : reprise et abandon", j.includes("reprise") && j.includes("abandon"));
});
await groupe(756, async () => {
  // Abandonner sans avoir jamais publié : retour au contenu livré.
  const b = creerBanc();
  const cookie = await seConnecter(b);
  const e = (await api(b, cookie, "etat")).json;
  const c = copie(e.brouillon.contenu);
  c.site.nom = "Brouillon jamais publié";
  const r = (await api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: c, revision: 1 } })).json;
  const ab = await api(b, cookie, "brouillon/abandonner", { methode: "POST", json: { revision: r.revision } });
  verifier("abandonner sans publication : retour au contenu livré", ab.statut === 200 && ab.json.brouillon.contenu.site.nom === NOM);
  verifier("abandonner sans publication : le brouillon est sauvegardé", (await api(b, cookie, "versions")).json.versions.some((x) => x.origine === "sauvegarde" && x.empreinte === r.empreinte));
});

/* =========================================================
   Cent versions au plus
   ========================================================= */
await groupe(772, async () => {
  const b = creerBanc();
  const cookie = await seConnecter(b);
  const e = (await api(b, cookie, "etat")).json;
  const c = copie(e.brouillon.contenu);
  let revision = e.brouillon.revision;
  for (let i = 1; i <= 105; i++) {
    c.site.nom = "Nom " + i;
    revision = (await api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: c, revision } })).json.revision;
    await api(b, cookie, "publier", { methode: "POST", json: { revision } });
  }
  const v = (await api(b, cookie, "versions")).json.versions;
  // Version 1 = le départ ; les publications portent les numéros 2 à 106.
  verifier("versions : 100 publications au plus, de la plus récente à la plus ancienne, puis le départ",
    v.length === 101 && v[0].id === 106 && v[99].id === 7 && v[100].id === 1 && v[100].origine === "depart");
  verifier("versions : seule la dernière publiée est active", v.filter((x) => x.active).length === 1 && v[0].active);
  verifier("versions : la plus ancienne publication est purgée", (await api(b, cookie, "versions/2")).statut === 404);
  verifier("versions : le départ n'est jamais purgé", (await api(b, cookie, "versions/1")).statut === 200);
  const n = b.espace.stockage.sql.exec("SELECT COUNT(*) AS n FROM versions").one().n;
  verifier("versions : 101 lignes en base (100 + le départ)", n === 101, "lignes " + n);
});

/* =========================================================
   Photos
   ========================================================= */
await groupe(797, async () => {
  const b = creerBanc();
  const cookie = await seConnecter(b);
  const depot = await api(b, cookie, "medias", { methode: "POST", multipart: formulairePhoto(JPEG_REEL, { nom: "Fournée du matin.jpg", vignette: JPEG_REEL }) });
  const m = depot.json && depot.json.media;
  verifier("photo JPEG valide → 201", depot.statut === 201 && !!m, "statut " + depot.statut + " " + depot.texte);
  verifier("photo : la forme du contrat", m && /^[0-9a-f]{32}$/.test(m.id) && m.url === "/medias/" + m.id + ".jpg" &&
    m.vignette === "/medias/vignettes/" + m.id + ".jpg" && m.type === "image/jpeg" && m.largeur === 3 && m.hauteur === 2 &&
    m.taille === JPEG_REEL.byteLength && m.nom === "Fournée du matin.jpg" && typeof m.quand === "number", JSON.stringify(m));
  const objet = b.r2.objets.get("medias/" + m.id + ".jpg");
  verifier("photo : rangée dans R2 avec le type lu dans les octets", !!objet && objet.httpMetadata.contentType === "image/jpeg" && b.r2.objets.has("vignettes/" + m.id + ".jpg"));
  const liste = (await api(b, cookie, "medias")).json.medias;
  verifier("médiathèque : la photo y est", liste.length === 1 && liste[0].id === m.id);

  const servie = await b.appeler(m.url);
  verifier("photo servie : 200, image/jpeg, mêmes octets", servie.statut === 200 && servie.entetes.get("content-type") === "image/jpeg" &&
    servie.octets.length === JPEG_REEL.length && servie.octets.every((x, i) => x === JPEG_REEL[i]));
  verifier("photo servie : nosniff", servie.entetes.get("x-content-type-options") === "nosniff");
  verifier("photo servie : immutable, un an", servie.entetes.get("cache-control") === "public, max-age=31536000, immutable");
  const lecturesR2 = b.r2.lectures;
  const cache = b.caches.default;
  const depuisCache = await b.appeler(m.url + "?contourner=1");
  verifier("photo : la seconde visite vient de caches.default (requête ignorée)", depuisCache.statut === 200 && b.r2.lectures === lecturesR2 && cache.lectures === 1);
  verifier("photo : vignette servie", (await b.appeler(m.vignette)).entetes.get("content-type") === "image/jpeg");

  const png = (await api(b, cookie, "medias", { methode: "POST", multipart: formulairePhoto(PNG_REEL, { type: "image/png", nom: "logo.png" }) })).json.media;
  verifier("photo PNG : acceptée, sans vignette", png && png.type === "image/png" && png.url.endsWith(".png") && png.vignette === null && png.largeur === 3);
  const ecritures = cache.ecritures;
  const tete = await b.appeler(png.url, { methode: "HEAD" });
  verifier("HEAD : 200 sans corps, avec le type", tete.statut === 200 && tete.octets.length === 0 && tete.entetes.get("content-type") === "image/png");
  verifier("HEAD : jamais mis en cache", cache.ecritures === ecritures);
  const webp = await api(b, cookie, "medias", { methode: "POST", multipart: formulairePhoto(webpSansPerte(5, 7), { type: "image/webp", nom: "x.webp" }) });
  verifier("photo WebP : acceptée, dimensions lues", webp.statut === 201 && webp.json.media.largeur === 5 && webp.json.media.hauteur === 7);

  const objetsAvant = b.r2.objets.size;
  const deguises = [
    ["SVG déguisé en JPEG", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>'],
    ["HTML déguisé en JPEG", "<!doctype html><html><body><script>fetch('/admin/api/export')</script></body></html>"],
    ["GIF", "GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000;"]
  ];
  for (const [nom, contenu] of deguises) {
    const r = await api(b, cookie, "medias", { methode: "POST", multipart: formulairePhoto(new TextEncoder().encode(contenu), { type: "image/jpeg", nom: "photo.jpg" }) });
    verifier(nom + " → 415 format_refuse", r.statut === 415 && r.json.erreur === "format_refuse");
  }
  const vignettePiegee = await api(b, cookie, "medias", { methode: "POST", multipart: formulairePhoto(JPEG_REEL, { vignette: new TextEncoder().encode("<svg></svg>") }) });
  verifier("vignette déguisée → 415", vignettePiegee.statut === 415);
  verifier("fichiers refusés : rien n'est écrit dans R2", b.r2.objets.size === objetsAvant);
  const geante = await api(b, cookie, "medias", { methode: "POST", multipart: formulairePhoto(enteteJpeg(5000, 100)) });
  verifier("photo de plus de 4 096 pixels → 413", geante.statut === 413 && geante.json.erreur === "trop_lourd");
  const lourde = await api(b, cookie, "medias", { methode: "POST", multipart: formulairePhoto(enteteJpeg(10, 10, 8 * 1024 * 1024 + 1)) });
  verifier("photo de plus de 8 Mo → 413", lourde.statut === 413 && lourde.json.erreur === "trop_lourd");
  const sansImage = new FormData();
  sansImage.append("nom", "rien");
  verifier("dépôt sans photo → 400", (await api(b, cookie, "medias", { methode: "POST", multipart: sansImage })).statut === 400);
  verifier("dépôt sans session → 401", (await api(b, "", "medias", { methode: "POST", multipart: formulairePhoto(JPEG_REEL) })).statut === 401);
  verifier("dépôt depuis un autre site → 403", (await api(b, cookie, "medias", { methode: "POST", multipart: formulairePhoto(JPEG_REEL), origine: "https://pirate.example" })).statut === 403);
  verifier("dépôt en JSON → 415", (await api(b, cookie, "medias", { methode: "POST", json: { image: "x" } })).statut === 415);
  verifier("fichiers refusés : toujours rien dans R2", b.r2.objets.size === objetsAvant);

  const retrait = await api(b, cookie, "medias/" + m.id + "/retirer", { methode: "POST" });
  verifier("retirer une photo → 200", retrait.statut === 200 && retrait.json.ok === true);
  verifier("retirée : absente de la médiathèque", !(await api(b, cookie, "medias")).json.medias.some((x) => x.id === m.id));
  verifier("retirée : le fichier reste dans R2 (une version la cite peut-être)", b.r2.objets.has("medias/" + m.id + ".jpg"));
  b.caches.default.entrees.clear();
  verifier("retirée : elle s'affiche toujours sur le site", (await b.appeler(m.url)).statut === 200);
  verifier("retirer deux fois → 200", (await api(b, cookie, "medias/" + m.id + "/retirer", { methode: "POST" })).statut === 200);
  verifier("retirer une photo inconnue → 404", (await api(b, cookie, "medias/" + "0".repeat(32) + "/retirer", { methode: "POST" })).statut === 404);
  const j = actions(await journalDe(b, cookie));
  verifier("journal : ajout et retrait de photos", j.includes("media_ajoute") && j.includes("media_retire"));

  const pieges = [
    "/medias/" + m.id.toUpperCase() + ".jpg", "/medias/" + m.id + ".svg", "/medias/" + m.id + ".JPG", "/medias/" + m.id + ".jpg/x",
    "/medias/" + m.id + ".jpg%00", "/medias/vignettes/vignettes/" + m.id + ".jpg", "/medias/medias/" + m.id + ".jpg",
    "/medias/" + "a".repeat(32) + ".jpg", "/medias/", "/medias/../medias/" + m.id + ".txt", "/medias/x/%2e%2e/" + m.id + ".svg",
    "/medias/" + m.id.slice(1) + ".jpg", "/medias/vignettes/" + m.id + ".jpeg"
  ];
  for (const chemin of pieges) {
    const r = await b.appeler(chemin);
    verifier("chemin piégé « " + chemin.replace(m.id, "<id>") + " » → 404", r.statut === 404, "statut " + r.statut);
  }
  verifier("POST sur une photo → 405", (await b.appeler(m.url, { methode: "POST" })).statut === 405);
});
await groupe(879, async () => {
  // Quota : 1 000 photos visibles, 1 Go.
  const b = creerBanc();
  const cookie = await seConnecter(b);
  const inserer = b.espace.stockage.sql;
  for (let i = 0; i < 999; i++) {
    inserer.exec("INSERT INTO medias (id, ext, type, nom, largeur, hauteur, taille, quand) VALUES (?, 'jpg', 'image/jpeg', '', 10, 10, 1000, ?)",
      i.toString(16).padStart(32, "0"), i);
  }
  const millieme = await api(b, cookie, "medias", { methode: "POST", multipart: formulairePhoto(JPEG_REEL) });
  verifier("quota : la 1 000e photo passe", millieme.statut === 201);
  const objets = b.r2.objets.size;
  const de_trop = await api(b, cookie, "medias", { methode: "POST", multipart: formulairePhoto(JPEG_REEL) });
  verifier("quota : la 1 001e → 409 quota_atteint, rien dans R2", de_trop.statut === 409 && de_trop.json.erreur === "quota_atteint" && b.r2.objets.size === objets);
  await api(b, cookie, "medias/" + "0".repeat(32) + "/retirer", { methode: "POST" });
  verifier("quota : une photo retirée libère une place", (await api(b, cookie, "medias", { methode: "POST", multipart: formulairePhoto(JPEG_REEL) })).statut === 201);
});
await groupe(896, async () => {
  const b = creerBanc();
  const cookie = await seConnecter(b);
  b.espace.stockage.sql.exec("INSERT INTO medias (id, ext, type, nom, largeur, hauteur, taille, quand) VALUES (?, 'jpg', 'image/jpeg', '', 10, 10, ?, 0)",
    "f".repeat(32), 1024 * 1024 * 1024 - 100);
  const objets = b.r2.objets.size;
  const r = await api(b, cookie, "medias", { methode: "POST", multipart: formulairePhoto(JPEG_REEL) });
  verifier("quota de 1 Go : refusé APRÈS l'écriture, les fichiers neufs sont retirés", r.statut === 409 && b.r2.objets.size === objets);
});
await groupe(905, async () => {
  const b = creerBanc({ sansMedias: true });
  const cookie = await seConnecter(b);
  const r = await api(b, cookie, "medias", { methode: "POST", multipart: formulairePhoto(JPEG_REEL) });
  verifier("sans liaison MEDIAS : 503 lisible", r.statut === 503 && r.json.erreur === "medias_indisponibles");
  verifier("sans liaison MEDIAS : une photo → 404", (await b.appeler("/medias/" + "a".repeat(32) + ".jpg")).statut === 404);
});

/* =========================================================
   Déconnexion, appareils, expiration
   ========================================================= */
await groupe(916, async () => {
  const b = creerBanc({ adresses: "essai@example.com,deux@example.com" });
  const a = await seConnecter(b);
  const c2 = await seConnecter(b);
  const c3 = await seConnecter(b);
  const autre = await seConnecter(b, "deux@example.com");
  const sortie = await b.appeler("/admin/deconnexion", { methode: "POST", cookie: a });
  verifier("déconnexion : 303 vers /admin, cookie effacé", sortie.statut === 303 && sortie.entetes.get("location") === "/admin" &&
    /^__Host-atelier=; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=0$/.test(sortie.cookies[0] || ""), sortie.cookies[0]);
  verifier("déconnexion : cette session ne marche plus", (await api(b, a, "etat")).statut === 401);
  verifier("déconnexion : les autres appareils restent connectés", (await api(b, c2, "etat")).statut === 200);
  const partout = await api(b, c2, "deconnecter-partout", { methode: "POST" });
  verifier("déconnecter partout : 200 ok, cookie effacé", partout.statut === 200 && partout.json.ok === true && /Max-Age=0/.test(partout.cookies[0] || ""));
  verifier("déconnecter partout : tous les appareils de l'adresse", (await api(b, c2, "etat")).statut === 401 && (await api(b, c3, "etat")).statut === 401);
  verifier("déconnecter partout : pas ceux d'une autre adresse", (await api(b, autre, "etat")).statut === 200);
  const j = actions(await journalDe(b, autre));
  verifier("journal : déconnexion et déconnexion partout", j.includes("deconnexion") && j.includes("deconnexion_partout"));
  verifier("déconnexion sans Origin d'un autre site → 403", (await b.appeler("/admin/deconnexion", { methode: "POST", cookie: autre, origine: "https://pirate.example" })).statut === 403 &&
    (await api(b, autre, "etat")).statut === 200);
});
await groupe(936, async () => {
  const b = creerBanc();
  const cookie = await seConnecter(b);
  const vuLe = () => b.espace.stockage.sql.exec("SELECT vu_le FROM sessions").one().vu_le;
  const depart = vuLe();
  b.horloge.avancer(5 * MINUTE);
  await api(b, cookie, "etat");
  verifier("session : « vu le » n'est pas réécrit à chaque appel", vuLe() === depart);
  b.horloge.avancer(6 * MINUTE);
  await api(b, cookie, "etat");
  verifier("session : « vu le » mis à jour après 10 minutes", vuLe() === b.horloge.maintenant());
  b.horloge.avancer(30 * JOUR - 12 * MINUTE);
  verifier("session : encore bonne au 29e jour", (await api(b, cookie, "etat")).statut === 200);
  b.horloge.avancer(2 * MINUTE);
  verifier("session : expirée après 30 jours", (await api(b, cookie, "etat")).statut === 401);
  const page = await b.appeler("/admin", { cookie });
  verifier("session expirée : /admin montre la connexion et efface le cookie", page.texte.includes('action="/admin/connexion"') && /Max-Age=0/.test(page.cookies[0] || ""));
});
await groupe(954, async () => {
  // Vingt appareils au plus par adresse : le plus ancien tombe.
  const b = creerBanc();
  const cookies = [];
  for (let i = 0; i < 21; i++) {
    if (i === 10 || i === 20) b.horloge.avancer(JOUR);
    cookies.push(await seConnecter(b));
    b.horloge.avancer(5 * MINUTE + 1);
  }
  verifier("21 connexions réussies", cookies.every(Boolean), cookies.filter(Boolean).length + " cookies");
  verifier("20 appareils au plus : le premier tombe", (await api(b, cookies[0], "etat")).statut === 401 && (await api(b, cookies[1], "etat")).statut === 200);
});

/* =========================================================
   Journal et export
   ========================================================= */
await groupe(970, async () => {
  const b = creerBanc();
  const cookie = await seConnecter(b);
  const ev = await journalDe(b, cookie);
  verifier("journal : la forme { quand, par, action, detail }, plus récent d'abord", ev.length >= 2 && ev[0].action === "connexion" &&
    ev.every((e) => typeof e.quand === "number" && "par" in e && typeof e.action === "string" && typeof e.detail === "string"));
  const stub = b.env.ATELIER.get(b.env.ATELIER.idFromName("site"));
  for (let i = 0; i < 600; i++) await stub.signalerEchecEnvoi({ email: "essai@example.com", cause: "essai " + i });
  verifier("journal : 500 lignes gardées en base", b.espace.stockage.sql.exec("SELECT COUNT(*) AS n FROM journal").one().n === 500);
  verifier("journal : l'API en rend 100", (await journalDe(b, cookie)).length === 100);
  verifier("le nom du Durable Object est fixe : « site »", b.espace.noms.every((n) => n === "site"));
});
await groupe(982, async () => {
  const b = creerBanc();
  const cookie = await seConnecter(b);
  const livre = await api(b, cookie, "export");
  verifier("export avant publication : le contenu livré", livre.statut === 200 && livre.json.contenu.site.nom === NOM && livre.json.site === "demo-boulangerie");
  const photo = (await api(b, cookie, "medias", { methode: "POST", multipart: formulairePhoto(JPEG_REEL) })).json.media;
  const citee = (await api(b, cookie, "medias", { methode: "POST", multipart: formulairePhoto(PNG_REEL, { type: "image/png", nom: "p.png" }) })).json.media;
  const e = (await api(b, cookie, "etat")).json;
  const c = copie(e.brouillon.contenu);
  c.blocs["accroche-1"].image = citee.url;
  c.site.nom = "Publié pour l'export";
  const r = (await api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: c, revision: e.brouillon.revision } })).json;
  await api(b, cookie, "publier", { methode: "POST", json: { revision: r.revision } });
  await api(b, cookie, "medias/" + citee.id + "/retirer", { methode: "POST" });
  c.site.nom = "Brouillon non publié";
  await api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: c, revision: r.revision } });
  const x = await api(b, cookie, "export");
  verifier("export : un fichier à télécharger, daté", x.statut === 200 &&
    x.entetes.get("content-disposition") === 'attachment; filename="demo-boulangerie-contenu-2026-10-03.json"', x.entetes.get("content-disposition"));
  verifier("export : le contenu EN LIGNE, pas le brouillon", x.json.contenu.site.nom === "Publié pour l'export" && typeof x.json.exporte_le === "number");
  verifier("export : les photos en adresses absolues, retirées-mais-citées comprises",
    x.json.medias.includes(ORIGINE + photo.url) && x.json.medias.includes(ORIGINE + citee.url) && x.json.medias.length === 2, JSON.stringify(x.json.medias));
  verifier("export : no-store", x.entetes.get("cache-control") === "no-store");
});

/* =========================================================
   Les en-têtes, les adresses inconnues, la liste blanche RPC
   ========================================================= */
await groupe(1010, async () => {
  const b = creerBanc();
  const cadre = await b.appeler("/admin/cadre");
  verifier("/admin/cadre : un document vide", cadre.statut === 200 && /<body><\/body>/.test(cadre.texte) && !/<script/i.test(cadre.texte));
  verifier("/admin/cadre : encadrable par le site seul", cadre.entetes.get("x-frame-options") === "SAMEORIGIN" &&
    cadre.entetes.get("content-security-policy") === CSP_ADMIN.replace("frame-ancestors 'none'", "frame-ancestors 'self'"));
  verifier("/admin/cadre : no-store, noindex", cadre.entetes.get("cache-control") === "no-store" && /noindex/.test(cadre.entetes.get("x-robots-tag") || ""));
  const inconnue = await b.appeler("/admin/wp-login.php");
  verifier("adresse inconnue sous /admin → 404 non indexée", inconnue.statut === 404 && /noindex/.test(inconnue.entetes.get("x-robots-tag") || ""));
  verifier("/admin/ → redirigé vers /admin", (await b.appeler("/admin/")).entetes.get("location") === "/admin");
  verifier("GET /admin/connexion → retour à /admin", (await b.appeler("/admin/connexion")).statut === 303);
  const put = await b.appeler("/admin", { methode: "PUT" });
  verifier("PUT /admin → 405", put.statut === 405 && /GET/.test(put.entetes.get("allow") || ""));
  verifier("« /%61dmin » n'est pas l'administration", (await b.appeler("/%61dmin")).statut === 404 && b.espace.appels === 0);
  verifier("le site public garde son 405 hors GET/HEAD", (await b.appeler("/", { methode: "POST" })).statut === 405);
  const sansCtx = await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "essai@example.com" }, sansCtx: true });
  verifier("sans ctx (appel direct) : la demande aboutit quand même", sansCtx.statut === 200 && b.courriel.envois.length === 1);

  const source = readFileSync(racine + "socle/serveur/atelier.js", "utf8");
  const declarees = [...source.matchAll(/^ {2}([a-zA-Z]+)\(demande\) \{ return this\.coeur\.([a-zA-Z]+)\(demande\); \}$/gm)];
  verifier("atelier.js déclare exactement METHODES_RPC", declarees.length === METHODES_RPC.length &&
    declarees.every((m) => m[1] === m[2] && METHODES_RPC.includes(m[1])), declarees.map((m) => m[1]).join(","));
  verifier("atelier-coeur.js n'importe rien de cloudflare:", !/from\s+["']cloudflare:/.test(readFileSync(racine + "socle/serveur/atelier-coeur.js", "utf8")));
});

/* =========================================================
   Relecture du 3 octobre 2026 — chantier serveur
   ========================================================= */

/* Un cookie inventé ne fait plus lire le corps : la session est vérifiée
   AVANT, et le Durable Object ne reçoit jamais le mégaoctet. */
await groupe(1041, async () => {
  const b = creerBanc();
  let tire = 0;
  const morceau = new TextEncoder().encode(" ".repeat(64 * 1024));
  const flux = new ReadableStream({ pull(c) { tire++; c.enqueue(morceau); if (tire >= 4) c.close(); } }, { highWaterMark: 0 });
  const h = new Headers({ cookie: "__Host-atelier=" + "A".repeat(43), origin: ORIGINE, "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" });
  const avant = Object.assign({}, b.espace.parMethode);
  const r = await b.fetchBrut(new Request(ORIGINE + "/admin/api/brouillon", { method: "PUT", headers: h, body: flux, duplex: "half" }));
  const corps = await r.json();
  verifier("cookie inventé + gros corps → 401, cookie effacé", r.status === 401 && corps.erreur === "non_connecte" && /Max-Age=0/.test(r.headers.get("set-cookie") || ""));
  verifier("cookie inventé : le corps n'est jamais lu", tire === 0, tire + " morceaux lus");
  verifier("cookie inventé : une seule question au Durable Object (la session), pas d'appel à l'API",
    b.espace.parMethode.session === avant.session + 1 && b.espace.parMethode.api === avant.api, JSON.stringify(b.espace.parMethode));
  const annonce = await b.fetchBrut(new Request(ORIGINE + "/admin/api/brouillon", {
    method: "PUT", headers: new Headers({ cookie: "__Host-atelier=" + "A".repeat(43), origin: ORIGINE, "content-type": "application/json", "content-length": "400000" }),
    body: "{}"
  }));
  verifier("corps annoncé au-delà de 310 000 octets → 413 sans réveiller le Durable Object",
    annonce.status === 413 && b.espace.parMethode.session === avant.session + 1);
  // Avec une vraie session, rien ne change pour l'éditeur.
  const cookie = await seConnecter(b);
  const e = (await api(b, cookie, "etat")).json;
  const put = await api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: Object.assign(copie(e.brouillon.contenu), { site: Object.assign(copie(e.brouillon.contenu.site), { nom: "Avec session" }) }), revision: 1 } });
  verifier("avec une session : l'enregistrement passe", put.statut === 200 && put.json.revision === 2);
});

/* Le brouillon suit le site tant que rien n'a été publié depuis l'éditeur. */
await groupe(1068, async () => {
  // A. Brouillon intact : il reprend le nouveau contenu livré.
  const b = creerBanc();
  const cookie = await seConnecter(b);
  const e1 = (await api(b, cookie, "etat")).json;
  const v2 = copie(contenuLivre);
  v2.site.nom = "Au Pétrin d'Ernestine — v2";
  b.livrer(v2);
  verifier("hors éditeur : le site public montre la v2 après le redéploiement", (await b.appeler("/")).texte.includes("Ernestine — v2"));
  const perime = await api(b, cookie, "publier", { methode: "POST", json: { revision: e1.brouillon.revision } });
  verifier("hors éditeur : publier depuis un éditeur resté sur la v1 → 409 qui montre la v2, rien ne part",
    perime.statut === 409 && perime.json.brouillon.contenu.site.nom === v2.site.nom && !b.kv.donnees.has("publie"),
    perime.statut + " " + (perime.json && perime.json.brouillon && perime.json.brouillon.contenu.site.nom));
  const e2 = (await api(b, cookie, "etat")).json;
  verifier("hors éditeur : le brouillon intact a repris la v2", e2.brouillon.contenu.site.nom === v2.site.nom &&
    e2.brouillon.revision === 2 && e2.brouillon.modifie_par === null, JSON.stringify([e2.brouillon.revision, e2.brouillon.modifie_par]));
  let v = (await api(b, cookie, "versions")).json.versions;
  const depart = v.find((x) => x.origine === "depart");
  verifier("hors éditeur : le départ montré est la v2", v.filter((x) => x.origine === "depart").length === 1 && depart.empreinte === e2.brouillon.empreinte);
  verifier("hors éditeur : le journal le dit", (await journalDe(b, cookie)).some((x) => x.action === "hors_editeur" && /intact/.test(x.detail)));
  const e3 = (await api(b, cookie, "etat")).json;
  const departs = b.espace.stockage.sql.exec("SELECT COUNT(*) AS n FROM versions WHERE origine = 'depart'").one().n;
  verifier("hors éditeur : un second état ne refait rien", e3.brouillon.revision === 2 && departs === 2, departs + " départs");
  const pub = await api(b, cookie, "publier", { methode: "POST", json: { revision: 2 } });
  verifier("hors éditeur : publier ensuite met bien la v2 en ligne", pub.statut === 200 && (await b.appeler("/")).texte.includes("Ernestine — v2"));
  // Après une publication, le contenu livré n'est plus lu.
  const v3 = copie(contenuLivre);
  v3.site.nom = "Jamais vu";
  b.livrer(v3);
  const e4 = (await api(b, cookie, "etat")).json;
  verifier("hors éditeur : après une publication, un redéploiement ne touche plus au brouillon", e4.brouillon.revision === 2 &&
    b.espace.stockage.sql.exec("SELECT COUNT(*) AS n FROM versions WHERE origine = 'depart'").one().n === 2);
});
await groupe(1101, async () => {
  // B. Brouillon MODIFIÉ : il est gardé, le nouveau contenu est récupérable.
  const b = creerBanc();
  const cookie = await seConnecter(b);
  const e1 = (await api(b, cookie, "etat")).json;
  const retouche = copie(e1.brouillon.contenu);
  retouche.site.nom = "Retouche du client";
  const r = (await api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: retouche, revision: 1 } })).json;
  const v2 = copie(contenuLivre);
  v2.site.nom = "Contenu livré v2";
  b.livrer(v2);
  const e2 = (await api(b, cookie, "etat")).json;
  verifier("brouillon modifié : il est gardé tel quel", e2.brouillon.contenu.site.nom === "Retouche du client" && e2.brouillon.revision === r.revision);
  const depart = (await api(b, cookie, "versions")).json.versions.find((x) => x.origine === "depart");
  const vue = depart ? (await api(b, cookie, "versions/" + depart.id)).json.version : null;
  verifier("brouillon modifié : la v2 est dans les versions (récupérable)", !!vue && vue.contenu.site.nom === "Contenu livré v2");
  verifier("brouillon modifié : le journal le dit", (await journalDe(b, cookie)).some((x) => x.action === "hors_editeur" && /gardé/.test(x.detail)));
  const ab = await api(b, cookie, "brouillon/abandonner", { methode: "POST", json: { revision: r.revision } });
  verifier("brouillon modifié : « abandonner » ramène la v2", ab.statut === 200 && ab.json.brouillon.contenu.site.nom === "Contenu livré v2");
});
await groupe(1121, async () => {
  // C. KV posé à la main après la naissance du brouillon ; D. KV muet.
  const b = creerBanc();
  const cookie = await seConnecter(b);
  await api(b, cookie, "etat");
  const kv = copie(contenuLivre);
  kv.site.nom = "Posé à la main dans KV";
  b.kv.donnees.set("publie", JSON.stringify(kv));
  const e = (await api(b, cookie, "etat")).json;
  verifier("KV posé à la main : le brouillon intact le reprend", e.brouillon.contenu.site.nom === "Posé à la main dans KV");
  kv.site.nom = "Reposé pendant la panne";
  b.kv.donnees.set("publie", JSON.stringify(kv));
  b.kv.panne.lecture = true;
  const muet = await api(b, cookie, "etat");
  verifier("KV muet : l'état répond, sans rien réaligner", muet.statut === 200 && muet.json.brouillon.revision === e.brouillon.revision &&
    muet.json.brouillon.contenu.site.nom === "Posé à la main dans KV");
  const ecritures = b.kv.ecritures;
  const pub = await api(b, cookie, "publier", { methode: "POST", json: { revision: e.brouillon.revision } });
  verifier("KV muet avant toute publication : publier refuse (503), rien n'est écrit",
    pub.statut === 503 && pub.json.erreur === "publication_impossible" && b.kv.ecritures === ecritures);
  b.kv.panne.lecture = false;
  const apres = await api(b, cookie, "publier", { methode: "POST", json: { revision: e.brouillon.revision } });
  verifier("KV revenu : le brouillon a été réaligné entre-temps → 409, rien ne part à l'aveugle",
    apres.statut === 409 && apres.json.brouillon.contenu.site.nom === "Reposé pendant la panne");
  // E. Même contenu sous une autre forme (le socle a évolué) : le départ est
  // rafraîchi, sans rien annoncer au journal.
  const b2 = creerBanc();
  const c2 = await seConnecter(b2);
  await api(b2, c2, "etat");
  const brut = b2.espace.stockage.sql.exec("SELECT contenu FROM versions WHERE origine = 'depart'").one().contenu;
  const autreForme = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(brut)).reverse()));
  b2.espace.stockage.sql.exec("UPDATE versions SET contenu = ?, empreinte = ? WHERE origine = 'depart'", autreForme, "0".repeat(64));
  const e2 = (await api(b2, c2, "etat")).json;
  const n = b2.espace.stockage.sql.exec("SELECT COUNT(*) AS n FROM versions WHERE origine = 'depart'").one().n;
  verifier("autre forme du même contenu : départ rafraîchi, brouillon intact, rien au journal",
    n === 2 && e2.brouillon.revision === 1 && !(await journalDe(b2, c2)).some((x) => x.action === "hors_editeur"));
});

/* « ecraser: true » met de côté le brouillon remplacé. */
await groupe(1160, async () => {
  const b = creerBanc({ adresses: "essai@example.com,atelier@example.com" });
  const artisan = await seConnecter(b);
  const atelierC = await seConnecter(b, "atelier@example.com");
  const e = (await api(b, artisan, "etat")).json;
  const avec = (nom) => { const c = copie(e.brouillon.contenu); c.site.nom = nom; return c; };
  const sauvegardes = async () => (await api(b, artisan, "versions")).json.versions.filter((x) => x.origine === "sauvegarde");
  const a1 = await api(b, atelierC, "brouillon", { methode: "PUT", json: { contenu: avec("Correction de l'atelier"), revision: 1 } });
  const conflit = await api(b, artisan, "brouillon", { methode: "PUT", json: { contenu: avec("Version de l'artisan"), revision: 1 } });
  verifier("écraser : le conflit d'abord", a1.json.revision === 2 && conflit.statut === 409);
  const sans = await api(b, artisan, "brouillon", { methode: "PUT", json: { contenu: avec("Version de l'artisan"), revision: 2 } });
  verifier("sans le drapeau : comportement inchangé (aucune sauvegarde)", sans.statut === 200 && sans.json.revision === 3 && (await sauvegardes()).length === 0);
  await api(b, atelierC, "brouillon", { methode: "PUT", json: { contenu: avec("Seconde correction de l'atelier"), revision: 3 } });
  const chaine = await api(b, artisan, "brouillon", { methode: "PUT", json: { contenu: avec("Garder la mienne"), revision: 4, ecraser: "true" } });
  verifier("écraser : seul le booléen true compte", chaine.statut === 200 && (await sauvegardes()).length === 0);
  await api(b, atelierC, "brouillon", { methode: "PUT", json: { contenu: avec("Troisième correction de l'atelier"), revision: 5 } });
  const perime = await api(b, artisan, "brouillon", { methode: "PUT", json: { contenu: avec("Garder la mienne"), revision: 4, ecraser: true } });
  verifier("écraser : le drapeau ne lève pas le contrôle de révision", perime.statut === 409);
  const garde = await api(b, artisan, "brouillon", { methode: "PUT", json: { contenu: avec("Garder la mienne, encore"), revision: 6, ecraser: true } });
  const s = await sauvegardes();
  const vue = s[0] ? (await api(b, artisan, "versions/" + s[0].id)).json.version : null;
  verifier("écraser : enregistré", garde.statut === 200 && garde.json.revision === 7);
  verifier("écraser : la correction de l'atelier est mise de côté AVANT", s.length === 1 && !!vue && vue.contenu.site.nom === "Troisième correction de l'atelier" && vue.par === "essai@example.com");
  const j = (await journalDe(b, artisan)).find((x) => x.action === "ecrasement");
  verifier("écraser : « ecrasement » au journal, avec l'auteur du brouillon remplacé", !!j && j.par === "essai@example.com" && j.detail.includes("atelier@example.com"), j && j.detail);
});

/* 61 sections sur une page : un message qui parle de sections. */
await groupe(1188, async () => {
  const b = creerBanc();
  const cookie = await seConnecter(b);
  const e = (await api(b, cookie, "etat")).json;
  const c = copie(e.brouillon.contenu);
  c.pages.accueil.ordre = Array.from({ length: 61 }, (_, i) => "appel-" + i);
  const r = await api(b, cookie, "brouillon", { methode: "PUT", json: { contenu: c, revision: e.brouillon.revision } });
  verifier("61 sections sur une page → « Une page dépasse 60 sections. »", r.statut === 400 && r.json.message === "Une page dépasse 60 sections." && r.json.chemin === "pages.accueil.ordre",
    r.statut + " " + (r.json && r.json.message));
});

/* Un lien déjà servi, rouvert depuis un navigateur connecté : tout droit
   dans l'administration. */
await groupe(1201, async () => {
  const b = creerBanc();
  await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "essai@example.com" }, ip: b.ipNeuve() });
  const jeton = jetonDe(lienDe(b.courriel.envois[0]));
  const cookie = cookieDe((await b.appeler("/admin/entrer", { methode: "POST", formulaire: { jeton } })).cookies);
  b.horloge.avancer(JOUR);
  const rouvert = await b.appeler("/admin/entrer?jeton=" + jeton, { cookie });
  verifier("lien rouvert, déjà connecté : direction /admin", rouvert.statut === 303 && rouvert.entetes.get("location") === "/admin" && rouvert.cookies.length === 0);
  const sansCookie = await b.appeler("/admin/entrer?jeton=" + jeton);
  verifier("lien rouvert, pas connecté sur ce navigateur : « expiré » et le formulaire", sansCookie.statut === 200 && sansCookie.texte.includes("expiré ou a déjà servi"));
  const reclic = await b.appeler("/admin/entrer", { methode: "POST", formulaire: { jeton }, cookie });
  verifier("second clic sur « Entrer », déjà connecté : direction /admin, aucune nouvelle session", reclic.statut === 303 &&
    reclic.entetes.get("location") === "/admin" && reclic.cookies.length === 0);
  await b.appeler("/admin/connexion", { methode: "POST", formulaire: { email: "essai@example.com" }, ip: b.ipNeuve() });
  const neuf = jetonDe(lienDe(b.courriel.envois[1]));
  const bon = await b.appeler("/admin/entrer?jeton=" + neuf, { cookie });
  verifier("lien encore bon, même connecté : le parcours normal (le bouton)", bon.statut === 200 && bon.texte.includes('name="jeton" value="' + neuf + '"'));
});

/* Deux sites en local, deux ports : deux cookies. */
await groupe(1221, async () => {
  const A = creerBanc();
  const B = creerBanc();
  const LOCAL_B = "http://localhost:8791";
  const ca = await seConnecter(A, "essai@example.com", { base: LOCAL });
  const cb = await seConnecter(B, "essai@example.com", { base: LOCAL_B });
  verifier("deux ports : deux noms de cookie", ca.startsWith("atelier-8790=") && cb.startsWith("atelier-8791="), ca.split("=")[0] + " / " + cb.split("=")[0]);
  // Le navigateur envoie les DEUX cookies aux deux ports.
  const boite = ca + "; " + cb;
  const ra = await api(A, boite, "etat", { base: LOCAL });
  const rb = await api(B, boite, "etat", { base: LOCAL_B });
  verifier("deux ports : chacun reconnaît le sien, et n'efface rien", ra.statut === 200 && rb.statut === 200 && ra.cookies.length === 0 && rb.cookies.length === 0);
  const sortie = await A.appeler("/admin/deconnexion", { methode: "POST", cookie: boite, base: LOCAL });
  verifier("deux ports : se déconnecter de l'un n'efface que son cookie", /^atelier-8790=; /.test(sortie.cookies[0] || "") && sortie.cookies.length === 1);
  verifier("deux ports : l'autre reste connecté", (await api(B, boite, "etat", { base: LOCAL_B })).statut === 200);
  verifier("en ligne : toujours __Host-atelier", (await seConnecter(A)).startsWith("__Host-atelier="));
});

/* La barre finale se retire en temps linéaire. */
await groupe(1240, async () => {
  const b = creerBanc();
  const barres = "/".repeat(40_000);
  const t0 = performance.now();
  const r = await b.appeler("/a" + barres + "b/");
  const ms = performance.now() - t0;
  verifier("barre finale : 301 vers la même adresse, sans la barre", r.statut === 301 && r.entetes.get("location") === ORIGINE + "/a" + barres + "b");
  verifier("barre finale : 40 000 barres en moins de 50 ms (coût linéaire)", ms < 50, ms.toFixed(1) + " ms");
  verifier("barre finale : plusieurs barres finales retirées d'un coup", (await b.appeler("/tarifs///?x=1")).entetes.get("location") === ORIGINE + "/tarifs?x=1");
  verifier("barre finale : un chemin fait seulement de barres n'est pas redirigé", (await b.appeler("/" + barres)).statut === 404);
});

/* =========================================================
   Le lien d'accès d'une maquette (sans e-mail)
   ========================================================= */
await groupe(1300, async () => {
  const SECRET = "Kq3vX9_tR2-mP8wLz4YbN6cHs1JdF7gA0eUoViQ5";
  const b = creerBanc();
  b.env.ACCES_DEMO = SECRET;
  const ouvrir = (cle, banc = b) => banc.appeler("/admin/demo?cle=" + encodeURIComponent(cle));

  const r = await ouvrir(SECRET);
  const cookie = cookieDe(r.cookies);
  verifier("lien de démo : la bonne clé ouvre une session et ramène à /admin", r.statut === 303 && r.entetes.get("location") === "/admin" && !!cookie);
  const etat = await api(b, cookie, "etat");
  verifier("lien de démo : l'éditeur répond, sous l'adresse fictive", etat.statut === 200 && etat.json.utilisateur.email === "lien-de-demo@demo.invalid");
  const journal = b.espace.stockage.sql.exec("SELECT par, detail FROM journal WHERE action = 'connexion'").toArray();
  verifier("lien de démo : la connexion est au journal, et dit d'où elle vient", journal.some((l) => l.par === "lien-de-demo@demo.invalid" && /maquette/.test(l.detail)));

  const fausse = await ouvrir(SECRET.slice(0, -1) + "x");
  verifier("lien de démo : une clé fausse répond comme une page inconnue, sans cookie", fausse.statut === 404 && !cookieDe(fausse.cookies));
  verifier("lien de démo : sans clé, page inconnue", (await b.appeler("/admin/demo")).statut === 404);
  verifier("lien de démo : la clé tronquée ne passe pas", (await ouvrir(SECRET.slice(0, 20))).statut === 404);

  // Un secret trop court n'active rien : ce doit être une clé tirée au hasard.
  const court = creerBanc();
  court.env.ACCES_DEMO = "motdepasse";
  verifier("lien de démo : un secret de moins de 32 caractères n'ouvre rien", (await ouvrir("motdepasse", court)).statut === 404);

  // Chez un VRAI client, le secret posé par erreur ne fait rien.
  const vrai = creerBanc({ client: Object.assign({}, clientDemo, { demo: false }) });
  vrai.env.ACCES_DEMO = SECRET;
  const rv = await ouvrir(SECRET, vrai);
  verifier("lien de démo : sur un site qui n'est pas une maquette, la porte n'existe pas", rv.statut === 404 && !cookieDe(rv.cookies));

  // Retirer le secret ferme les sessions ouvertes par le lien.
  delete b.env.ACCES_DEMO;
  verifier("lien de démo : secret retiré → la session du lien ne vaut plus rien", (await api(b, cookie, "etat")).statut === 401);
  // … et la page de connexion par e-mail n'a pas bougé.
  verifier("lien de démo : /admin montre toujours la connexion par e-mail", (await b.appeler("/admin")).texte.includes("adresse e-mail"));
});

/* =========================================================
   Le formulaire de contact (socle 0.3.0)
   =========================================================

   Les tests ne dépendent pas du contenu.json de la démo : ils fabriquent
   leur propre contenu, où la case « formulaire » est cochée ou non selon
   le cas éprouvé. */
const avecFormulaire = (modifier = () => {}) => {
  const c = copie(contenuLivre);
  c.blocs["contact-1"].formulaire = true;
  modifier(c);
  return c;
};
const CONTENU_FORMULAIRE = avecFormulaire();
const MESSAGE = Object.freeze({
  page: "accueil", bloc: "contact-1", nom: "Jeanne Martin", email: "jeanne@exemple.fr",
  telephone: "06 12 34 56 78", message: "Bonjour, je voudrais un kougelhopf pour dimanche."
});
const ENVOYE = ORIGINE + "/?contact=envoye&bloc=contact-1#contact";
const envoyerMessage = (banc, champs = {}, o = {}) =>
  banc.appeler("/contact", Object.assign({ methode: "POST", formulaire: Object.assign({}, MESSAGE, champs) }, o));
// Un Durable Object jamais réveillé n'a pas encore de schéma (il naît au
// premier appel) : ses tables sont alors vides, par définition.
const lignesSi = (banc, table, requete, ...liaisons) => {
  const sql = banc.espace.stockage.sql;
  if (!sql.exec("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", table).toArray().length) return [];
  return sql.exec(requete, ...liaisons).toArray();
};
const messagesEnBase = (banc) => lignesSi(banc, "messages", "SELECT * FROM messages ORDER BY id");
const lignesDeSeau = (banc, motif) => lignesSi(banc, "demandes", "SELECT * FROM demandes WHERE seau LIKE ?", motif);
const journalBrut = (banc, action) => lignesSi(banc, "journal", "SELECT * FROM journal WHERE action = ?", action);
const clientAvecAdresses = (adresses) => Object.assign(copie(clientDemo), { administration: { adresses } });

/* Un envoi valide : 303, le message en base, et rien d'envoyé tant que le
   client n'a aucune adresse (la démo, et tout site au socle 0.3.0). */
await groupe(1310, async () => {
  const b = creerBanc({ contenu: CONTENU_FORMULAIRE });
  const r = await envoyerMessage(b);
  verifier("contact : envoi valide → 303 vers la page, « envoyé », à l'ancre de la section", r.statut === 303 && r.entetes.get("location") === ENVOYE,
    r.statut + " " + r.entetes.get("location"));
  const m = messagesEnBase(b);
  verifier("contact : le message est en base, nettoyé, non lu", m.length === 1 && m[0].nom === "Jeanne Martin" && m[0].email === "jeanne@exemple.fr" &&
    m[0].telephone === "06 12 34 56 78" && m[0].message === MESSAGE.message && m[0].page === "accueil" && m[0].bloc === "contact-1" &&
    m[0].lu_le === null && m[0].quand === b.horloge.maintenant(), JSON.stringify(m));
  // Ni l'adresse IP, ni même son empreinte : rien ne la relisait, et les
  // mentions légales disent « uniquement pour répondre » (contrôle du
  // 3 octobre 2026). La limite des envois se compte ailleurs (`demandes`).
  verifier("contact : aucune trace de la connexion gardée avec le message", m.length === 1 && m[0].connexion === "" &&
    !JSON.stringify(b.espace.stockage.sql.exec("SELECT * FROM messages").toArray()).includes("203.0.113.7"), JSON.stringify(m.map((x) => x.connexion)));
  verifier("contact : la limite des envois garde l'empreinte salée, jamais l'adresse IP",
    lignesDeSeau(b, "message_ip").length === 1 && /^[0-9a-f]{32}$/.test(lignesDeSeau(b, "message_ip")[0].cle) &&
    !JSON.stringify(b.espace.stockage.sql.exec("SELECT * FROM demandes").toArray()).includes("203.0.113.7"));
  verifier("contact : sans adresse du client, aucun e-mail ne part (pas même à l'atelier)", b.courriel.envois.length === 0);
  // La table `messages` est la trace d'un message reçu : le journal n'en
  // garde rien (relecture du 3 octobre 2026, voir plus bas).
  verifier("contact : un message reçu n'écrit rien au journal", lignesSi(b, "journal", "SELECT * FROM journal").length === 0,
    JSON.stringify(lignesSi(b, "journal", "SELECT * FROM journal")));
  verifier("contact : un compteur par connexion et un pour le site", lignesDeSeau(b, "message_ip").length === 1 && lignesDeSeau(b, "message_site").length === 1);

  const appels = b.espace.appels;
  const merci = await b.appeler("/?contact=envoye&bloc=contact-1");
  verifier("contact : la page qui suit dit merci (role=status)", merci.statut === 200 && merci.texte.includes('role="status"') &&
    merci.texte.includes("Merci, votre message est bien parti."));
  verifier("contact : cette page ne réveille pas le Durable Object", b.espace.appels === appels);
  const ailleurs = await b.appeler("/?contact=envoye&bloc=faq-1");
  const piege = await b.appeler("/?contact=envoye&bloc=constructor");
  verifier("contact : « envoyé » sur une section qui n'est pas un contact → la page telle quelle", ailleurs.statut === 200 &&
    !ailleurs.texte.includes("Merci, votre message est bien parti.") && piege.statut === 200 && !piege.texte.includes("Merci, votre message"));
  const normale = await b.appeler("/");
  verifier("contact : sans paramètre, le formulaire est là, vers /contact", normale.texte.includes('method="post" action="/contact') && !normale.texte.includes("Merci, votre message"));

  const get = await b.appeler("/contact");
  verifier("GET /contact → 303 vers l'accueil", get.statut === 303 && get.entetes.get("location") === "/", get.statut + " " + get.entetes.get("location"));
  const put = await b.appeler("/contact", { methode: "PUT" });
  verifier("PUT /contact → 405, Allow dit GET, HEAD, POST", put.statut === 405 && put.entetes.get("allow") === "GET, HEAD, POST");
  verifier("le site public garde son 405 ailleurs", (await b.appeler("/", { methode: "POST", formulaire: MESSAGE })).statut === 405);
  // Une page « contact » du client garde son adresse : seul le POST est au formulaire.
  const p = creerBanc({ contenu: avecFormulaire((c) => { c.pages.contact = { titre: "Nous trouver", ordre: ["horaires-1"] }; }) });
  const page = await p.appeler("/contact");
  verifier("GET /contact quand le client a une page « contact » : la page s'affiche", page.statut === 200 && page.texte.includes("<title>Nous trouver"));
  verifier("… et POST /contact reste le formulaire", (await envoyerMessage(p)).statut === 303 && messagesEnBase(p).length === 1);
});

/* Une erreur : 400 AVEC la page, les erreurs et ce que la personne avait
   écrit — sans JavaScript, c'est ce qui lui évite de tout retaper. */
await groupe(1360, async () => {
  const b = creerBanc({ contenu: CONTENU_FORMULAIRE });
  const saisie = { nom: "", email: "jeanne@", telephone: "<b>12</b>", message: 'Bref "<i>' };
  const r = await envoyerMessage(b, saisie);
  verifier("contact en erreur → 400", r.statut === 400, "statut " + r.statut);
  verifier("contact en erreur : la page du site, avec son formulaire", r.texte.includes('<form class="contact__formulaire"') && r.texte.includes("Au Pétrin"));
  verifier("contact en erreur : chaque message d'erreur, en clair", ["nom", "email", "telephone", "message"].every((c) => r.texte.includes(echapper(ERREURS_CONTACT[c]))));
  verifier("contact en erreur : ce qui avait été écrit revient, échappé", r.texte.includes('value="jeanne@"') && r.texte.includes(echapper(saisie.message)) &&
    r.texte.includes(echapper(saisie.telephone)) && !r.texte.includes("<b>12</b>") && !r.texte.includes("<i>"));
  verifier("contact en erreur : champs marqués aria-invalid", (r.texte.match(/aria-invalid="true"/g) || []).length === 4);
  verifier("contact en erreur : page jamais indexée", /noindex/.test(r.entetes.get("x-robots-tag") || ""));
  verifier("contact en erreur : rien en base, aucun compteur, rien au journal", messagesEnBase(b).length === 0 &&
    lignesDeSeau(b, "message%").length === 0 && journalBrut(b, "message_recu").length === 0);
  const unSeul = await envoyerMessage(b, { message: "court" });
  verifier("contact : un seul champ fautif → seul lui est marqué", unSeul.statut === 400 && (unSeul.texte.match(/aria-invalid="true"/g) || []).length === 1 &&
    unSeul.texte.includes('value="Jeanne Martin"'));
});

/* Le piège à robots : rempli, la MÊME réponse qu'un envoi réussi, et rien
   n'est gardé. */
await groupe(1385, async () => {
  const b = creerBanc({ contenu: CONTENU_FORMULAIRE });
  const r = await envoyerMessage(b, { site_web: "https://spam.example" });
  verifier("piège rempli → 303 « envoyé », comme un vrai envoi", r.statut === 303 && r.entetes.get("location") === ENVOYE);
  verifier("piège rempli : rien en base, aucun compteur, rien au journal, le Durable Object n'est pas appelé",
    messagesEnBase(b).length === 0 && lignesDeSeau(b, "message%").length === 0 && journalBrut(b, "message_recu").length === 0 &&
    b.espace.parMethode.deposerMessage === 0);
  const blanc = await envoyerMessage(b, { site_web: "   " });
  verifier("piège laissé blanc (des espaces) : le message passe", blanc.statut === 303 && messagesEnBase(b).length === 1);
});

/* L'origine, le format, la taille. */
await groupe(1398, async () => {
  const b = creerBanc({ contenu: CONTENU_FORMULAIRE });
  const pirate = await envoyerMessage(b, {}, { origine: "https://pirate.example" });
  verifier("contact depuis un autre site → 403, une page lisible", pirate.statut === 403 && pirate.texte.includes("pas pu partir") &&
    /noindex/.test(pirate.entetes.get("x-robots-tag") || ""));
  const aucune = await envoyerMessage(b, {}, { origine: null });
  verifier("contact sans Origin ni Sec-Fetch-Site → 403", aucune.statut === 403);
  const croise = await envoyerMessage(b, {}, { origine: null, entetes: { "sec-fetch-site": "cross-site" } });
  verifier("contact : Sec-Fetch-Site cross-site → 403", croise.statut === 403);
  verifier("refus d'origine : rien en base, le Durable Object n'est pas appelé", messagesEnBase(b).length === 0 && b.espace.parMethode.deposerMessage === 0);
  const nulle = await envoyerMessage(b, {}, { origine: null, entetes: { origin: "null", "sec-fetch-site": "same-origin" } });
  verifier("contact : Origin null + Sec-Fetch-Site same-origin → accepté", nulle.statut === 303);
  const sansOrigin = await envoyerMessage(b, {}, { origine: null, entetes: { "sec-fetch-site": "same-origin" }, ip: b.ipNeuve() });
  verifier("contact : sans Origin, Sec-Fetch-Site same-origin → accepté", sansOrigin.statut === 303 && messagesEnBase(b).length === 2);
  const json = await b.appeler("/contact", { methode: "POST", json: MESSAGE });
  verifier("contact envoyé en JSON → 415", json.statut === 415);
  const appels = b.espace.appels;
  const lourd = await envoyerMessage(b, { message: "x".repeat(LIMITE_CORPS_CONTACT) });
  verifier("contact au-delà de la borne du corps → 413, sans réveiller le Durable Object", lourd.statut === 413 && b.espace.appels === appels && messagesEnBase(b).length === 2);
});

/* Les limites : 5 messages par heure et par connexion, 100 par 24 heures
   pour le site. Un refus n'écrit rien et garde ce qui avait été écrit. */
await groupe(1420, async () => {
  const b = creerBanc({ contenu: CONTENU_FORMULAIRE });
  const IP = "198.51.100.30";
  for (let i = 1; i <= 5; i++) await envoyerMessage(b, { message: "Message numéro " + i + " de la même connexion." }, { ip: IP });
  const lignes = lignesDeSeau(b, "message%").length;
  const sixieme = await envoyerMessage(b, { message: "Le sixième message en une heure." }, { ip: IP });
  verifier("limite : 5 messages par heure depuis une connexion, le 6e → 429", messagesEnBase(b).length === 5 && sixieme.statut === 429, "statut " + sixieme.statut);
  verifier("limite : le 6e voit la page, l'erreur en tête (role=alert) et son texte", sixieme.texte.includes('role="alert"') &&
    sixieme.texte.includes(echapper(ERREURS_CONTACT.limite)) && sixieme.texte.includes("Le sixième message en une heure."));
  verifier("limite : un refus n'écrit aucun compteur", lignesDeSeau(b, "message%").length === lignes);
  verifier("limite : une autre connexion passe", (await envoyerMessage(b, {}, { ip: "198.51.100.31" })).statut === 303);
  b.horloge.avancer(HEURE);
  verifier("limite : une heure plus tard, la connexion repasse", (await envoyerMessage(b, {}, { ip: IP })).statut === 303 && messagesEnBase(b).length === 7);

  const s = creerBanc({ contenu: CONTENU_FORMULAIRE });
  for (let i = 0; i < 100; i++) await envoyerMessage(s, {}, { ip: s.ipNeuve() });
  verifier("limite du site : 100 messages en 24 heures", messagesEnBase(s).length === 100, messagesEnBase(s).length + " messages");
  const centUnieme = await envoyerMessage(s, {}, { ip: s.ipNeuve() });
  verifier("limite du site : le 101e → 429, même d'une connexion neuve", centUnieme.statut === 429 && messagesEnBase(s).length === 100);
  s.horloge.avancer(JOUR);
  verifier("limite du site : le lendemain, un message repasse", (await envoyerMessage(s, {}, { ip: s.ipNeuve() })).statut === 303 && messagesEnBase(s).length === 101);
});

/* Une section qui n'accepte pas de message → 404. */
await groupe(1446, async () => {
  const cas = [
    ["page inconnue", CONTENU_FORMULAIRE, { page: "tarifs" }],
    ["page « constructor »", CONTENU_FORMULAIRE, { page: "constructor" }],
    ["section absente de la page", CONTENU_FORMULAIRE, { bloc: "contact-2" }],
    ["section qui n'est pas un contact", CONTENU_FORMULAIRE, { bloc: "faq-1" }],
    ["section sans formulaire", avecFormulaire((c) => { c.blocs["contact-1"].formulaire = false; }), {}],
    ["formulaire coché en texte (« true »)", avecFormulaire((c) => { c.blocs["contact-1"].formulaire = "true"; }), {}],
    ["section masquée", avecFormulaire((c) => { c.blocs["contact-1"].masque = true; }), {}],
    ["section retirée de la page", avecFormulaire((c) => { c.pages.accueil.ordre = c.pages.accueil.ordre.filter((id) => id !== "contact-1"); }), {}],
    ["champs page et bloc absents", CONTENU_FORMULAIRE, { page: "", bloc: "" }]
  ];
  for (const [nom, contenu, champs] of cas) {
    const b = creerBanc({ contenu });
    const r = await envoyerMessage(b, champs);
    verifier("contact, " + nom + " → 404, rien en base", r.statut === 404 && messagesEnBase(b).length === 0 && b.espace.parMethode.deposerMessage === 0,
      "statut " + r.statut);
  }
  const b = creerBanc({ contenu: CONTENU_FORMULAIRE });
  const r = await envoyerMessage(b, { bloc: "faq-1" });
  verifier("contact 404 : la page d'erreur garde l'habit du site, non indexée", r.texte.includes("Cette page n'existe pas.") &&
    r.texte.includes('class="entete"') && /noindex/.test(r.entetes.get("x-robots-tag") || ""));
  // Le contenu PUBLIÉ fait foi, pas le contenu livré.
  b.kv.donnees.set("publie", JSON.stringify(avecFormulaire((c) => { c.blocs["contact-1"].formulaire = false; })));
  verifier("contact : formulaire décoché dans le contenu PUBLIÉ → 404", (await envoyerMessage(b)).statut === 404);
});

/* Sans Durable Object, ou s'il ne répond pas : 503 lisible, rien de perdu
   de ce qui avait été écrit. */
await groupe(1475, async () => {
  const b = creerBanc({ contenu: CONTENU_FORMULAIRE, sansAtelier: true });
  const consoleAvant = journalConsole.length;
  const r = await envoyerMessage(b, { message: "Mon message ne doit pas se perdre, même en panne." });
  // Une liaison absente est un état de la configuration, pas une panne : rien à signaler.
  verifier("contact sans ATELIER : aucune erreur dans la console", !journalConsole.slice(consoleAvant).some((l) => l.startsWith("error")),
    journalConsole.slice(consoleAvant).join(" | "));
  verifier("contact sans ATELIER → 503 avec la page", r.statut === 503 && r.texte.includes('<form class="contact__formulaire"'), "statut " + r.statut);
  verifier("contact sans ATELIER : « n'a pas pu partir », en tête", r.texte.includes(echapper(ERREURS_CONTACT.indisponible)) && r.texte.includes('role="alert"'));
  verifier("contact sans ATELIER : ce qui avait été écrit revient", r.texte.includes("Mon message ne doit pas se perdre, même en panne.") &&
    r.texte.includes('value="jeanne@exemple.fr"'));
  verifier("contact sans ATELIER : aucun e-mail ne part", b.courriel.envois.length === 0);

  const p = creerBanc({ contenu: CONTENU_FORMULAIRE });
  p.env.ATELIER = { idFromName: (n) => ({ toString: () => n }), get: () => ({ deposerMessage: async () => { throw new Error("Durable Object en panne (simulée)"); } }) };
  const panne = await envoyerMessage(p);
  verifier("contact, Durable Object en panne → 503 lisible, valeurs gardées", panne.statut === 503 &&
    panne.texte.includes(echapper(ERREURS_CONTACT.indisponible)) && panne.texte.includes(MESSAGE.message));
});

/* Un an au plus : purgé au dépôt suivant ET avant toute lecture de
   l'administration. */
await groupe(1493, async () => {
  const b = creerBanc({ contenu: CONTENU_FORMULAIRE });
  await envoyerMessage(b, { message: "Le tout premier message, d'il y a un an." });
  b.horloge.avancer(200 * JOUR);
  await envoyerMessage(b, { message: "Un message plus récent, de deux cents jours." });
  b.horloge.avancer(165 * JOUR - MINUTE);
  const cookie = await seConnecter(b);
  const avant = (await api(b, cookie, "messages")).json.messages;
  verifier("purge : à 364 jours et 23 h 59, le premier message est encore là", avant.length === 2);
  b.horloge.avancer(2 * MINUTE);
  const apres = (await api(b, cookie, "messages")).json.messages;
  verifier("purge : passé un an, il a disparu de l'onglet Messages", apres.length === 1 && apres[0].message.startsWith("Un message plus récent"));
  verifier("purge : … et de la base", messagesEnBase(b).length === 1);
  verifier("purge : … et de l'export", (await api(b, cookie, "export")).json.messages.length === 1);

  const d = creerBanc({ contenu: CONTENU_FORMULAIRE });
  await envoyerMessage(d);
  d.horloge.avancer(365 * JOUR + MINUTE);
  await envoyerMessage(d, { message: "Un an plus tard, sans que personne n'ait ouvert l'administration." }, { ip: d.ipNeuve() });
  verifier("purge : un nouveau message suffit à retirer celui de plus d'un an", messagesEnBase(d).length === 1 && messagesEnBase(d)[0].id === 2);
  const plan = d.espace.stockage.db.prepare("EXPLAIN QUERY PLAN DELETE FROM messages WHERE quand <= ?").all(0).map((x) => x.detail).join(" ; ");
  verifier("purge : elle suit un index (pas de parcours de la table)", !/\bSCAN messages\b/.test(plan), plan);
});

/* L'API de l'onglet Messages. */
await groupe(1520, async () => {
  const b = creerBanc({ contenu: CONTENU_FORMULAIRE });
  for (let i = 1; i <= 3; i++) {
    await envoyerMessage(b, { nom: "Personne " + i, message: "Message numéro " + i + ", assez long.", telephone: i === 2 ? "" : MESSAGE.telephone }, { ip: b.ipNeuve() });
    b.horloge.avancer(MINUTE);
  }
  const sans = await b.appeler("/admin/api/messages");
  verifier("messages sans session → 401", sans.statut === 401 && sans.json.erreur === "non_connecte");
  verifier("lu sans session → 401", (await b.appeler("/admin/api/messages/1/lu", { methode: "POST", json: { lu: true } })).statut === 401);
  verifier("supprimer sans session → 401", (await b.appeler("/admin/api/messages/1/supprimer", { methode: "POST" })).statut === 401);

  const cookie = await seConnecter(b);
  const liste = await api(b, cookie, "messages");
  const m = liste.json.messages;
  verifier("messages : 200, du plus récent au plus ancien", liste.statut === 200 && m.length === 3 && m.map((x) => x.id).join(",") === "3,2,1");
  verifier("messages : la forme du contrat, rien de plus (ni bloc, ni connexion)", m.every((x) =>
    Object.keys(x).join(",") === "id,quand,page,nom,email,telephone,message,lu" && x.lu === false && typeof x.quand === "number" && x.page === "accueil"),
    JSON.stringify(m[0]));
  verifier("messages : le téléphone facultatif reste vide", m[1].telephone === "" && m[1].nom === "Personne 2");
  verifier("etat : messages.nonLus", (await api(b, cookie, "etat")).json.messages.nonLus === 3);

  const lu = await api(b, cookie, "messages/2/lu", { methode: "POST", json: { lu: true } });
  verifier("marquer lu → 200 { ok: true }", lu.statut === 200 && lu.json.ok === true);
  const luLe = () => b.espace.stockage.sql.exec("SELECT lu_le FROM messages WHERE id = 2").one().lu_le;
  const premiereLecture = luLe();
  verifier("marquer lu : la liste et le compte le disent", (await api(b, cookie, "messages")).json.messages.find((x) => x.id === 2).lu === true &&
    (await api(b, cookie, "etat")).json.messages.nonLus === 2 && premiereLecture === b.horloge.maintenant());
  b.horloge.avancer(HEURE);
  await api(b, cookie, "messages/2/lu", { methode: "POST", json: { lu: true } });
  verifier("marquer lu deux fois : la date de la PREMIÈRE lecture reste", luLe() === premiereLecture);
  await api(b, cookie, "messages/2/lu", { methode: "POST", json: { lu: false } });
  verifier("marquer non lu : il redevient non lu", luLe() === null && (await api(b, cookie, "etat")).json.messages.nonLus === 3);
  const texte = await api(b, cookie, "messages/2/lu", { methode: "POST", json: { lu: "true" } });
  verifier("lu en texte (« true ») → 400, rien ne change", texte.statut === 400 && texte.json.erreur === "requete_invalide" && luLe() === null);
  verifier("lu sans corps JSON → 415", (await api(b, cookie, "messages/2/lu", { methode: "POST", formulaire: { lu: "true" } })).statut === 415);
  const inconnu = await api(b, cookie, "messages/99/lu", { methode: "POST", json: { lu: true } });
  verifier("lu d'un message inconnu → 404 « Ce message n'existe plus. »", inconnu.statut === 404 && inconnu.json.message === "Ce message n'existe plus.");

  const pirate = await api(b, cookie, "messages/1/supprimer", { methode: "POST", origine: "https://pirate.example" });
  verifier("supprimer depuis un autre site → 403, rien n'est supprimé", pirate.statut === 403 && messagesEnBase(b).length === 3);
  const sup = await api(b, cookie, "messages/1/supprimer", { methode: "POST" });
  verifier("supprimer → 200 { ok: true }, définitif", sup.statut === 200 && sup.json.ok === true && messagesEnBase(b).map((x) => x.id).join(",") === "2,3");
  verifier("supprimer : absent de la liste", !(await api(b, cookie, "messages")).json.messages.some((x) => x.id === 1));
  verifier("supprimer deux fois → 404", (await api(b, cookie, "messages/1/supprimer", { methode: "POST" })).statut === 404);
  const j = (await journalDe(b, cookie)).filter((x) => x.action === "message_supprime");
  verifier("journal : « message_supprime », par qui, le numéro seul", j.length === 1 && j[0].par === "essai@example.com" && j[0].detail === "Message n° 1");
  verifier("journal : aucune ligne « message_recu » (trois messages reçus)", (await journalDe(b, cookie)).filter((x) => x.action === "message_recu").length === 0);
  verifier("messages : adresses mal formées → 404 ou 405", (await api(b, cookie, "messages/0/lu", { methode: "POST", json: { lu: true } })).statut === 404 &&
    (await api(b, cookie, "messages/abc/supprimer", { methode: "POST" })).statut === 404 &&
    (await api(b, cookie, "messages/2/supprimer")).statut === 405 && (await api(b, cookie, "messages", { methode: "POST" })).statut === 405);
  // Un numéro n'est jamais réattribué après une suppression.
  await envoyerMessage(b, {}, { ip: b.ipNeuve() });
  verifier("supprimer : un nouveau message ne reprend pas un numéro libéré", messagesEnBase(b).at(-1).id === 4);

  const sql = b.espace.stockage.sql;
  for (let i = 0; i < 205; i++) {
    sql.exec("INSERT INTO messages (quand, page, bloc, nom, email, message, connexion) VALUES (?, 'accueil', 'contact-1', 'Robot', 'r@exemple.fr', 'Message en série.', 'x')", b.horloge.maintenant());
  }
  const page1 = (await api(b, cookie, "messages")).json;
  const deuxCents = page1.messages;
  verifier("messages : 200 au plus par page, les plus récents", deuxCents.length === 200 && deuxCents[0].id === 209);
  verifier("messages : la page dit qu'il y en a d'autres, et compte toute la base", page1.suite === true && page1.total === 208 && page1.nonLus === 208,
    JSON.stringify({ suite: page1.suite, total: page1.total, nonLus: page1.nonLus }));
  const page2 = (await api(b, cookie, "messages?avant=" + deuxCents.at(-1).id)).json;
  verifier("messages ?avant= : la page suivante, les 8 plus anciens, et plus de suite", page2.messages.length === 8 &&
    page2.messages[0].id === deuxCents.at(-1).id - 1 && page2.messages.at(-1).id === 2 && page2.suite === false && page2.total === 208,
    JSON.stringify(page2.messages.map((m) => m.id)));
  const x = await api(b, cookie, "export");
  verifier("export : TOUS les messages (pas seulement 200), même forme que la liste", x.statut === 200 && Array.isArray(x.json.messages) &&
    x.json.messages.length === 208 && Object.keys(x.json.messages[0]).join(",") === "id,quand,page,nom,email,telephone,message,lu" &&
    !("messages_tronques" in x.json), x.json.messages && x.json.messages.length);
});

/* L'alerte e-mail : aux adresses du client, JAMAIS à celles de l'atelier,
   après la réponse, et un échec va au journal. */
await groupe(1590, async () => {
  const client = clientAvecAdresses([" Marie@Exemple.FR ", "marie@exemple.fr", "paul@exemple.fr", "pas une adresse"]);
  const b = creerBanc({ contenu: CONTENU_FORMULAIRE, client, adresses: "atelier@example.com" });
  const r = await envoyerMessage(b, { message: "Bonjour <script>alert(1)</script>\nDeuxième ligne & fin." });
  const envois = b.courriel.envois;
  verifier("alerte : le message est enregistré et la visiteuse redirigée", r.statut === 303 && messagesEnBase(b).length === 1);
  verifier("alerte : une par adresse du CLIENT (dédoublonnées, la mal formée écartée)", envois.length === 2 &&
    envois.map((e) => e.to).sort().join(",") === "marie@exemple.fr,paul@exemple.fr", envois.map((e) => e.to).join(","));
  verifier("alerte : JAMAIS aux adresses de l'atelier", !envois.some((e) => /atelier@example\.com/.test(JSON.stringify(e.to))));
  const e = envois[0] || {};
  verifier("alerte : objet « Nouveau message depuis votre site »", e.subject === "Nouveau message depuis votre site" && e.subject === OBJET_ALERTE);
  verifier("alerte : Reply-To = l'adresse de la visiteuse", e.replyTo === "jeanne@exemple.fr", JSON.stringify(e.replyTo));
  verifier("alerte : l'expéditeur de l'atelier, au nom du site", e.from && e.from.email === "connexion@atelier.example" && e.from.name === NOM);
  verifier("alerte : le texte brut dit tout (nom, e-mail, téléphone, message, où le retrouver)", (e.text || "").includes("Jeanne Martin") &&
    e.text.includes("jeanne@exemple.fr") && e.text.includes("06 12 34 56 78") && e.text.includes("Bonjour <script>alert(1)</script>\nDeuxième ligne & fin.") &&
    e.text.includes(ORIGINE + "/admin") && e.text.includes("onglet Messages"));
  verifier("alerte : le HTML échappe le message", (e.html || "").includes("Bonjour &lt;script&gt;alert(1)&lt;/script&gt;") && !e.html.includes("<script>") &&
    e.html.includes("Deuxième ligne &amp; fin."));
  verifier("alerte : la première de la journée ne parle pas de plafond", !(e.text || "").includes("ne seront plus annoncés"));
  verifier("alerte réussie : rien au journal des échecs", journalBrut(b, "envoi_echoue").length === 0);

  // Elle part APRÈS la réponse, dans waitUntil : un service d'envoi qui ne
  // répond pas ne retient pas la visiteuse. (Le faux service est bloqué ;
  // une réponse qui l'attendrait n'arriverait jamais : une seconde au plus.)
  const ctx = fauxCtx();
  globalThis.caches = b.caches;
  const site = creerSite({ client, contenu: CONTENU_FORMULAIRE });
  const sendNormal = b.courriel.send;
  let liberer;
  const bloque = new Promise((ok_) => { liberer = ok_; });
  b.courriel.send = async (m) => { await bloque; return sendNormal(m); };
  const rep = await Promise.race([
    site.fetch(new Request(ORIGINE + "/contact", { method: "POST", body: new URLSearchParams(MESSAGE).toString(),
      headers: { origin: ORIGINE, "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": b.ipNeuve() } }), b.env, ctx),
    new Promise((ok_) => setTimeout(() => ok_(null), 1000))
  ]);
  verifier("alerte : la réponse part sans attendre l'e-mail (ctx.waitUntil)", !!rep && rep.status === 303 && b.courriel.envois.length === 2 && ctx.promesses.length === 1,
    rep ? rep.status + " / " + b.courriel.envois.length + " envois" : "réponse jamais arrivée");
  liberer();
  await ctx.terminer();
  b.courriel.send = sendNormal;
  verifier("alerte : … qui part ensuite", b.courriel.envois.length === 4, b.courriel.envois.length + " envois");

  // Un envoi refusé : le message reste, l'échec va au journal, une ligne par adresse.
  b.courriel.echec = { code: "E_RATE_LIMIT_EXCEEDED", message: "Trop d'envois" };
  const refuse = await envoyerMessage(b, {}, { ip: b.ipNeuve() });
  const echecs = journalBrut(b, "envoi_echoue");
  verifier("alerte refusée : le message est enregistré quand même", refuse.statut === 303 && messagesEnBase(b).length === 3);
  verifier("alerte refusée : « envoi_echoue » au journal, avec le numéro et la cause", echecs.length === 2 &&
    echecs.every((l) => l.detail.includes("Alerte du message n° 3") && l.detail.includes("E_RATE_LIMIT_EXCEEDED")) &&
    echecs.map((l) => l.par).sort().join(",") === "marie@exemple.fr,paul@exemple.fr", JSON.stringify(echecs));
});
await groupe(1640, async () => {
  // Rien de configuré : rien ne part, rien n'échoue.
  const client = clientAvecAdresses(["marie@exemple.fr"]);
  for (const [nom, options] of [["sans expéditeur", { expediteur: "" }], ["sans liaison COURRIEL", { sansCourriel: true }]]) {
    const b = creerBanc(Object.assign({ contenu: CONTENU_FORMULAIRE, client }, options));
    const r = await envoyerMessage(b);
    verifier("alerte " + nom + " : le message passe, rien ne part, rien au journal des échecs", r.statut === 303 && messagesEnBase(b).length === 1 &&
      b.courriel.envois.length === 0 && journalBrut(b, "envoi_echoue").length === 0);
    verifier("alerte " + nom + " : aucune place prise dans le plafond des alertes", lignesDeSeau(b, "alerte%").length === 0);
  }
  // En développement local, l'alerte va dans la console.
  const l = creerBanc({ contenu: CONTENU_FORMULAIRE, client, journalLocal: true });
  const avant = journalConsole.length;
  await envoyerMessage(l, {}, { base: LOCAL });
  verifier("alerte en local : rien ne part, elle est dans la console", l.courriel.envois.length === 0 &&
    journalConsole.slice(avant).some((x) => x.includes("[Développement local] Alerte") && x.includes(MESSAGE.message)));
});
await groupe(1660, async () => {
  // Vingt alertes par 24 heures et par site : le quota d'e-mails de l'atelier est commun à tous les clients.
  const b = creerBanc({ contenu: CONTENU_FORMULAIRE, client: clientAvecAdresses(["marie@exemple.fr"]) });
  for (let i = 1; i <= 21; i++) await envoyerMessage(b, { message: "Message de la série, numéro " + i + "." }, { ip: b.ipNeuve() });
  const envois = b.courriel.envois;
  verifier("plafond des alertes : 21 messages, 20 alertes", messagesEnBase(b).length === 21 && envois.length === 20, envois.length + " alertes");
  verifier("plafond des alertes : la 20e prévient que les suivantes ne partiront pas", envois.length === 20 &&
    envois[19].text.includes("ne seront plus annoncés par e-mail avant demain") && !envois[18].text.includes("ne seront plus annoncés"));
  b.horloge.avancer(JOUR);
  await envoyerMessage(b, {}, { ip: b.ipNeuve() });
  verifier("plafond des alertes : le lendemain, elles repartent", envois.length === 21);
});
await groupe(1675, async () => {
  // Le Reply-To ne prend qu'une adresse sans espace ni saut de ligne.
  const courriel = fauxCourriel();
  const env = { COURRIEL: courriel, COURRIEL_EXPEDITEUR: "connexion@atelier.example" };
  const r = await envoyerAlerteMessage(env, { a: ["marie@exemple.fr"], nomSite: "Site", message: { nom: "X", email: "x@exemple.fr\r\nBcc: tous@exemple.fr", message: "Bonjour." } });
  verifier("alerte : une adresse piégée n'entre jamais dans Reply-To", r.envoyes === 1 && courriel.envois.length === 1 && !("replyTo" in courriel.envois[0]));
  const vide = await envoyerAlerteMessage(env, { a: [], nomSite: "Site", message: { nom: "X", email: "x@exemple.fr", message: "Bonjour." } });
  verifier("alerte sans destinataire : rien ne part, rien n'échoue", vide.envoyes === 0 && vide.echecs.length === 0 && courriel.envois.length === 1);
});

/* Le Durable Object ne croit pas son appelant sur parole. */
await groupe(1688, async () => {
  const b = creerBanc();
  const stub = b.env.ATELIER.get(b.env.ATELIER.idFromName("site"));
  const invalide = await stub.deposerMessage({ ip: "192.0.2.1", page: "accueil", bloc: "contact-1", nom: "X", email: "pas-une-adresse", message: "Assez long pour passer." });
  const sansPage = await stub.deposerMessage(Object.assign({}, MESSAGE, { page: "../admin" }));
  verifier("deposerMessage : un message invalide est refusé, rien n'est écrit", invalide.ok === false && invalide.motif === "invalide" &&
    sansPage.ok === false && messagesEnBase(b).length === 0);
  const bon = await stub.deposerMessage(Object.assign({ ip: "192.0.2.1" }, MESSAGE, { nom: "  Jeanne\nMartin  " }));
  verifier("deposerMessage : la règle du formulaire nettoie ce qu'il garde", bon.ok === true && bon.id === 1 && bon.alerte === false &&
    messagesEnBase(b)[0].nom === "Jeanne Martin");
});

/* www.<domaine> → <domaine>, avant toute autre logique. */
await groupe(1700, async () => {
  const client = Object.assign(copie(clientDemo), { domaine: " Exemple.FR " });
  const b = creerBanc({ client, contenu: CONTENU_FORMULAIRE });
  const www = "https://www.exemple.fr";
  const page = await b.appeler("/tarifs?x=1&y=%C3%A9", { base: www });
  verifier("www → 301 vers le domaine, chemin et requête gardés", page.statut === 301 && page.entetes.get("location") === "https://exemple.fr/tarifs?x=1&y=%C3%A9",
    page.statut + " " + page.entetes.get("location"));
  const admin = await b.appeler("/admin/api/etat", { base: www });
  verifier("www : l'administration aussi, sans réveiller le Durable Object", admin.statut === 301 && admin.entetes.get("location") === "https://exemple.fr/admin/api/etat" &&
    b.espace.appels === 0);
  const contact = await envoyerMessage(b, {}, { base: www });
  verifier("www : POST /contact aussi (rien n'est enregistré sur www)", contact.statut === 301 && messagesEnBase(b).length === 0);
  const piege = await b.appeler("//pirate.example/", { base: www });
  verifier("www : « //pirate.example » reste un chemin du domaine", piege.statut === 301 && new URL(piege.entetes.get("location")).host === "exemple.fr");
  verifier("www : le domaine lui-même n'est pas redirigé", (await b.appeler("/", { base: "https://exemple.fr" })).statut === 200);
  verifier("www : un autre sous-domaine n'est pas redirigé", (await b.appeler("/", { base: "https://boutique.exemple.fr" })).statut === 200);
  const sansDomaine = creerBanc();
  verifier("www : sans domaine dans la fiche, rien n'est redirigé", (await sansDomaine.appeler("/", { base: "https://www.demo.test" })).statut === 200);
});

/* =========================================================
   Relecture contradictoire du socle 0.3.0 — chantier serveur
   =========================================================

   Chaque groupe ci-dessous échouait sur le code d'avant le 3 octobre 2026
   au soir : un test qui casse le jour où quelqu'un « simplifie ». */

/* Le plafond des alertes compte des E-MAILS, pas des messages : chaque
   adresse du client coûte sur le quota commun de l'atelier. Avant : un
   client à trois adresses recevait 60 e-mails pour 25 messages. */
await groupe(1760, async () => {
  const trois = creerBanc({ contenu: CONTENU_FORMULAIRE, client: clientAvecAdresses(["a@exemple.fr", "b@exemple.fr", "c@exemple.fr"]) });
  for (let i = 1; i <= 25; i++) await envoyerMessage(trois, { message: "Message de robot, numéro " + i + "." }, { ip: trois.ipNeuve() });
  const envois = trois.courriel.envois;
  verifier("plafond en e-mails : 3 adresses, 25 messages → 18 e-mails au plus (6 alertes entières)", messagesEnBase(trois).length === 25 &&
    envois.length === 18, envois.length + " e-mails");
  verifier("plafond en e-mails : la dernière salve (les 3 adresses) prévient que les suivantes ne partiront pas", envois.length === 18 &&
    envois.slice(15).every((e) => e.text.includes("ne seront plus annoncés par e-mail avant demain")) &&
    envois.slice(0, 15).every((e) => !e.text.includes("ne seront plus annoncés")));
  verifier("plafond en e-mails : jamais plus de 20 places prises dans le seau des alertes", lignesDeSeau(trois, "alerte_site").length === 18);

  const cinq = creerBanc({ contenu: CONTENU_FORMULAIRE, client: clientAvecAdresses(["a@exemple.fr", "b@exemple.fr", "c@exemple.fr", "d@exemple.fr", "e@exemple.fr"]) });
  for (let i = 1; i <= 25; i++) await envoyerMessage(cinq, {}, { ip: cinq.ipNeuve() });
  verifier("plafond en e-mails : 5 adresses → 4 alertes, 20 e-mails", cinq.courriel.envois.length === 20, cinq.courriel.envois.length + " e-mails");

  const sept = creerBanc({ contenu: CONTENU_FORMULAIRE, client: clientAvecAdresses(["a@exemple.fr", "b@exemple.fr", "c@exemple.fr", "d@exemple.fr", "e@exemple.fr", "f@exemple.fr", "g@exemple.fr"]) });
  await envoyerMessage(sept);
  verifier("alerte : " + DESTINATAIRES_ALERTE_MAX + " destinataires au plus, les premiers de la fiche", DESTINATAIRES_ALERTE_MAX === 5 &&
    sept.courriel.envois.map((e) => e.to).join(",") === "a@exemple.fr,b@exemple.fr,c@exemple.fr,d@exemple.fr,e@exemple.fr",
    sept.courriel.envois.map((e) => e.to).join(","));
});

/* Le formulaire public n'écrit plus dans le journal : ni un message reçu,
   ni un plafond au-delà d'une ligne par jour, ni un échec d'alerte au-delà
   d'une ligne par jour et par adresse. Avant : 100 messages en une journée
   remplissaient les 100 lignes de l'API et chassaient la connexion de la
   titulaire ; en 5 jours, la table entière n'était plus que « message_recu ». */
await groupe(1790, async () => {
  const b = creerBanc({ contenu: CONTENU_FORMULAIRE });
  const cookie = await seConnecter(b);
  for (let i = 0; i < 20; i++) {
    const ip = b.ipNeuve();
    for (let k = 0; k < 5; k++) await envoyerMessage(b, { message: "Robot " + i + ", message " + k + "." }, { ip });
  }
  const refus = [];
  for (let i = 0; i < 3; i++) refus.push((await envoyerMessage(b, {}, { ip: b.ipNeuve() })).statut);
  verifier("journal : 100 messages acceptés, les suivants refusés au plafond du site", messagesEnBase(b).length === 100 && refus.every((s) => s === 429), refus.join(","));
  const vingt = (await journalDe(b, cookie)).slice(0, 20);
  verifier("journal : après 100 messages, la connexion reste dans les 20 lignes que montre l'onglet Compte", actions(vingt).includes("connexion"), actions(vingt).join(","));
  verifier("journal : aucune ligne « message_recu »", journalBrut(b, "message_recu").length === 0);
  const plafond = journalBrut(b, "message_plafond");
  verifier("journal : le plafond du site, UNE ligne, sans nom ni adresse", plafond.length === 1 && plafond[0].par === null && /100 messages en 24 heures/.test(plafond[0].detail),
    JSON.stringify(plafond));

  // Quatre jours de plus au plafond, en passant par le Durable Object.
  const stub = b.env.ATELIER.get(b.env.ATELIER.idFromName("site"));
  for (let jour = 1; jour <= 4; jour++) {
    b.horloge.avancer(JOUR);
    for (let i = 0; i < 105; i++) await stub.deposerMessage(Object.assign({ ip: "198.18." + jour + "." + Math.floor(i / 5) }, MESSAGE));
    b.horloge.avancer(HEURE);
    await stub.deposerMessage(Object.assign({ ip: "198.19.0." + jour }, MESSAGE));
  }
  verifier("journal : cinq jours au plafond → 500 messages, 5 lignes de plafond (une par jour)", messagesEnBase(b).length === 500 &&
    journalBrut(b, "message_plafond").length === 5, journalBrut(b, "message_plafond").length + " lignes");
  const tout = actions(await journalDe(b, cookie));
  verifier("journal : la connexion et la demande de lien sont toujours là", tout.includes("connexion") && tout.includes("lien_demande"), tout.join(","));
  verifier("journal : la table entière tient en quelques lignes", lignesSi(b, "journal", "SELECT * FROM journal").length === 7);
});

await groupe(1830, async () => {
  // Un envoi d'alerte en panne : une ligne par adresse et par jour, pas une par message.
  const b = creerBanc({ contenu: CONTENU_FORMULAIRE, client: clientAvecAdresses(["marie@exemple.fr", "paul@exemple.fr"]) });
  b.courriel.echec = { code: "E_SENDER_NOT_VERIFIED", message: "Expéditeur non vérifié" };
  for (let i = 0; i < 8; i++) await envoyerMessage(b, {}, { ip: b.ipNeuve() });
  const echecs = journalBrut(b, "envoi_echoue");
  verifier("échecs d'alerte : 8 messages, 16 envois ratés → 2 lignes (une par adresse)", messagesEnBase(b).length === 8 && echecs.length === 2 &&
    echecs.every((l) => l.detail.includes("Alerte du message n° 1") && l.detail.includes("E_SENDER_NOT_VERIFIED") && l.detail.includes("seul le premier échec du jour")),
    JSON.stringify(echecs));
  b.horloge.avancer(JOUR);
  await envoyerMessage(b, {}, { ip: b.ipNeuve() });
  verifier("échecs d'alerte : le lendemain, l'échec suivant est noté", journalBrut(b, "envoi_echoue").length === 4);
  // Un échec de LIEN de connexion, lui, est toujours noté.
  const stub = b.env.ATELIER.get(b.env.ATELIER.idFromName("site"));
  await stub.signalerEchecEnvoi({ email: "marie@exemple.fr", cause: "lien 1" });
  await stub.signalerEchecEnvoi({ email: "marie@exemple.fr", cause: "lien 2" });
  verifier("échecs de lien : chacun est noté", journalBrut(b, "envoi_echoue").length === 6);
});

/* Les messages au-delà des 200 plus récents restent atteignables : page
   par page, jusqu'au plus ancien, et il se supprime. Avant : ni lisible,
   ni supprimable, mais compté et exporté. */
await groupe(1855, async () => {
  const b = creerBanc({ contenu: CONTENU_FORMULAIRE });
  await envoyerMessage(b, { nom: "Claire Dupont", message: "La pièce montée du mariage du 14, s'il vous plaît." });
  const cookie = await seConnecter(b);
  const sql = b.espace.stockage.sql;
  for (let i = 0; i < 449; i++) {
    sql.exec("INSERT INTO messages (quand, page, bloc, nom, email, message, connexion) VALUES (?, 'accueil', 'contact-1', 'Robot', 'r@exemple.fr', 'Message en série.', 'x')", b.horloge.maintenant());
  }
  const vus = [];
  let page = (await api(b, cookie, "messages")).json;
  const pages = [page];
  vus.push(...page.messages);
  while (page.suite === true && pages.length < 10) {
    page = (await api(b, cookie, "messages?avant=" + page.messages.at(-1).id)).json;
    pages.push(page);
    vus.push(...page.messages);
  }
  verifier("pagination : 450 messages → trois pages (200, 200, 50), sans doublon ni trou", pages.map((p) => p.messages.length).join(",") === "200,200,50" &&
    new Set(vus.map((m) => m.id)).size === 450 && vus.every((m, i) => i === 0 || m.id < vus[i - 1].id), pages.map((p) => p.messages.length).join(","));
  verifier("pagination : chaque page compte toute la base", pages.every((p) => p.total === 450 && p.nonLus === 450));
  const claire = vus.at(-1);
  verifier("pagination : le plus ancien (celui de Claire) est atteint", claire.nom === "Claire Dupont" && claire.id === 1);
  const sup = await api(b, cookie, "messages/" + claire.id + "/supprimer", { methode: "POST" });
  verifier("pagination : … et il se supprime", sup.statut === 200 && !messagesEnBase(b).some((m) => m.id === 1));
  const apres = (await api(b, cookie, "messages")).json;
  verifier("pagination : les comptes suivent", apres.total === 449 && apres.nonLus === 449);
  for (const mauvais of ["abc", "0", "-3", "", "1.5", "99999999999999999"]) {
    const r = await api(b, cookie, "messages?avant=" + encodeURIComponent(mauvais));
    verifier("pagination : ?avant=" + JSON.stringify(mauvais) + " → 400, jamais la première page", r.statut === 400 && r.json.erreur === "requete_invalide", r.statut);
  }
  const fin = (await api(b, cookie, "messages?avant=1")).json;
  verifier("pagination : avant le premier, une page vide et sans suite", fin.messages.length === 0 && fin.suite === false);
});

await groupe(1890, async () => {
  // L'export : les 2 000 plus récents, et le compte de ceux qui manquent.
  const b = creerBanc({ contenu: CONTENU_FORMULAIRE });
  const cookie = await seConnecter(b);
  const sql = b.espace.stockage.sql;
  for (let i = 0; i < 2003; i++) {
    sql.exec("INSERT INTO messages (quand, page, bloc, nom, email, message, connexion) VALUES (?, 'accueil', 'contact-1', 'Robot', 'r@exemple.fr', 'Message en série.', 'x')", b.horloge.maintenant());
  }
  const x = await api(b, cookie, "export");
  verifier("export : 2 000 messages au plus, les plus récents", x.statut === 200 && x.json.messages.length === 2000 &&
    x.json.messages[0].id === 2003 && x.json.messages.at(-1).id === 4, x.json.messages && x.json.messages.length);
  verifier("export : « messages_tronques » dit combien manquent", x.json.messages_tronques === 3, JSON.stringify(x.json.messages_tronques));
});

/* Reply-To : la règle même du formulaire. Avant : une apostrophe, légale
   dans une adresse et acceptée par le formulaire, faisait sauter l'en-tête
   en silence, et une adresse de plus de 120 caractères était COUPÉE avant
   d'y entrer — la réponse partait vers une autre adresse. */
await groupe(1910, async () => {
  const b = creerBanc({ contenu: CONTENU_FORMULAIRE, client: clientAvecAdresses(["marie@exemple.fr"]) });
  const r = await envoyerMessage(b, { email: "sean.o'brien@exemple.ie" });
  const e = b.courriel.envois[0] || {};
  verifier("Reply-To : une adresse avec apostrophe y entre", r.statut === 303 && e.replyTo === "sean.o'brien@exemple.ie", JSON.stringify(e.replyTo));
  verifier("Reply-To : … et le texte promet ce que l'en-tête fait", (e.text || "").includes("votre réponse partira vers sean.o'brien@exemple.ie."));

  const longue = "a".repeat(130) + "@exemple.fr";
  await envoyerMessage(b, { email: longue }, { ip: b.ipNeuve() });
  const l = b.courriel.envois[1] || {};
  verifier("Reply-To : une adresse de plus de 120 caractères entre ENTIÈRE", l.replyTo === longue && (l.text || "").includes(longue), JSON.stringify(l.replyTo));

  // Une adresse qui ne peut pas entrer dans l'en-tête : le texte ne promet rien.
  const courriel = fauxCourriel();
  const env = { COURRIEL: courriel, COURRIEL_EXPEDITEUR: "connexion@atelier.example" };
  await envoyerAlerteMessage(env, { a: ["marie@exemple.fr"], nomSite: "Site", message: { nom: "X", email: "x@exemple.fr\r\nBcc: tous@exemple.fr", message: "Bonjour." } });
  const p = courriel.envois[0] || {};
  verifier("Reply-To absent : le texte dit d'écrire à l'adresse, sans promettre « Répondre »", !("replyTo" in p) && !p.text.includes("partira vers") &&
    p.text.includes("écrivez à l'adresse indiquée") && !p.html.includes("partira vers"));

  // Une seule règle : ce que le formulaire accepte entre dans l'en-tête, et rien d'autre.
  const adresses = ["sean.o'brien@exemple.ie", "Jeanne.Martin@Exemple.FR", "a+b@exemple.fr", "x{y}|z~@exemple.fr", "jeanne@exemple", "a b@exemple.fr",
    "a<b@exemple.fr", 'a"b@exemple.fr', "a,b@exemple.fr", "a;b@exemple.fr", "jeanne@exemple.fr>", "é@exemple.fr", "a@-exemple.fr", "a@exemple..fr"];
  const ecarts = adresses.filter((a) => !validerMessage({ nom: "X", email: a, message: "Un message assez long." }).erreurs.email !== !!adresseTelleQuelle(a));
  verifier("Reply-To : même règle que le formulaire, adresse par adresse", ecarts.length === 0, JSON.stringify(ecarts));

  // La copie dans la boîte du client : l'e-mail rappelle la garde d'un an.
  verifier("alerte : elle rappelle que le site promet un an au plus", e.text.includes("gardés un an au plus") && e.html.includes("gardés un an au plus"));
});

/* La garde d'un an tient SANS visite : l'alarme du Durable Object. Avant :
   un message, puis plus rien — le message restait en base pour toujours. */
await groupe(1945, async () => {
  const b = creerBanc({ contenu: CONTENU_FORMULAIRE });
  await envoyerMessage(b);
  const t0 = b.horloge.maintenant();
  verifier("garde : le dépôt pose l'alarme pour le jour où le message aura un an", b.espace.stockage.alarme === t0 + 365 * JOUR, String(b.espace.stockage.alarme));
  const appels = b.espace.appels;
  // Un an de visites publiques : elles ne réveillent jamais le Durable Object.
  for (let i = 0; i < 12; i++) {
    b.horloge.avancer(30 * JOUR);
    await b.appeler("/");
  }
  b.horloge.avancer(5 * JOUR - MINUTE);
  b.espace.redemarrer();
  verifier("garde : à un an moins une minute, l'alarme ne sonne pas encore", (await b.espace.declencherAlarme()) === false && messagesEnBase(b).length === 1);
  b.horloge.avancer(2 * MINUTE);
  verifier("garde : passé un an, l'alarme sonne", (await b.espace.declencherAlarme()) === true);
  verifier("garde : … le message est effacé, sans aucun appel du Worker", messagesEnBase(b).length === 0 && b.espace.appels === appels, b.espace.appels - appels + " appels");
  verifier("garde : … et sans message, plus d'alarme", b.espace.stockage.alarme === null);

  // Deux messages : l'alarme suit le plus ancien, puis se repose sur le suivant.
  const d = creerBanc({ contenu: CONTENU_FORMULAIRE });
  await envoyerMessage(d, { message: "Le premier des deux messages." });
  const t1 = d.horloge.maintenant();
  d.horloge.avancer(10 * JOUR);
  await envoyerMessage(d, { message: "Le second, dix jours plus tard." }, { ip: d.ipNeuve() });
  const t2 = d.horloge.maintenant();
  verifier("garde : un message plus récent ne recule pas l'alarme", d.espace.stockage.alarme === t1 + 365 * JOUR);
  d.horloge.regler(t1 + 365 * JOUR);
  await d.espace.declencherAlarme();
  verifier("garde : l'alarme efface le plus ancien, garde le suivant, et se repose sur lui", messagesEnBase(d).length === 1 &&
    messagesEnBase(d)[0].quand === t2 && d.espace.stockage.alarme === t2 + 365 * JOUR);
  d.horloge.regler(t2 + 365 * JOUR);
  await d.espace.declencherAlarme();
  verifier("garde : … qui part à son tour, un an après", messagesEnBase(d).length === 0 && d.espace.stockage.alarme === null);

  // Le plus ancien supprimé à la main : l'alarme sonne pour rien, et se repose.
  const s = creerBanc({ contenu: CONTENU_FORMULAIRE });
  await envoyerMessage(s, { message: "Celui qu'on supprimera." });
  const u1 = s.horloge.maintenant();
  s.horloge.avancer(JOUR);
  await envoyerMessage(s, { message: "Celui qui reste." }, { ip: s.ipNeuve() });
  const u2 = s.horloge.maintenant();
  const cookie = await seConnecter(s);
  await api(s, cookie, "messages/1/supprimer", { methode: "POST" });
  s.horloge.regler(u1 + 365 * JOUR);
  await s.espace.declencherAlarme();
  verifier("garde : un message supprimé avant l'heure ne fait pas perdre l'alarme du suivant", messagesEnBase(s).length === 1 &&
    s.espace.stockage.alarme === u2 + 365 * JOUR);

  // Une plateforme qui rendrait encore, pendant la sonnerie, l'heure de
  // l'alarme en train de sonner : la suivante se pose quand même.
  const v = creerBanc({ contenu: CONTENU_FORMULAIRE });
  await envoyerMessage(v, { message: "Le premier, qui partira." });
  const v1 = v.horloge.maintenant();
  v.horloge.avancer(JOUR);
  await envoyerMessage(v, { message: "Le second, qui restera." }, { ip: v.ipNeuve() });
  const v2 = v.horloge.maintenant();
  v.espace.stockage.deleteAlarm = async () => {};
  v.horloge.regler(v1 + 365 * JOUR);
  await v.espace.declencherAlarme();
  verifier("garde : l'alarme suivante se pose même si l'ancienne paraît encore posée pendant la sonnerie", messagesEnBase(v).length === 1 &&
    v.espace.stockage.alarme === v2 + 365 * JOUR, String(v.espace.stockage.alarme));

  // Une alarme qui ne se pose pas ne fait jamais perdre un message.
  const p = creerBanc({ contenu: CONTENU_FORMULAIRE });
  p.espace.stockage.setAlarm = async () => { throw new Error("Alarme refusée (panne simulée)"); };
  const r = await envoyerMessage(p);
  verifier("garde : alarme en panne → le message est enregistré quand même, la visiteuse remerciée", r.statut === 303 && messagesEnBase(p).length === 1);

  const source = readFileSync(racine + "socle/serveur/atelier.js", "utf8");
  verifier("atelier.js : l'alarme de la plateforme délègue au cœur", /^ {2}alarm\(\) \{ return this\.coeur\.alarme\(\); \}$/m.test(source));
  verifier("l'alarme n'est pas une méthode RPC", !METHODES_RPC.includes("alarm") && !METHODES_RPC.includes("alarme"));
});

/* La borne du corps : tout ce que la page laisse partir arrive jusqu'à la
   règle du formulaire. Avant : 16 Ko, et un message en ukrainien de 3 900
   caractères repartait en 413, sans le formulaire ni son texte. */
await groupe(1995, async () => {
  const b = creerBanc({ contenu: CONTENU_FORMULAIRE });
  const ukrainien = "Добрий день! Я хотіла б замовити торт на весілля. ".repeat(80).slice(0, 3900);
  const corps = new URLSearchParams(Object.assign({}, MESSAGE, { message: ukrainien })).toString();
  const r = await envoyerMessage(b, { message: ukrainien });
  verifier("borne : 3 900 caractères en ukrainien (" + corps.length + " octets) → 303 « envoyé »", corps.length > 16 * 1024 && r.statut === 303 &&
    messagesEnBase(b).length === 1 && messagesEnBase(b)[0].message === ukrainien.trim(), "statut " + r.statut);

  // Le pire cas : chaque champ à son maximum, chaque caractère à 9 octets une fois encodé.
  const pire = { nom: "中".repeat(100), email: "中".repeat(254), telephone: "中".repeat(30), message: "中".repeat(4000), site_web: "" };
  const octetsPire = new URLSearchParams(Object.assign({}, MESSAGE, pire)).toString().length;
  const appels = b.espace.appels;
  const rp = await envoyerMessage(b, pire, { ip: b.ipNeuve() });
  verifier("borne : le pire cas (" + octetsPire + " octets) passe la borne et revient en 400 avec le formulaire, jamais en 413",
    octetsPire > 39_000 && octetsPire <= LIMITE_CORPS_CONTACT && rp.statut === 400 && rp.texte.includes('<form class="contact__formulaire"') &&
    b.espace.appels === appels, "statut " + rp.statut);
  verifier("borne : une valeur entière, ni ouverte ni absurde", Number.isSafeInteger(LIMITE_CORPS_CONTACT) && LIMITE_CORPS_CONTACT >= 40_000 && LIMITE_CORPS_CONTACT <= 64 * 1024,
    String(LIMITE_CORPS_CONTACT));
});

/* =========================================================
   De bout en bout : le rendu, le serveur et l'éditeur ensemble
   =========================================================

   Le socle 0.3.0 a été écrit par quatre chantiers en même temps, chacun
   sur ses fichiers, chacun avec ses tests — et chacun testait l'autre tel
   qu'il l'IMAGINAIT : le serveur recevait un formulaire écrit à la main,
   l'éditeur lisait des réponses rejouées. Ici, rien n'est recopié
   (3 octobre 2026) :
   - le formulaire envoyé est celui que la page de la démo affiche, ses
     champs lus dans le HTML rendu ;
   - l'onglet Messages (api.js et messages.js de l'éditeur, tels quels)
     parle au vrai serveur ;
   - la page des mentions légales est fabriquée par le geste de l'onglet
     Site, enregistrée et publiée par le vrai serveur.

   Les modules de l'éditeur importent le rendu par son adresse sur le site
   (`/rendu/…`) : le même crochet que tester-editeur.mjs le ramène au
   dossier `socle/public/`. Le serveur importe les mêmes fichiers par un
   chemin relatif : une seule copie de chaque module. */
{
  const PUBLIC = new URL("../socle/public/", import.meta.url).href;
  registerHooks({
    resolve(specifier, context, suivant) {
      if (specifier.startsWith("/rendu/") || specifier.startsWith("/editeur/")) return suivant(new URL(specifier.slice(1), PUBLIC).href, context);
      return suivant(specifier, context);
    }
  });
}
const { creerApi } = await import("../socle/public/editeur/api.js");
const { creerBoiteMessages, lienRepondre } = await import("../socle/public/editeur/messages.js");
const Operations = await import("../socle/public/editeur/operations.js");
const { pageMentionsLegales, PAGE_MENTIONS } = await import("../socle/public/rendu/modeles-pages.js");
const { CHAMPS_CONTACT, CHAMP_PIEGE } = await import("../socle/public/rendu/formulaire.js");

/* L'API de l'éditeur, branchée sur le banc comme le navigateur l'est sur
   le site : le cookie de session, et `Origin` sur ce qui n'est pas une
   lecture (le navigateur le pose de lui-même). */
function apiDeLEditeur(banc, cookie) {
  return creerApi({
    fetch: (adresse, init) => {
      const h = new Headers(init.headers);
      h.set("cookie", cookie);
      h.set("cf-connecting-ip", "203.0.113.7");
      if (init.method !== "GET" && init.method !== "HEAD") h.set("origin", ORIGINE);
      return banc.fetchBrut(new Request(ORIGINE + adresse, { method: init.method, headers: h, body: init.body }));
    }
  });
}

/* Le formulaire tel que la page l'affiche : son adresse d'envoi, le nom de
   chacun de ses champs, la valeur des champs cachés. */
function formulaireDeLaPage(html) {
  const form = (/<form class="contact__formulaire"[^>]*>[\s\S]*?<\/form>/.exec(html) || [""])[0];
  const action = (/^<form[^>]*\baction="([^"]*)"/.exec(form) || [])[1] || "";
  const noms = [...form.matchAll(/<(?:input|textarea)\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
  const caches = Object.fromEntries([...form.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], m[2]]));
  return { form, action: action.replace(/&amp;/g, "&"), noms, caches };
}

await groupe(1800, async () => {
  // Le contenu livré de la démo, tel quel : c'est lui qui affiche le formulaire.
  const b = creerBanc();
  const accueil = await b.appeler("/");
  const f = formulaireDeLaPage(accueil.texte);
  verifier("bout en bout : la démo affiche son formulaire, en POST", accueil.statut === 200 && f.form.includes('method="post"'), f.form.slice(0, 200));
  verifier("bout en bout : les champs de la page sont ceux que le serveur lit (formulaire.js), plus page, bloc et le piège",
    JSON.stringify([...f.noms].sort()) === JSON.stringify([...CHAMPS_CONTACT, CHAMP_PIEGE, "page", "bloc"].sort()), JSON.stringify(f.noms));
  // Le navigateur n'envoie jamais l'ancre d'une adresse au serveur.
  const cible = new URL(f.action, ORIGINE);
  verifier("bout en bout : l'adresse d'envoi est /contact, l'ancre de la section en plus", cible.pathname === "/contact" && cible.search === "" &&
    cible.hash.length > 1 && accueil.texte.includes(' id="' + decodeURIComponent(cible.hash.slice(1)) + '"'), f.action);

  // Une visiteuse remplit les champs VISIBLES ; les cachés partent tels quels, le piège vide.
  const saisie = { nom: "Lucie Hoffmann", email: "lucie@exemple.fr", telephone: "", message: "Bonjour, faites-vous du pain sans sel ?" };
  const corps = Object.fromEntries(f.noms.map((n) => [n, Object.prototype.hasOwnProperty.call(f.caches, n) ? f.caches[n] : saisie[n] ?? ""]));
  const envoi = await b.appeler(cible.pathname, { methode: "POST", formulaire: corps });
  const vers = new URL(envoi.entetes.get("location") || "/", ORIGINE);
  verifier("bout en bout : 303 vers la page du formulaire, à l'ancre où il était", envoi.statut === 303 && vers.origin === ORIGINE &&
    vers.pathname === "/" && vers.hash === cible.hash, envoi.statut + " " + envoi.entetes.get("location"));
  const merci = await b.appeler(vers.pathname + vers.search);
  verifier("bout en bout : la page suivante dit merci (role=status), à la place du formulaire", merci.statut === 200 &&
    merci.texte.includes('role="status"') && merci.texte.includes("Merci, votre message est bien parti.") && !merci.texte.includes('<form class="contact__formulaire"'));
  verifier("bout en bout : le message est en base, tel qu'écrit", messagesEnBase(b).length === 1 && messagesEnBase(b)[0].nom === saisie.nom &&
    messagesEnBase(b)[0].page === f.caches.page && messagesEnBase(b)[0].bloc === f.caches.bloc);

  // Un envoi refusé revient avec le MÊME formulaire, rempli, et la même adresse d'envoi.
  const refus = await b.appeler(cible.pathname, { methode: "POST", formulaire: Object.assign({}, corps, { message: "Court" }) });
  const g = formulaireDeLaPage(refus.texte);
  verifier("bout en bout : un envoi refusé rend le même formulaire, rempli, vers la même adresse", refus.statut === 400 &&
    JSON.stringify(g.noms) === JSON.stringify(f.noms) && g.action === f.action && g.form.includes('value="Lucie Hoffmann"') && g.form.includes(">\nCourt</textarea>"));

  // L'onglet Messages, branché sur ce serveur.
  const cookie = await seConnecter(b);
  const api = apiDeLEditeur(b, cookie);
  const etat = await api.etat();
  verifier("bout en bout : l'éditeur lit le compte des non lus dans etat", etat.messages && etat.messages.nonLus === 1, JSON.stringify(etat.messages));
  const boite = creerBoiteMessages({ api, nonLus: etat.messages.nonLus, maintenant: () => b.horloge.maintenant() });
  const charge = await boite.charger();
  const m = boite.liste && boite.liste[0];
  verifier("bout en bout : l'onglet Messages lit la liste du serveur, champ par champ", charge.ok === true && boite.liste.length === 1 &&
    m.nom === saisie.nom && m.email === saisie.email && m.telephone === "" && m.message === saisie.message && m.page === "accueil" &&
    m.quand === messagesEnBase(b)[0].quand && m.lu === false && boite.nonLus === 1, JSON.stringify(boite.liste));
  verifier("bout en bout : « Répondre » vise l'adresse écrite par la visiteuse", (lienRepondre(m.email, NOM) || "").startsWith("mailto:lucie@exemple.fr?subject="));
  const ouvert = await boite.ouvrir(m.id);
  verifier("bout en bout : ouvrir un message le marque lu sur le serveur", ouvert.ok === true && messagesEnBase(b)[0].lu_le !== null &&
    (await api.etat()).messages.nonLus === 0 && boite.nonLus === 0);
  // « Actualiser » : c'est le SERVEUR qui dit maintenant « lu », plus la
  // mémoire de l'onglet.
  await boite.charger();
  verifier("bout en bout : rechargée, la liste du serveur le dit lu", boite.liste.length === 1 && boite.liste[0].lu === true && boite.nonLus === 0,
    JSON.stringify(boite.liste));
  const remis = await boite.marquerNonLu(m.id);
  await boite.charger();
  verifier("bout en bout : « Marquer comme non lu » le remet non lu sur le serveur", remis.ok === true && messagesEnBase(b)[0].lu_le === null &&
    (await api.etat()).messages.nonLus === 1 && boite.liste[0].lu === false && boite.nonLus === 1);
  const parti = await boite.supprimer(m.id);
  verifier("bout en bout : « Supprimer » l'efface du serveur, et le journal le dit", parti.ok === true && messagesEnBase(b).length === 0 &&
    boite.liste.length === 0 && actions(await journalDe(b, cookie)).includes("message_supprime"));
  const encore = await boite.supprimer(m.id);
  verifier("bout en bout : un message déjà supprimé (ailleurs) n'est pas une erreur pour l'onglet", encore.ok === true && encore.introuvable === true);

  // La page des mentions légales, par le geste de l'onglet Site, sur un
  // site qui ne l'a pas encore.
  const sans = copie(contenuLivre);
  for (const id of sans.pages[PAGE_MENTIONS].ordre) delete sans.blocs[id];
  delete sans.pages[PAGE_MENTIONS];
  const s = creerBanc({ contenu: sans });
  const cookieS = await seConnecter(s);
  const apiS = apiDeLEditeur(s, cookieS);
  verifier("bout en bout : sans page des mentions, pas de lien en bas de page", !(await s.appeler("/")).texte.includes('href="/mentions-legales"'));
  const depart = await apiS.etat();
  const brouillon = depart.brouillon.contenu;
  const { pageId } = Operations.ajouterPageModele(brouillon, pageMentionsLegales(brouillon));
  const enregistre = await apiS.enregistrer(JSON.stringify(brouillon), depart.brouillon.revision);
  const publie = await apiS.publier(enregistre.revision);
  verifier("bout en bout : la page créée par l'onglet Site est acceptée et publiée par le serveur", pageId === PAGE_MENTIONS &&
    enregistre.revision === depart.brouillon.revision + 1 && !!publie.publie && !!publie.version);
  const mentions = await s.appeler("/" + PAGE_MENTIONS);
  verifier("bout en bout : /mentions-legales en ligne, un seul <h1>, ses trous visibles, le lien du bas sur elle-même", mentions.statut === 200 &&
    (mentions.texte.match(/<h1\b/g) || []).length === 1 && mentions.texte.includes("[À compléter : forme juridique") &&
    mentions.texte.includes('href="/mentions-legales" aria-current="page"'));
  verifier("bout en bout : … et le lien en bas de l'accueil", (await s.appeler("/")).texte.includes('<a class="pied__mentions" href="/mentions-legales"'));
});

/* Le message d'une cliente derrière 200 messages de robots, par l'onglet
   Messages TEL QUEL (api.js, messages.js) et le vrai serveur. Le serveur
   pagine et l'éditeur suit, chacun testé de son côté avec l'autre
   imaginé : ici ils se parlent (contrôle du 3 octobre 2026). Avant : la
   liste s'arrêtait aux 200 plus récents, et la cliente n'était nulle part. */
await groupe(2185, async () => {
  const b = creerBanc({ contenu: CONTENU_FORMULAIRE });
  await envoyerMessage(b, { nom: "Claire Dupont", message: "Pouvez-vous me garder deux bretzels pour samedi ?" });
  const sql = b.espace.stockage.sql;
  for (let i = 0; i < 200; i++) {
    sql.exec("INSERT INTO messages (quand, page, bloc, nom, email, message, connexion) VALUES (?, 'accueil', 'contact-1', 'Robot', 'r@exemple.fr', 'Message en série.', '')", b.horloge.maintenant());
  }
  const cookie = await seConnecter(b);
  const api = apiDeLEditeur(b, cookie);
  const etat = await api.etat();
  const boite = creerBoiteMessages({ api, nonLus: etat.messages.nonLus, maintenant: () => b.horloge.maintenant() });
  await boite.charger();
  const claireDans = () => (boite.liste || []).find((m) => m.nom === "Claire Dupont") || null;
  verifier("bout en bout, 201 messages : la première page en montre 200, se sait coupée, et compte toute la boîte",
    boite.liste.length === 200 && !claireDans() && boite.total === 201 && boite.nonLus === 201 && boite.tronquee && boite.peutChargerPlusAnciens,
    JSON.stringify({ n: boite.liste.length, total: boite.total, nonLus: boite.nonLus, tronquee: boite.tronquee }));
  const plus = await boite.chargerPlusAnciens();
  const claire = claireDans();
  verifier("bout en bout : « Afficher les messages plus anciens » amène le message de la cliente", plus.ok === true && plus.ajoutes === 1 &&
    !!claire && claire.id === 1 && boite.liste.length === 201 && !boite.tronquee && !boite.peutChargerPlusAnciens, JSON.stringify(plus));
  if (!claire) return;
  await boite.ouvrir(claire.id);
  verifier("bout en bout : ouvert, il est lu sur le serveur, et les comptes suivent", messagesEnBase(b)[0].lu_le !== null &&
    (await api.etat()).messages.nonLus === 200 && boite.nonLus === 200);
  const parti = await boite.supprimer(claire.id);
  verifier("bout en bout : … et il se supprime du serveur (droit à l'effacement)", parti.ok === true &&
    !messagesEnBase(b).some((m) => m.nom === "Claire Dupont") && boite.total === 200 && !claireDans());
});

/* ----- Bilan ----- */
for (const k of Object.keys(consoleOriginale)) console[k] = consoleOriginale[k];
if (echecs.length) {
  for (const e of echecs) console.error("✗ " + e);
  console.error("\nConsole pendant les tests :\n" + journalConsole.slice(-40).join("\n"));
  console.error(`\n${echecs.length} échec(s), ${ok} réussite(s).`);
  process.exit(1);
}
console.log(`✓ ${ok} vérifications de l'administration réussies`);
