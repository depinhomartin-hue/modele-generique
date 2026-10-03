/* =========================================================
   Outils de rendu — communs au serveur (Worker) et au navigateur
   =========================================================

   Ce module est ISOMORPHE : le Worker l'importe pour rendre la page,
   l'éditeur (phase 2) le chargera tel quel depuis /rendu/outils.js.
   Il ne touche donc ni à `document` ni à `window` : tout est fait sur des
   chaînes. Graine de Pensée nettoyait le texte riche avec le DOM du
   navigateur ; ici le rendu se fait d'abord sur le serveur, qui n'en a
   pas.

   Règle : tout ce qui vient du contenu passe par une de ces fonctions
   avant d'entrer dans le HTML. Le contenu n'est écrit que par un client
   authentifié, mais une page publique ne fait confiance à personne. */

/* ----- Le texte d'un champ -----

   Toute valeur lue dans le contenu passe d'abord par ici. Une chaîne reste
   une chaîne, un nombre devient sa chaîne, TOUT LE RESTE devient vide.

   Relecture du 3 octobre 2026 : sans ce filtre, un objet à la place d'un
   titre s'affichait « [object Object] », et un objet piégé
   (`{"toString":1}`) faisait LEVER `String()` — hors du filet des blocs,
   donc une erreur 500 sur tout le site. Un contenu abîmé doit donner une
   page incomplète, jamais une page en erreur. */
