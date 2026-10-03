/* =========================================================
   Contrôler un client avant de le montrer ou de le livrer
   =========================================================

   `npm run controler -- <id> [--production] [--depuis export.json]`

   Relit le contenu livré (`clients/<id>/contenu.json`), ou celui d'un
   export téléchargé depuis l'administration (`--depuis`), et la
   configuration du client, comme le ferait une personne méticuleuse juste
   avant la mise en ligne. Une ligne par point : ✓ rien à redire, ⚠ à
   regarder, ✗ à corriger. Le code de sortie vaut 1 s'il y a un ✗ : c'est
   ce que lit `deployer.mjs`, qui s'arrête au premier.

   Deux sévérités, selon ce qu'on contrôle (3 octobre 2026) :
   - une MAQUETTE (sans `--production`) n'a de ✗ que pour ce qui est
     CASSÉ : une page qui ne se rend pas, un lien qui mène nulle part, une
     adresse refusée, un site joignable nulle part. Ce qui reste à remplir
     — textes d'exemple, « [À compléter … » des mentions légales, téléphone
     — n'y est qu'un ⚠. Une maquette se montre AVANT la signature, et la
     règle « rien de vrai sans signature » interdit d'y écrire le SIRET du
     prospect : bloquer son déploiement pour ça forcerait à inventer ;
   - un site EN PRODUCTION (`--production`) reçoit de vrais visiteurs : ces
     mêmes manques deviennent des ✗, et la configuration de production
     (domaine, espace de contenu, adresses de l'administration…) est
     vérifiée en plus.

   Les liens sont vérifiés sur la page RENDUE, telle que la verra une
   visiteuse : une section masquée n'y est pas, son ancre non plus — un
   menu qui y mène est un lien cassé. Les boutons sans destination et les
   adresses refusées, eux, ne sont visibles que dans le contenu : le rendu
   les fait disparaître en silence, c'est précisément pour ça qu'on les
   cherche — dans les champs d'adresse (`vers`) ET dans les liens écrits
   au milieu d'un texte (3 octobre 2026 : un « www.… » posé dans un
   paragraphe disparaissait du site pendant que le contrôle répondait
   « rien à redire »).

   Les mentions légales doivent exister, s'AFFICHER et être remplies
   (3 octobre 2026) : masquer leur section pour faire taire l'avertissement
   laissait le lien du bas de page mener à une page vide, et le contrôle
   répondait ✓ parce que la page existait.

   Deux clients ne partagent jamais un espace de contenu, un espace photos
   ni un nom de Worker (3 octobre 2026) : la publication de l'un
   remplacerait le site de l'autre, sans que rien ne le signale.

   Ce module sert aussi de boîte à outils aux autres scripts de l'atelier
   (la racine, les arguments, la lecture de wrangler.toml) : ils les
   importent d'ici plutôt que d'en garder chacun une copie — deux copies
   d'une même règle finissent toujours par diverger. */

import { readFileSync, existsSync, realpathSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { normaliser, rendrePage, titreDePage, descriptionDePage, PAGE_ACCUEIL } from "../socle/public/rendu/page.js";
import { texteBrut, adresseSure, destination, identifiantValide, attributsDe, motifBalise, adresseDeLien } from "../socle/public/rendu/outils.js";
import { cheminsVers, lireChemin, nomDuBloc, restesDuModele, compterTrous, mentionsPresentes, contientUnTrou } from "../socle/public/rendu/structure.js";
import { PAGE_MENTIONS } from "../socle/public/rendu/modeles-pages.js";
import { lignesHorairesIllisibles } from "../socle/public/rendu/donnees-structurees.js";
import { validerContenu, adresseEmail } from "../socle/serveur/validation.js";
import { destinatairesAlerte, DESTINATAIRES_ALERTE_MAX } from "../socle/serveur/contact.js";

/* ----- La racine de l'atelier -----

   Le CODE (le socle, les modules de rendu) est toujours celui de ce dépôt.
   Les DONNÉES (`clients/`, `atelier.json`) se lisent sous la racine de
   l'atelier : ce dépôt, ou le dossier désigné par `ATELIER_RACINE`. Les
   tests s'en servent pour travailler sur une copie, sans jamais toucher
   aux vrais clients. */
export const RACINE_CODE = fileURLToPath(new URL("..", import.meta.url));
export function racineAtelier() {
  return process.env.ATELIER_RACINE ? resolve(process.env.ATELIER_RACINE) : RACINE_CODE;
}

/* Vrai si ce module est le script lancé (et non importé par un autre). */
export function estLance(urlModule) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(urlModule)) === realpathSync(resolve(process.argv[1]));
  } catch {
    return false;
  }
}

/* ----- Les arguments -----

   `drapeaux` : les options sans valeur (`--production`) ; `options` : celles
   qui en prennent une (`--depuis <fichier>`). Une option inconnue est
   REFUSÉE, jamais ignorée : `--prodution` mal tapé aurait contrôlé un site
   de production avec les règles d'une maquette, sans un mot. */
export function lireArguments(argv, { drapeaux = [], options = [] } = {}) {
  const r = { positions: [], drapeaux: new Set(), options: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      if (drapeaux.includes(a)) r.drapeaux.add(a);
      else if (options.includes(a)) {
        const v = argv[i + 1];
        if (v === undefined || v.startsWith("--")) throw new Error("l'option " + a + " attend une valeur.");
        r.options.set(a, v);
        i++;
      } else throw new Error("option inconnue : " + a + ".");
    } else r.positions.push(a);
  }
  return r;
}

export function lireJson(fichier) {
  let texte;
  try {
    texte = readFileSync(fichier, "utf8");
  } catch {
    throw new Error("fichier introuvable : " + fichier);
  }
  try {
    return JSON.parse(texte);
  } catch (e) {
    throw new Error("fichier illisible (JSON invalide) : " + fichier + " — " + e.message);
  }
}

/* ----- Lire wrangler.toml -----

   Le sous-ensemble de TOML qu'emploient les wrangler.toml de l'atelier :
   tables (`[assets]`), tableaux de tables (`[[kv_namespaces]]`), clés
   pointées, chaînes, booléens, nombres, tableaux (sur plusieurs lignes) et
   tables en ligne — de quoi lire `routes = [ { pattern = "…", … } ]`. Tout
   le reste (chaînes sur plusieurs lignes, dates nues) est REFUSÉ avec sa
   ligne plutôt que lu de travers : un `workers_dev` mal lu ferait passer un
   site de production pour bien réglé. Aucune dépendance : le projet n'en a
   pas. Une clé en double est une erreur, comme pour wrangler. */
