/* =========================================================
   Thèmes et duos de polices
   =========================================================

   Un thème = une palette nommée + un duo de polices + une forme (rayon des
   coins). Le client CHOISIT parmi des thèmes ; il ne compose pas ses
   couleurs une à une. C'est le garde-fou qui l'empêche de rendre son site
   illisible — la leçon la plus utile de Graine de Pensée.

   ⚠️ Chaque palette est mesurée sur la MATRICE COMPLÈTE des couples
   réellement employés (`COUPLES`, plus bas) : aucun ne descend sous 4,5:1.
   `npm run verifier` le contrôle à chaque modification
   (outils/verifier-themes.mjs). Un couple ajouté au CSS sans être déclaré
   ici échappe au contrôle : la feuille de style ne pose JAMAIS un texte
   sur un fond autrement que par un couple listé ci-dessous. */

/* ----- Les duos de polices -----

   Repris de Graine de Pensée (les six duos à titres lisibles ; les duos
   manuscrits viendront avec une recette qui en a besoin). Chaque duo
   déclare sa requête Google Fonts, vérifiée le 3 octobre 2026.

   ⚠️ Avant le premier vrai client : héberger les polices sur le site au
   lieu de les demander à Google. Une police chargée chez Google transmet
   l'adresse IP de la visiteuse ; un tribunal allemand l'a jugé contraire
   au RGPD en 2022. */
export const DUOS = [
  {
    id: "classique", nom: "Classique",
    display: '"Newsreader",Georgia,"Times New Roman",serif',
    corps: '"Karla",system-ui,-apple-system,"Segoe UI",sans-serif',
    google: "family=Newsreader:ital,opsz,wght@0,6..72,300..600;1,6..72,300..600&family=Karla:ital,wght@0,300..700;1,300..700"
  },
  {
    id: "chaleureux", nom: "Chaleureux",
    display: '"Fraunces",Georgia,serif',
    corps: '"Nunito Sans",system-ui,-apple-system,"Segoe UI",sans-serif',
    google: "family=Fraunces:ital,opsz,wght@0,9..144,300..600;1,9..144,300..600&family=Nunito+Sans:ital,opsz,wght@0,6..12,300..700;1,6..12,400"
  },
  {
    id: "epure", nom: "Épuré",
    display: '"EB Garamond",Georgia,serif',
    corps: '"Work Sans",system-ui,-apple-system,"Segoe UI",sans-serif',
    google: "family=EB+Garamond:ital,wght@0,400..600;1,400..500&family=Work+Sans:ital,wght@0,300..700;1,400"
  },
  {
    id: "affirme", nom: "Affirmé",
    display: '"Playfair Display",Georgia,serif',
    corps: '"Source Sans 3",system-ui,-apple-system,"Segoe UI",sans-serif',
    google: "family=Playfair+Display:ital,wght@0,400..700;1,400..600&family=Source+Sans+3:ital,wght@0,300..700;1,400"
  },
  {
    id: "doux", nom: "Doux",
    display: '"Lora",Georgia,serif',
    corps: '"Mulish",system-ui,-apple-system,"Segoe UI",sans-serif',
    google: "family=Lora:ital,wght@0,400..600;1,400..500&family=Mulish:ital,wght@0,300..700;1,400"
  },
  {
    id: "romantique", nom: "Romantique",
    display: '"Cormorant Garamond",Georgia,serif',
    corps: '"Lato",system-ui,-apple-system,"Segoe UI",sans-serif',
    google: "family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=Lato:ital,wght@0,300;0,400;0,700;1,400"
  },
  /* Une affiche plutôt qu'un livre (4 octobre 2026, le site de l'atelier) :
     une grotesque, Archivo, en capitales, grasse et resserrée — son axe de
     largeur la resserre à 82 % pour les titres, le texte courant reste à
     100 %. Le seul duo dont les titres changent de forme, pas seulement de
     police : ses `titres` passent par des variables CSS (`variablesCss`),
     lues par les titres, la marque de l'en-tête et le nom du pied.
     `taille` multiplie l'échelle des titres : une capitale resserrée tient
     moins de place qu'une romaine, elle peut monter d'un cran.
     Un mot d'une AUTRE police dans un titre (`<span data-police>`, l'italique
     à empattements de « classique », par exemple) reprend sa forme à lui :
     minuscules, largeur et graisse normales. */
  {
    id: "affiche", nom: "Affiche",
    display: '"Archivo",system-ui,-apple-system,"Segoe UI",sans-serif',
    corps: '"Archivo",system-ui,-apple-system,"Segoe UI",sans-serif',
    google: "family=Archivo:ital,wdth,wght@0,62..125,100..900;1,62..125,100..900",
    titres: { casse: "uppercase", largeur: "82%", graisse: 760, interlettrage: "-0.015em", interligne: 1, taille: 1.22 }
  }
];

