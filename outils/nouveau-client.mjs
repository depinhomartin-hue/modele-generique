/* =========================================================
   Créer le dossier d'un nouveau client (une maquette)
   =========================================================

   `npm run nouveau-client -- <id> "<Nom>" [--theme <id>] [--depuis <client>]`

   Fabrique `clients/<id>/` d'un coup, au lieu de recopier la démo à la
   main et d'oublier un nom à renommer (PROCESSUS.md, § 2, jusqu'au
   3 octobre 2026) :
   - `client.json`  : une maquette (`demo: true`), jamais indexée ;
   - `wrangler.toml` FABRIQUÉ ici, pas recopié : une copie de celui de la
     démo emportait son identifiant d'espace de contenu (KV), et la
     maquette aurait écrit dans le contenu publié de la démo. Celui-ci naît
     avec « a-creer », que `wrangler deploy` refuse tant qu'on ne l'a pas
     remplacé ;
   - `index.js` et `.dev.vars.exemple`, ceux de la démo ;
   - `contenu.json` : la recette générique (ou le contenu d'un autre
     client, `--depuis`), et la page des mentions légales ;
   - `.acces-demo` : le secret du lien d'accès à l'administration de la
     maquette, et ce lien. Jamais versionné (.gitignore).

   Tout est écrit dans un dossier temporaire, à côté, puis RENOMMÉ : une
   erreur en cours de route ne laisse jamais un client à moitié créé, que
   le déploiement prendrait pour un vrai.

   `--depuis <client>` part du contenu d'un autre client : ses textes, ses
   sections, son menu, son thème. Mais PAS ce qui appartient à l'autre
   entreprise : téléphone, e-mail, adresse, horaires, avis, liens d'appel,
   de réservation et vers ses réseaux, photos de sa médiathèque et
   mentions légales repartent du modèle. Un avis recopié d'une autre
   boutique est un faux avis ; son SIRET dans les mentions légales, une
   fausse identité ; ses photos `/medias/…`, des images cassées (elles
   vivent dans l'espace photos de l'autre client). Décision du 3 octobre
   2026.

   Les liens vers d'autres sites (`https://…`) sont retirés aussi, depuis
   le même jour : une maquette du salon B gardait le bouton « Réserver en
   ligne » vers la page de réservation du salon A, et son lien Facebook —
   une destination ne se voit pas à l'écran, la relecture des textes ne
   la trouve pas. Le bouton vidé ressort en ⚠ au contrôle : on sait lequel
   relier à l'adresse du nouveau client.

   L'espace de contenu (KV) se crée sous le nom `vitrine-<id>-contenu`
   (3 octobre 2026) : wrangler 4 nomme l'espace d'après le SEUL nom donné à
   `kv namespace create`, sans le préfixer du Worker, et un nom est unique
   sur le compte. « CONTENU » pour tout le monde échouait dès le deuxième
   client — et recopier l'identifiant de l'espace existant faisait écrire
   deux sites dans le même contenu (controler et deployer le refusent). */

import { readFileSync, writeFileSync, existsSync, renameSync, rmSync, mkdtempSync, readdirSync, chmodSync } from "node:fs";
import { join, relative } from "node:path";
import { randomBytes } from "node:crypto";
import { identifiantValide, texteBrut } from "../socle/public/rendu/outils.js";
import { normaliser } from "../socle/public/rendu/page.js";
import { BLOCS, nouveauBloc } from "../socle/public/rendu/registre.js";
import { nouvelIdBloc, cheminsVers, liensDansLesTextes, reecrireLiensDansTexte, lireChemin, ecrireChemin, mediasCites } from "../socle/public/rendu/structure.js";
import { THEMES, THEME_PAR_DEFAUT } from "../socle/public/rendu/themes.js";
import { pageMentionsLegales, PAGE_MENTIONS } from "../socle/public/rendu/modeles-pages.js";
import { validerContenu } from "../socle/serveur/validation.js";
import { racineAtelier, lireArguments, lireJson, lireToml, estLance } from "./controler.mjs";

