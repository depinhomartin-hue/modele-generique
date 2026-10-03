/* =========================================================
   Le rendu d'une page complète
   =========================================================

   `rendrePage()` fabrique le document HTML entier à partir du contenu et
   de la fiche du client. Le Worker l'appelle pour chaque visite ; la
   visiteuse reçoit une page COMPLÈTE, lisible sans JavaScript, que les
   moteurs de recherche lisent telle quelle. (Graine de Pensée construisait
   sa page dans le navigateur : pour un site vitrine, dont le référencement
   local est l'enjeu, ce socle fait l'inverse.)

   Les mêmes fonctions serviront à l'éditeur (phase 2), dans le navigateur :
   `rendreBloc()` pour redessiner un seul bloc, `rendreCorps()` pour la page
   sans son <head>. */

import { echapper, texteBrut, destination, cible, ed, edDest, edImg, edListe, imageSure, identifiantValide, afficher, estVide } from "./outils.js";
import { themeDe, variablesCss, lienPolices, liensPolicesCitees } from "./themes.js";
import { BLOCS, typeConnu } from "./registre.js";
import { lib, libHtml } from "./libelles.js";
import { riche, liste, ancre } from "./blocs/commun.js";

export const PAGE_ACCUEIL = "accueil";

/* ----- Lecture prudente du contenu -----

   Le contenu vient de KV, écrit par l'éditeur, ou du fichier livré avec le
   client. Dans les deux cas on ne lui fait pas confiance pour la
   STRUCTURE : un bloc d'un type inconnu, un identifiant invalide, un ordre
   qui cite un bloc absent sont écartés en silence, et la page s'affiche
   avec ce qui reste. Un contenu abîmé donne une page incomplète, jamais
   une erreur 500.

   Un bloc qui MANQUE d'un champ le reçoit VIDE — jamais le texte
   d'exemple de son modèle. Relecture du 3 octobre 2026 : un champ ajouté
   au socle après la mise en ligne d'un client aurait publié chez lui
   « Recopiez ici un vrai avis », un avis cinq étoiles anonyme ou des
   horaires inventés. Seuls les RÉGLAGES (disposition, fond, style,
   inverse) reprennent la valeur du modèle. Un champ PRÉSENT, même vide,
   n'est jamais touché : un titre effacé exprès reste effacé.

   (Un bloc NEUF, créé depuis l'éditeur, naît au contraire complet, textes
   d'exemple compris : c'est `nouveauBloc()`, dans registre.js.) */
const REGLAGES = new Set(["disposition", "fond", "style", "inverse"]);
const aEnPropre = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function vide(valeur, cle) {
  if (REGLAGES.has(cle)) return valeur;
  if (typeof valeur === "string") return "";
  if (Array.isArray(valeur)) return [];
  if (valeur && typeof valeur === "object") {
    return Object.fromEntries(Object.entries(valeur).map(([k, v]) => [k, vide(v, k)]));
  }
  return valeur;
}

function completer(bloc) {
  const modele = BLOCS[bloc.type].modele();
  const complet = {};
  for (const [cle, valeur] of Object.entries(modele)) {
    complet[cle] = aEnPropre(bloc, cle) ? bloc[cle] : vide(valeur, cle);
  }
  // Les champs que le modèle ne connaît pas (ancre, ou un champ d'une
  // version plus récente) sont gardés tels quels — mais jamais une clé qui
  // toucherait au prototype de l'objet.
  for (const [cle, valeur] of Object.entries(bloc)) {
    if (!aEnPropre(complet, cle) && cle !== "__proto__" && cle !== "constructor" && cle !== "prototype") complet[cle] = valeur;
  }
  complet.type = bloc.type;
  return complet;
}

