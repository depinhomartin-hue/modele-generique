/* =========================================================
   Les photos — dépôt validé par les octets, service public
   =========================================================

   Une photo vit dans l'espace R2 du client (`MEDIAS`) sous deux clés :
   `medias/<id>.<ext>` (l'image, réduite dans le navigateur à 1600 px) et
   `vignettes/<id>.<ext>` (400 px, pour la médiathèque). L'identifiant est
   tiré au hasard (32 caractères hexadécimaux) : une clé n'est JAMAIS
   réécrite, c'est ce qui autorise une mise en cache d'un an.

   L'index (nom d'origine, dimensions, retrait) vit dans le Durable Object ;
   ce module ne fait que lire les octets et parler à R2. */

import { lireOctetsBornes } from "./validation.js";

export const TYPES_IMAGES = Object.freeze({ jpg: "image/jpeg", png: "image/png", webp: "image/webp" });
const TYPES_SERVIS = new Set(Object.values(TYPES_IMAGES));

export const LIMITES_PHOTOS = Object.freeze({
  image: 8 * 1024 * 1024,
  vignette: 1024 * 1024,
  cote: 4096,
  nom: 120
});
// L'enveloppe multipart ajoute ses séparateurs et ses en-têtes : quelques
// kilo-octets suffisent, 64 Ko laissent de la marge sans rien ouvrir.
export const LIMITE_DEPOT = LIMITES_PHOTOS.image + LIMITES_PHOTOS.vignette + 64 * 1024;

/* ----- Ce que disent les octets -----

   On ne croit NI le type déclaré par le navigateur NI l'extension du nom :
   un fichier HTML renommé « photo.jpg » et envoyé avec `image/jpeg` serait,
   une fois servi depuis notre domaine, une page capable de voler la
   session de l'administratrice. Seules trois signatures passent ; SVG
   (qui peut porter du script), GIF et tout le reste sont refusés.

   Les dimensions sont lues dans l'en-tête, sans décoder l'image : un Worker
   n'a pas le temps de processeur pour décoder un JPEG (Graine de Pensée l'a
   mesuré), et il n'en a pas besoin pour savoir sa taille. */
const lu16be = (o, i) => (o[i] << 8) | o[i + 1];
const lu32be = (o, i) => ((o[i] << 24) | (o[i + 1] << 16) | (o[i + 2] << 8) | o[i + 3]) >>> 0;
const lu24le = (o, i) => o[i] | (o[i + 1] << 8) | (o[i + 2] << 16);
const ascii = (o, i, n) => String.fromCharCode(...o.subarray(i, i + n));

function dimensionsJpeg(o) {
  let i = 2;
  while (i + 3 < o.length) {
    if (o[i] !== 0xFF) return null;
    let marqueur = o[i + 1];
    // Des octets de remplissage 0xFF peuvent précéder un marqueur.
    while (marqueur === 0xFF && i + 2 < o.length) { i++; marqueur = o[i + 1]; }
    i += 2;
    // Marqueurs sans longueur : début d'image, TEM, redémarrages.
    if (marqueur === 0xD8 || marqueur === 0x01 || (marqueur >= 0xD0 && marqueur <= 0xD7)) continue;
    // Fin de l'image ou début des données sans avoir vu les dimensions.
    if (marqueur === 0xD9 || marqueur === 0xDA) return null;
    if (i + 1 >= o.length) return null;
    const longueur = lu16be(o, i);
    if (longueur < 2) return null;
    // SOF0 à SOF15, sauf DHT (C4), JPG (C8) et DAC (CC) qui partagent la plage.
    if (marqueur >= 0xC0 && marqueur <= 0xCF && marqueur !== 0xC4 && marqueur !== 0xC8 && marqueur !== 0xCC) {
      if (i + 7 > o.length) return null;
      return { hauteur: lu16be(o, i + 3), largeur: lu16be(o, i + 5) };
    }
    i += longueur;
  }
  return null;
}