/* La démo sert de RÉFÉRENCE : son index.js, son .dev.vars.exemple, sa
   date de compatibilité et la version du socle qu'elle déclare. */
export const DEMO = "demo-boulangerie";

/* La recette générique : les sections d'un site vitrine, de l'entrée au
   contact, chacune avec une ancre courte et son entrée de menu. Les
   recettes MÉTIER (boulangerie, coiffure…) prendront cette forme. */
const RECETTE_GENERIQUE = [
  { type: "accroche" },
  { type: "presentation", ancre: "presentation", menu: "Présentation" },
  { type: "prestations", ancre: "prestations", menu: "Prestations" },
  { type: "avis", ancre: "avis", menu: "Avis" },
  { type: "horaires", ancre: "horaires", menu: "Horaires" },
  { type: "faq", ancre: "questions", menu: "Questions" },
  { type: "contact", ancre: "contact", formulaire: true }
];

const ILLUSTRATION_NEUTRE = "/illustrations/neutre.svg";
const NOM_MAX = 80;

/* Le texte riche est du HTML : un nom qui contient « & » ou « < » y entre
   échappé. Une apostrophe reste une apostrophe (même règle que
   modeles-pages.js). */
const enHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* Un identifiant de client devient un nom de Worker, d'espace R2 et un
   sous-domaine (`vitrine-<id>.<compte>.workers.dev`) : un tiret final y
   est refusé par le DNS. `IDENTIFIANT` (outils.js) borne déjà à 48
   caractères, ce qui tient dans les 63 d'un nom d'espace R2. */
export function identifiantClientValide(id) {
  return identifiantValide(id) && !id.endsWith("-");
}

export function nomValide(nom) {
  return typeof nom === "string" && nom.trim() !== "" && Array.from(nom.trim()).length <= NOM_MAX && !/[\u0000-\u001F\u007F]/.test(nom);
}

/* ----- Le contenu générique ----- */
export function contenuGenerique({ nom, theme = THEME_PAR_DEFAUT }) {
  const contenu = {
    version: 1,
    site: { nom, description: "" },
    theme: { id: theme, duo: THEMES[theme].duo, echelleTitres: 1 },
    entete: { liens: [], bouton: { texte: "Nous contacter", vers: "#contact" } },
    pages: { accueil: { titre: nom, description: "", ordre: [] } },
    blocs: {},
    pied: {
      texte: "",
      liens: [
        { texte: "Horaires et accès", vers: "#horaires" },
        { texte: "Nous écrire", vers: "#contact" }
      ]
    },
    libelles: {}
  };
  for (const etape of RECETTE_GENERIQUE) {
    const bloc = nouveauBloc(etape.type);
    if (etape.ancre) bloc.ancre = etape.ancre;
    if (etape.formulaire) bloc.formulaire = true;
    if (etape.type === "accroche") {
      bloc.titre = enHtml(nom);
      // Les deux boutons du modèle naissent sans destination : ils
      // n'apparaîtraient pas sur le site. On les relie aux sections.
      if (Array.isArray(bloc.boutons) && bloc.boutons[0]) bloc.boutons[0].vers = "#prestations";
      if (Array.isArray(bloc.boutons) && bloc.boutons[1]) bloc.boutons[1].vers = "#contact";
    }
    const id = nouvelIdBloc(etape.type, contenu.blocs);
    contenu.blocs[id] = bloc;
    contenu.pages.accueil.ordre.push(id);
    if (etape.menu) contenu.entete.liens.push({ texte: etape.menu, vers: "#" + etape.ancre });
  }
  ajouterMentions(contenu);
  return contenu;
}

function ajouterMentions(contenu) {
  const m = pageMentionsLegales(contenu);
  contenu.pages[m.pageId] = m.page;
  Object.assign(contenu.blocs, m.blocs);
}

/* ----- Le contenu d'un autre client (`--depuis`) ----- */
const CLES_ADRESSES = new Set(["vers", "lienPlan", "image", "src", "ancre", "type", "logo"]);

