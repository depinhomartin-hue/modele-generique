/* =========================================================
   Les données structurées pour Google (JSON-LD)
   =========================================================

   Un site vitrine vit de la recherche LOCALE : « boulangerie Rieddorf
   ouverte dimanche ». Google lit mieux une entreprise qui se décrit dans
   son vocabulaire (schema.org) : nom, téléphone, adresse, horaires. Tout
   est tiré de ce que le client a déjà écrit sur sa page d'accueil — il n'a
   rien à remplir de plus (3 octobre 2026).

   Ce module est ISOMORPHE et ne lève JAMAIS : le contenu peut être abîmé,
   et une page qui tombe parce qu'un horaire est mal écrit serait un comble.

   ⚠️ La règle qui gouverne tout le reste : une donnée FAUSSE chez Google
   est pire qu'une donnée absente. Google l'affiche dans ses résultats, sur
   sa carte, et la cliente se déplace pour trouver porte close. Donc :
   - une ligne d'horaires qu'on ne sait pas lire EN ENTIER n'est jamais
     devinée à moitié — et elle écarte TOUS les horaires, car un jour
     absent se lit « fermé » chez Google (voir `horairesDe`) ;
   - un champ vide n'apparaît pas ;
   - un texte encore « [À compléter » ou resté celui du modèle (les
     horaires et l'adresse inventés d'une section neuve) n'est pas envoyé ;
   - seules les sections VISIBLES comptent : une section masquée n'est pas
     publique. */

import { texte, texteBrut, imageSure, estVide } from "./outils.js";
import { BLOCS } from "./registre.js";
import { contientUnTrou } from "./structure.js";

/* L'accueil, le seul endroit où l'entreprise se décrit. Même valeur que
   `PAGE_ACCUEIL` (page.js), qu'on n'importe pas : page.js importe ce
   module, et une importation en boucle se paie au premier chargement. */
const ACCUEIL = "accueil";

/* Les catégories que `client.categorieGoogle` peut choisir : une liste
   FERMÉE de types schema.org réels. Une catégorie mal recopiée
   (« Boulangerie », « bakery ») retombe sur le type général plutôt que de
   décrire l'entreprise avec un mot que Google ne connaît pas. */
export const CATEGORIES_GOOGLE = Object.freeze([
  "LocalBusiness", "Bakery", "Restaurant", "CafeOrCoffeeShop", "FoodEstablishment", "Store",
  "HairSalon", "BeautySalon", "HomeAndConstructionBusiness", "Plumber", "Electrician",
  "HousePainter", "AutoRepair", "ProfessionalService", "HealthAndBeautyBusiness"
]);

const aEnPropre = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const estObjet = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/* ----- La première photo -----

   Celle des sections VISIBLES de la page, et jamais un SVG : les réseaux
   sociaux comme Google n'en affichent pas. La même règle sert l'image des
   liens partagés (`og:image`, page.js) : une seule écriture. Une photo
   rangée dans une section masquée n'est pas encore publique — elle ne doit
   sortir du site ni par l'aperçu d'un lien, ni par Google. */
export function premiereImage(contenu, ids) {
  const blocs = estObjet(contenu) && estObjet(contenu.blocs) ? contenu.blocs : {};
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id !== "string" || !aEnPropre(blocs, id)) continue;
    const b = blocs[id];
    if (!estObjet(b)) continue;
    const images = Array.isArray(b.images) ? b.images : [];
    const candidats = [b.image].concat(images.map((x) => (estObjet(x) ? x.src : "")));
    for (const src of candidats) {
      const s = imageSure(src);
      if (s && !/\.svg$/i.test(s)) return s;
    }
  }
  return "";
}