function dimensionsWebp(o) {
  if (o.length < 30) return null;
  const morceau = ascii(o, 12, 4);
  if (morceau === "VP8 ") {
    // Image avec perte : code de départ 9D 01 2A, puis 14 bits par côté.
    if (o[23] !== 0x9D || o[24] !== 0x01 || o[25] !== 0x2A) return null;
    return { largeur: (o[26] | (o[27] << 8)) & 0x3FFF, hauteur: (o[28] | (o[29] << 8)) & 0x3FFF };
  }
  if (morceau === "VP8L") {
    // Sans perte : signature 0x2F, puis largeur-1 et hauteur-1 sur 14 bits.
    if (o[20] !== 0x2F) return null;
    const b = (o[21] | (o[22] << 8) | (o[23] << 16) | (o[24] << 24)) >>> 0;
    return { largeur: (b & 0x3FFF) + 1, hauteur: ((b >>> 14) & 0x3FFF) + 1 };
  }
  if (morceau === "VP8X") {
    // Étendu : la toile, largeur-1 et hauteur-1 sur 24 bits.
    return { largeur: lu24le(o, 24) + 1, hauteur: lu24le(o, 27) + 1 };
  }
  return null;
}

/* → `{ type, ext, largeur, hauteur }` ou `null` si ce n'est pas une photo
   JPEG, PNG ou WebP lisible. */
export function lireImage(o) {
  if (!(o instanceof Uint8Array) || o.length < 12) return null;
  let info = null;
  if (o[0] === 0xFF && o[1] === 0xD8 && o[2] === 0xFF) {
    const d = dimensionsJpeg(o);
    if (d) info = Object.assign({ type: TYPES_IMAGES.jpg, ext: "jpg" }, d);
  } else if (o.length >= 24 && o[0] === 0x89 && ascii(o, 1, 7) === "PNG\r\n\x1a\n") {
    if (ascii(o, 12, 4) === "IHDR") info = { type: TYPES_IMAGES.png, ext: "png", largeur: lu32be(o, 16), hauteur: lu32be(o, 20) };
  } else if (ascii(o, 0, 4) === "RIFF" && ascii(o, 8, 4) === "WEBP") {
    const d = dimensionsWebp(o);
    if (d) info = Object.assign({ type: TYPES_IMAGES.webp, ext: "webp" }, d);
  }
  if (!info || !(info.largeur > 0) || !(info.hauteur > 0)) return null;
  return info;
}

/* ----- Clés et adresses ----- */
export function cleR2(id, ext, vignette = false) {
  return (vignette ? "vignettes/" : "medias/") + id + "." + ext;
}

export function urlMedia(id, ext, vignette = false) {
  return (vignette ? "/medias/vignettes/" : "/medias/") + id + "." + ext;
}

/* Les adresses de photos citées par un contenu (en JSON) : chaque chaîne
   qui EST une adresse de photo, rien d'autre. Sert à l'export, pour qu'un
   client qui part emporte aussi les photos de son site. */
const PHOTO_CITEE = /"(\/medias\/(?:vignettes\/)?[0-9a-f]{32}\.(?:jpg|png|webp))"/g;
export function photosCitees(json) {
  const vues = new Set();
  for (const m of String(json).matchAll(PHOTO_CITEE)) vues.add(m[1]);
  return [...vues];
}

/* ----- Le dépôt (POST /admin/api/medias) -----

   → `{ ok: true, image, vignette, nom }`, chaque fichier sous la forme
     `{ octets, type, ext, largeur, hauteur, taille }` ;
   → `{ ok: false, statut, erreur, message }`. */
function refus(statut, erreur, message) {
  return { ok: false, statut, erreur, message };
}

const estFichier = (v) => !!v && typeof v === "object" && typeof v.arrayBuffer === "function";