function visiterObjets(v, fn, profondeur = 0) {
  if (!v || typeof v !== "object" || profondeur > 12) return;
  if (!Array.isArray(v)) fn(v);
  for (const x of Array.isArray(v) ? v : Object.values(v)) visiterObjets(x, fn, profondeur + 1);
}

/* Remplace le nom de l'autre client par le nouveau, dans tous les textes
   (pas dans les adresses). Rend le nombre de remplacements. Le nom peut
   être rangé tel quel (texte simple) ou échappé (texte riche). */
function remplacerNom(contenu, ancien, nouveau) {
  if (!ancien || ancien === nouveau) return 0;
  const formes = [[ancien, nouveau]];
  if (enHtml(ancien) !== ancien) formes.push([enHtml(ancien), enHtml(nouveau)]);
  let n = 0;
  visiterObjets(contenu, (o) => {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v !== "string" || CLES_ADRESSES.has(k)) continue;
      let w = v;
      for (const [a, b] of formes) {
        const morceaux = w.split(a);
        n += morceaux.length - 1;
        w = morceaux.join(b);
      }
      o[k] = w;
    }
  });
  return n;
}

export function contenuDepuis(source, { nom, theme = null }) {
  const c = JSON.parse(JSON.stringify(normaliser(source)));
  const notes = [];
  // Les mentions légales de l'autre entreprise disparaissent d'abord, avec
  // leurs sections si aucune autre page ne s'en sert ; une page neuve les
  // remplace à la fin.
  if (Object.prototype.hasOwnProperty.call(c.pages, PAGE_MENTIONS)) {
    const ailleurs = new Set(Object.entries(c.pages).filter(([p]) => p !== PAGE_MENTIONS).flatMap(([, p]) => p.ordre));
    for (const id of c.pages[PAGE_MENTIONS].ordre) if (!ailleurs.has(id)) delete c.blocs[id];
    delete c.pages[PAGE_MENTIONS];
  }
  const ancien = typeof c.site.nom === "string" ? c.site.nom : "";
  c.site.nom = nom;
  const n = remplacerNom(c, ancien, nom);
  notes.push(`Le nom « ${texteBrut(ancien) || "?"} » est remplacé par « ${nom} »` + (n ? ` (${n} endroit${n > 1 ? "s" : ""} dans les textes).` : "."));
  if (theme) c.theme = Object.assign({}, c.theme, { id: theme, duo: THEMES[theme].duo });
  if (typeof c.site.logo === "string" && c.site.logo.trim().startsWith("/medias/")) c.site.logo = "";

  // Ce qui appartient à l'autre entreprise repart du modèle.
  for (const bloc of Object.values(c.blocs)) {
    const modele = BLOCS[bloc.type].modele();
    if (bloc.type === "horaires") Object.assign(bloc, { jours: modele.jours, adresse: modele.adresse, telephone: "", email: "", lienPlan: "" });
    if (bloc.type === "contact") Object.assign(bloc, { telephone: "", email: "" });
    if (bloc.type === "avis") bloc.avis = modele.avis;
  }
  let photos = 0;
  visiterObjets(c.blocs, (o) => {
    if (typeof o.image === "string" && o.image.trim().startsWith("/medias/")) { o.image = ILLUSTRATION_NEUTRE; o.imageAlt = ""; photos++; }
    if (typeof o.src === "string" && o.src.trim().startsWith("/medias/")) { o.src = ILLUSTRATION_NEUTRE; o.alt = ""; photos++; }
  });
  // Les liens qui appellent ou écrivent à l'autre entreprise, et ceux qui
  // mènent vers d'autres sites (sa page de réservation, ses réseaux) : ils
  // sont à LUI. Ceux du site lui-même (ancres, pages) restent.
  const APPEL = /^\s*(tel|mailto):/i;
  const EXTERNE = /^\s*https?:/i;
  const aRetirer = (v) => APPEL.test(v) || EXTERNE.test(v);
  let liens = 0;
  let externes = 0;
  const compter = (v) => { if (EXTERNE.test(v)) externes++; else liens++; };
  for (const chemin of cheminsVers(c)) {
    const v = lireChemin(c, chemin);
    if (typeof v === "string" && aRetirer(v)) { compter(v); ecrireChemin(c, chemin, ""); }
  }
  const dansLesTextes = liensDansLesTextes(c).filter((l) => aRetirer(l.vers));
  for (const l of dansLesTextes) compter(l.vers);
  for (const chemin of new Set(dansLesTextes.map((l) => l.chemin))) {
    ecrireChemin(c, chemin, reecrireLiensDansTexte(lireChemin(c, chemin), (v) => (aRetirer(v) ? "" : v)));
  }
  ajouterMentions(c);
  notes.push("Remis au modèle (ils appartiennent à l'autre entreprise) : téléphone, e-mail, adresse, horaires, avis, mentions légales" +
    (photos ? `, ${photos} photo${photos > 1 ? "s" : ""} de sa médiathèque` : "") +
    (liens ? `, ${liens} lien${liens > 1 ? "s" : ""} d'appel ou d'écriture` : "") +
    (externes ? `, ${externes} lien${externes > 1 ? "s" : ""} vers d'autres sites (réservation, réseaux sociaux…)` : "") + ".");
  if (externes) {
    notes.push("Les boutons et entrées de menu qui menaient vers d'autres sites n'ont plus de destination : le contrôle (étape 2) les liste en ⚠, à relier aux adresses du nouveau client.");
  }
  const restantes = mediasCites(c).size;
  if (restantes) notes.push(`⚠ ${restantes} adresse${restantes > 1 ? "s" : ""} /medias/… reste${restantes > 1 ? "nt" : ""} dans le contenu : elle${restantes > 1 ? "s" : ""} ne s'affichera${restantes > 1 ? "ont" : ""} pas chez ce client.`);
  notes.push("Relisez les textes repris : ils peuvent encore parler de l'autre entreprise.");
  return { contenu: c, notes };
}