export function texte(v) {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/* Texte brut → HTML. Pour tout ce qui n'est PAS du texte riche. */
export function echapper(s) {
  return texte(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

/* ----- Adresses -----

   Liste blanche de schémas : `javascript:`, `data:` et tout le reste
   tombent. Un lien relatif ou une ancre passent tels quels.

   Une contre-oblique ou un caractère de contrôle refusent l'adresse
   entière : un navigateur lit « /\hôte » et « /<tab>/hôte » comme
   « //hôte », c'est-à-dire un AUTRE site (relecture du 3 octobre 2026). */
const SCHEMAS_SURS = /^(https?:|mailto:|tel:)/i;
const RELATIF = /^(#|\/(?![/\\])|\.\/|\.\.\/)/;
const SUSPECT = /[\\\u0000-\u001F\u007F]/;

export function adresseSure(u) {
  const s = texte(u).trim();
  if (!s || SUSPECT.test(s)) return "";
  if (RELATIF.test(s) || SCHEMAS_SURS.test(s)) return s;
  return "";
}

/* Une ancre seule (« # ») n'est pas une destination : sur le site, un
   bouton qui y mène ne mènerait nulle part. */
export function destination(u) {
  const s = adresseSure(u);
  return s === "#" ? "" : s;
}

/* Un lien ne s'ouvre dans un nouvel onglet que s'il QUITTE le site.
   Leçon de Graine de Pensée : `target="_blank"` posé en dur finit
   toujours par ouvrir le site lui-même dans un second onglet. */
export function cible(u) {
  return /^https?:/i.test(adresseSure(u)) ? ' target="_blank" rel="noopener"' : "";
}

/* Images : un chemin du site ou une adresse https, rien d'autre. */
export function imageSure(u) {
  const s = texte(u).trim();
  if (!s || SUSPECT.test(s)) return "";
  if (/^\/(?![/\\])/.test(s) || /^https:\/\//i.test(s)) return s;
  return "";
}

/* ----- Téléphone -----

   Le numéro reste TOUJOURS écrit en clair, tel que le client l'a saisi ;
   le lien `tel:` n'est qu'une commodité. On ne le fabrique que si le
   numéro a la forme d'un numéro composable, sinon le texte reste sans
   lien plutôt que d'appeler un faux numéro (« +33 (0)3… » gardait le 0 ;
   « 03… / 06… » collait deux numéros).

   Le PREMIER numéro seulement ; « (0) » après un indicatif est retiré.

   Relecture du 3 octobre 2026 : le découpage entourait le séparateur de
   deux `\s*`, et celui de tête se rejouait à chaque position d'une suite
   d'espaces — un temps QUADRATIQUE. Un champ de 20 000 espaces suivis de
   « x », accepté par le serveur, coûtait près d'une demi-seconde de
   processeur à CHAQUE visite (le même défaut que `texteRiche` et
   `texteBrut` ont déjà payé). Deux gardes désormais :
   - la longueur est bornée AVANT toute expression (les blancs des deux
     bouts retirés d'abord, en temps linéaire) : un numéro composable
     tient en quelques dizaines de caractères ; un premier numéro qui ne
     s'arrête pas dans la borne n'est pas un numéro, il reste sans lien ;
   - le découpage ne cherche que le séparateur. Les blancs autour n'y
     servaient à rien : ils sont retirés plus bas avec tout ce qui n'est
     pas un chiffre. */
const LONGUEUR_TELEPHONE = 200;
const SEPARATEUR_TELEPHONE = /[/,;]|\bou\b/i;

export function lienTelephone(numero) {
  const tout = texte(numero).trim();
  const borne = tout.slice(0, LONGUEUR_TELEPHONE);
  const coupe = borne.search(SEPARATEUR_TELEPHONE);
  if (coupe < 0 && tout.length > LONGUEUR_TELEPHONE) return "";
  const premier = coupe < 0 ? borne : borne.slice(0, coupe);
  const sansZero = premier.replace(/^(\s*\+\d{1,3})\s*\(0\)/, "$1");
  if (/[^\d\s.+()-]/.test(sansZero)) return "";
  const brut = sansZero.replace(/[^\d+]/g, "");
  if (/^0\d{9}$/.test(brut) || /^\+\d{8,15}$/.test(brut)) return "tel:" + brut;
  return "";
}

/* ----- Texte riche -----

   Liste BLANCHE, et non liste noire comme dans Graine de Pensée : on ne
   cherche pas ce qui est dangereux, on ne garde que ce qu'on connaît.
   Toute balise inconnue disparaît (son texte reste), tout attribut
   inconnu aussi, et les balises sont refermées dans l'ordre : un <strong>
   oublié ne peut pas mettre toute la page en gras. */
const TAILLES = new Set(["petit", "grand", "tres-grand"]);
const BALISES = {
  strong: [], b: [], em: [], i: [], u: [], br: [],
  a: ["href"],
  span: ["data-taille", "data-police"]
};
const VIDES = new Set(["br"]);
const ENTITE = /^&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/i;
const aEnPropre = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function echapperTexteRiche(t) {
  // Le texte riche est stocké en HTML : « &amp; » y est déjà un « & ».
  // On garde donc les entités valides et on échappe tout le reste.
  let sortie = "";
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "&") {
      const m = ENTITE.exec(t.slice(i, i + 40));
      if (m) { sortie += m[0]; i += m[0].length - 1; } else sortie += "&amp;";
    } else if (c === "<") sortie += "&lt;";
    else if (c === ">") sortie += "&gt;";
    else if (c === '"') sortie += "&quot;";
    else sortie += c;
  }
  return sortie;
}

/* La LECTURE des balises et de leurs attributs, une seule fois écrite.
   `texteRiche` s'en sert pour nettoyer ; `structure.js` pour retrouver et
   réécrire les liens posés dans un texte (renommer une ancre, retirer une
   page). Deux lectures différentes d'un même texte finiraient par ne pas
   voir les mêmes liens : l'éditeur en suivrait un que la page n'affiche
   pas, ou l'inverse (relecture du 3 octobre 2026).

   `motifBalise()` rend une expression NEUVE : elle porte le drapeau `g`,
   donc une position de lecture, qu'un appelant ne doit pas partager.
   `attributsDe()` rend chaque attribut avec sa place dans le texte lu
   (`debut`, `fin`), pour qu'on puisse en remplacer un sans toucher au
   reste. Un attribut répété : c'est le DERNIER qui compte, comme ici. */
export function motifBalise() {
  return /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*)>/g;
}

export function attributsDe(brut) {
  const liste = [];
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(brut))) {
    liste.push({ nom: m[1].toLowerCase(), valeur: m[2] ?? m[3] ?? m[4] ?? "", debut: m.index, fin: re.lastIndex });
  }
  return liste;
}

function lireAttributs(brut) {
  const attrs = {};
  for (const a of attributsDe(brut)) attrs[a.nom] = a.valeur;
  return attrs;
}

/* L'adresse d'un lien de texte, telle que le nettoyeur la lit : seul
   « &amp; » est décodé (c'est la forme que `echapper` écrit). */
