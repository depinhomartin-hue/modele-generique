/* =========================================================
   Les opérations sur la structure du contenu
   =========================================================

   Module PUR, testé sous Node. Chaque fonction reçoit le contenu (la COPIE
   que lui passe `etat.transformer`), le modifie, et rend ce que l'écran a
   besoin de savoir (le nouvel identifiant, le nombre de liens réécrits…).
   Un geste impossible lève un `Refus` dont le message s'affiche tel quel :
   `transformer` n'applique alors rien.

   Aucune règle de FORME n'est réécrite ici : identifiants, adresses de
   page, chemins des liens et descripteurs des listes viennent de
   `/rendu/structure.js`, partagé avec le serveur. Ce module n'ajoute que
   les GESTES (monter, dupliquer, renommer partout…). */

import { PAGE_ACCUEIL, ancresDeLaPage } from "/rendu/page.js";
import { nouveauBloc, typeConnu } from "/rendu/registre.js";
import { descripteurListe, nouvelIdBloc, idDePage, cheminsVers, liensDansLesTextes, reecrireLiensDansTexte, lireChemin, ecrireChemin } from "/rendu/structure.js";
import { echapper, identifiantValide, texteBrut } from "/rendu/outils.js";
import { Refus, pageDuLien, cibleInterne, analyserDestination } from "./liens.js";

export { Refus };

/* Les plafonds du serveur (spécification § 4) : mieux vaut refuser le
   geste en le disant que laisser l'enregistrement échouer ensuite. */
export const MAX_PAGES = 20;
export const MAX_BLOCS = 150;
/* L'ordre d'une page est un tableau, et le serveur borne TOUT tableau à
   60 éléments (§ 4). Seul le plafond des 150 sections du site était
   vérifié ici : la 61e section d'une page passait, puis chaque
   enregistrement suivant revenait refusé, avec un message sur « une
   liste » qui ne disait pas laquelle (relecture du 3 octobre 2026). */
export const MAX_SECTIONS_PAGE = 60;
const PAGE_PLEINE = "Cette page a déjà " + MAX_SECTIONS_PAGE + " sections : c'est le maximum. Supprimez-en une, ou créez une autre page.";

const aEnPropre = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
const copie = (v) => JSON.parse(JSON.stringify(v));

function page(contenu, pageId) {
  if (!aEnPropre(contenu.pages, pageId)) throw new Refus("Cette page n'existe plus. Rechargez l'éditeur.");
  return contenu.pages[pageId];
}
function bloc(contenu, id) {
  if (!aEnPropre(contenu.blocs, id)) throw new Refus("Cette section n'existe plus.");
  return contenu.blocs[id];
}
const nombreDeBlocs = (contenu) => Object.keys(contenu.blocs).length;

/* ----- Les sections ----- */

export function deplacerBloc(contenu, pageId, id, sens) {
  const ordre = page(contenu, pageId).ordre;
  const i = ordre.indexOf(id);
  const j = i + (sens < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= ordre.length) return false;
  [ordre[i], ordre[j]] = [ordre[j], ordre[i]];
  return true;
}

/* Rend le nouvel état : `true` = masquée. On ne range jamais `false` :
   la seule forme qui compte est `masque: true` (page.js efface le reste). */
export function basculerMasque(contenu, id) {
  const b = bloc(contenu, id);
  if (b.masque === true) {
    delete b.masque;
    return false;
  }
  b.masque = true;
  return true;
}

/* La copie prend un identifiant neuf et PAS l'ancre de l'original : deux
   sections qui demanderaient « #horaires » n'en auraient qu'une, et les
   liens du menu continueraient de viser l'original. */
export function dupliquerBloc(contenu, pageId, id) {
  const ordre = page(contenu, pageId).ordre;
  const original = bloc(contenu, id);
  if (ordre.length >= MAX_SECTIONS_PAGE) throw new Refus(PAGE_PLEINE);
  if (nombreDeBlocs(contenu) >= MAX_BLOCS) throw new Refus("Votre site a déjà " + MAX_BLOCS + " sections : c'est le maximum. Supprimez-en une pour en ajouter.");
  const double = copie(original);
  delete double.ancre;
  const nouvel = nouvelIdBloc(double.type, contenu.blocs);
  if (!nouvel) throw new Refus("Cette section ne peut pas être dupliquée.");
  contenu.blocs[nouvel] = double;
  const i = ordre.indexOf(id);
  ordre.splice(i < 0 ? ordre.length : i + 1, 0, nouvel);
  return nouvel;
}