/* ----- Les fichiers ----- */
export function fabriquerClientJson({ id, nom, socle }) {
  return JSON.stringify({
    id,
    demo: true,
    mentionDemo: `Maquette : ce site est une proposition pour ${nom}. Il n'est pas encore en ligne.`,
    domaine: "",
    socle,
    administration: { adresses: [] }
  }, null, 2) + "\n";
}

/* Le wrangler.toml d'une maquette : mêmes liaisons, migrations, variables
   et explications que celui de la démo (tester-outils.mjs le vérifie),
   ses propres noms, et un espace de contenu « a-creer ». */
export function fabriquerWranglerToml({ id, nom, compatibilite, date }) {
  const nomSurUneLigne = nom.replace(/\s+/g, " ").trim();
  return `# Le Worker de la maquette « ${nomSurUneLigne} », créée le ${date} par
# outils/nouveau-client.mjs. Le socle est commun : seuls \`name\`, la fiche
# (client.json) et le contenu (contenu.json) changent d'un client à
# l'autre — plus, ici, les noms des espaces de stockage, propres à chaque
# client.
name = "vitrine-${id}"
main = "index.js"
compatibility_date = "${compatibilite}"

# Une MAQUETTE est publiée sur son adresse *.workers.dev, en attendant le
# compte de l'atelier et son domaine de démonstration. Un site CLIENT, lui,
# n'est joignable que par son domaine : \`workers_dev = false\` dès qu'il en
# a un (PROCESSUS.md, § 3.2).
workers_dev = true

# Les fichiers statiques du socle (CSS, illustrations, modules de rendu,
# éditeur), servis par Cloudflare avant le Worker, gratuitement.
[assets]
directory = "../../socle/public"

# =========================================================================
# L'administration.
#
# ⚠️ AVANT TOUTE MISE EN LIGNE, deux ressources sont à CRÉER sur le compte
# Cloudflare de l'atelier, puis à reporter ici. Tant qu'elles n'existent
# pas, \`wrangler dev --local\` fonctionne (tout est émulé), mais
# \`wrangler deploy\` échoue — ou, pire, publie un site dont l'administration
# écrit dans le vide.
# =========================================================================

# 1. Le contenu PUBLIÉ, lu à chaque visite. Créer l'espace avec
#      npx wrangler kv namespace create vitrine-${id}-contenu -c clients/${id}/wrangler.toml
#    et remplacer « a-creer » par l'identifiant affiché. Un identifiant faux
#    ne se voit pas en local : il ne se voit qu'au déploiement. Jamais
#    l'identifiant d'un autre client : les deux sites écriraient dans le
#    même contenu (controler et deployer le refusent).
[[kv_namespaces]]
binding = "CONTENU"
id = "a-creer"

# 2. Les photos du client (un espace R2 par client : supprimer un client ne
#    touche à personne d'autre). Créer avec
#      npx wrangler r2 bucket create vitrine-${id}-medias
[[r2_buckets]]
binding = "MEDIAS"
bucket_name = "vitrine-${id}-medias"

# 3. Le Durable Object de l'administration : brouillon, versions, connexions,
#    limites, journal, index des photos, messages du formulaire. Rien à
#    créer à la main — le déploiement le crée. Son schéma vit DANS LE CODE
#    (atelier-coeur.js) : aucune migration SQL à appliquer client par client.
#    ⚠️ Le bloc [[migrations]] ci-dessous n'est PAS une migration de données :
#    il déclare la classe à Cloudflare, une fois pour toutes. Ne jamais
#    modifier ni retirer « v1 » après un premier déploiement ; une classe
#    renommée plus tard demandera un « v2 » AJOUTÉ à la suite.
[[durable_objects.bindings]]
name = "ATELIER"
class_name = "Atelier"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Atelier"]

# 4. Les e-mails de connexion et les alertes de message (Cloudflare Email
#    Service, offre de l'atelier). Le domaine d'expédition doit être VÉRIFIÉ
#    chez Cloudflare avant le premier envoi, et COURRIEL_EXPEDITEUR (plus
#    bas) renseigné. Sinon personne ne reçoit de lien : chaque échec est
#    inscrit au journal de l'atelier (« envoi_echoue »), mais rien ne
#    remonte tout seul.
[[send_email]]
name = "COURRIEL"

[vars]
# L'adresse d'expédition des liens de connexion, sur le domaine vérifié.
# Ex. « connexion@domaine-de-l-atelier.fr ». Vide = aucun e-mail ne part.
COURRIEL_EXPEDITEUR = ""
# Les adresses de l'ATELIER autorisées sur tous les sites, séparées par des
# virgules. Celles du client vont dans client.json (« administration »).
ADRESSES_ATELIER = ""
# COURRIEL_JOURNAL ne se pose JAMAIS ici : seulement dans .dev.vars (voir
# .dev.vars.exemple). Il n'agirait de toute façon que sur localhost.
`;
}

