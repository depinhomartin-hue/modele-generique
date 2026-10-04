/* Contrôle des thèmes : chaque couple texte/fond réellement employé
   (`COUPLES`, themes.js) doit tenir 4,5:1 dans CHAQUE thème, et chaque
   thème doit déclarer toutes ses couleurs et un duo de polices connu.

   Sort en erreur au premier défaut : un thème illisible ne doit jamais
   partir chez un client. */
import { THEMES, COUPLES, COULEURS, DUOS, FORMES_TITRES, SCHEMAS } from "../socle/public/rendu/themes.js";
import { FONDS } from "../socle/public/rendu/blocs/commun.js";

const SEUIL = 4.5;
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

let erreurs = 0;
for (const [id, t] of Object.entries(THEMES)) {
  const manquantes = COULEURS.filter((k) => !/^#[0-9a-fA-F]{6}$/.test(t.couleurs[k] || ""));
  if (manquantes.length) { console.error(`✗ ${id} : couleurs absentes ou invalides — ${manquantes.join(", ")}`); erreurs++; continue; }
  if (!DUOS.some((d) => d.id === t.duo)) { console.error(`✗ ${id} : duo de polices inconnu « ${t.duo} »`); erreurs++; }
  const mesures = COUPLES.map(([texte, fond]) => ({ texte, fond, r: contraste(t.couleurs[texte], t.couleurs[fond]) }))
    .sort((a, b) => a.r - b.r);
  const faibles = mesures.filter((m) => m.r < SEUIL);
  const pire = mesures[0];
  if (faibles.length) {
    erreurs += faibles.length;
    for (const m of faibles) console.error(`✗ ${id} : ${m.texte} sur ${m.fond} = ${m.r.toFixed(2)}:1 (minimum ${SEUIL}:1)`);
  } else {
    console.log(`✓ ${id.padEnd(10)} ${COUPLES.length} couples, le plus serré ${pire.r.toFixed(2)}:1 (${pire.texte} sur ${pire.fond})`);
  }
}
/* Le panneau de l'accroche « image-fond » : le sombre à 88 % d'opacité,
   posé sur la photo. Chaque texte du contexte sombre doit y tenir 4,5:1
   (accroche.css) sur les DEUX pires photos : une blanche — le pire cas d'un
   panneau foncé — et une noire, le pire cas d'un panneau CLAIR, celui d'un
   thème sombre (braise, 4 octobre 2026). */
const OPACITE_PANNEAU = 0.88;
const melange = (dessus, dessous, alpha) => "#" + [1, 3, 5].map((i) => {
  const v = Math.round(alpha * parseInt(dessus.slice(i, i + 2), 16) + (1 - alpha) * parseInt(dessous.slice(i, i + 2), 16));
  return v.toString(16).padStart(2, "0");
}).join("");
let erreursPanneau = 0;
for (const [id, t] of Object.entries(THEMES)) {
  for (const [photo, nomPhoto] of [["#FFFFFF", "photo blanche"], ["#000000", "photo noire"]]) {
    const fond = melange(t.couleurs.sombre, photo, OPACITE_PANNEAU);
    for (const texte of ["surSombre", "texteDouxSombre", "accentSombre"]) {
      const r = contraste(t.couleurs[texte], fond);
      if (r < SEUIL) { console.error(`✗ ${id} : ${texte} sur le panneau de l'accroche (${nomPhoto}) = ${r.toFixed(2)}:1`); erreursPanneau++; }
    }
  }
}
erreurs += erreursPanneau;
if (!erreursPanneau) console.log(`✓ panneau de l'accroche : tous les textes tiennent ${SEUIL}:1 sur une photo blanche comme sur une noire`);

/* Ce qu'un thème et un duo déclarent EN PLUS des couleurs (4 octobre 2026) :
   des constantes du socle, mais qui finissent dans une règle CSS
   (`variablesCss`) ou dans l'éditeur. Une faute de frappe y casserait tous
   les titres d'un site, ou nommerait un fond qui n'existe pas. */
let erreursFormes = 0;
for (const [id, t] of Object.entries(THEMES)) {
  if (t.schema !== undefined && !SCHEMAS.includes(t.schema)) { console.error(`✗ ${id} : schema « ${t.schema} » inconnu (${SCHEMAS.join(", ")})`); erreursFormes++; }
  for (const [fond, nom] of Object.entries(t.nomsFonds || {})) {
    if (!FONDS.includes(fond) || typeof nom !== "string" || !nom.trim()) { console.error(`✗ ${id} : nomsFonds.${fond} invalide`); erreursFormes++; }
  }
}
for (const d of DUOS) {
  if (!/^[a-z]+$/.test(d.id)) { console.error(`✗ duo « ${d.id} » : un identifiant en minuscules sans accent, ni chiffre ni tiret`); erreursFormes++; }
  if (!d.titres) continue;
  for (const [cle, motif] of Object.entries(FORMES_TITRES)) {
    if (!motif.test(String(d.titres[cle]))) { console.error(`✗ duo « ${d.id} » : titres.${cle} = ${JSON.stringify(d.titres[cle])} hors des valeurs permises`); erreursFormes++; }
  }
  const inconnues = Object.keys(d.titres).filter((k) => !Object.hasOwn(FORMES_TITRES, k));
  if (inconnues.length) { console.error(`✗ duo « ${d.id} » : titres inconnus — ${inconnues.join(", ")}`); erreursFormes++; }
}
erreurs += erreursFormes;
if (!erreursFormes) console.log(`✓ formes des titres, schémas et noms des fonds : conformes`);

if (erreurs) { console.error(`\n${erreurs} défaut(s).`); process.exit(1); }