async function lireFichier(fichier, max, quoi) {
  if (fichier.size > max) return refus(413, "trop_lourd", quoi === "image"
    ? "Cette photo est trop lourde : 8 Mo au plus."
    : "La vignette de cette photo est trop lourde : 1 Mo au plus.");
  const o = new Uint8Array(await fichier.arrayBuffer());
  if (o.byteLength > max) return refus(413, "trop_lourd", "Cette photo est trop lourde : 8 Mo au plus.");
  const info = lireImage(o);
  if (!info) return refus(415, "format_refuse", "Ce fichier n'est pas une photo JPEG, PNG ou WebP.");
  if (info.largeur > LIMITES_PHOTOS.cote || info.hauteur > LIMITES_PHOTOS.cote) {
    return refus(413, "trop_lourd", "Cette photo est trop grande : 4 096 pixels de côté au plus.");
  }
  return Object.assign({ ok: true, octets: o, taille: o.byteLength }, info);
}

/* Le nom d'origine n'est qu'un repère dans la médiathèque : il est coupé
   plutôt que refusé (un nom de fichier d'appareil photo peut être long),
   et débarrassé de tout caractère de contrôle. */
function nomPropre(v, repli) {
  const brut = typeof v === "string" && v.trim() ? v : (typeof repli === "string" ? repli : "");
  return brut.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, LIMITES_PHOTOS.nom);
}

export async function lireDepot(request) {
  const type = request.headers.get("content-type") || "";
  if (!/^multipart\/form-data\s*;/i.test(type)) return refus(415, "type_refuse", "Format de demande non accepté.");
  const corps = await lireOctetsBornes(request, LIMITE_DEPOT);
  if (!corps) return refus(413, "trop_lourd", "Cette photo est trop lourde : 8 Mo au plus.");
  let formulaire;
  try {
    formulaire = await new Response(corps, { headers: { "content-type": type } }).formData();
  } catch {
    return refus(400, "requete_invalide", "La photo n'a pas été reçue correctement. Réessayez.");
  }
  const image = formulaire.get("image");
  if (!estFichier(image) || !image.size) return refus(400, "image_manquante", "Aucune photo n'a été reçue.");
  const lue = await lireFichier(image, LIMITES_PHOTOS.image, "image");
  if (!lue.ok) return lue;
  const v = formulaire.get("vignette");
  let vignette = null;
  if (estFichier(v) && v.size) {
    // Une vignette invalide refuse tout le dépôt : l'éditeur la fabrique
    // depuis la même image, elle ne peut être fausse que si quelque chose
    // cloche — et on ne range pas sous notre domaine un fichier douteux.
    vignette = await lireFichier(v, LIMITES_PHOTOS.vignette, "vignette");
    if (!vignette.ok) return vignette;
  }
  return { ok: true, image: lue, vignette, nom: nomPropre(formulaire.get("nom"), image.name) };
}

/* Le type est fixé au dépôt D'APRÈS LES OCTETS, et c'est lui que le
   service public renverra : jamais celui qu'annonçait le navigateur. */
export async function deposerFichiers(env, id, depot) {
  await env.MEDIAS.put(cleR2(id, depot.image.ext), depot.image.octets, { httpMetadata: { contentType: depot.image.type } });
  if (depot.vignette) {
    await env.MEDIAS.put(cleR2(id, depot.vignette.ext, true), depot.vignette.octets, { httpMetadata: { contentType: depot.vignette.type } });
  }
}

/* Compensation : un dépôt refusé APRÈS l'écriture dans R2 (quota atteint
   entre-temps) retire ses propres fichiers, tout neufs et cités nulle
   part. C'est le seul effacement de ce module. */
export async function retirerFichiers(env, id, depot) {
  try {
    await env.MEDIAS.delete(cleR2(id, depot.image.ext));
    if (depot.vignette) await env.MEDIAS.delete(cleR2(id, depot.vignette.ext, true));
  } catch (e) {
    console.error("Fichiers orphelins laissés dans R2 pour " + id + " :", e);
  }
}