/* ----- Les horaires -----

   Une ligne = un jour (« Mardi ») et ses heures. On sait lire :
     « 9 h – 18 h », « 9h-18h », « de 9 h à 18 h »,
     « 6 h 30 – 13 h · 15 h 30 – 19 h », « 9:00 - 12:00, 14:00 - 18:00 »,
   et « Fermé » (qui ne donne rien : un jour sans plage est un jour fermé
   pour Google). Tout le reste — « Mardi et jeudi », « Du mardi au
   vendredi », « Mar. », « Sur rendez-vous », « 9 h – midi » — ne se lit
   pas, et alors AUCUN horaire ne part (`horairesDe`). */
const JOURS = Object.freeze({
  lundi: "Monday", mardi: "Tuesday", mercredi: "Wednesday", jeudi: "Thursday",
  vendredi: "Friday", samedi: "Saturday", dimanche: "Sunday"
});

/* Minuscules, sans accent, blancs (insécables compris) réduits à un. */
function aplatir(s) {
  return texteBrut(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

function jourDe(brut) {
  const j = aplatir(brut).replace(/\s*:$/, "");
  return aEnPropre(JOURS, j) ? JOURS[j] : "";
}

/* Une heure : « 9 h », « 9h30 », « 6 h 30 », « 09:00 ». Les minutes sont
   obligatoires après « : ». Rend « HH:MM », ou "" si ce n'est pas une
   heure. « 24 h » n'est accepté qu'en heure de FERMETURE, écrit 23:59
   comme Google le demande pour « jusqu'à minuit ». */
const HEURE = "(\\d{1,2})\\s*(?:h\\s*(\\d{2})?|:\\s*(\\d{2}))";
const PLAGE = new RegExp("^(?:de\\s+)?" + HEURE + "\\s*(?:-|–|—|a)\\s*" + HEURE + "$");

function heure(h, m, fermeture) {
  const hh = Number(h);
  const mm = m === undefined ? 0 : Number(m);
  if (mm > 59) return "";
  if (hh === 24 && mm === 0 && fermeture) return "23:59";
  if (hh > 23) return "";
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

/* Les plages d'une ligne d'heures : un tableau (vide pour « Fermé »), ou
   `null` si la ligne ne se lit pas en entier. Les plages se séparent par
   « · », « , », « ; », « / », « et ». */
const FERME = /^fermee?s?$/;
export function plagesHoraires(brut) {
  const t = aplatir(brut);
  if (!t || t.length > 120) return null;      // un horaire tient en une ligne
  if (FERME.test(t)) return [];
  const morceaux = t.split(/\s*(?:·|•|,|;|\/|\bet\b)\s*/);
  const plages = [];
  for (const m of morceaux) {
    const r = PLAGE.exec(m);
    if (!r) return null;
    const opens = heure(r[1], r[2] ?? r[3], false);
    const closes = heure(r[4], r[5] ?? r[6], true);
    if (!opens || !closes || opens === closes) return null;
    plages.push({ opens, closes });
  }
  return plages.length ? plages : null;
}

/* Une ligne VIDE (ni jour ni heures), ou abîmée (pas un objet), ne compte
   pas : elle ne dit rien.

   ⚠️ Une ligne qui a des heures mais pas de jour, elle, compte — comme
   illisible. C'est la ligne « de suite » qu'on écrit sous « Mardi |
   9 h – 12 h » pour l'après-midi (« | 14 h – 18 h ») : la sauter envoyait
   « mardi 9 h – 12 h » seul, et Google lisait le mardi après-midi fermé
   (contrôle du 3 octobre 2026). Le site ne l'affiche pas non plus
   (horaires.js) : raison de plus pour que le contrôle qualité la nomme,
   au lieu de la taire des deux côtés. */
const ligneVide = (ligne) => !estObjet(ligne) || (estVide(ligne.jour) && estVide(ligne.heures));

/* TOUT OU RIEN. Une seule ligne qu'on ne sait pas lire, et aucun horaire
   ne part.

   Relecture du 3 octobre 2026 : une ligne illisible était sautée, et les
   autres partaient. Or un jour sans plage est un jour FERMÉ pour Google
   — c'est même ainsi que « Fermé » se dit (en n'envoyant rien). Sauter
   « Du mardi au vendredi | 6 h 30 – 13 h » déclarait donc la boulangerie
   fermée quatre jours sur sept, en silence. Une donnée absente vaut mieux
   qu'une donnée fausse. */
function horairesDe(jours) {
  const specs = [];
  for (const ligne of Array.isArray(jours) ? jours : []) {
    if (ligneVide(ligne)) continue;
    const jour = jourDe(ligne.jour);
    const plages = jour ? plagesHoraires(ligne.heures) : null;
    if (!plages) return [];
    for (const p of plages) {
      specs.push({ "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/" + jour, opens: p.opens, closes: p.closes });
    }
  }
  return specs;
}

/* Les lignes d'horaires qu'on ne sait pas lire, telles qu'elles
   s'affichent (texte brut) : `[{ index, jour, heures }]`, dans l'ordre de
   la liste. Une seule suffit à écarter tous les horaires (`horairesDe`) :
   le contrôle qualité s'en sert pour NOMMER la ligne fautive, au lieu de
   laisser l'éditrice deviner pourquoi Google ne reçoit rien. Ne lève
   jamais. */
export function lignesHorairesIllisibles(jours) {
  const illisibles = [];
  (Array.isArray(jours) ? jours : []).forEach((ligne, index) => {
    if (ligneVide(ligne)) return;
    const jour = jourDe(ligne.jour);
    if (jour && plagesHoraires(ligne.heures)) return;
    illisibles.push({ index, jour: texteBrut(ligne.jour), heures: texteBrut(ligne.heures) });
  });
  return illisibles;
}

/* ----- Ce qui est encore un exemple -----

   Une section neuve naît avec des horaires et une adresse INVENTÉS
   (« Numéro et rue », « Mardi 9 h – 18 h ») : l'éditeur prévient avant de
   les publier, mais une éditrice pressée peut publier quand même. Sur la
   page, ils se voient et se corrigent ; chez Google, ils deviendraient les
   horaires de l'entreprise. Ils ne partent donc pas. */
const empreinte = (v) => { try { return JSON.stringify(v); } catch { return null; } };
function modeleHoraires() {
  try { return BLOCS.horaires.modele(); } catch { return {}; }
}

/* Une adresse sur une ligne : « 3 place de la Fontaine<br>Rieddorf »
   → « 3 place de la Fontaine, Rieddorf ». */
function adresseDe(html) {
  return texteBrut(texte(html).replace(/<br\s*\/?>/gi, ", "))
    .replace(/\s*,(\s*,)+/g, ",")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .replace(/\s+,/g, ",");
}

/* Un texte qu'on peut envoyer : non vide et sans trou à compléter. */
function utilisable(s) {
  return typeof s === "string" && s.trim() !== "" && !contientUnTrou(s);
}

/* ----- L'objet entier -----

   `donneesStructurees(contenu, { client, origine, pageId })` → l'objet
   JSON-LD de l'entreprise, ou `null` hors de l'accueil (ou sans nom :
   Google n'a que faire d'une entreprise anonyme).
   `origine` (« https://boulangerie.fr ») rend les adresses absolues ; sans
   elle, ni `url` ni `image` : une adresse relative ne veut rien dire hors
   du site. */
export function donneesStructurees(contenu, { client, origine, pageId = ACCUEIL } = {}) {
  try {
    return construire(contenu, client, origine, pageId);
  } catch (e) {
    // Filet de sécurité : rien de ce qui précède ne devrait lever. Une
    // page sans données structurées vaut mieux qu'une page en erreur.
    if (typeof console !== "undefined") console.error("Données structurées :", e);
    return null;
  }
}

function construire(contenu, client, origine, pageId) {
  if (pageId !== ACCUEIL || !estObjet(contenu)) return null;
  const site = estObjet(contenu.site) ? contenu.site : {};
  const nom = texteBrut(site.nom);
  if (!utilisable(nom)) return null;
  const pages = estObjet(contenu.pages) ? contenu.pages : {};
  const page = aEnPropre(pages, ACCUEIL) && estObjet(pages[ACCUEIL]) ? pages[ACCUEIL] : {};
  const blocs = estObjet(contenu.blocs) ? contenu.blocs : {};
  const vus = new Set();
  const visibles = (Array.isArray(page.ordre) ? page.ordre : []).filter((id) => {
    if (typeof id !== "string" || vus.has(id) || !aEnPropre(blocs, id)) return false;
    vus.add(id);
    return estObjet(blocs[id]) && blocs[id].masque !== true;
  });
  const deGenre = (type) => visibles.map((id) => blocs[id]).filter((b) => b.type === type);
  const horaires = deGenre("horaires");
  const contacts = deGenre("contact");

  const fiche = estObjet(client) ? client : {};
  const type = typeof fiche.categorieGoogle === "string" && CATEGORIES_GOOGLE.includes(fiche.categorieGoogle)
    ? fiche.categorieGoogle : "LocalBusiness";
  const racine = typeof origine === "string" && /^https?:\/\/[^\s/]+/i.test(origine) ? origine.replace(/\/+$/, "") : "";

  const objet = { "@context": "https://schema.org", "@type": type, name: nom };
  const description = texteBrut(site.description);
  if (utilisable(description)) objet.description = description;
  if (racine) {
    objet.url = racine + "/";
    const image = premiereImage(contenu, visibles);
    if (image) objet.image = image.startsWith("/") ? racine + image : image;
  }

  // Le téléphone et l'e-mail : le premier écrit, dans les horaires d'abord
  // (c'est là qu'on cherche à joindre une boutique), puis dans le contact.
  // Tels qu'écrits : c'est le client qui sait comment il se présente.
  const premier = (champ) => {
    for (const b of horaires.concat(contacts)) {
      const v = texteBrut(b[champ]);
      if (utilisable(v)) return v;
    }
    return "";
  };
  const telephone = premier("telephone");
  if (telephone) objet.telephone = telephone;
  const email = premier("email");
  if (email) objet.email = email;

  // L'adresse et les horaires viennent du MÊME bloc, le premier visible :
  // deux boutiques décrites dans deux blocs ne doivent pas se mélanger.
  const h = horaires[0];
  if (h) {
    const modele = modeleHoraires();
    const adresse = adresseDe(h.adresse);
    if (utilisable(adresse) && !estVide(h.adresse) && texte(h.adresse).trim() !== texte(modele.adresse).trim()) objet.address = adresse;
    const inventes = Array.isArray(h.jours) && empreinte(h.jours) === empreinte(modele.jours);
    const specs = inventes || contientUnTrou(h.jours) ? [] : horairesDe(h.jours);
    if (specs.length) objet.openingHoursSpecification = specs;
  }
  return objet;
}

/* ----- La balise -----

   `<script type="application/ld+json">` : ce n'est PAS du code exécuté,
   le navigateur n'y touche pas, et la politique de contenu (CSP) n'a pas
   à bouger. Mais le texte vient du client, et un nom de site qui contient
   « </script> » fermerait la balise : le JSON est donc écrit avec « < »,
   « > » et « & » en `\u003c`, `\u003e`, `\u0026` (toujours du JSON valide,
   lu à l'identique), ainsi que U+2028 et U+2029, que certains lecteurs de
   JavaScript prennent pour des fins de ligne. Rien d'autre ne peut sortir
   de la balise. */
export function jsonLdSur(objet) {
  let json;
  try { json = JSON.stringify(objet); } catch { return ""; }
  if (typeof json !== "string") return "";
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function baliseDonneesStructurees(objet) {
  const json = objet ? jsonLdSur(objet) : "";
  return json ? '<script type="application/ld+json">' + json + "</script>" : "";
}