export function normaliser(brut) {
  const c = brut && typeof brut === "object" ? brut : {};
  const objet = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

  const blocs = {};
  for (const [id, bloc] of Object.entries(objet(c.blocs))) {
    if (!identifiantValide(id) || !bloc || typeof bloc !== "object" || !typeConnu(bloc.type)) continue;
    blocs[id] = completer(bloc);
  }

  const pages = {};
  for (const [pageId, page] of Object.entries(objet(c.pages))) {
    if (!identifiantValide(pageId)) continue;
    const p = objet(page);
    const vus = new Set();
    const ordre = (Array.isArray(p.ordre) ? p.ordre : []).filter((id) => {
      // `aEnPropre` et non `blocs[id]` : « constructor » ou « toString »
      // existent sur tout objet, par son prototype (relecture du 3 octobre).
      if (typeof id !== "string" || !aEnPropre(blocs, id) || vus.has(id)) return false;
      vus.add(id);
      return true;
    });
    pages[pageId] = { titre: p.titre, description: p.description, interne: undefined, ordre };
  }
  if (!aEnPropre(pages, PAGE_ACCUEIL)) pages[PAGE_ACCUEIL] = { titre: "", description: "", ordre: [] };

  return {
    version: Number(c.version) || 1,
    site: objet(c.site),
    theme: objet(c.theme),
    entete: objet(c.entete),
    pied: objet(c.pied),
    libelles: objet(c.libelles),
    pages,
    blocs
  };
}

/* ----- Les blocs -----

   Un bloc qui lève une erreur pendant son rendu ne doit pas emporter la
   page entière : il est remplacé par rien sur le site, et par un cadre
   explicite en édition — un bloc qui disparaît sans un mot est le pire des
   défauts pour l'éditrice. */
export function rendreBloc(id, bloc, ctx) {
  try {
    return BLOCS[bloc.type].rendre(bloc, id, ctx);
  } catch (e) {
    if (typeof console !== "undefined") console.error("Bloc " + id + " :", e);
    return ctx.edition
      ? '<section class="bloc bloc--erreur" data-bloc="' + echapper(id) + '"><div class="conteneur"><p>Ce bloc n\'a pas pu s\'afficher.</p></div></section>'
      : "";
  }
}

/* ----- En-tête : la marque, le menu, le bouton -----

   Le menu existe DEUX fois dans le HTML : en ligne sur grand écran, dans un
   <details> sur téléphone. C'est ce qui permet un menu de téléphone qui
   s'ouvre et se ferme SANS JavaScript ; le CSS n'en montre qu'un à la fois
   (`display:none` retire l'autre aussi pour les lecteurs d'écran).

   L'en-tête et le pied de page sont COMMUNS à toutes les pages : une ancre
   « #horaires » qui y figure vise l'accueil. Sur une autre page (ou sur la
   page introuvable), elle devient « /#horaires » — sans quoi tous les
   liens du menu y menaient nulle part (relecture du 3 octobre 2026). */
function versGlobal(vers, ctx) {
  return vers.startsWith("#") && ctx.pageId !== PAGE_ACCUEIL ? "/" + vers : vers;
}

function lienNav(l, i, liste_, ctx) {
  if (!l) return "";
  const vers = destination(l.vers);
  if (!ctx.edition && (!vers || estVide(l.texte))) return "";
  const href = versGlobal(vers || "#", ctx);
  return "<li" + edListe(ctx, liste_, i) + '><a href="' + echapper(href) + '"' + cible(vers) +
    ed(ctx, liste_ + "." + i + ".texte") + edDest(ctx, liste_ + "." + i + ".vers") + ">" + echapper(l.texte) + "</a></li>";
}

function liensMenu(contenu, ctx) {
  return liste(contenu.entete.liens).map((l, i) => lienNav(l, i, "entete.liens", ctx)).join("");
}

function boutonEntete(contenu, ctx) {
  const b = contenu.entete.bouton;
  if (!b || typeof b !== "object") return "";
  const vers = destination(b.vers);
  if (!ctx.edition && (!vers || estVide(b.texte))) return "";
  return '<a class="bouton bouton--plein entete__bouton" href="' + echapper(versGlobal(vers || "#", ctx)) + '"' + cible(vers) +
    ed(ctx, "entete.bouton.texte") + edDest(ctx, "entete.bouton.vers") + ">" + echapper(b.texte) + "</a>";
}

function rendreEntete(contenu, ctx) {
  const nom = contenu.site.nom;
  const logo = imageSure(contenu.site.logo);
  const marque = logo
    ? '<img class="entete__logo" src="' + echapper(logo) + '" alt="' + echapper(texteBrut(nom)) + '"' + edImg(ctx, "site.logo") + ">"
    : "<span" + ed(ctx, "site.nom") + ">" + echapper(nom) + "</span>";
  const liens = liensMenu(contenu, ctx);
  const btn = boutonEntete(contenu, ctx);
  const menu = liens ? '<ul class="menu" role="list">' + liens + "</ul>" : "";
  return '<header class="entete">' +
    '<div class="conteneur entete__barre">' +
      '<a class="entete__marque" href="/">' + marque + "</a>" +
      (menu || btn ? '<nav class="entete__nav" aria-label="Menu principal">' + menu + btn + "</nav>" : "") +
      (menu || btn
        ? '<details class="entete__tiroir"><summary class="entete__ouvrir">' +
            '<span class="entete__burger" aria-hidden="true"><span></span><span></span><span></span></span>' +
            libHtml(ctx, "menu") + "</summary>" +
            '<nav class="entete__tiroir-nav" aria-label="Menu principal">' + menu + btn + "</nav></details>"
        : "") +
    "</div></header>";
}