/* Les formes de titre qu'un duo peut déclarer (`titres`), et leurs bornes.
   Ce sont des constantes du socle, jamais du contenu : rien de ce
   qu'écrit un client n'entre dans une règle CSS. `verifier-themes` les
   contrôle quand même — une faute de frappe ici casserait tous les titres. */
export const FORMES_TITRES = Object.freeze({
  casse: /^(none|uppercase)$/,
  largeur: /^(normal|\d{2,3}%)$/,
  graisse: /^[1-9]00$|^[1-9][0-9]0$/,
  interlettrage: /^(normal|-?0?\.\d{1,3}em)$/,
  interligne: /^(0\.9\d?|1(\.\d{1,2})?)$/,
  taille: /^(0\.9\d?|1(\.\d{1,2})?)$/
});

/* Les identifiants des polices de titre, pour le texte riche
   (`<span data-police>`) : seules celles-là sont acceptées. */
export const POLICES = new Set(DUOS.map((d) => d.id));

export function duo(id) {
  return DUOS.find((d) => d.id === id) || DUOS[0];
}

/* ----- Les couleurs -----

   Les noms disent le RÔLE, jamais la teinte : « accent » et non
   « marron ». Changer de thème ne change que les valeurs.

   fond            fond de la page
   surface         cartes, encarts posés sur le fond
   doux            fond d'une section qui alterne avec le fond
   texte           texte courant et titres
   texteDoux       texte secondaire (sous-titres, légendes)
   accent          liens, sur-titres, fond des boutons pleins
   surAccent       texte posé SUR l'accent (bouton plein)
   sombre          sections sombres et pied de page
   surSombre       texte sur le sombre
   accentSombre    sur-titres et liens sur le sombre ; fond du bouton plein
                   dans une section sombre (texte = sombre)
   texteDouxSombre texte secondaire sur le sombre
   trait           filets et bordures — décoration, aucun texte dessus

   « sombre » est la section qui CONTRASTE avec la page. Dans un thème
   clair, elle est foncée ; dans un thème SOMBRE (`schema: "sombre"`,
   braise), la page est noire et cette section est claire. Les rôles ne
   bougent pas, seuls les noms affichés dans l'éditeur changent
   (`nomsFonds`) : « Clair / Teinté / Foncé » y deviendraient des
   mensonges. */
export const COULEURS = [
  "fond", "surface", "doux", "texte", "texteDoux", "accent", "surAccent",
  "sombre", "surSombre", "accentSombre", "texteDouxSombre", "trait"
];

/* La matrice contrôlée : [couleur du texte, couleur du fond]. */
export const COUPLES = [
  ["texte", "fond"], ["texte", "surface"], ["texte", "doux"],
  ["texteDoux", "fond"], ["texteDoux", "surface"], ["texteDoux", "doux"],
  ["accent", "fond"], ["accent", "surface"], ["accent", "doux"],
  ["surAccent", "accent"],
  ["surSombre", "sombre"], ["accentSombre", "sombre"], ["texteDouxSombre", "sombre"],
  ["sombre", "accentSombre"]
];