/* La section disparaît de la page ; son contenu aussi, sauf si une autre
   page la montre encore. */
export function supprimerBloc(contenu, pageId, id) {
  const p = page(contenu, pageId);
  p.ordre = p.ordre.filter((x) => x !== id);
  const ailleurs = Object.values(contenu.pages).some((q) => q.ordre.includes(id));
  if (!ailleurs) delete contenu.blocs[id];
  return true;
}

/* Insérée après `apresId` s'il est sur la page, sinon à la fin. */
export function ajouterBloc(contenu, pageId, type, apresId = null) {
  const ordre = page(contenu, pageId).ordre;
  if (!typeConnu(type)) throw new Refus("Ce genre de section n'existe pas.");
  if (ordre.length >= MAX_SECTIONS_PAGE) throw new Refus(PAGE_PLEINE);
  if (nombreDeBlocs(contenu) >= MAX_BLOCS) throw new Refus("Votre site a déjà " + MAX_BLOCS + " sections : c'est le maximum. Supprimez-en une pour en ajouter.");
  const id = nouvelIdBloc(type, contenu.blocs);
  contenu.blocs[id] = nouveauBloc(type);
  const i = apresId ? ordre.indexOf(apresId) : -1;
  ordre.splice(i < 0 ? ordre.length : i + 1, 0, id);
  return id;
}

/* ----- Les ancres et les liens qui les visent ----- */

function ancreEffective(contenu, pageId, id) {
  return ancresDeLaPage(contenu, page(contenu, pageId))[id] || id;
}

/* Chaque lien interne du contenu, avec la page et l'ancre qu'il vise.

   DEUX sortes de liens (relecture du 3 octobre 2026) : ceux qui ont leur
   propre case (`vers`, `lienPlan` : `cheminsVers`) et ceux que la barre de
   mise en forme écrit DANS un texte (`<a href>` d'un paragraphe :
   `liensDansLesTextes`). Seuls les premiers étaient vus : renommer une
   ancre annonçait « 3 liens suivis » et laissait mort le lien du
   paragraphe ; supprimer une page laissait « /tarifs » dans un texte,
   vers une page introuvable. Les seconds portent `riche: true`, et leur
   `chemin` est celui du TEXTE : on ne l'écrit jamais tel quel, on le
   réécrit lien par lien (`reecrireLiensDansTexte`). Un même texte peut en
   porter plusieurs : il revient une fois par lien. */
function liensInternes(contenu) {
  const liens = [];
  for (const chemin of cheminsVers(contenu)) {
    const vers = lireChemin(contenu, chemin);
    if (typeof vers !== "string") continue;
    const contexte = pageDuLien(contenu, chemin, PAGE_ACCUEIL);
    const cible = cibleInterne(vers, contexte);
    if (cible) liens.push({ chemin, vers, contexte, cible, riche: false });
  }
  for (const { chemin, vers } of liensDansLesTextes(contenu)) {
    const contexte = pageDuLien(contenu, chemin, PAGE_ACCUEIL);
    const cible = cibleInterne(vers, contexte);
    if (cible) liens.push({ chemin, vers, contexte, cible, riche: true });
  }
  return liens;
}

/* Réécrit, dans chaque texte cité par `liens` (des liens `riche`), les liens
   que `choisir(vers, contexte)` désigne : il rend la nouvelle adresse, ""
   pour défaire le lien (ses mots restent), ou `null` pour n'y pas toucher.
   Rend le nombre de liens touchés. Le texte est relu ici, et non recopié
   de la liste : deux liens d'un même texte se réécrivent en une passe. */
function reecrireTextes(contenu, liens, choisir) {
  let touches = 0;
  const chemins = new Map();
  for (const l of liens) if (l.riche && !chemins.has(l.chemin)) chemins.set(l.chemin, l.contexte);
  for (const [chemin, contexte] of chemins) {
    const avant = lireChemin(contenu, chemin);
    if (typeof avant !== "string") continue;
    const apres = reecrireLiensDansTexte(avant, (vers) => {
      const nouveau = choisir(vers, contexte);
      if (typeof nouveau !== "string" || nouveau === vers) return vers;
      touches++;
      return nouveau;
    });
    if (apres !== avant) ecrireChemin(contenu, chemin, apres);
  }
  return touches;
}

/* Les liens qui mènent à une section : pour prévenir avant de la
   supprimer ou de la masquer (ils ne mèneraient plus nulle part). Un
   chemin par lien — un texte qui en porte deux y figure deux fois. */