export function lireToml(texte) {
  const s = String(texte);
  const n = s.length;
  let i = 0;
  let ligne = 1;
  const racine = {};
  let table = racine;
  const erreur = (m) => { throw new Error("ligne " + ligne + " : " + m); };
  const blancs = () => { while (i < n && (s[i] === " " || s[i] === "\t")) i++; };
  const commentaire = () => { if (s[i] === "#") while (i < n && s[i] !== "\n") i++; };
  const finDeLigne = () => {
    if (s[i] === "\r" && s[i + 1] === "\n") i++;
    if (s[i] === "\n") { i++; ligne++; return true; }
    return false;
  };
  const toutBlanc = () => { for (;;) { blancs(); commentaire(); if (!finDeLigne()) return; } };
  const estObjet = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const interdite = (k) => k === "__proto__" || k === "constructor" || k === "prototype";

  function cle() {
    const segments = [];
    for (;;) {
      blancs();
      let k;
      if (s[i] === '"' || s[i] === "'") k = chaine();
      else {
        const m = /^[A-Za-z0-9_-]+/.exec(s.slice(i, i + 200));
        if (!m) erreur("nom de clé attendu.");
        k = m[0];
        i += k.length;
      }
      if (interdite(k)) erreur("nom de clé interdit : " + k + ".");
      segments.push(k);
      blancs();
      if (s[i] !== ".") return segments;
      i++;
    }
  }

  function chaine() {
    const q = s[i];
    if (s.slice(i, i + 3) === q.repeat(3)) erreur("les chaînes sur plusieurs lignes ne sont pas prises en charge.");
    i++;
    let v = "";
    while (i < n && s[i] !== q) {
      if (s[i] === "\n") erreur("chaîne non fermée.");
      if (q === '"' && s[i] === "\\") {
        const e = s[i + 1];
        const simples = { '"': '"', "\\": "\\", n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };
        if (Object.prototype.hasOwnProperty.call(simples, e)) { v += simples[e]; i += 2; continue; }
        const long = e === "u" ? 4 : e === "U" ? 8 : 0;
        const hexa = long ? s.slice(i + 2, i + 2 + long) : "";
        if (!long || !/^[0-9a-fA-F]+$/.test(hexa) || hexa.length !== long) erreur("échappement invalide dans une chaîne.");
        v += String.fromCodePoint(parseInt(hexa, 16));
        i += 2 + long;
        continue;
      }
      v += s[i++];
    }
    if (s[i] !== q) erreur("chaîne non fermée.");
    i++;
    return v;
  }

  function valeur() {
    blancs();
    const c = s[i];
    if (c === '"' || c === "'") return chaine();
    if (c === "[") {
      i++;
      const t = [];
      for (;;) {
        toutBlanc();
        if (s[i] === "]") { i++; return t; }
        t.push(valeur());
        toutBlanc();
        if (s[i] === ",") { i++; continue; }
        if (s[i] === "]") { i++; return t; }
        erreur("« , » ou « ] » attendu dans un tableau.");
      }
    }
    if (c === "{") {
      i++;
      const t = {};
      blancs();
      if (s[i] === "}") { i++; return t; }
      for (;;) {
        const k = cle();
        if (s[i] !== "=") erreur("« = » attendu.");
        i++;
        poser(t, k, valeur());
        blancs();
        if (s[i] === ",") { i++; continue; }
        if (s[i] === "}") { i++; return t; }
        erreur("« , » ou « } » attendu dans une table en ligne.");
      }
    }
    const m = /^(true|false|[+-]?\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?)(?=[\s,\]}#]|$)/.exec(s.slice(i, i + 64));
    if (!m) erreur("valeur illisible.");
    i += m[0].length;
    if (m[1] === "true") return true;
    if (m[1] === "false") return false;
    return Number(m[1].replace(/_/g, ""));
  }

  function poser(objet, segments, v) {
    let o = objet;
    for (const k of segments.slice(0, -1)) {
      if (!Object.prototype.hasOwnProperty.call(o, k)) o[k] = {};
      if (!estObjet(o[k])) erreur("la clé " + k + " n'est pas une table.");
      o = o[k];
    }
    const der = segments[segments.length - 1];
    if (Object.prototype.hasOwnProperty.call(o, der)) erreur("clé en double : " + segments.join(".") + ".");
    o[der] = v;
  }

  function enTete() {
    const double = s[i + 1] === "[";
    i += double ? 2 : 1;
    const segments = cle();
    if (s.slice(i, i + (double ? 2 : 1)) !== (double ? "]]" : "]")) erreur("en-tête de table mal fermé.");
    i += double ? 2 : 1;
    let o = racine;
    for (const k of segments.slice(0, -1)) {
      if (!Object.prototype.hasOwnProperty.call(o, k)) o[k] = {};
      o = Array.isArray(o[k]) ? o[k][o[k].length - 1] : o[k];
      if (!estObjet(o)) erreur("la clé " + k + " n'est pas une table.");
    }
    const der = segments[segments.length - 1];
    if (double) {
      if (!Object.prototype.hasOwnProperty.call(o, der)) o[der] = [];
      if (!Array.isArray(o[der])) erreur("la clé " + segments.join(".") + " n'est pas un tableau de tables.");
      const t = {};
      o[der].push(t);
      return t;
    }
    if (!Object.prototype.hasOwnProperty.call(o, der)) o[der] = {};
    if (!estObjet(o[der])) erreur("la clé " + segments.join(".") + " n'est pas une table.");
    return o[der];
  }

  for (;;) {
    toutBlanc();
    if (i >= n) return racine;
    if (s[i] === "[") table = enTete();
    else {
      const k = cle();
      if (s[i] !== "=") erreur("« = » attendu après " + k.join(".") + ".");
      i++;
      poser(table, k, valeur());
    }
    blancs();
    commentaire();
    if (i < n && !finDeLigne()) erreur("fin de ligne attendue.");
  }
}

/* ----- Les règles de configuration partagées avec deployer.mjs -----

   Écrites UNE fois, ici : deployer s'en sert pour refuser AVANT le premier
   déploiement ce que controler signale. Deux copies d'une même règle
   finissent toujours par diverger — et un ✓ de l'un suivi d'un arrêt de
   l'autre au milieu d'une vague, c'est exactement ce qu'on évite. */