/* Le secret du lien d'accès (32 octets tirés au hasard, en base64url :
   43 caractères sûrs, ce qu'exige `secretDemo`) sur la première ligne, le
   lien sur la seconde — la première se pose telle quelle sur le Worker. */
export function fabriquerAccesDemo({ id, sousDomaine }) {
  const secret = randomBytes(32).toString("base64url");
  return secret + "\nhttps://vitrine-" + id + "." + sousDomaine + ".workers.dev/admin/demo?cle=" + secret + "\n";
}

/* ----- L'écriture, tout ou rien -----

   Les fichiers sont écrits dans un dossier temporaire À CÔTÉ de la
   destination (même disque : le renommage est immédiat et entier), puis
   renommés. Une erreur supprime le dossier temporaire : rien de partiel ne
   reste. `fichiers` : `{ nom: contenu }` ; `.acces-demo`, qui porte un
   secret, est écrit lisible par son seul propriétaire. */
export function ecrireToutOuRien(destination, fichiers) {
  const parent = join(destination, "..");
  const temporaire = mkdtempSync(join(parent, ".nouveau-" + destination.split(/[\\/]/).pop() + "-"));
  try {
    for (const [nom, texte] of Object.entries(fichiers)) {
      writeFileSync(join(temporaire, nom), texte, nom === ".acces-demo" ? { mode: 0o600 } : undefined);
    }
    // Vérifié À NOUVEAU juste avant : renommer sur un dossier vide existant
    // le remplacerait sans un mot.
    if (existsSync(destination)) throw new Error("le dossier " + destination + " est apparu entre-temps.");
    // Un dossier temporaire naît fermé aux autres (0700) : le dossier d'un
    // client est un dossier ordinaire du dépôt.
    chmodSync(temporaire, 0o755);
    renameSync(temporaire, destination);
  } catch (e) {
    rmSync(temporaire, { recursive: true, force: true });
    throw e;
  }
}