export function liensVersBloc(contenu, pageId, id) {
  const ancre = ancreEffective(contenu, pageId, id);
  return liensInternes(contenu)
    .filter((l) => l.cible.page === pageId && l.cible.ancre === ancre)
    .map((l) => l.chemin);
}

/* « Nos pains » → « nos-pains », par la même règle que les adresses de
   page (`idDePage`) : minuscules, sans accents, des tirets. */
export function ancreDepuisTexte(texte) {
  return idDePage(texte, {});
}

/* Renomme l'ancre d'une section et réécrit TOUS les liens qui la visaient,
   sous la forme qu'ils avaient (« #a », « /#a », « /page#a »). Un texte
   vide rend à la section son ancre d'origine (son identifiant).
   Rend `{ ancre, liens }` : la nouvelle ancre et le nombre de liens suivis. */
export function renommerAncre(contenu, pageId, id, texte) {
  const p = page(contenu, pageId);
  const b = bloc(contenu, id);
  const ancienne = ancreEffective(contenu, pageId, id);
  const voulue = String(texte || "").trim().replace(/^#/, "");
  let nouvelle;
  if (!voulue) {
    nouvelle = id;
  } else {
    nouvelle = identifiantValide(voulue) ? voulue : ancreDepuisTexte(voulue);
    if (nouvelle === "contenu") throw new Refus("« #contenu » est réservé par le site. Choisissez un autre mot.");
  }
  if (nouvelle === ancienne) return { ancre: ancienne, liens: 0 };
  // Une autre section de la page la porte déjà (ou s'appelle ainsi :
  // son identifiant lui sert d'ancre de secours).
  const ancres = ancresDeLaPage(contenu, p);
  for (const autre of p.ordre) {
    if (autre === id) continue;
    if (ancres[autre] === nouvelle || autre === nouvelle) {
      throw new Refus("Une autre section de cette page utilise déjà « #" + nouvelle + " ». Choisissez un autre mot.");
    }
  }
  const vise = (vers, contexte) => {
    const c = cibleInterne(vers, contexte);
    return !!c && c.page === pageId && c.ancre === ancienne;
  };
  const liens = liensInternes(contenu).filter((l) => vise(l.vers, l.contexte));
  if (nouvelle === id) delete b.ancre;
  else b.ancre = nouvelle;
  const effective = ancreEffective(contenu, pageId, id);
  const suivre = (vers) => vers.replace(/#[^#]*$/, "#" + effective);
  for (const l of liens) {
    if (!l.riche) ecrireChemin(contenu, l.chemin, suivre(l.vers));
  }
  const dansLesTextes = reecrireTextes(contenu, liens, (vers, contexte) => (vise(vers, contexte) ? suivre(vers) : null));
  return { ancre: effective, liens: liens.filter((l) => !l.riche).length + dansLesTextes };
}

/* ----- Les listes (cartes, photos, questions, liens du menu…) -----

   Rend l'indice de l'élément à montrer ensuite (celui qui a bougé, la
   copie, le nouvel élément), ou -1 si la liste est vide. */
export function operationListe(contenu, chemin, index, action) {
  const d = descripteurListe(contenu, chemin);
  if (!d) throw new Refus("Cette liste ne se modifie pas ici.");
  let liste = lireChemin(contenu, chemin);
  if (!Array.isArray(liste)) {
    liste = [];
    if (!ecrireChemin(contenu, chemin, liste)) throw new Refus("Cette liste ne se modifie pas ici.");
  }
  const plein = () => {
    if (liste.length >= d.max) throw new Refus("Cette liste est complète : " + d.max + " au maximum. Supprimez-en un élément pour en ajouter un autre.");
  };
  const i = Number(index);
  switch (action) {
    case "monter":
      if (!(i > 0 && i < liste.length)) return i;
      [liste[i - 1], liste[i]] = [liste[i], liste[i - 1]];
      return i - 1;
    case "descendre":
      if (!(i >= 0 && i < liste.length - 1)) return i;
      [liste[i], liste[i + 1]] = [liste[i + 1], liste[i]];
      return i + 1;
    case "dupliquer": {
      plein();
      const source = liste[i] && typeof liste[i] === "object" ? copie(liste[i]) : d.modele;
      liste.splice(i + 1, 0, source);
      return i + 1;
    }
    case "ajouter-apres":
      plein();
      liste.splice(Math.min(Math.max(i + 1, 0), liste.length), 0, d.modele);
      return Math.min(Math.max(i + 1, 0), liste.length - 1);
    case "ajouter":
      plein();
      liste.push(d.modele);
      return liste.length - 1;
    case "supprimer":
      if (!(i >= 0 && i < liste.length)) return -1;
      liste.splice(i, 1);
      return liste.length ? Math.min(i, liste.length - 1) : -1;
    default:
      throw new Refus("Opération inconnue.");
  }
}

/* ----- Les pages ----- */

/* Une page neuve naît avec une accroche qui porte son nom : une page vide
   ne laisserait rien à cliquer, et l'artisan ne saurait pas par où
   commencer. L'adresse vient de `idDePage` (jamais réservée, jamais prise).
   Rend `{ pageId, auMenu, menuPlein }`. */
export function ajouterPage(contenu, nom, { auMenu = true } = {}) {
  const titre = String(nom || "").replace(/\s+/g, " ").trim();
  if (!titre) throw new Refus("Donnez un nom à la nouvelle page.");
  if (Object.keys(contenu.pages).length >= MAX_PAGES) throw new Refus("Votre site a déjà " + MAX_PAGES + " pages : c'est le maximum.");
  if (nombreDeBlocs(contenu) >= MAX_BLOCS) throw new Refus("Votre site a déjà " + MAX_BLOCS + " sections : supprimez-en une avant d'ajouter une page.");
  const pageId = idDePage(titre, contenu.pages);
  const premier = nouvelIdBloc("accroche", contenu.blocs);
  const accroche = nouveauBloc("accroche");
  accroche.titre = echapper(titre);
  contenu.blocs[premier] = accroche;
  contenu.pages[pageId] = { titre, description: "", ordre: [premier] };
  let ajoute = false;
  let menuPlein = false;
  if (auMenu) {
    const d = descripteurListe(contenu, "entete.liens");
    if (!contenu.entete || typeof contenu.entete !== "object") contenu.entete = {};
    if (!Array.isArray(contenu.entete.liens)) contenu.entete.liens = [];
    if (d && contenu.entete.liens.length >= d.max) menuPlein = true;
    else {
      contenu.entete.liens.push({ texte: titre, vers: "/" + pageId });
      ajoute = true;
    }
  }
  return { pageId, auMenu: ajoute, menuPlein };
}

/* Ce que coûterait la suppression d'une page, pour le dire AVANT :
   ses sections, les liens du menu et du pied qui y mènent (retirés), les
   autres liens qui y mènent (vidés — le bouton disparaît du site), et les
   liens écrits dans un texte (`textes` : défaits, leurs mots restent). */
export function analyserSuppressionPage(contenu, pageId) {
  if (pageId === PAGE_ACCUEIL) throw new Refus("L'accueil ne peut pas être supprimé.");
  const p = page(contenu, pageId);
  let retires = 0;
  let vides = 0;
  let textes = 0;
  for (const l of liensVersLaPage(contenu, pageId)) {
    if (l.riche) textes++;
    else if (/^(entete|pied)\.liens\.\d+\.vers$/.test(l.chemin)) retires++;
    else vides++;
  }
  return { sections: p.ordre.length, retires, vides, textes };
}

/* Les liens qui mènent à une page, sauf ceux qui partiront avec elle (un
   lien rangé dans une section qu'aucune autre page ne montre). */
function liensVersLaPage(contenu, pageId) {
  const propres = new Set(page(contenu, pageId).ordre);
  return liensInternes(contenu).filter((l) => {
    if (l.cible.page !== pageId) return false;
    const b = /^blocs\.([^.]+)\./.exec(l.chemin);
    return !(b && propres.has(b[1]) && !Object.entries(contenu.pages).some(([id, q]) => id !== pageId && q.ordre.includes(b[1])));
  });
}

export function supprimerPage(contenu, pageId) {
  const bilan = analyserSuppressionPage(contenu, pageId);
  const p = page(contenu, pageId);
  const aRetirer = { entete: [], pied: [] };
  const liens = liensVersLaPage(contenu, pageId);
  for (const l of liens) {
    if (l.riche) continue;
    const m = /^(entete|pied)\.liens\.(\d+)\.vers$/.exec(l.chemin);
    if (m) aRetirer[m[1]].push(Number(m[2]));
    else ecrireChemin(contenu, l.chemin, "");
  }
  // Un lien écrit dans un texte est DÉFAIT, comme « Aucun lien » de la
  // barre de mise en forme : « nos tarifs » redevient du texte simple au
  // lieu de mener à une page introuvable.
  reecrireTextes(contenu, liens, (vers, contexte) => {
    const c = cibleInterne(vers, contexte);
    return c && c.page === pageId ? "" : null;
  });
  // Du dernier au premier : retirer l'élément 1 avant le 3 décalerait le 3.
  for (const zone of ["entete", "pied"]) {
    for (const i of aRetirer[zone].sort((a, b) => b - a)) contenu[zone].liens.splice(i, 1);
  }
  for (const id of p.ordre) {
    const ailleurs = Object.entries(contenu.pages).some(([autre, q]) => autre !== pageId && q.ordre.includes(id));
    if (!ailleurs) delete contenu.blocs[id];
  }
  delete contenu.pages[pageId];
  return bilan;
}

/* ----- Ce que montre le panneau ----- */

/* Les photos d'une section : chaque champ `image` ou `src` qui est du
   texte (les mêmes clés que `cheminAlt` sait décrire). */
export function cheminsImages(contenu, id) {
  const chemins = [];
  if (!aEnPropre(contenu.blocs, id)) return chemins;
  const parcourir = (v, chemin, profondeur) => {
    if (!v || typeof v !== "object" || profondeur > 6) return;
    for (const [k, x] of Object.entries(v)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype" || k.includes(".")) continue;
      const c = chemin + "." + k;
      if ((k === "image" || k === "src") && typeof x === "string") chemins.push(c);
      else if (x && typeof x === "object") parcourir(x, c, profondeur + 1);
    }
  };
  parcourir(contenu.blocs[id], "blocs." + id, 0);
  return chemins;
}

/* Les liens d'une section, pour les modifier depuis le panneau. */
export function cheminsLiensDuBloc(contenu, id) {
  const prefixe = "blocs." + id + ".";
  return cheminsVers(contenu).filter((c) => c.startsWith(prefixe));
}

/* Le nom d'un élément de liste, pour le panneau : son premier texte non
   vide, sinon « Carte 3 ». */
const CHAMPS_NOM = ["titre", "question", "texte", "jour", "legende", "auteur", "alt"];
export function nomElement(element, libelle, index) {
  if (element && typeof element === "object") {
    for (const k of CHAMPS_NOM) {
      const lettres = Array.from(texteBrut(element[k]));
      if (lettres.length) return lettres.length > 48 ? lettres.slice(0, 47).join("").trimEnd() + "…" : lettres.join("");
    }
  }
  const mot = String(libelle || "élément").replace(/^(un|une)\s+/i, "");
  return mot.charAt(0).toUpperCase() + mot.slice(1) + " " + (Number(index) + 1);
}

/* Le bouton de l'en-tête est « affiché » tant qu'il n'est pas masqué
   (`entete.bouton.masque`) : c'est la règle du rendu (`boutonEntete`,
   page.js), qui le dessine en édition même vide, pour qu'on puisse
   cliquer dedans. Sur le site, il lui faut en plus un texte et un lien —
   le panneau le dit.

   Masquer ne VIDE PLUS le texte (relecture du 3 octobre 2026) : le libellé
   n'était gardé qu'en mémoire, dans l'éditeur ouvert, et après un
   rechargement « Réserver votre kougelhopf » revenait sous le nom « Nous
   contacter ». La marque `masque: true` est le seul geste ; le texte reste
   où il est. Comme pour une section, on ne range jamais `masque: false`. */
export function boutonEnteteAffiche(contenu) {
  const b = contenu.entete && contenu.entete.bouton;
  return !!(b && typeof b === "object" && !Array.isArray(b) && b.masque !== true);
}

export const TEXTE_BOUTON_ENTETE = "Nous contacter";

/* Rend `true` si le bouton a besoin d'une destination (il n'en a pas). */
export function afficherBoutonEntete(contenu, afficher) {
  if (!contenu.entete || typeof contenu.entete !== "object") contenu.entete = {};
  const e = contenu.entete;
  if (!e.bouton || typeof e.bouton !== "object" || Array.isArray(e.bouton)) e.bouton = { texte: "", vers: "" };
  const b = e.bouton;
  if (!afficher) {
    b.masque = true;
    return false;
  }
  delete b.masque;
  // Un texte vidé à la main sur la page : il faut bien un mot à cliquer.
  if (typeof b.texte !== "string" || !b.texte.trim()) b.texte = TEXTE_BOUTON_ENTETE;
  return !(typeof b.vers === "string" && b.vers.trim());
}

export { analyserDestination };
