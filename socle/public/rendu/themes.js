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
  }
];

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
   trait           filets et bordures — décoration, aucun texte dessus */
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
  }
};

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
    echelle: echelleValide(t.echelleTitres)
  };
}

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
  lignes.push("--echelle-titre:" + resolu.echelle);
  lignes.push("--rayon:" + resolu.theme.rayon);
  // Un passage mis en forme dans une autre police de titre (texte riche,
  // `<span data-police>`) : une règle par duo connu, rien d'autre.
  const polices = DUOS.map((d) => '[data-police="' + d.id + '"]{font-family:' + d.display + "}").join("");
  return ":root{" + lignes.join(";") + "}" + polices;
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