const estObjet = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const liaison = (toml, cle, nom) => (estObjet(toml) && Array.isArray(toml[cle]) ? toml[cle] : []).find((k) => estObjet(k) && k.binding === nom) || null;

/* L'espace de contenu (KV « CONTENU ») manque-t-il ? → "" ou la raison.
   « a-creer » est la valeur que pose nouveau-client : `wrangler dev
   --local` s'en accommode, `wrangler deploy` la refuse à coup sûr. */
export function espaceContenuManquant(toml) {
  const kv = liaison(toml, "kv_namespaces", "CONTENU");
  if (!kv || typeof kv.id !== "string" || !kv.id.trim()) return "l'espace de contenu (KV « CONTENU ») n'est pas déclaré";
  if (kv.id.trim() === "a-creer") return "l'espace de contenu vaut encore « a-creer » — créez-le et reportez son identifiant";
  return "";
}

/* Un hôte est-il déclaré comme domaine du Worker ? Même condition pour le
   contrôle (un ⚠ s'il manque) et pour la vérification du vrai site après
   un déploiement (on ne vérifie que ce qui est déclaré). */
export function routeDeclaree(toml, hote) {
  const routes = estObjet(toml) && Array.isArray(toml.routes) ? toml.routes : [];
  return routes.some((rt) => estObjet(rt) && rt.pattern === hote && rt.custom_domain === true);
}

/* Ce que deux clients ne partagent JAMAIS : `[{ quoi, valeur, ids, consequence }]`,
   un élément par ressource déclarée par deux clients ou plus. `clients` :
   `[{ id, toml }]`. « a-creer » et les valeurs vides ne comptent pas : ce
   ne sont pas encore des ressources.

   Le piège qui l'a fait écrire (3 octobre 2026) : wrangler 4 nomme un
   espace KV d'après le SEUL nom donné à `kv namespace create`, et un nom
   est unique sur le compte. « CONTENU » pour un second client échouait, et
   la reprise la plus naturelle — recopier l'identifiant que liste
   `kv namespace list` — faisait écrire deux sites dans la même clé. */
const RESSOURCES = [
  {
    quoi: "l'espace de contenu (KV)",
    lire: (t) => { const kv = liaison(t, "kv_namespaces", "CONTENU"); return kv && typeof kv.id === "string" && kv.id.trim() !== "a-creer" ? kv.id.trim() : ""; },
    consequence: "la publication de l'un remplacerait le site de l'autre"
  },
  {
    quoi: "l'espace photos (R2)",
    lire: (t) => { const r2 = liaison(t, "r2_buckets", "MEDIAS"); return r2 && typeof r2.bucket_name === "string" ? r2.bucket_name.trim() : ""; },
    consequence: "retirer l'un effacerait les photos de l'autre"
  },
  {
    quoi: "le Worker",
    lire: (t) => (estObjet(t) && typeof t.name === "string" ? t.name.trim() : ""),
    consequence: "déployer l'un remplacerait le site de l'autre"
  }
];
export function ressourcesPartagees(clients) {
  const partages = [];
  for (const res of RESSOURCES) {
    const par = new Map();
    for (const c of clients) {
      const v = res.lire(c.toml);
      if (!v) continue;
      if (!par.has(v)) par.set(v, []);
      par.get(v).push(c.id);
    }
    for (const [valeur, ids] of par) if (ids.length > 1) partages.push({ quoi: res.quoi, valeur, ids: ids.slice().sort(), consequence: res.consequence });
  }
  return partages;
}
export function phrasePartage(p) {
  return `${p.ids.map((i) => "« " + i + " »").join(" et ")} partagent ${p.quoi} « ${p.valeur} » — chaque client doit avoir le sien : ${p.consequence}`;
}

/* Les wrangler.toml de tous les clients de l'atelier, pour le contrôle
   d'UN client : un voisin illisible est sauté (c'est son propre contrôle
   qui le dira), jamais une raison de ne pas contrôler celui-ci. */
function tomlsDesClients(racine) {
  const dossier = join(racine, "clients");
  const clients = [];
  let entrees = [];
  try { entrees = readdirSync(dossier, { withFileTypes: true }); } catch { return clients; }
  for (const d of entrees) {
    // Les mêmes dossiers que deployer (listerClients) prend pour des clients.
    if (!d.isDirectory() || !identifiantValide(d.name) || !existsSync(join(dossier, d.name, "client.json"))) continue;
    try {
      clients.push({ id: d.name, toml: lireToml(readFileSync(join(dossier, d.name, "wrangler.toml"), "utf8")) });
    } catch { /* illisible ou absent : voir l'en-tête */ }
  }
  return clients;
}

/* ----- Les liens écrits dans un texte, que le rendu fait disparaître -----

   `liensDansLesTextes` (structure.js) ne voit que les liens que la page
   AFFICHE : c'est ce qu'il faut pour les suivre quand une ancre change,
   et c'est exactement ce qui la rend aveugle ici. Le nettoyeur
   (`texteRiche`) défait sans un mot un lien dont l'adresse est refusée ou
   absente ; on cherche donc ceux-là, avec SA lecture (`motifBalise`,
   `attributsDe`, `adresseDeLien`, le dernier `href` compte) — sans quoi le
   contrôle et la page ne verraient pas les mêmes liens.
   → `[{ mots, vers }]`, un élément par lien qui disparaîtra. */
export function liensRefusesDansUnTexte(html) {
  const refuses = [];
  if (typeof html !== "string" || !/<a\b/i.test(html)) return refuses;
  const re = motifBalise();
  let m;
  while ((m = re.exec(html))) {
    if (m[1] === "/" || m[2].toLowerCase() !== "a") continue;
    let href = null;
    for (const a of attributsDe(m[3])) if (a.nom === "href") href = a.valeur;
    const vers = href === null ? "" : adresseDeLien(href).trim();
    if (adresseSure(vers)) continue;
    const suite = html.slice(re.lastIndex);
    const fin = suite.search(/<\/a\s*>/i);
    refuses.push({ mots: texteBrut(fin < 0 ? suite : suite.slice(0, fin)), vers });
  }
  return refuses;
}

/* Chaque chaîne d'une valeur, sauf les champs d'adresse (déjà lus par
   `cheminsVers`). Profondeur bornée, comme partout dans le socle. */
