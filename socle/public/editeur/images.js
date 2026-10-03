/* =========================================================
   Réduire une photo DANS LE NAVIGATEUR, avant l'envoi
   =========================================================

   Leçon de Graine de Pensée, mesurée le 13 septembre 2026 : une photo de
   téléphone de 2,8 Mo tombe à 280 Ko (−90 %) à 1600 px, sans différence
   visible à la taille d'affichage. Le Worker n'a pas le temps de calcul
   pour décoder une photo de douze mégapixels ; le navigateur, si.

   Trois pièges déjà payés là-bas, à ne pas réintroduire :
   — la TRANSPARENCE : un logo détouré aplati en JPEG se poserait sur un
     carré noir. On échantillonne le canal alpha ; s'il sert, PNG ;
   — l'ORIENTATION : une photo prise en portrait porte sa rotation dans
     ses métadonnées. `imageOrientation: "from-image"` l'applique ;
   — un format que le navigateur ne sait pas lire (HEIC de l'iPhone sur
     Chrome) : on le dit en clair, avec le geste qui règle le problème.

   Bonus : réencoder retire les métadonnées de la photo — dont la position
   GPS qu'un téléphone y écrit. Une photo de l'atelier publiée ne dit pas
   où habite l'artisan.

   `dimensionsReduites` est pure (testée sous Node) ; le reste demande un
   navigateur. */

export const COTE_MAX = 1600;
export const COTE_VIGNETTE = 400;
export const QUALITE_JPEG = 0.85;

export function dimensionsReduites(largeur, hauteur, max) {
  const l = Math.max(1, Math.round(Number(largeur) || 1));
  const h = Math.max(1, Math.round(Number(hauteur) || 1));
  const plusGrand = Math.max(l, h);
  if (plusGrand <= max) return { largeur: l, hauteur: h };
  const r = max / plusGrand;
  return { largeur: Math.max(1, Math.round(l * r)), hauteur: Math.max(1, Math.round(h * r)) };
}

export class PhotoIllisible extends Error {
  constructor(message) {
    super(message);
    this.name = "PhotoIllisible";
  }
}

const MESSAGE_ILLISIBLE = "Cette photo n'a pas pu être lue par votre navigateur. Enregistrez-la en JPEG, puis réessayez. " +
  "(Sur iPhone : Réglages › Appareil photo › Formats › « Le plus compatible ».)";

function toile(l, h) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(l, h);
  const c = document.createElement("canvas");
  c.width = l;
  c.height = h;
  return c;
}

function versBlob(c, type, qualite) {
  if (typeof c.convertToBlob === "function") return c.convertToBlob({ type, quality: qualite });
  return new Promise((resoudre, rejeter) => c.toBlob((b) => (b ? resoudre(b) : rejeter(new Error("toBlob"))), type, qualite));
}

/* Le canal alpha sert-il ? Échantillonné sur une réduction à 64 px au plus :
   un pixel partiellement transparent y reste partiellement transparent. */
function aDeLaTransparence(source) {
  const { largeur, hauteur } = dimensionsReduites(source.width, source.height, 64);
  const c = toile(largeur, hauteur);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, largeur, hauteur);
  const px = ctx.getImageData(0, 0, largeur, hauteur).data;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 255) return true;
  return false;
}

async function dessiner(source, max, type) {
  const { largeur, hauteur } = dimensionsReduites(source.width, source.height, max);
  const c = toile(largeur, hauteur);
  const ctx = c.getContext("2d");
  if (type === "image/jpeg") {
    // Le JPEG n'a pas de transparence : sans fond, les zones vides
    // sortiraient NOIRES.
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, largeur, hauteur);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, largeur, hauteur);
  const blob = await versBlob(c, type, type === "image/jpeg" ? QUALITE_JPEG : undefined);
  return { blob, largeur, hauteur };
}

/* → `{ image: Blob, vignette: Blob, type, extension, largeur, hauteur }`,
   ou lève `PhotoIllisible` avec un message à afficher tel quel. */
export async function preparerPhoto(fichier) {
  let source;
  try {
    source = await createImageBitmap(fichier, { imageOrientation: "from-image" });
  } catch {
    throw new PhotoIllisible(MESSAGE_ILLISIBLE);
  }
  try {
    // Un JPEG n'a jamais de transparence : inutile de la chercher.
    const peutEtreTransparent = !/jpe?g$/i.test(fichier.type || "") && !/\.jpe?g$/i.test(fichier.name || "");
    const type = peutEtreTransparent && aDeLaTransparence(source) ? "image/png" : "image/jpeg";
    const image = await dessiner(source, COTE_MAX, type);
    const vignette = await dessiner(source, COTE_VIGNETTE, type);
    return {
      image: image.blob,
      vignette: vignette.blob,
      type,
      extension: type === "image/png" ? "png" : "jpg",
      largeur: image.largeur,
      hauteur: image.hauteur
    };
  } catch (e) {
    if (e instanceof PhotoIllisible) throw e;
    throw new PhotoIllisible(MESSAGE_ILLISIBLE);
  } finally {
    if (source && typeof source.close === "function") source.close();
  }
}
