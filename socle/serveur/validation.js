/* =========================================================
   Ce qui vient du navigateur — validation et empreintes
   =========================================================

   Le contenu est écrit par un client AUTHENTIFIÉ : ce n'est pas une raison
   pour le croire. Un éditeur abîmé, un onglet resté ouvert sur une vieille
   version du socle, une extension de navigateur qui réécrit la page, et le
   serveur enregistrerait n'importe quoi. Tout passe donc ici avant d'entrer
   dans le Durable Object : bornes de taille, puis `normaliser()` — la même
   fonction que celle qui protège la page publique.

   Ce qui est stocké est la FORME CANONIQUE (`normaliser(contenu)`), et
   l'empreinte se calcule sur elle. Deux contenus qui ne diffèrent que par
   un bloc inconnu ou une clé dans un autre ordre ont la même empreinte :
   c'est ce qui permet de dire « rien n'a changé » sans écrire une révision
   de plus. */

import { normaliser } from "../public/rendu/page.js";

/* Les bornes du § 4 de la spécification. Elles ne servent pas la
   performance d'un site vitrine — dix pages en sont loin — mais elles
   bornent ce qu'un navigateur fou peut faire écrire à chaque
   enregistrement automatique (toutes les 1,2 s). */
export const LIMITES_CONTENU = Object.freeze({
  octets: 300_000,
  profondeur: 10,
  texte: 20_000,
  liste: 60,
  pages: 20,
  blocs: 150
});

const encodeur = new TextEncoder();
export const octets = (s) => encodeur.encode(s).byteLength;
const aEnPropre = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const objetSimple = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/* Le premier défaut rencontré, avec un message qu'un artisan comprend.
   `chemin` n'est jamais affiché tel quel : il sert à l'éditeur pour
   désigner l'endroit. */
function refus(statut, erreur, message, chemin = "") {
  return { ok: false, statut, erreur, message, chemin };
}

/* Profondeur, longueur des textes, longueur des listes.

   ⚠️ Ce parcours passe AVANT `JSON.stringify` : un tableau imbriqué cent
   mille fois (300 Ko de « [ ») ferait déborder la pile de la mise en
   chaîne. Lui s'arrête au onzième niveau. */
function inspecter(valeur, profondeur, chemin) {
  const L = LIMITES_CONTENU;
  if (typeof valeur === "string") {
    return valeur.length > L.texte
      ? refus(400, "contenu_invalide", "Un texte dépasse " + L.texte.toLocaleString("fr-FR") + " caractères.", chemin)
      : null;
  }
  if (!valeur || typeof valeur !== "object") return null;
  if (profondeur > L.profondeur) return refus(400, "contenu_invalide", "Le contenu est trop imbriqué pour être enregistré.", chemin);
  if (Array.isArray(valeur)) {
    if (valeur.length > L.liste) {
      // L'ordre d'une page EST la liste de ses sections : « une liste
      // dépasse 60 éléments » ne disait pas à l'artisan quoi retirer
      // (relecture du 3 octobre 2026).
      const message = /^pages\.[^.]+\.ordre$/.test(chemin)
        ? "Une page dépasse " + L.liste + " sections."
        : "Une liste dépasse " + L.liste + " éléments.";
      return refus(400, "contenu_invalide", message, chemin);
    }
    for (let i = 0; i < valeur.length; i++) {
      const r = inspecter(valeur[i], profondeur + 1, chemin ? chemin + "." + i : String(i));
      if (r) return r;
    }
    return null;
  }
  for (const [cle, v] of Object.entries(valeur)) {
    if (cle.length > L.texte) return refus(400, "contenu_invalide", "Un nom de champ est trop long.", chemin);
    const r = inspecter(v, profondeur + 1, chemin ? chemin + "." + cle : cle);
    if (r) return r;
  }
  return null;
}

/* La validation complète d'un contenu envoyé par l'éditeur.
   → `{ ok: true, contenu, json, taille }` (forme canonique)
   → `{ ok: false, statut: 400 | 413, erreur, message, chemin }` */