const CLES_ADRESSE = new Set(["vers", "lienPlan"]);
function chainesDe(valeur, fn, cle = "", profondeur = 0) {
  if (profondeur > 12) return;
  if (typeof valeur === "string") { if (!CLES_ADRESSE.has(cle)) fn(valeur); return; }
  if (!valeur || typeof valeur !== "object") return;
  for (const [k, v] of Object.entries(valeur)) chainesDe(v, fn, Array.isArray(valeur) ? cle : k, profondeur + 1);
}

/* ----- Le rapport -----

   Chaque point est rangé sous un THÈME (« Liens », « Photos »…) : un thème
   sans aucun défaut s'affiche en une seule ligne ✓, un thème qui en a
   montre chacun d'eux. Un même défaut répété sur plusieurs pages (le menu
   est sur toutes) n'est écrit qu'une fois, avec la liste des pages. */
export const OK = "✓";
export const ATTENTION = "⚠";
export const ERREUR = "✗";

function nouveauRapport(client, mode, source) {
  const points = [];
  const index = new Map();
  return {
    client, mode, source, points,
    signaler(niveau, message, ou = "") {
      const cle = niveau + "\u0000" + message;
      if (index.has(cle)) {
        if (ou) index.get(cle).ou.add(ou);
        return;
      }
      const p = { niveau, message, ou: new Set(ou ? [ou] : []) };
      index.set(cle, p);
      points.push(p);
    },
    // Un défaut dont la gravité dépend du mode : ✗ en production, ⚠ sur une maquette.
    manque(message, ou = "") { this.signaler(mode === "production" ? ERREUR : ATTENTION, message, ou); },
    // `verifier` signale les défauts du thème et rend le résumé de la ligne
    // ✓ ; `null` : le thème ne s'applique pas, aucune ligne.
    theme(resumeSiRienARedire, verifier) {
      const avant = points.length;
      const resume = verifier();
      if (points.length === avant && resume !== null) points.push({ niveau: OK, message: resume || resumeSiRienARedire, ou: new Set() });
    }
  };
}

export function bilan(rapport) {
  const compte = { [OK]: 0, [ATTENTION]: 0, [ERREUR]: 0 };
  for (const p of rapport.points) compte[p.niveau]++;
  return compte;
}

export function lignesDuRapport(rapport) {
  const lignes = [];
  for (const p of rapport.points) {
    lignes.push(p.niveau + " " + p.message + (p.ou.size ? " — " + [...p.ou].join(", ") : ""));
  }
  const b = bilan(rapport);
  lignes.push("");
  lignes.push(`Bilan : ${b[OK]} ✓, ${b[ATTENTION]} ⚠, ${b[ERREUR]} ✗` +
    (b[ERREUR] ? " — à corriger avant toute mise en ligne." : b[ATTENTION] ? " — rien de bloquant, mais à regarder." : " — rien à redire."));
  return lignes;
}

/* ----- Ce qu'on lit dans une page rendue ----- */
const ENTITES_ATTRIBUT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
const decoder = (v) => String(v).replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITES_ATTRIBUT[m]);
const attribut = (brut, nom) => {
  let v = null;
  for (const a of attributsDe(brut)) if (a.nom === nom) v = decoder(a.valeur);   // le dernier compte, comme dans un navigateur
  return v;
};
function idsDe(html) {
  const ids = new Set();
  for (const m of html.matchAll(/<[a-zA-Z][a-zA-Z0-9]*\b([^<>]*)>/g)) {
    const id = attribut(m[1], "id");
    if (id) ids.add(id);
  }
  return ids;
}

/* Ce qu'une page publique ne doit jamais contenir : plus ou moins d'un
   <h1>, un script — hormis les données structurées pour Google, qui ne
   s'exécutent pas —, une marque d'édition. → `{ defauts, donnees }`, où
   `donnees` est le JSON-LD lu (ou `null`). */
export function lirePageRendue(html) {
  const defauts = [];
  let donnees = null;
  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  if (h1 !== 1) defauts.push(`${h1} titres <h1> au lieu d'un seul`);
  const ouvrants = (html.match(/<script\b/gi) || []).length;
  const scripts = [...html.matchAll(/<script\b([^<>]*)>([\s\S]*?)<\/script\s*>/gi)];
  if (ouvrants !== scripts.length) defauts.push("Une balise <script> mal fermée dans la page publique");
  for (const sc of scripts) {
    const type = (attribut(sc[1], "type") || "").trim().toLowerCase();
    if (type !== "application/ld+json" || attribut(sc[1], "src") !== null) {
      defauts.push("Un script dans la page publique (seules les données structurées sont permises)");
      continue;
    }
    try {
      donnees = JSON.parse(sc[2]);
    } catch {
      defauts.push("Les données structurées pour Google sont illisibles (JSON invalide)");
    }
  }
  if (/data-edit|data-masque|data-sans-lien|data-liste/.test(html)) defauts.push("Des marques d'édition dans la page publique");
  return { defauts, donnees };
}

/* La page montre-t-elle un texte à la visiteuse ? Le `<h1>` réservé aux
   lecteurs d'écran (posé quand aucune section ne porte le titre) ne compte
   pas : une page qui n'a que lui est vide à l'écran. */
export function texteAffiche(html) {
  const m = /<main\b[^<>]*>([\s\S]*)<\/main>/i.exec(String(html));
  if (!m) return false;
  return texteBrut(m[1].replace(/<h1\b[^<>]*\bvisuellement-cache\b[^<>]*>[\s\S]*?<\/h1>/gi, "")) !== "";
}

/* Les fichiers que le site sert sans être des pages : ceux du socle, les
   photos de la médiathèque, et ce que le Worker répond lui-même. */
