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

import { echapper, texteBrut, destination, cible, ed, edDest, edImg, edListe, imageSure, identifiantValide, afficher, estVide, sansLien } from "./outils.js";
import { themeDe, variablesCss, lienPolices, liensPolicesCitees } from "./themes.js";
import { BLOCS, typeConnu, valeurReglage } from "./registre.js";
import { lib, libHtml } from "./libelles.js";
import { riche, liste, ancre } from "./blocs/commun.js";
import { PAGE_MENTIONS, mentionsPresentes } from "./structure.js";
import { donneesStructurees, baliseDonneesStructurees, premiereImage } from "./donnees-structurees.js";

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
   d'exemple compris : c'est `nouveauBloc()`, dans registre.js.)

   Un bloc MASQUÉ porte `masque: true`, et seulement ce `true`-là : toute
   autre valeur (« true » écrit en texte, 1, false) fait disparaître la clé.
   Un masquage doit être un geste délibéré de l'éditrice ; une valeur
   douteuse qui cacherait une section de son site sans qu'elle l'ait voulu
   serait le pire des deux maux. Et une seule forme écrite donne une seule
   empreinte pour un même contenu. */
const REGLAGES = new Set(["disposition", "fond", "style", "inverse"]);
const aEnPropre = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const estMasque = (bloc) => !!bloc && bloc.masque === true;

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
  if (complet.masque !== true) delete complet.masque;
  return complet;
}

/* La version du format. `Number()` sur un objet piégé (`{"toString":1}`)
   LÈVE : le serveur de l'administration appelle `normaliser` sur tout ce
   que le navigateur envoie, et compte qu'il ne lève jamais. */
function versionDe(v) {
  if (typeof v !== "number" && typeof v !== "string") return 1;
  return Number(v) || 1;
}

/* Le bouton de l'en-tête garde `masque` seulement s'il vaut `true` — la
   même règle que pour les blocs, et pour la même raison : une valeur
   douteuse ne doit pas retirer de son site le bouton de l'éditrice. Une
   COPIE est faite quand il faut retirer la clé : `normaliser` ne touche
   jamais à ce qu'on lui passe. `Object.fromEntries` et non
   `Object.assign` : une clé « __proto__ » venue du JSON y reste une simple
   donnée au lieu de changer le prototype de la copie. */