export function validerContenu(brut) {
  const L = LIMITES_CONTENU;
  if (!objetSimple(brut)) return refus(400, "contenu_invalide", "Le contenu reçu est illisible.");
  const defaut = inspecter(brut, 1, "");
  if (defaut) return defaut;
  if (octets(JSON.stringify(brut)) > L.octets) {
    return refus(413, "contenu_trop_lourd", "Le contenu est trop volumineux pour être enregistré.");
  }
  if (objetSimple(brut.pages) && Object.keys(brut.pages).length > L.pages) {
    return refus(400, "contenu_invalide", "Le contenu dépasse " + L.pages + " pages.", "pages");
  }
  if (objetSimple(brut.blocs) && Object.keys(brut.blocs).length > L.blocs) {
    return refus(400, "contenu_invalide", "Le contenu dépasse " + L.blocs + " sections.", "blocs");
  }
  let n;
  try {
    n = formeCanonique(brut);
  } catch (e) {
    console.error("normaliser() a levé sur un contenu envoyé :", e);
    return refus(400, "contenu_invalide", "Le contenu reçu est illisible.");
  }
  // `normaliser` complète les sections auxquelles il manque des champs :
  // la forme stockée peut être un peu plus lourde que celle reçue.
  if (n.taille > L.octets) return refus(413, "contenu_trop_lourd", "Le contenu est trop volumineux pour être enregistré.");
  return Object.assign({ ok: true }, n);
}

/* La forme canonique SANS les bornes : pour un contenu qui ne vient pas du
   navigateur (le contenu livré, celui déjà en ligne, une ancienne version).
   Refuser de les ouvrir parce qu'une borne a changé depuis enfermerait le
   client dehors ; le rendu, lui, les a toujours acceptés. */
export function formeCanonique(brut) {
  const contenu = normaliser(brut);
  const json = JSON.stringify(contenu);
  // On relit la chaîne plutôt que de garder l'objet : les clés à
  // `undefined` disparaissent, et ce qu'on renvoie est exactement ce qui
  // est stocké.
  return { contenu: JSON.parse(json), json, taille: octets(json) };
}

/* ----- Empreintes ----- */
export async function sha256Hex(texte) {
  const tampon = await crypto.subtle.digest("SHA-256", encodeur.encode(String(texte)));
  let hex = "";
  for (const o of new Uint8Array(tampon)) hex += o.toString(16).padStart(2, "0");
  return hex;
}

/* L'empreinte d'un contenu = SHA-256 de sa forme canonique en JSON. */
export const empreinteDe = (json) => sha256Hex(json);

/* ----- Jetons tirés au hasard -----

   32 octets en base64url : 43 caractères, sans « = ». Un cookie ou un
   paramètre qui n'a pas cette forme n'est même pas cherché en base — un
   aller-retour au Durable Object de moins pour chaque robot. */
const JETON = /^[A-Za-z0-9_-]{43}$/;
export function jetonValide(s) {
  return typeof s === "string" && JETON.test(s);
}