export function adresseDeLien(valeur) {
  return texte(valeur).replace(/&amp;/g, "&");
}

/* `options.polices` : les polices permises dans `data-police`.
   `options.lien` : une fonction appliquée à chaque adresse SÛRE d'un lien
   avant de l'écrire — le pied de page s'en sert pour faire viser l'accueil
   à ses ancres (voir `rendrePied`, page.js). Ce qu'elle rend repasse par
   `adresseSure` : elle ne peut pas faire entrer une adresse refusée. */
export function texteRiche(html, options = {}) {
  const polices = options.polices instanceof Set ? options.polices : null;
  const transformerLien = typeof options.lien === "function" ? options.lien : null;
  const source = texte(html);
  const pile = [];
  // Combien de balises de chaque nom sont ouvertes : une fermeture
  // orpheline s'écarte en temps constant. (Avec une recherche dans la pile,
  // des milliers de fermetures orphelines faisaient un temps quadratique —
  // de quoi épuiser le processeur du Worker avec un seul champ.)
  const ouvertes = new Map();
  let sortie = "";
  let dernier = 0;
  const re = motifBalise();
  let m;
  while ((m = re.exec(source))) {
    sortie += echapperTexteRiche(source.slice(dernier, m.index));
    dernier = re.lastIndex;
    const fermante = m[1] === "/";
    const nom = m[2].toLowerCase();
    if (!aEnPropre(BALISES, nom)) continue;     // balise inconnue : on la retire, son texte reste
    if (fermante) {
      if (!ouvertes.get(nom)) continue;         // fermeture orpheline : ignorée
      let haut;
      do {
        haut = pile.pop();
        ouvertes.set(haut, ouvertes.get(haut) - 1);
        sortie += "</" + haut + ">";
      } while (haut !== nom);
      continue;
    }
    if (VIDES.has(nom)) { sortie += "<" + nom + ">"; continue; }
    if (pile.length >= 16) continue;            // profondeur bornée : du gras dans de l'italique suffit
    const attrs = lireAttributs(m[3]);
    let propres = "";
    for (const nomAttr of BALISES[nom]) {
      if (!aEnPropre(attrs, nomAttr)) continue;
      const v = attrs[nomAttr];
      if (nomAttr === "href") {
        let sure = adresseSure(adresseDeLien(v));
        if (sure && transformerLien) sure = adresseSure(transformerLien(sure));
        if (sure) propres += ' href="' + echapper(sure) + '"' + cible(sure);
      } else if (nomAttr === "data-taille") {
        if (TAILLES.has(v)) propres += ' data-taille="' + v + '"';
      } else if (nomAttr === "data-police") {
        if (polices && polices.has(v)) propres += ' data-police="' + echapper(v) + '"';
      }
    }
    if (nom === "a" && !/\shref=/.test(propres)) continue;   // un lien sans adresse sûre n'est plus un lien
    sortie += "<" + nom + propres + ">";
    pile.push(nom);
    ouvertes.set(nom, (ouvertes.get(nom) || 0) + 1);
  }
  sortie += echapperTexteRiche(source.slice(dernier));
  while (pile.length) sortie += "</" + pile.pop() + ">";
  return sortie;
}

/* Le texte sans sa mise en forme : titre d'onglet, `alt`, description pour
   les moteurs de recherche. Un saut de ligne vaut une espace.
   `[^<>]` et non `[^>]` : sur une suite de « < », la seconde forme
   devenait quadratique. */