function enteteNormalisee(entete) {
  if (!aEnPropre(entete, "bouton")) return entete;
  const b = entete.bouton;
  if (!b || typeof b !== "object" || Array.isArray(b) || !aEnPropre(b, "masque") || b.masque === true) return entete;
  const bouton = Object.fromEntries(Object.entries(b).filter(([k]) => k !== "masque"));
  return Object.fromEntries(Object.entries(entete).map(([k, v]) => [k, k === "bouton" ? bouton : v]));
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
    version: versionDe(c.version),
    site: objet(c.site),
    theme: objet(c.theme),
    entete: enteteNormalisee(objet(c.entete)),
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
   défauts pour l'éditrice.

   Un bloc masqué ne sort jamais d'ici hors édition, même appelé seul :
   l'éditeur redessine un bloc à la fois, et l'aperçu « tel que le verront
   vos visiteurs » ne doit pas montrer ce qu'ils ne verront pas.

   Les RÉGLAGES (fond, disposition, case) sont résolus ici, par la règle de
   `valeurReglage` (registre.js) — celle-là même par laquelle l'éditeur les
   affiche. Le bloc reçoit une copie : le contenu n'est pas touché. */
function avecReglages(bloc) {
  const copie = Object.assign({}, bloc);
  for (const r of BLOCS[bloc.type].reglages) copie[r.cle] = valeurReglage(bloc, r);
  return copie;
}

export function rendreBloc(id, bloc, ctx) {
  const edition = !!(ctx && ctx.edition);
  if (!edition && estMasque(bloc)) return "";
  try {
    return BLOCS[bloc.type].rendre(avecReglages(bloc), id, ctx);
  } catch (e) {
    if (typeof console !== "undefined") console.error("Bloc " + id + " :", e);
    return edition
      ? '<section class="bloc bloc--erreur" data-bloc="' + echapper(id) + '"' + (estMasque(bloc) ? " data-masque" : "") +
          '><div class="conteneur"><p>Ce bloc n\'a pas pu s\'afficher.</p></div></section>'
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
    ed(ctx, liste_ + "." + i + ".texte") + edDest(ctx, liste_ + "." + i + ".vers") + sansLien(ctx, vers) + ">" + echapper(l.texte) + "</a></li>";
}

function liensMenu(contenu, ctx) {
  return liste(contenu.entete.liens).map((l, i) => lienNav(l, i, "entete.liens", ctx)).join("");
}

/* Le bouton de l'en-tête se MASQUE par `entete.bouton.masque: true`, et
   par rien d'autre. Relecture du 3 octobre 2026 : on le masquait en vidant
   son texte — le libellé choisi (« Réserver votre kougelhopf ») ne
   survivait qu'en mémoire et revenait « Nous contacter » après un
   rechargement ; et en édition, le bouton vidé restait dessiné, plein,
   avec son invitation « Écrire ici… » : la case paraissait sans effet.
   Désormais :
   - masqué : jamais rendu, en édition comme sur le site ;
   - sur le site : rendu seulement avec un texte ET une destination ;
   - en édition : rendu même vide ou sans lien, pour qu'on puisse cliquer
     dedans (`data-sans-lien` dit alors qu'il manque au site). */
function boutonEntete(contenu, ctx) {
  const b = contenu.entete.bouton;
  if (!b || typeof b !== "object" || b.masque === true) return "";
  const vers = destination(b.vers);
  if (!ctx.edition && (!vers || estVide(b.texte))) return "";
  return '<a class="bouton bouton--plein entete__bouton" href="' + echapper(versGlobal(vers || "#", ctx)) + '"' + cible(vers) +
    ed(ctx, "entete.bouton.texte") + edDest(ctx, "entete.bouton.vers") + sansLien(ctx, vers) + ">" + echapper(b.texte) + "</a>";
}

/* La présentation du menu (4 octobre 2026), un choix de l'onglet « Site » :
   — « barre » (par défaut) : les liens dans la barre sur grand écran, le
     tiroir sur téléphone ;
   — « plein-ecran » : un lien « Menu » à toutes les largeurs ; le menu est
     un calque fixe qui remplit l'écran, en très grandes lettres, affiché
     par `:target` (socle.css). Toujours sans JavaScript, et il s'ouvre LÀ
     OÙ L'ON EST : la première version reprenait le <details> du tiroir, que
     l'en-tête rendu au flux ouvrait tout en haut de la page — 3 000 px
     au-dessus de l'écran pour qui avait défilé (relecture du 4 octobre
     2026). Un lien de section change la cible : le menu se referme de
     lui-même, et la section visée n'est pas dessous. « Fermer » vise un
     repère fixe, la page ne bouge pas ; le bouton « retour » du navigateur
     le referme aussi.
     Ses identifiants portent un « _ », qu'aucune ancre de section ne peut
     porter (`IDENTIFIANT`, outils.js) : un restaurant peut avoir sa
     section « menu ».
     En ÉDITION, l'en-tête reste celui de la barre : l'éditeur ne suit pas
     les liens (pas de `:target`), et ses outils visent le menu affiché.
     L'aperçu montre le plein écran.
   Toute autre valeur donne le premier choix : la règle de tous les
   réglages. */
export const ID_MENU_PLEIN = "menu_plein";
const ID_MENU_FERME = "menu_ferme";
export const MENUS = Object.freeze([
  Object.freeze({ valeur: "barre", libelle: "Dans la barre" }),
  Object.freeze({ valeur: "plein-ecran", libelle: "Plein écran" })
]);
export function menuDe(contenu) {
  const v = contenu && contenu.entete && contenu.entete.menu;
  return MENUS.some((m) => m.valeur === v) ? v : MENUS[0].valeur;
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
  const burger = '<span class="entete__burger" aria-hidden="true"><span></span><span></span><span></span></span>';
  if (!ctx.edition && menuDe(contenu) === "plein-ecran" && (menu || btn)) {
    const lienMarque = '<a class="entete__marque" href="/">' + marque + "</a>";
    return '<header class="entete entete--plein">' +
      '<div class="conteneur entete__barre">' + lienMarque +
        '<a class="entete__ouvrir" href="#' + ID_MENU_PLEIN + '">' + burger + libHtml(ctx, "menu") + "</a>" +
      "</div>" +
      '<span id="' + ID_MENU_FERME + '" class="entete__repere"></span>' +
      '<nav id="' + ID_MENU_PLEIN + '" class="entete__plein" aria-label="Menu principal">' +
        '<div class="conteneur entete__barre">' + lienMarque +
          '<a class="entete__fermer" href="#' + ID_MENU_FERME + '"><span class="entete__croix" aria-hidden="true"></span>' + libHtml(ctx, "fermerMenu") + "</a>" +
        "</div>" +
        '<div class="conteneur entete__plein-liens">' + menu + btn + "</div>" +
      "</nav></header>";
  }
  return '<header class="entete">' +
    '<div class="conteneur entete__barre">' +
      '<a class="entete__marque" href="/">' + marque + "</a>" +
      (menu || btn ? '<nav class="entete__nav" aria-label="Menu principal">' + menu + btn + "</nav>" : "") +
      (menu || btn
        ? '<details class="entete__tiroir"><summary class="entete__ouvrir">' + burger +
            libHtml(ctx, "menu") + "</summary>" +
            '<nav class="entete__tiroir-nav" aria-label="Menu principal">' + menu + btn + "</nav></details>"
        : "") +
    "</div></header>";
}

/* ----- Pied de page -----

   Son texte est COMMUN à toutes les pages, comme le menu : un lien
   « #horaires » posé dedans par la barre de mise en forme vise l'accueil.
   Relecture du 3 octobre 2026 : il était écrit tel quel, et sur
   « /nos-tarifs » il visait « /nos-tarifs#horaires », qui n'existe pas —
   le lien ne marchait que sur l'accueil, là où l'éditrice l'essaie.
   Hors de l'accueil, il devient donc « /#horaires », par `versGlobal`.

   Sur le SITE seulement : en édition, l'éditeur relit ce texte dans la
   page pour l'enregistrer (cadre.js, `valeurDuChamp`). Réécrit ici, un mot
   retouché sur une autre page aurait rangé « /#horaires » à la place de ce
   que l'éditrice avait choisi. Les clics ne mènent nulle part en édition :
   la forme écrite n'y change rien. */
function rendrePied(contenu, client, ctx) {
  const p = contenu.pied;
  const liens = liste(p.liens).map((l, i) => lienNav(l, i, "pied.liens", ctx)).join("");
  const annee = new Date().getFullYear();
  const texte = ctx.edition ? riche(p.texte) : riche(p.texte, { lien: (vers) => versGlobal(vers, ctx) });
  return '<footer class="pied">' +
    '<div class="conteneur pied__grille">' +
      '<div class="pied__marque">' +
        '<p class="pied__nom"' + ed(ctx, "site.nom") + ">" + echapper(contenu.site.nom) + "</p>" +
        (afficher(ctx, p.texte) ? '<p class="pied__texte"' + ed(ctx, "pied.texte", { riche: true, lignes: true }) + ">" + texte + "</p>" : "") +
      "</div>" +
      (liens ? '<ul class="pied__liens" role="list">' + liens + "</ul>" : "") +
    "</div>" +
    '<div class="conteneur pied__bas"><p>© ' + annee + " " + echapper(texteBrut(contenu.site.nom)) + lienMentions(ctx) + "</p></div>" +
    "</footer>";
}

/* Le lien des MENTIONS LÉGALES est STRUCTUREL : il suit la page
   `mentions-legales`, et n'est PAS une entrée de `pied.liens`. Une liste
   modifiable peut se vider par mégarde ; une mention légale doit rester
   joignable de partout (leçon de Graine de Pensée, 13 septembre 2026).
   Son libellé se change en cliquant dessus, comme les autres petits mots
   (`libelles.mentionsLegales`).

   Il n'apparaît que si la page affiche réellement quelque chose
   (`mentionsPresentes`, structure.js) : une page dont la seule section est
   masquée gardait son lien, qui menait de chaque page du site à une page
   vide (relecture du 3 octobre 2026). */
function lienMentions(ctx) {
  if (!ctx.mentions) return "";
  const courante = ctx.pageId === PAGE_MENTIONS ? ' aria-current="page"' : "";
  return ' · <a class="pied__mentions" href="' + echapper(ctx.mentions) + '"' + courante + ed(ctx, "libelles.mentionsLegales") + ">" +
    echapper(lib(ctx, "mentionsLegales")) + "</a>";
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

/* La page demandée, sinon l'accueil. `aEnPropre` et non `pages[pageId]` :
   l'éditeur passe l'identifiant de la page qu'il affiche, et « constructor »
   trouverait une fonction par le prototype (même piège que dans le Worker). */
function pageDe(contenu, pageId) {
  return aEnPropre(contenu.pages, pageId) ? contenu.pages[pageId] : contenu.pages[PAGE_ACCUEIL];
}

/* Les blocs de la page que voit une visiteuse, dans l'ordre. */
function visibles(contenu, page) {
  return page.ordre.filter((id) => !estMasque(contenu.blocs[id]));
}

/* Les ancres de la page, UNIQUES. Deux blocs qui demanderaient la même
   ancre (ou l'ancre réservée du contenu principal) donneraient deux
   éléments de même `id` : les liens du menu viseraient le premier, sans un
   mot. Le premier garde l'ancre demandée, les suivants retombent sur leur
   identifiant, lui-même unique.

   Les blocs VISIBLES sont servis d'abord, les masqués ensuite. Un bloc
   masqué n'a pas d'ancre sur le site ; en édition il en faut une, mais
   jamais prise à un bloc visible : sinon « #horaires » ne viserait pas la
   même section dans l'éditeur et sur le site, et un lien qui marche en
   ligne paraîtrait cassé à l'éditrice (ou l'inverse). */
const ANCRES_RESERVEES = ["contenu"];
export function ancresDeLaPage(contenu, page) {
  const prises = new Set(ANCRES_RESERVEES);
  const ancres = {};
  const masques = page.ordre.filter((id) => estMasque(contenu.blocs[id]));
  for (const id of visibles(contenu, page).concat(masques)) {
    let a = ancre(contenu.blocs[id], id);
    if (prises.has(a)) a = id;
    let n = 2;
    while (prises.has(a)) a = id + "-" + n++;
    prises.add(a);
    ancres[id] = a;
  }
  return ancres;
}

/* `formulaire` : l'état d'un envoi du formulaire de contact, quand le
   serveur rend la page après un POST (`socle/serveur/contact.js`) :
   `{ bloc, etat: "envoye" | "erreur", valeurs, erreurs }`. Seule la
   section dont l'identifiant vaut `formulaire.bloc` s'en sert (voir
   blocs/contact.js) ; les autres se rendent comme d'habitude.

   `mentions` : l'adresse de la page des mentions légales si elle affiche
   quelque chose (`mentionsPresentes`, structure.js), pour le bas de page
   et la notice du formulaire. Une page vide ou dont tout est masqué ne
   reçoit aucun lien : il ne mènerait à rien. */
export function rendreCorps({ contenu, client, pageId = PAGE_ACCUEIL, edition = false, formulaire = null }) {
  const page = pageDe(contenu, pageId);
  const ctxBase = {
    edition, contenu, client, pageId,
    formulaire: !edition && formulaire && typeof formulaire === "object" ? formulaire : null,
    mentions: mentionsPresentes(contenu) ? "/" + PAGE_MENTIONS : ""
  };
  const ancres = ancresDeLaPage(contenu, page);
  /* Le <h1> revient au premier bloc VISIBLE, en édition comme sur le site.
     Un bloc masqué n'est jamais `premier` : il garde en édition le niveau
     de titre qu'il aurait sur le site, et le réafficher ne déplace pas le
     <h1> de la page sous les yeux de l'éditrice.
     `index` reste la position dans l'ordre du CONTENU, comme les indices
     des listes : c'est elle que l'éditeur déplace. */
  const premierVisible = visibles(contenu, page)[0];
  const blocs = page.ordre.map((id, i) =>
    edition || !estMasque(contenu.blocs[id])
      ? rendreBloc(id, contenu.blocs[id], Object.assign({}, ctxBase, { premier: id === premierVisible, index: i, ancre: ancres[id] }))
      : ""
  ).join("");
  /* Une page a toujours un <h1>, et un seul. Le premier bloc visible le
     porte s'il a un titre ; sinon la page en ajoute un, réservé aux
     lecteurs d'écran. Une page dont tout est masqué garde donc le sien.
     En édition, un titre vide reste dessiné (pour qu'on puisse cliquer
     dedans) : c'est lui le <h1>, la page n'en ajoute pas un second. */
  const premier = premierVisible ? contenu.blocs[premierVisible] : null;
  const h1 = premier && (edition || !estVide(premier.titre)) ? "" : '<h1 class="visuellement-cache">' + echapper(texteBrut(page.titre) || texteBrut(contenu.site.nom)) + "</h1>";
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

export function titreDePage(contenu, pageId) {
  const page = pageDe(contenu, pageId);
  const nom = texteBrut(contenu.site.nom);
  const titre = texteBrut(page.titre);
  if (pageId === PAGE_ACCUEIL) return titre || nom;
  return titre ? titre + " · " + nom : nom;
}

export function descriptionDePage(contenu, pageId) {
  const page = pageDe(contenu, pageId);
  const d = texteBrut(page.description) || texteBrut(contenu.site.description);
  return d.length > 160 ? d.slice(0, 157).replace(/\s+\S*$/, "") + "…" : d;
}

export function rendrePage({ contenu, client = {}, pageId = PAGE_ACCUEIL, edition = false, origine = "", chemin = "/", indexable = !client.demo, formulaire = null }) {
  const page = pageDe(contenu, pageId);
  const resolu = themeDe(contenu);
  const titre = titreDePage(contenu, pageId);
  const description = descriptionDePage(contenu, pageId);
  const url = origine ? origine.replace(/\/$/, "") + chemin : "";
  const publics = visibles(contenu, page);
  // L'image des réseaux sociaux : la première photo des blocs VISIBLES, non
  // SVG (`premiereImage`, donnees-structurees.js — la même règle sert
  // l'image donnée à Google). Une photo rangée dans une section masquée
  // n'est pas encore publique : elle ne sort pas du site par l'aperçu d'un
  // lien partagé.
  const image = premiereImage(contenu, publics);
  const imageAbsolue = image && origine && image.startsWith("/") ? origine.replace(/\/$/, "") + image : image;

  // Une feuille par type de bloc PRÉSENT sur la page, et seulement celles-là.
  // Sur le site, un bloc masqué n'est pas présent : sa feuille n'est pas
  // demandée. En édition il est dessiné, il lui faut la sienne.
  const rendus = edition ? page.ordre : publics;
  const types = [...new Set(rendus.map((id) => contenu.blocs[id].type))];
  const feuilles = ["/css/socle.css"].concat(types.map((t) => "/css/blocs/" + t + ".css"))
    .map((h) => '<link rel="stylesheet" href="' + h + '">').join("");

  // Le corps d'abord : il dit quelles polices de titre le contenu cite.
  const corps = rendreCorps({ contenu, client, pageId, edition, formulaire });

  /* Les données structurées pour Google, sur l'accueil seulement
     (donnees-structurees.js). Pas en édition : l'éditeur n'en a que faire,
     et ce qu'il affiche doit rester la page, rien d'autre. Elles sont
     écrites même sur une maquette : la page n'est pas indexée (balise et
     en-tête), et le contrôle peut les relire. */
  const jsonLd = edition ? "" : baliseDonneesStructurees(donneesStructurees(contenu, { client, origine, pageId }));

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
    "<style>" + variablesCss(resolu) + "</style>",
    jsonLd
  ].filter(Boolean).join("\n");

  return "<!doctype html>\n<html lang=\"fr\">\n<head>\n" + meta + "\n</head>\n<body>\n" +
    corps +
    "\n</body>\n</html>\n";
}