/* ----- La création ----- */
export function creerClient({ racine = racineAtelier(), id, nom, theme = null, depuis = null, date = new Date() }) {
  if (!identifiantClientValide(id)) {
    throw new Error(`« ${id} » ne convient pas comme identifiant : minuscules sans accent, chiffres et tirets, ` +
      "48 caractères au plus, une lettre au début et pas de tiret à la fin (ex. boulangerie-muller).");
  }
  if (!nomValide(nom)) throw new Error(`le nom doit être un texte d'une ligne, de 1 à ${NOM_MAX} caractères.`);
  nom = nom.trim();
  if (theme !== null && !Object.prototype.hasOwnProperty.call(THEMES, theme)) {
    throw new Error(`thème inconnu « ${theme} ». Thèmes : ${Object.keys(THEMES).join(", ")}.`);
  }
  const dossierClients = join(racine, "clients");
  const destination = join(dossierClients, id);
  if (existsSync(destination)) throw new Error(`clients/${id} existe déjà : choisissez un autre identifiant, ou supprimez ce dossier.`);

  const atelier = lireJson(join(racine, "atelier.json"));
  const sousDomaine = atelier && typeof atelier.sousDomaineWorkers === "string" ? atelier.sousDomaineWorkers : "";
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(sousDomaine)) throw new Error("atelier.json : « sousDomaineWorkers » manque ou est mal écrit.");

  const dossierDemo = join(dossierClients, DEMO);
  const ficheDemo = lireJson(join(dossierDemo, "client.json"));
  const tomlDemo = lireToml(readFileSync(join(dossierDemo, "wrangler.toml"), "utf8"));
  const indexJs = readFileSync(join(dossierDemo, "index.js"), "utf8");
  const devVars = readFileSync(join(dossierDemo, ".dev.vars.exemple"), "utf8").split("clients/" + DEMO + "/").join("clients/" + id + "/");
  if (typeof ficheDemo.socle !== "string" || !ficheDemo.socle) throw new Error(`clients/${DEMO}/client.json ne dit pas sa version du socle.`);
  if (typeof tomlDemo.compatibility_date !== "string") throw new Error(`clients/${DEMO}/wrangler.toml n'a pas de compatibility_date.`);

  let contenu;
  let notes = [];
  if (depuis !== null) {
    if (!identifiantValide(depuis) || !existsSync(join(dossierClients, depuis, "contenu.json"))) {
      const connus = readdirSync(dossierClients, { withFileTypes: true }).filter((d) => d.isDirectory() && identifiantValide(d.name)).map((d) => d.name);
      throw new Error(`aucun client « ${depuis} » à recopier. Clients : ${connus.join(", ") || "aucun"}.`);
    }
    ({ contenu, notes } = contenuDepuis(lireJson(join(dossierClients, depuis, "contenu.json")), { nom, theme }));
  } else {
    contenu = contenuGenerique({ nom, theme: theme || THEME_PAR_DEFAUT });
  }
  const v = validerContenu(contenu);
  if (!v.ok) throw new Error("le contenu fabriqué serait refusé par l'administration : " + v.message);

  const jour = date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  ecrireToutOuRien(destination, {
    "client.json": fabriquerClientJson({ id, nom, socle: ficheDemo.socle }),
    "wrangler.toml": fabriquerWranglerToml({ id, nom, compatibilite: tomlDemo.compatibility_date, date: jour }),
    "index.js": indexJs,
    ".dev.vars.exemple": devVars,
    "contenu.json": JSON.stringify(contenu, null, 2) + "\n",
    ".acces-demo": fabriquerAccesDemo({ id, sousDomaine })
  });
  return { destination, notes, email: atelier.compteCloudflare && atelier.compteCloudflare.email, theme: contenu.theme.id };
}