export const THEMES = {
  /* Boulangerie, artisans de bouche : mie claire, croûte, blé.
     Mesuré le 3 octobre 2026 : 5,52:1 au plus serré (texteDoux sur doux). */
  fournil: {
    nom: "Fournil",
    duo: "chaleureux",
    rayon: "14px",
    couleurs: {
      fond: "#FBF6EE", surface: "#FFFFFF", doux: "#F3E8D7",
      texte: "#2B2119", texteDoux: "#6A594A",
      accent: "#8A4314", surAccent: "#FFFFFF",
      sombre: "#2B2119", surSombre: "#F7EFE4", accentSombre: "#E9B676", texteDouxSombre: "#CDBDAA",
      trait: "#E3D5C2"
    }
  },
  /* Artisans du bâtiment, professions libérales : ardoise et bleu de
     travail. 5,42:1 au plus serré. */
  atelier: {
    nom: "Atelier",
    duo: "epure",
    rayon: "6px",
    couleurs: {
      fond: "#F4F6F7", surface: "#FFFFFF", doux: "#E6ECEF",
      texte: "#1B242B", texteDoux: "#53606A",
      accent: "#1E5788", surAccent: "#FFFFFF",
      sombre: "#17212A", surSombre: "#EEF2F5", accentSombre: "#8DC3EA", texteDouxSombre: "#AAB8C3",
      trait: "#D3DBE0"
    }
  },
  /* Bien-être, paysage, produits de la ferme : verts tendres et profonds.
     5,30:1 au plus serré. */
  verger: {
    nom: "Verger",
    duo: "doux",
    rayon: "18px",
    couleurs: {
      fond: "#F5F8F1", surface: "#FFFFFF", doux: "#E5EDDA",
      texte: "#1D291E", texteDoux: "#56634F",
      accent: "#386436", surAccent: "#FFFFFF",
      sombre: "#1D291E", surSombre: "#F0F5E9", accentSombre: "#B6D897", texteDouxSombre: "#ADBBA5",
      trait: "#D5DFC9"
    }
  },
  /* Studios, ateliers créatifs, bars, tatoueurs : le noir et la braise
     (4 octobre 2026, le site de l'atelier). Le premier thème SOMBRE : la
     page est noire, la section contrastée est claire (voir « sombre »
     ci-dessus). L'orange vif ne tient 4,5:1 que sur le noir (3,1:1 sur du
     blanc) : sur la section claire, l'accent est une braise éteinte, plus
     foncée — assez pour tenir aussi sur le panneau de l'accroche posé sur
     une photo NOIRE, le pire cas d'un panneau clair.
     5,0:1 au plus serré (accentSombre sur le panneau, photo noire). */
  braise: {
    nom: "Braise",
    duo: "affiche",
    rayon: "4px",
    schema: "sombre",
    nomsFonds: { clair: "Noir", doux: "Anthracite", sombre: "Clair" },
    couleurs: {
      fond: "#0F0E0D", surface: "#1C1A18", doux: "#1F1D1B",
      texte: "#F2EEE8", texteDoux: "#A8A298",
      accent: "#FF5B1F", surAccent: "#0F0E0D",
      sombre: "#E8E5DF", surSombre: "#14120F", accentSombre: "#8F2E00", texteDouxSombre: "#55504A",
      trait: "#34312C"
    }
  }
};

/* Un thème sombre (`schema`) passe aussi les barres de défilement, les
   champs et le remplissage automatique en sombre (`color-scheme`). */
export const SCHEMAS = Object.freeze(["clair", "sombre"]);

export const THEME_PAR_DEFAUT = "fournil";

/* Trois crans pour la taille des titres, jamais un curseur libre : une
   taille au pixel près finit toujours par écraser un titre contre le bord
   d'un téléphone (Graine de Pensée). Toute autre valeur — absente, vide,
   texte, objet — donne le cran du milieu, jamais le plus petit. */
export const CRANS_TITRES = [0.9, 1, 1.12];
export function echelleValide(v) {
  if (typeof v !== "number" && typeof v !== "string") return 1;
  const n = typeof v === "number" ? v : Number(v.trim() || NaN);
  if (!Number.isFinite(n)) return 1;
  return CRANS_TITRES.reduce((proche, c) => (Math.abs(c - n) < Math.abs(proche - n) ? c : proche), 1);
}

const enTiret = (k) => k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
const COULEUR_VALIDE = /^#[0-9a-fA-F]{6}$/;

/* Résout le thème d'un contenu : thème connu, duo connu, échelle bornée. */
export function themeDe(contenu) {
  const t = (contenu && contenu.theme) || {};
  const id = typeof t.id === "string" && Object.prototype.hasOwnProperty.call(THEMES, t.id) ? t.id : THEME_PAR_DEFAUT;
  const theme = THEMES[id];
  // Un duo inconnu retombe sur celui du THÈME, pas sur le premier de la
  // liste : le thème a été pensé avec ses polices.
  const choisi = DUOS.find((d) => d.id === t.duo);
  return {
    id,
    theme,
    duo: choisi || duo(theme.duo),
    echelle: echelleValide(t.echelleTitres),
    // Les animations douces (socle.css, « Le mouvement ») : une case de
    // l'onglet Thème. Seul un vrai `true` les allume, comme toute case.
    animations: t.animations === true
  };
}