const FICHIERS_SERVIS = /^\/(css\/|illustrations\/|medias\/|rendu\/|favicon\.svg$|robots\.txt$|sitemap\.xml$)/;
const COURRIEL = /^[^\s@<>()"]+@[^\s@<>()".]+(\.[^\s@<>()".]+)+$/;

const cheminDePage = (pageId) => (pageId === PAGE_ACCUEIL ? "/" : "/" + pageId);
const aEnPropre = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

/* Les seuils « pour Google » : au-delà, le moteur coupe ce qu'il affiche.
   Le rendu coupe déjà la description à 160 caractères (page.js) — une
   phrase coupée par « … » se lit mal, mieux vaut la raccourcir soi-même. */
const TITRE_MAX = 60;
const DESCRIPTION_MAX = 160;

/* ----- Le contrôle -----
   → le rapport : `{ client, mode, source, points: [{ niveau, message, ou }] }`. */
export function controler({ racine = racineAtelier(), id, production = false, depuis = null } = {}) {
  const mode = production ? "production" : "maquette";
  const r = nouveauRapport(id, mode, depuis ? "export " + depuis : "contenu livré (contenu.json)");

  if (!identifiantValide(id)) {
    r.signaler(ERREUR, `« ${id} » n'est pas un identifiant de client (minuscules, chiffres et tirets).`);
    return r;
  }
  const dossier = join(racine, "clients", id);
  let fiche;
  try {
    fiche = lireJson(join(dossier, "client.json"));
  } catch (e) {
    r.signaler(ERREUR, "Fiche du client : " + e.message);
    return r;
  }
  if (!fiche || typeof fiche !== "object" || Array.isArray(fiche)) {
    r.signaler(ERREUR, "Fiche du client : client.json ne contient pas un objet.");
    return r;
  }

  let brut;
  try {
    if (depuis) {
      const exp = lireJson(resolve(depuis));
      if (!exp || typeof exp !== "object" || !exp.contenu || typeof exp.contenu !== "object") {
        throw new Error("ce fichier n'est pas un export de l'administration (il n'a pas de « contenu »).");
      }
      if (exp.site !== id) throw new Error(`cet export est celui du site « ${exp.site} », pas de « ${id} ».`);
      brut = exp.contenu;
    } else {
      brut = lireJson(join(dossier, "contenu.json"));
    }
  } catch (e) {
    r.signaler(ERREUR, "Contenu : " + e.message);
    return r;
  }

  let toml = null;
  try {
    toml = lireToml(readFileSync(join(dossier, "wrangler.toml"), "utf8"));
  } catch (e) {
    r.signaler(ERREUR, "wrangler.toml illisible : " + e.message);
  }

  const contenu = normaliser(brut);
  const nomPage = (pageId) => (pageId === PAGE_ACCUEIL
    ? "l'accueil"
    : "la page « " + (texteBrut(contenu.pages[pageId] && contenu.pages[pageId].titre) || pageId) + " »");

  /* Où chaque section est visible : la première page qui la montre. */
  const visibleSur = new Map();
  for (const [pageId, page] of Object.entries(contenu.pages)) {
    for (const idBloc of page.ordre) {
      if (contenu.blocs[idBloc].masque !== true && !visibleSur.has(idBloc)) visibleSur.set(idBloc, pageId);
    }
  }

  /* 1. Chaque page se rend. */
  const rendues = {};
  const origine = fiche.domaine ? "https://" + fiche.domaine : "https://" + ((toml && toml.name) || "vitrine-" + id) + ".workers.dev";
  let donneesGoogle = null;
  r.theme("", () => {
    for (const [pageId, page] of Object.entries(contenu.pages)) {
      const ou = nomPage(pageId);
      let html;
      try {
        html = rendrePage({ contenu, client: fiche, pageId, origine, chemin: cheminDePage(pageId) });
      } catch (e) {
        r.signaler(ERREUR, "La page ne se rend pas : " + (e && e.message ? e.message : e), ou);
        continue;
      }
      rendues[pageId] = { html, ids: idsDe(html) };
      const lu = lirePageRendue(html);
      for (const d of lu.defauts) r.signaler(ERREUR, d, ou);
      if (pageId === PAGE_ACCUEIL) donneesGoogle = lu.donnees;
      for (const idBloc of page.ordre) {
        const present = html.includes('data-bloc="' + idBloc + '"');
        if (contenu.blocs[idBloc].masque === true) {
          if (present) r.signaler(ERREUR, `La section masquée « ${nomDuBloc(contenu.blocs[idBloc])} » apparaît sur le site`, ou);
        } else if (!present) {
          r.signaler(ERREUR, `La section « ${nomDuBloc(contenu.blocs[idBloc])} » n'apparaît pas dans la page`, ou);
        }
      }
    }
    const n = Object.keys(rendues).length;
    return `${n} page${n > 1 ? "s se rendent" : " se rend"}, chacune avec un seul <h1>, sans script ni marque d'édition`;
  });

  /* 2. Les données structurées de l'accueil. Leur absence n'est qu'un ⚠ :
     le site marche sans, Google le comprend juste moins bien. */
  r.theme("", () => {
    if (!rendues[PAGE_ACCUEIL]) return null;                       // déjà signalé : l'accueil ne se rend pas
    if (!donneesGoogle || typeof donneesGoogle !== "object") {
      r.signaler(ATTENTION, "Aucune donnée structurée pour Google sur l'accueil (nom, adresse, horaires)");
      return null;
    }
    const plages = Array.isArray(donneesGoogle.openingHoursSpecification) ? donneesGoogle.openingHoursSpecification.length : 0;
    /* Une seule ligne d'horaires illisible, et AUCUN horaire ne part
       (`horairesDe`, donnees-structurees.js : un jour absent se lirait
       « fermé » chez Google). Le ✓ disait alors « sans horaires lisibles »
       sans dire pourquoi : on nomme la ligne fautive, sur le bloc même que
       lit Google — le premier « Horaires » visible de l'accueil (contrôle
       du 3 octobre 2026). Un « [À compléter » est signalé plus bas. */
    if (!plages) {
      const h = contenu.pages[PAGE_ACCUEIL].ordre.map((idBloc) => contenu.blocs[idBloc])
        .find((b) => b && b.masque !== true && b.type === "horaires");
      const fautives = h && !contientUnTrou(h.jours) ? lignesHorairesIllisibles(h.jours) : [];
      if (fautives.length) {
        const dire = (l) => !l.jour ? `une ligne sans jour (« ${l.heures} »)`
          : !l.heures ? `la ligne « ${l.jour} », sans heures`
          : `la ligne « ${l.jour} : ${l.heures} »`;
        const dites = fautives.slice(0, 3).map(dire);
        if (fautives.length > 3) dites.push(`${fautives.length - 3} autre${fautives.length > 4 ? "s" : ""}`);
        const noms = dites.length > 1 ? dites.slice(0, -1).join(", ") + " et " + dites[dites.length - 1] : dites[0];
        r.signaler(ATTENTION, `Horaires non transmis à Google : ${noms} ne ${fautives.length > 1 ? "se lisent" : "se lit"} pas. ` +
          "Écrivez un jour par ligne (« Mardi »), et les heures comme « 9 h – 18 h » ou « Fermé » : tant qu'une ligne ne se lit pas, aucun horaire ne part, car un jour absent se lirait « fermé »",
          nomPage(PAGE_ACCUEIL));
      }
    }
    return `Données structurées pour Google sur l'accueil : ${donneesGoogle["@type"] || "?"}` +
      (plages ? `, ${plages} plage${plages > 1 ? "s" : ""} d'ouverture` : ", sans horaires lisibles");
  });

  /* 3. Les liens. */
  r.theme("", () => {
    let vus = 0;
    // a. Dans les pages rendues : chaque lien mène-t-il quelque part ?
    for (const [pageId, { html }] of Object.entries(rendues)) {
      for (const m of html.matchAll(/<a\b([^<>]*)>([\s\S]*?)<\/a>/gi)) {
        const href = attribut(m[1], "href");
        if (href === null) continue;
        vus++;
        const quoi = "« " + (texteBrut(m[2]) || href) + " » → " + href;
        const defaut = defautDuLien(href, pageId, contenu, rendues);
        if (defaut) r.signaler(defaut.niveau, `Lien ${quoi} : ${defaut.raison}`, nomPage(pageId));
      }
    }
    // b. Dans le contenu : ce que le rendu a fait disparaître.
    for (const chemin of cheminsVers(contenu)) {
      const segments = chemin.split(".");
      const cle = segments[segments.length - 1];
      const parent = lireChemin(contenu, segments.slice(0, -1).join("."));
      const vers = lireChemin(contenu, chemin);
      let ou;
      if (segments[0] === "blocs") {
        const pageId = visibleSur.get(segments[1]);
        if (!pageId) continue;                                     // section masquée ou sur aucune page : invisible
        ou = "« " + nomDuBloc(contenu.blocs[segments[1]]) + " », " + nomPage(pageId);
      } else if (chemin === "entete.bouton.vers") {
        if (parent && parent.masque === true) continue;
        ou = "le bouton de l'en-tête";
      } else {
        ou = segments[0] === "entete" ? "le menu" : "le pied de page";
      }
      const brute = String(vers).trim();
      if (cle === "lienPlan") {
        if (brute && !/^https:\/\//i.test(adresseSure(brute))) {
          r.signaler(ERREUR, `Le lien du plan « ${brute} » doit commencer par https:// — il n'apparaît pas sur le site`, ou);
        }
        continue;
      }
      const texte = parent && typeof parent === "object" ? texteBrut(parent.texte) : "";
      if (brute && brute !== "#" && !adresseSure(brute)) {
        r.signaler(ERREUR, `« ${texte || brute} » : l'adresse « ${brute} » est refusée (elle doit commencer par https://, mailto:, tel:, / ou #) — le lien n'apparaît pas sur le site`, ou);
      } else if (!destination(brute) && texte) {
        r.signaler(ATTENTION, `« ${texte} » n'a pas de destination : il n'apparaît pas sur le site`, ou);
      }
    }
    // c. Dans les TEXTES : un lien écrit au milieu d'un paragraphe avec une
    // adresse refusée (« www.… », « javascript: ») ou sans adresse. Le rendu
    // n'en garde que les mots ; ni a. ni b. ne peuvent le voir.
    const zones = [[contenu.entete, "l'en-tête"], [contenu.pied, "le pied de page"]];
    for (const [idBloc, pageId] of visibleSur) zones.push([contenu.blocs[idBloc], "« " + nomDuBloc(contenu.blocs[idBloc]) + " », " + nomPage(pageId)]);
    for (const [valeur, ou] of zones) {
      chainesDe(valeur, (s) => {
        for (const { mots, vers } of liensRefusesDansUnTexte(s)) {
          r.signaler(ERREUR, vers
            ? `« ${mots || "un lien"} » : l'adresse « ${vers} » écrite dans un texte est refusée (elle doit commencer par https://, mailto:, tel:, / ou #) — le lien n'apparaît pas sur le site`
            : `« ${mots || "un lien"} » : un lien écrit dans un texte n'a pas d'adresse — il n'apparaît pas sur le site`, ou);
        }
      });
    }
    return `Liens : ${vus} vérifié${vus > 1 ? "s" : ""} sur les pages rendues, tous mènent quelque part`;
  });

  /* 4. Les photos : une description pour qui ne les voit pas (et pour Google). */
  r.theme("Photos : chacune a sa description", () => {
    for (const [pageId, { html }] of Object.entries(rendues)) {
      for (const m of html.matchAll(/<img\b([^<>]*)>/gi)) {
        const src = attribut(m[1], "src") || "";
        const alt = (attribut(m[1], "alt") || "").trim();
        if (!alt) r.signaler(ATTENTION, `Photo sans description : ${src}`, nomPage(pageId));
        if (src.startsWith("/illustrations/") && !existsSync(join(RACINE_CODE, "socle", "public", decodeURIComponent(src.split(/[?#]/)[0])))) {
          r.signaler(ERREUR, `Photo introuvable : ${src}`, nomPage(pageId));
        }
      }
    }
    return "";
  });

  /* 5. Titres et descriptions « pour Google ». */
  r.theme("", () => {
    for (const [pageId, page] of Object.entries(contenu.pages)) {
      const ou = nomPage(pageId);
      const titre = titreDePage(contenu, pageId);
      if (!texteBrut(page.titre)) r.signaler(ATTENTION, `Titre pour Google vide (Google lira « ${titre || "rien"} »)`, ou);
      if (Array.from(titre).length > TITRE_MAX) {
        r.signaler(ATTENTION, `Titre pour Google trop long (${Array.from(titre).length} caractères, Google en montre environ ${TITRE_MAX}) : « ${titre} »`, ou);
      }
      const propre = texteBrut(page.description);
      if (!propre) {
        r.signaler(ATTENTION, descriptionDePage(contenu, pageId)
          ? "Description pour Google vide : celle du site la remplace"
          : "Description pour Google vide", ou);
      } else if (Array.from(propre).length > DESCRIPTION_MAX) {
        r.signaler(ATTENTION, `Description pour Google trop longue (${Array.from(propre).length} caractères, coupée à ${DESCRIPTION_MAX})`, ou);
      }
    }
    return "Titres et descriptions pour Google : remplis, de bonne longueur";
  });

  /* 6. Ce qui reste du modèle sur le site : textes et photos d'exemple,
     « [À compléter » des sections visibles. */
  r.theme("Aucun texte ni photo d'exemple, aucun « [À compléter … » sur le site", () => {
    for (const reste of restesDuModele(contenu)) {
      // Une page vide, une section MASQUÉE qui garde ses trous : c'est le
      // point 7 qui les dit (il les cherche lui-même) — jamais deux fois.
      if (reste.vide === true || reste.masque === true) continue;
      // `aCompleter` : la section porte un « [À compléter » (le plus souvent
      // les mentions légales) ; `texte` seul : un texte d'exemple du modèle.
      const quoi = [
        reste.aCompleter ? "des « [À compléter … » à remplir" : reste.texte ? "des textes d'exemple à remplacer" : "",
        reste.photo ? "une photo d'exemple à changer" : ""
      ].filter(Boolean).join(", et ");
      if (quoi) r.manque(`« ${reste.nom} » : ${quoi}`, nomPage(reste.pageId));
    }
    return "";
  });

  /* 7. Les mentions légales (obligatoires pour un professionnel, LCEN) :
     présentes, AFFICHÉES, et sans trou — y compris dans une section
     masquée. La règle « une section masquée ne compte pas » (point 6) vaut
     pour les textes d'exemple ; ici elle ouvrait un trou (3 octobre 2026) :
     masquer la section faisait taire l'éditeur et le contrôle, pendant que
     le lien du bas de page menait, depuis chaque page, à une page vide. */
  r.theme("", () => {
    if (!aEnPropre(contenu.pages, PAGE_MENTIONS)) {
      r.manque("Pas de page des mentions légales — obligatoire pour un professionnel. Ajoutez-la depuis l'éditeur (onglet Site)");
      return "";
    }
    const ou = nomPage(PAGE_MENTIONS);
    // La règle du socle (`mentionsPresentes`, structure.js : celle du bas de
    // page et de l'éditeur), et la page RENDUE, comme partout ici : si
    // l'une des deux ne voit rien, la visiteuse ne verra rien.
    if (!mentionsPresentes(contenu) || (rendues[PAGE_MENTIONS] && !texteAffiche(rendues[PAGE_MENTIONS].html))) {
      r.manque("La page des mentions légales n'affiche rien (section masquée, vide ou retirée) — elles sont obligatoires : affichez-les et remplissez-les", ou);
    }
    let masques = 0;
    for (const idBloc of contenu.pages[PAGE_MENTIONS].ordre) {
      const bloc = contenu.blocs[idBloc];
      if (bloc && bloc.masque === true) masques += compterTrous(bloc);
    }
    if (masques) {
      r.manque(`« [À compléter … » dans une section masquée de la page (${masques}) : la masquer ne dispense pas de la remplir — affichez-la et remplissez-la`, ou);
    }
    return `Mentions légales : /${PAGE_MENTIONS}, affichées`;
  });

  /* 8. Un moyen de joindre l'entreprise, écrit sur une section visible. */
  r.theme("", () => {
    const moyens = new Set();
    for (const idBloc of visibleSur.keys()) {
      const b = contenu.blocs[idBloc];
      if (b.type !== "horaires" && b.type !== "contact") continue;
      if (texteBrut(b.telephone)) moyens.add("téléphone");
      if (texteBrut(b.email)) moyens.add("e-mail");
    }
    if (moyens.size) return "Moyen de contact : " + [...moyens].join(" et ");
    r.manque("Aucun moyen de contact : ni téléphone ni e-mail dans une section « Horaires et accès » ou « Contact » visible");
    return "";
  });

  /* 9. Le contenu passerait la validation de l'administration : sinon
     l'éditeur ne pourrait rien enregistrer par-dessus. */
  r.theme("Le contenu respecte les limites de l'administration", () => {
    const v = validerContenu(brut);
    if (!v.ok) r.signaler(ERREUR, "L'administration refuserait ce contenu : " + v.message);
    return "";
  });

  /* 10. La configuration. */
  r.theme("", () => {
    if (fiche.id !== id) r.signaler(ERREUR, `client.json dit « "id": "${fiche.id}" » dans le dossier « ${id} »`);
    if (toml && toml.name !== "vitrine-" + id) r.signaler(ATTENTION, `wrangler.toml : le Worker s'appelle « ${toml.name} » au lieu de « vitrine-${id} »`);
    let versionSocle = "";
    try { versionSocle = lireJson(join(RACINE_CODE, "package.json")).version || ""; } catch { /* sans version, pas de comparaison */ }
    if (versionSocle && fiche.socle !== versionSocle) {
      r.signaler(ATTENTION, `client.json annonce le socle « ${fiche.socle} », le dépôt est en ${versionSocle} : montez la version après l'avoir vérifié`);
    }
    // Un espace partagé avec un autre client est CASSÉ, maquette ou pas.
    if (toml) {
      const voisins = tomlsDesClients(racine).filter((c) => c.id !== id).concat([{ id, toml }]);
      for (const p of ressourcesPartagees(voisins)) if (p.ids.includes(id)) r.signaler(ERREUR, "wrangler.toml : " + phrasePartage(p));
    }
    if (!production) {
      if (fiche.demo !== true) r.signaler(ATTENTION, "Ce client n'est plus une maquette : contrôlez-le avec --production");
      if (toml && toml.workers_dev === false && !fiche.domaine) {
        r.signaler(ERREUR, "Ce site n'aurait aucune adresse : ni domaine, ni adresse workers.dev (workers_dev = false)");
      }
      return "Configuration de maquette : " + (fiche.domaine ? fiche.domaine : "adresse workers.dev") + ", jamais indexée";
    }
    if (fiche.demo !== false) r.signaler(ERREUR, "client.json : « demo » doit valoir false pour un site en production (c'est lui qui ouvre l'indexation)");
    const domaine = typeof fiche.domaine === "string" ? fiche.domaine : "";
    if (!domaine) r.signaler(ERREUR, "client.json : « domaine » est vide");
    else if (!/^(?!www\.)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domaine)) {
      r.signaler(ERREUR, `client.json : le domaine « ${domaine} » est mal écrit (sans https://, sans www, sans /, en minuscules)`);
    }
    if (toml) {
      if (toml.workers_dev !== false) r.signaler(ERREUR, "wrangler.toml : workers_dev doit valoir false — un site client n'est joignable que par son domaine");
      const kvManquant = espaceContenuManquant(toml);
      if (kvManquant) r.signaler(ERREUR, "wrangler.toml : " + kvManquant);
      const vars = toml.vars && typeof toml.vars === "object" ? toml.vars : {};
      if (aEnPropre(vars, "ACCES_DEMO")) r.signaler(ERREUR, "wrangler.toml : ACCES_DEMO ne doit jamais figurer dans [vars]");
      if (!String(vars.COURRIEL_EXPEDITEUR || "").trim()) {
        r.signaler(ATTENTION, "wrangler.toml : COURRIEL_EXPEDITEUR est vide — aucun lien de connexion ni alerte de message ne partira");
      }
      for (const hote of domaine ? [domaine, "www." + domaine] : []) {
        if (!routeDeclaree(toml, hote)) r.signaler(ATTENTION, `wrangler.toml : « ${hote} » n'est pas déclaré dans routes (custom_domain = true)`);
      }
    }
    const admin = fiche.administration && typeof fiche.administration === "object" ? fiche.administration : {};
    const adresses = (Array.isArray(admin.adresses) ? admin.adresses : []).filter((a) => adresseEmail(a));
    if (!adresses.length) r.signaler(ERREUR, "client.json : aucune adresse valide dans administration.adresses — le client ne pourrait pas se connecter");
    /* L'alerte d'un message ne part qu'aux premières adresses de la fiche
       (contact.js, `destinatairesAlerte`) : son plafond compte des e-mails,
       et une longue liste n'en recevrait plus aucune. Les suivantes gardent
       l'accès à l'administration — le dire avant qu'on s'étonne de ne rien
       recevoir (contrôle du 3 octobre 2026). La règle est lue là-bas, pas
       recopiée ici. */
    const distinctes = new Set(adresses.map((a) => adresseEmail(a))).size;
    if (distinctes > DESTINATAIRES_ALERTE_MAX) {
      r.signaler(ATTENTION, `client.json : ${distinctes} adresses dans administration.adresses — seules les ${DESTINATAIRES_ALERTE_MAX} premières (${destinatairesAlerte(fiche).join(", ")}) reçoivent l'alerte d'un message du formulaire ; toutes gardent l'accès à l'administration`);
    }
    // L'EXISTENCE du fichier seulement : il contient un secret, on ne le lit pas.
    if (existsSync(join(dossier, ".acces-demo"))) {
      r.signaler(ERREUR, `Le lien de maquette existe encore : supprimez clients/${id}/.acces-demo et le secret (npx wrangler secret delete ACCES_DEMO -c clients/${id}/wrangler.toml)`);
    }
    return "Configuration de production : " + domaine + ", espace de contenu créé, " + adresses.length + " adresse" + (adresses.length > 1 ? "s" : "") + " pour l'administration";
  });

  return r;
}

/* Le défaut d'un lien rendu, ou `null`. `href` est l'adresse telle que la
   page l'écrit (déjà décodée de ses entités). */
function defautDuLien(href, pageId, contenu, rendues) {
  const casse = (raison) => ({ niveau: ERREUR, raison });
  if (href.startsWith("#")) {
    const ancre = decodeURIComponent(href.slice(1));
    if (!ancre) return casse("il ne mène nulle part");
    return rendues[pageId].ids.has(ancre) ? null : casse(`aucune section « ${ancre} » sur cette page (absente, ou masquée)`);
  }
  if (/^(\/(?![/\\])|\.\.?\/)/.test(href)) {
    let u;
    try { u = new URL(href, "https://controle.invalid" + cheminDePage(pageId)); } catch { return casse("adresse illisible"); }
    let chemin;
    try { chemin = decodeURIComponent(u.pathname); } catch { return casse("adresse mal encodée"); }
    if (FICHIERS_SERVIS.test(chemin)) return null;
    if (chemin.length > 1 && chemin.endsWith("/")) chemin = chemin.replace(/\/+$/, "");
    const cible = chemin === "/" ? PAGE_ACCUEIL : chemin.slice(1);
    if (cible !== PAGE_ACCUEIL && (chemin === "/" + PAGE_ACCUEIL || !identifiantValide(cible) || !aEnPropre(contenu.pages, cible))) {
      return casse(`aucune page à l'adresse ${chemin}`);
    }
    const ancre = u.hash ? decodeURIComponent(u.hash.slice(1)) : "";
    if (ancre && rendues[cible] && !rendues[cible].ids.has(ancre)) {
      return casse(`aucune section « ${ancre} » sur ${cible === PAGE_ACCUEIL ? "l'accueil" : "la page /" + cible} (absente, ou masquée)`);
    }
    return null;
  }
  if (/^https?:/i.test(href)) {
    let u;
    try { u = new URL(href); } catch { return casse("adresse mal écrite"); }
    if (!/^[^.]+(\.[^.]+)+$/.test(u.hostname) && u.hostname !== "localhost") return casse(`« ${u.hostname} » n'est pas un nom de site complet`);
    if (u.protocol === "http:") return { niveau: ATTENTION, raison: "adresse non sécurisée (http://) — préférez https:// si le site le permet" };
    return null;
  }
  if (/^mailto:/i.test(href)) {
    let adresse;
    try { adresse = decodeURIComponent(href.slice(7).split("?")[0]); } catch { return casse("adresse e-mail mal encodée"); }
    return COURRIEL.test(adresse) ? null : casse(`« ${adresse} » n'est pas une adresse e-mail complète`);
  }
  if (/^tel:/i.test(href)) {
    // Les séparateurs visuels (espaces, points, tirets, parenthèses) sont
    // tolérés par les téléphones ; il faut entre 6 et 15 chiffres.
    const chiffres = href.slice(4).replace(/%20|[\s.()-]/g, "");
    return /^\+?\d{6,15}$/.test(chiffres) ? null : casse("numéro de téléphone mal écrit");
  }
  return casse("adresse d'un genre inconnu");
}

/* ----- En ligne de commande ----- */
if (estLance(import.meta.url)) {
  const usage = "Usage : npm run controler -- <id> [--production] [--depuis export.json]";
  let args;
  try {
    args = lireArguments(process.argv.slice(2), { drapeaux: ["--production"], options: ["--depuis"] });
  } catch (e) {
    console.error("✗ " + e.message + "\n" + usage);
    process.exit(2);
  }
  const [id] = args.positions;
  if (!id || args.positions.length > 1) { console.error(usage); process.exit(2); }
  const rapport = controler({ id, production: args.drapeaux.has("--production"), depuis: args.options.get("--depuis") || null });
  console.log(`Contrôle de « ${id} » (${rapport.mode}) — ${rapport.source}\n`);
  for (const l of lignesDuRapport(rapport)) console.log(l);
  process.exit(bilan(rapport)[ERREUR] ? 1 : 0);
}