export function base64url(octetsBruts) {
  let binaire = "";
  for (const o of octetsBruts) binaire += String.fromCharCode(o);
  return btoa(binaire).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function hex(octetsBruts) {
  let s = "";
  for (const o of octetsBruts) s += o.toString(16).padStart(2, "0");
  return s;
}

/* ----- Adresses e-mail -----

   Comparées après `trim()` et en minuscules : « Marie@Exemple.fr » saisie
   dans la fiche et « marie@exemple.fr » tapée sur la page de connexion sont
   la même personne. Volontairement strict (pas de guillemets, pas de
   domaine accentué) : une adresse d'administration n'a pas à être exotique,
   et rien d'étrange ne doit arriver jusqu'à l'en-tête d'un e-mail. */
const ADRESSE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
export function adresseEmail(s) {
  if (typeof s !== "string") return "";
  const a = s.trim().toLowerCase();
  return a.length <= 254 && ADRESSE.test(a) ? a : "";
}

/* La MÊME règle, sans les minuscules forcées : l'adresse d'une visiteuse,
   telle qu'elle l'a tapée, quand elle doit entrer dans un en-tête
   (`Reply-To` de l'alerte, courriel.js). C'est la règle du formulaire de
   contact (rendu/formulaire.js, même motif, drapeau `i`) : tout ce que le
   formulaire accepte entre dans l'en-tête.

   Elle remplace la règle de l'adresse d'EXPÉDITION, qui refusait
   l'apostrophe : « sean.o'brien@exemple.ie », acceptée par le formulaire,
   partait sans `Reply-To`, et la réponse de l'artisan revenait à l'atelier
   pendant que l'e-mail lui promettait le contraire (relecture du
   3 octobre 2026). L'apostrophe est un caractère ordinaire d'une adresse
   (RFC 5322, « atext ») ; ni blanc, ni saut de ligne, ni chevron, ni
   guillemet, ni virgule n'entrent ici — rien qui ouvre un autre en-tête
   ou un second destinataire. → l'adresse, ou "" */
const ADRESSE_CASSE_LIBRE = new RegExp(ADRESSE.source, "i");
export function adresseTelleQuelle(s) {
  if (typeof s !== "string") return "";
  const a = s.trim();
  return a.length <= 254 && ADRESSE_CASSE_LIBRE.test(a) ? a : "";
}

/* ----- Le lien d'accès d'une MAQUETTE -----

   Une maquette se montre avant que l'atelier ait un domaine d'expédition
   d'e-mails : sans lui, aucun lien de connexion ne part. Le secret
   `ACCES_DEMO` (posé par `wrangler secret put`, jamais dans le dépôt) ouvre
   alors l'administration à qui a le lien `/admin/demo?cle=<secret>`, sans
   e-mail — décision de Martin, 3 octobre 2026.

   Trois conditions, toutes exigées :
   — la fiche dit `"demo": true`. Chez un vrai client, le secret posé par
     erreur ne fait RIEN : son administration ne s'ouvre que par e-mail ;
   — le secret fait au moins 32 caractères sûrs (une clé tirée au hasard,
     pas un mot de passe qu'on devine) ;
   — la clé du lien est égale au secret, comparée en temps constant.
   Les sessions ouvertes ainsi portent une adresse fictive (`.invalid` ne
   peut appartenir à personne) : le journal et les versions disent « par
   lien-de-demo@demo.invalid ». Retirer le secret, ou passer la fiche en
   `"demo": false`, ferme ces sessions au premier appel suivant (`qui`). */
export const ADRESSE_LIEN_DEMO = "lien-de-demo@demo.invalid";
const SECRET_DEMO = /^[A-Za-z0-9_-]{32,256}$/;

export function secretDemo(fiche, env) {
  if (!fiche || fiche.demo !== true) return "";
  const s = env && typeof env.ACCES_DEMO === "string" ? env.ACCES_DEMO.trim() : "";
  return SECRET_DEMO.test(s) ? s : "";
}

export function egalEnTempsConstant(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Les adresses autorisées : celles de la fiche du client ∪ celles de
   l'atelier (`ADRESSES_ATELIER`, séparées par des virgules), valables sur
   TOUS les sites. Une adresse mal formée est ignorée — jamais une erreur
   qui fermerait l'administration à tout le monde. Sur une maquette dont
   le lien d'accès est actif, l'adresse fictive du lien en fait partie. */
export function adressesAutorisees(fiche, env) {
  const ensemble = new Set();
  if (secretDemo(fiche, env)) ensemble.add(ADRESSE_LIEN_DEMO);
  const admin = fiche && objetSimple(fiche.administration) ? fiche.administration : {};
  for (const a of Array.isArray(admin.adresses) ? admin.adresses : []) {
    const n = adresseEmail(a);
    if (n) ensemble.add(n);
  }
  const atelier = env && typeof env.ADRESSES_ATELIER === "string" ? env.ADRESSES_ATELIER : "";
  for (const a of atelier.split(",")) {
    const n = adresseEmail(a);
    if (n) ensemble.add(n);
  }
  return [...ensemble].sort();
}

/* ----- Lecture bornée d'un corps de requête -----

   `request.json()` ou `formData()` liraient tout ce qu'on leur envoie, et
   un Worker gratuit n'a que 128 Mo de mémoire. On compte en lisant, et on
   s'arrête dès que la borne est franchie. `Content-Length` permet de
   refuser sans rien lire, mais il peut manquer (envoi par morceaux) : le
   compte en lisant reste l'arbitre. Renvoie `null` au-delà de la borne. */
export async function lireOctetsBornes(request, max) {
  const annonce = Number(request.headers.get("content-length"));
  if (Number.isFinite(annonce) && annonce > max) return null;
  if (!request.body) return new Uint8Array(0);
  const lecteur = request.body.getReader();
  const morceaux = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      try { await lecteur.cancel(); } catch { /* déjà fermé */ }
      return null;
    }
    morceaux.push(value);
  }
  const tout = new Uint8Array(total);
  let position = 0;
  for (const m of morceaux) { tout.set(m, position); position += m.byteLength; }
  return tout;
}

/* Un objet JSON reçu : `null` si ce n'est pas un objet. */
export function objetJson(texte) {
  try {
    const v = JSON.parse(texte);
    return objetSimple(v) ? v : null;
  } catch {
    return null;
  }
}

export { aEnPropre, objetSimple };