/* Les titres d'un duo à forme propre (`titres`), et les mots d'une autre
   police qu'on y pose : la marque de l'en-tête et le nom du pied sont des
   titres comme les autres. */
const TITRES_CSS = ":is(h1,h2,h3,h4,.entete__marque,.pied__nom)";
const arrondi = (n) => Math.round(n * 1000) / 1000;

/* Les variables CSS du thème, à poser dans une feuille <style> de la
   page. Les valeurs viennent de ce fichier, jamais du contenu : rien de
   ce qu'écrit un client ne peut entrer dans une règle CSS.

   La palette est écrite en `--c-<couleur>`. Les RÔLES (`--texte`,
   `--accent`…) sont branchés dessus dans socle.css, et une section sombre
   les rebranche sur les couleurs du sombre : tout ce qu'elle contient suit,
   sans règle à écrire bloc par bloc (voir « Les contextes de couleur »). */
export function variablesCss(resolu) {
  const lignes = COULEURS
    .filter((k) => COULEUR_VALIDE.test(resolu.theme.couleurs[k] || ""))
    .map((k) => "--c-" + enTiret(k) + ":" + resolu.theme.couleurs[k]);
  lignes.push("--display:" + resolu.duo.display);
  lignes.push("--corps:" + resolu.duo.corps);
  const titres = resolu.duo.titres || null;
  lignes.push("--echelle-titre:" + arrondi(resolu.echelle * (titres ? titres.taille : 1)));
  lignes.push("--rayon:" + resolu.theme.rayon);
  if (titres) {
    lignes.push("--casse-titre:" + titres.casse, "--largeur-titre:" + titres.largeur, "--graisse-titre:" + titres.graisse,
      "--interlettrage-titre:" + titres.interlettrage, "--interligne-titre:" + titres.interligne);
  }
  if (resolu.theme.schema === "sombre") lignes.push("color-scheme:dark");
  // Les noms des @keyframes de socle.css : sans eux, `animation` y vaut
  // `none` et rien ne bouge. `--marches` donne leur contenu aux marches
  // entre deux sections de fonds différents (sans lui, `content: none` :
  // elles n'existent pas) ; `--survols` allume les survols animés, lus
  // par une requête de style (`@container style(--survols: oui)`).
  if (resolu.animations) {
    lignes.push("--anim-entree:socle-entree", "--anim-apparition:socle-apparition", "--anim-devoile:socle-devoile",
      "--anim-marches:socle-marches", "--anim-rideau:socle-rideau", '--marches:""', "--survols:oui");
  }
  // Un passage mis en forme dans une autre police de titre (texte riche,
  // `<span data-police>`) : une règle par duo connu — et, dans un titre, la
  // forme du duo s'il en a une.
  const polices = DUOS.map((d) => '[data-police="' + d.id + '"]{font-family:' + d.display + "}" +
    (d.titres
      ? TITRES_CSS + ' [data-police="' + d.id + '"]{text-transform:' + d.titres.casse + ";font-stretch:" + d.titres.largeur +
        ";letter-spacing:" + d.titres.interlettrage + ";font-weight:" + d.titres.graisse + "}"
      : "")).join("");
  // Dans les titres d'un duo à forme propre, le mot d'une AUTRE police
  // reprend la forme de la sienne : l'italique à empattements posé dans un
  // titre en capitales reste en minuscules, à sa largeur, en graisse normale.
  const autres = titres
    ? TITRES_CSS + ' [data-police]:not([data-police="' + resolu.duo.id + '"]){text-transform:none;font-stretch:normal;letter-spacing:normal;font-weight:400}'
    : "";
  return ":root{" + lignes.join(";") + "}" + polices + autres;
}

export function lienPolices(resolu) {
  return "https://fonts.googleapis.com/css2?" + resolu.duo.google + "&display=swap";
}

/* Les polices citées par le contenu (`data-police`) en plus de celles du
   duo : elles ne sont téléchargées que si une page les emploie. */
export function liensPolicesCitees(html, resolu) {
  const cites = new Set();
  for (const m of String(html).matchAll(/data-police="([a-z]+)"/g)) {
    if (m[1] !== resolu.duo.id && POLICES.has(m[1])) cites.add(m[1]);
  }
  return [...cites].map((id) => "https://fonts.googleapis.com/css2?" + duo(id).google + "&display=swap");
}