/* ----- Pied de page ----- */
function rendrePied(contenu, client, ctx) {
  const p = contenu.pied;
  const liens = liste(p.liens).map((l, i) => lienNav(l, i, "pied.liens", ctx)).join("");
  const annee = new Date().getFullYear();
  return '<footer class="pied">' +
    '<div class="conteneur pied__grille">' +
      '<div class="pied__marque">' +
        '<p class="pied__nom"' + ed(ctx, "site.nom") + ">" + echapper(contenu.site.nom) + "</p>" +
        (afficher(ctx, p.texte) ? '<p class="pied__texte"' + ed(ctx, "pied.texte", { riche: true, lignes: true }) + ">" + riche(p.texte) + "</p>" : "") +
      "</div>" +
      (liens ? '<ul class="pied__liens" role="list">' + liens + "</ul>" : "") +
    "</div>" +
    '<div class="conteneur pied__bas"><p>© ' + annee + " " + echapper(texteBrut(contenu.site.nom)) + "</p></div>" +
    "</footer>";
}

/* La mention de démonstration appartient à l'ATELIER, pas au contenu :
   aucun geste du client ne peut l'effacer d'une maquette, et elle disparaît
   d'elle-même quand la fiche du client cesse d'être une démo. */
function bandeauDemo(client) {
  if (!client || !client.demo) return "";
  const texte = typeof client.mentionDemo === "string" && client.mentionDemo.trim()
    ? client.mentionDemo
    : "Maquette de démonstration : l'entreprise présentée est fictive.";
  return '<p class="bandeau-demo">' + echapper(texte) + "</p>";
}

/* ----- Le corps de la page ----- */
/* Les ancres de la page, UNIQUES. Deux blocs qui demanderaient la même
   ancre (ou l'ancre réservée du contenu principal) donneraient deux
   éléments de même `id` : les liens du menu viseraient le premier, sans un
   mot. Le premier garde l'ancre demandée, les suivants retombent sur leur
   identifiant, lui-même unique. */
const ANCRES_RESERVEES = ["contenu"];
export function ancresDeLaPage(contenu, page) {
  const prises = new Set(ANCRES_RESERVEES);
  const ancres = {};
  for (const id of page.ordre) {
    let a = ancre(contenu.blocs[id], id);
    if (prises.has(a)) a = id;
    let n = 2;
    while (prises.has(a)) a = id + "-" + n++;
    prises.add(a);
    ancres[id] = a;
  }
  return ancres;
}

export function rendreCorps({ contenu, client, pageId = PAGE_ACCUEIL, edition = false }) {
  const page = contenu.pages[pageId] || contenu.pages[PAGE_ACCUEIL];
  const ctxBase = { edition, contenu, client, pageId };
  const ancres = ancresDeLaPage(contenu, page);
  const blocs = page.ordre.map((id, i) =>
    rendreBloc(id, contenu.blocs[id], Object.assign({}, ctxBase, { premier: i === 0, index: i, ancre: ancres[id] }))
  ).join("");
  /* Une page a toujours un <h1>. Le premier bloc le porte s'il s'agit d'une
     accroche ; sinon la page en ajoute un, réservé aux lecteurs d'écran. */
  const premier = page.ordre.length ? contenu.blocs[page.ordre[0]] : null;
  const h1 = premier && !estVide(premier.titre) ? "" : '<h1 class="visuellement-cache">' + echapper(texteBrut(page.titre) || texteBrut(contenu.site.nom)) + "</h1>";
  /* La page introuvable (404) n'est pas une page du client : son texte est
     fixe, et elle n'apparaît que lorsqu'on s'est trompé d'adresse. */
  const introuvable = page.interne === "introuvable"
    ? '<section class="bloc introuvable"><div class="conteneur conteneur--etroit">' +
        '<p class="surtitre">Erreur 404</p><h1 class="titre-section">Cette page n\'existe pas.</h1>' +
        '<p class="intro">L\'adresse est peut-être mal recopiée, ou la page a été retirée.</p>' +
        '<p><a class="bouton bouton--plein" href="/">Retour à l\'accueil</a></p></div></section>'
    : "";
  return bandeauDemo(client) +
    '<a class="aller-au-contenu" href="#contenu">Aller au contenu</a>' +
    rendreEntete(contenu, ctxBase) +
    '<main id="contenu" tabindex="-1">' + (introuvable || h1 + blocs) + "</main>" +
    rendrePied(contenu, client, ctxBase);
}