/* ----- Le service public : GET|HEAD /medias/… -----

   ⚠️ Leçon de Graine de Pensée : une réponse fabriquée par un Worker
   n'entre pas toute seule dans le cache de Cloudflare — `Cache-Control` ne
   parle qu'au navigateur. Sans `caches.default`, chaque affichage d'une
   photo coûterait une requête Worker et une lecture R2. On ne met en cache
   que les GET : `cache.put` lève sur toute autre méthode, et l'exception
   partirait dans `waitUntil` sans que personne la voie.

   La clé de cache est l'adresse SANS sa chaîne de requête : sinon
   « ?1 », « ?2 »… contourneraient le cache et feraient lire R2 à chaque
   fois. */
const MOTIF_PHOTO = /^\/medias\/(vignettes\/)?([0-9a-f]{32})\.(jpg|png|webp)$/;
const UN_AN = 31_536_000;

function cacheParDefaut() {
  try {
    return typeof caches !== "undefined" && caches && caches.default ? caches.default : null;
  } catch {
    return null;
  }
}

function enTetesPhoto(objet, ext) {
  const declare = objet.httpMetadata && objet.httpMetadata.contentType;
  const h = new Headers({
    // Un type hors des trois formats (fichier posé à la main dans R2) est
    // remplacé par celui de l'extension : jamais `text/html` servi d'ici.
    "Content-Type": TYPES_SERVIS.has(declare) ? declare : TYPES_IMAGES[ext],
    "Cache-Control": "public, max-age=" + UN_AN + ", immutable",
    "X-Content-Type-Options": "nosniff",
    // Si un navigateur ouvrait tout de même le fichier comme un document,
    // il n'y pourrait rien exécuter.
    "Content-Security-Policy": "default-src 'none'; sandbox"
  });
  if (objet.httpEtag) h.set("ETag", objet.httpEtag);
  return h;
}

function introuvable(methode, statut = 404) {
  return new Response(methode === "HEAD" ? null : (statut === 404 ? "Photo introuvable" : "Photo momentanément indisponible"), {
    status: statut,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}

export async function servirPhoto(request, env, ctx) {
  const methode = request.method;
  if (methode !== "GET" && methode !== "HEAD") {
    return new Response("Méthode non autorisée", { status: 405, headers: { Allow: "GET, HEAD", "X-Content-Type-Options": "nosniff" } });
  }
  const url = new URL(request.url);
  const m = MOTIF_PHOTO.exec(url.pathname);
  if (!m || !env || !env.MEDIAS) return introuvable(methode);
  const [, vignette, id, ext] = m;
  const cle = cleR2(id, ext, !!vignette);
  const cache = cacheParDefaut();
  const cleCache = new Request(url.origin + url.pathname, { method: "GET" });
  try {
    if (cache) {
      const trouve = await cache.match(cleCache);
      if (trouve) return methode === "HEAD" ? new Response(null, { status: trouve.status, headers: trouve.headers }) : trouve;
    }
    if (methode === "HEAD") {
      const objet = await env.MEDIAS.head(cle);
      if (!objet) return introuvable(methode);
      const h = enTetesPhoto(objet, ext);
      if (Number.isFinite(objet.size)) h.set("Content-Length", String(objet.size));
      return new Response(null, { status: 200, headers: h });
    }
    const objet = await env.MEDIAS.get(cle);
    if (!objet) return introuvable(methode);
    const reponse = new Response(objet.body, { status: 200, headers: enTetesPhoto(objet, ext) });
    if (cache) {
      const mise = cache.put(cleCache, reponse.clone()).catch((e) => console.error("Mise en cache d'une photo impossible :", e));
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(mise);
    }
    return reponse;
  } catch (e) {
    console.error("Lecture d'une photo impossible :", e);
    return introuvable(methode, 503);
  }
}