const ENTITES_COURANTES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function texteBrut(html) {
  return texte(html)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^<>]*>/g, "")
    .replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, (m, e) => {
      if (e[0] === "#") {
        const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
      }
      const cle = e.toLowerCase();
      return aEnPropre(ENTITES_COURANTES, cle) ? ENTITES_COURANTES[cle] : m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function estVide(html) {
  return texteBrut(html) === "";
}

/* ----- Identifiants -----

   Un identifiant de bloc ou une ancre : minuscules, chiffres et tirets.
   JAMAIS de point — leçon de Graine de Pensée : les chemins d'édition
   (`blocs.accroche-1.titre`) se découpent sur le point, et une clé qui en
   contiendrait un serait coupée au mauvais endroit, sans erreur. */
export const IDENTIFIANT = /^[a-z][a-z0-9-]{0,47}$/;
export function identifiantValide(s) {
  return typeof s === "string" && IDENTIFIANT.test(s);
}

/* ----- Marques d'édition -----

   Posées UNIQUEMENT quand la page est rendue pour l'éditeur
   (`ctx.edition`). Une visiteuse reçoit un HTML propre ; l'éditrice, la
   même page avec, sur chaque texte, le chemin où il est rangé.

   `ed(ctx, chemin, { riche, lignes })` — un texte modifiable sur la page
   `edImg(ctx, chemin)`                 — une image qu'on change d'un clic
   `edDest(ctx, chemin)`                — l'adresse d'un lien ou d'un bouton
   `edListe(ctx, chemin, index)`        — un élément d'une liste */
export function ed(ctx, chemin, options = {}) {
  if (!ctx || !ctx.edition) return "";
  let a = ' data-edit="' + echapper(chemin) + '"';
  if (options.riche) a += " data-edit-riche";
  if (options.lignes) a += " data-edit-lignes";
  return a;
}
export function edImg(ctx, chemin) {
  return ctx && ctx.edition ? ' data-edit-img="' + echapper(chemin) + '"' : "";
}
export function edDest(ctx, chemin) {
  return ctx && ctx.edition ? ' data-edit-dest="' + echapper(chemin) + '"' : "";
}
export function edListe(ctx, chemin, index) {
  return ctx && ctx.edition
    ? ' data-liste="' + echapper(chemin) + '" data-index="' + Number(index) + '"'
    : "";
}

/* Un champ texte vide disparaît sur le site, mais RESTE en édition : sans
   ça, un titre effacé ne laisserait plus rien à cliquer pour le réécrire
   (leçon de Graine de Pensée, sur les boutons et les images). */
export function afficher(ctx, valeur) {
  return !estVide(valeur) || !!(ctx && ctx.edition);
}

/* Un bouton ou un lien d'appel. Rien si le texte est vide (sauf en
   édition), et jamais un bouton qui ne mène nulle part : sans destination
   réelle, le bouton n'est pas rendu sur le site. */
export function bouton(ctx, b, chemin, classes = "") {
  if (!b || typeof b !== "object") return "";
  const libelle = texte(b.texte);
  const vers = destination(b.vers);
  if (!ctx.edition && (estVide(libelle) || !vers)) return "";
  const style = b.style === "contour" ? "bouton--contour" : "bouton--plein";
  return '<a class="bouton ' + style + (classes ? " " + classes : "") + '" href="' + echapper(vers || "#") + '"' +
    cible(vers) + ed(ctx, chemin + ".texte") + edDest(ctx, chemin + ".vers") + sansLien(ctx, vers) + ">" + echapper(libelle) + "</a>";
}

/* `data-sans-lien` : en ÉDITION seulement, sur un bouton ou un lien qui
   n'a pas de destination — donc qu'aucune visiteuse ne verra. Relecture du
   3 octobre 2026 : une section « Appel à l'action » neuve montrait dans
   l'éditeur un beau bouton « Nous appeler » qui n'existait pas sur le
   site, sans rien pour le dire. La feuille du cadre de l'éditeur
   l'habille ; le site public ne reçoit jamais cet attribut.
   `vers` est l'adresse déjà passée par `destination()` (vide = aucune). */
export function sansLien(ctx, vers) {
  return ctx && ctx.edition && !vers ? " data-sans-lien" : "";
}

/* Une image du contenu. En édition, une image vide garde un cadre
   cliquable (leçon de Graine de Pensée) ; sur le site, elle n'écrit rien. */
export function image(ctx, src, alt, chemin, classes = "", chargement = "lazy") {
  const sure = imageSure(src);
  if (!sure) {
    return ctx.edition
      ? '<span class="image-attente ' + classes + '"' + edImg(ctx, chemin) + ' role="img" aria-label="Photo à choisir"></span>'
      : "";
  }
  return '<img class="' + classes + '" src="' + echapper(sure) + '" alt="' + echapper(texteBrut(alt)) + '" loading="' +
    chargement + '" decoding="async"' + edImg(ctx, chemin) + ">";
}