/* ----- Le document complet ----- */
function premiereImage(contenu, page) {
  for (const id of page.ordre) {
    const b = contenu.blocs[id];
    const candidats = [b.image].concat(liste(b.images).map((x) => (x ? x.src : "")));
    for (const src of candidats) {
      const s = imageSure(src);
      if (s && !/\.svg$/i.test(s)) return s;   // les réseaux sociaux n'affichent pas les SVG
    }
  }
  return "";
}

export function titreDePage(contenu, pageId) {
  const page = contenu.pages[pageId] || contenu.pages[PAGE_ACCUEIL];
  const nom = texteBrut(contenu.site.nom);
  const titre = texteBrut(page.titre);
  if (pageId === PAGE_ACCUEIL) return titre || nom;
  return titre ? titre + " · " + nom : nom;
}

export function descriptionDePage(contenu, pageId) {
  const page = contenu.pages[pageId] || contenu.pages[PAGE_ACCUEIL];
  const d = texteBrut(page.description) || texteBrut(contenu.site.description);
  return d.length > 160 ? d.slice(0, 157).replace(/\s+\S*$/, "") + "…" : d;
}

export function rendrePage({ contenu, client = {}, pageId = PAGE_ACCUEIL, edition = false, origine = "", chemin = "/", indexable = !client.demo }) {
  const page = contenu.pages[pageId] || contenu.pages[PAGE_ACCUEIL];
  const resolu = themeDe(contenu);
  const titre = titreDePage(contenu, pageId);
  const description = descriptionDePage(contenu, pageId);
  const url = origine ? origine.replace(/\/$/, "") + chemin : "";
  const image = premiereImage(contenu, page);
  const imageAbsolue = image && origine && image.startsWith("/") ? origine.replace(/\/$/, "") + image : image;

  // Une feuille par type de bloc PRÉSENT sur la page, et seulement celles-là.
  const types = [...new Set(page.ordre.map((id) => contenu.blocs[id].type))];
  const feuilles = ["/css/socle.css"].concat(types.map((t) => "/css/blocs/" + t + ".css"))
    .map((h) => '<link rel="stylesheet" href="' + h + '">').join("");

  // Le corps d'abord : il dit quelles polices de titre le contenu cite.
  const corps = rendreCorps({ contenu, client, pageId, edition });

  const meta = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>" + echapper(titre) + "</title>",
    description ? '<meta name="description" content="' + echapper(description) + '">' : "",
    indexable ? "" : '<meta name="robots" content="noindex, nofollow">',
    url && indexable ? '<link rel="canonical" href="' + echapper(url) + '">' : "",
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="fr_FR">',
    '<meta property="og:site_name" content="' + echapper(texteBrut(contenu.site.nom)) + '">',
    '<meta property="og:title" content="' + echapper(titre) + '">',
    description ? '<meta property="og:description" content="' + echapper(description) + '">' : "",
    url ? '<meta property="og:url" content="' + echapper(url) + '">' : "",
    imageAbsolue ? '<meta property="og:image" content="' + echapper(imageAbsolue) + '">' : "",
    '<meta name="theme-color" content="' + echapper(resolu.theme.couleurs.fond) + '">',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link rel="stylesheet" href="' + echapper(lienPolices(resolu)) + '">',
    liensPolicesCitees(corps, resolu).map((h) => '<link rel="stylesheet" href="' + echapper(h) + '">').join(""),
    feuilles,
    "<style>" + variablesCss(resolu) + "</style>"
  ].filter(Boolean).join("\n");

  return "<!doctype html>\n<html lang=\"fr\">\n<head>\n" + meta + "\n</head>\n<body>\n" +
    corps +
    "\n</body>\n</html>\n";
}