/* Les prochaines étapes, EXACTES : chaque commande se recopie telle quelle.
   Le secret se pose APRÈS le premier déploiement : avant, le Worker
   n'existe pas encore sur Cloudflare. */
export function prochainesEtapes({ id, nom, email, relatif }) {
  const d = relatif;
  return [
    `1. Remplir le contenu (${d}/contenu.json) : textes, photos, horaires, téléphone.`,
    "   Les « [À compléter … » des mentions légales attendent la signature.",
    "2. Contrôler :",
    `     npm run controler -- ${id}`,
    "3. Regarder en local, sur ordinateur ET en largeur téléphone :",
    `     cp ${d}/.dev.vars.exemple ${d}/.dev.vars`,
    `     npx wrangler dev -c ${d}/wrangler.toml --port 8790 --local`,
    "   puis http://localhost:8790 (et /admin avec essai@example.com).",
    "4. Créer les espaces du client, sur le compte de l'atelier :",
    `     npx wrangler whoami                     # doit afficher ${email || "le compte d'atelier.json"}`,
    `     npx wrangler kv namespace create vitrine-${id}-contenu -c ${d}/wrangler.toml`,
    `     npx wrangler r2 bucket create vitrine-${id}-medias`,
    `   et reporter l'identifiant du KV à la place de « a-creer » dans ${d}/wrangler.toml`,
    "   (celui que la commande vient d'afficher, jamais celui d'un autre client).",
    "5. Enregistrer (le déploiement refuse un dépôt qui a des modifications) :",
    "     npm run verifier",
    `     git add ${d} && git commit -m "Maquette ${nom.replace(/["\\$`]/g, "")}"`,
    "6. Déployer :",
    `     npm run deployer -- --client ${id}`,
    "7. Poser le secret du lien d'accès à l'administration (sans e-mail) :",
    `     head -n 1 ${d}/.acces-demo | tr -d '\\n' | npx wrangler secret put ACCES_DEMO -c ${d}/wrangler.toml`,
    `   Le lien à transmettre est la seconde ligne de ${d}/.acces-demo (jamais versionné).`
  ];
}

/* ----- En ligne de commande ----- */
if (estLance(import.meta.url)) {
  const usage = 'Usage : npm run nouveau-client -- <id> "<Nom>" [--theme <id>] [--depuis <client>]';
  let args;
  try {
    args = lireArguments(process.argv.slice(2), { options: ["--theme", "--depuis"] });
  } catch (e) {
    console.error("✗ " + e.message + "\n" + usage);
    process.exit(2);
  }
  const [id, nom] = args.positions;
  if (!id || nom === undefined || args.positions.length > 2) { console.error(usage); process.exit(2); }
  const racine = racineAtelier();
  try {
    const r = creerClient({ racine, id, nom, theme: args.options.get("--theme") ?? null, depuis: args.options.get("--depuis") ?? null });
    const relatif = relative(process.cwd(), r.destination) || r.destination;
    console.log(`✓ Client « ${id} » créé dans ${relatif}/ (thème ${THEMES[r.theme].nom}, ` +
      (args.options.has("--depuis") ? `d'après « ${args.options.get("--depuis")} »` : "recette générique") + ").");
    for (const n of r.notes) console.log("  " + n);
    console.log("\nProchaines étapes :");
    for (const l of prochainesEtapes({ id, nom: nom.trim(), email: r.email, relatif })) console.log("  " + l);
  } catch (e) {
    console.error("✗ Rien n'a été créé : " + e.message);
    process.exit(1);
  }
}
