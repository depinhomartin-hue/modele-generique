/* =========================================================
   Le cœur de l'atelier — la logique du Durable Object
   =========================================================

   Un Durable Object par client (nom fixe « site ») garde tout ce qui doit
   être COHÉRENT : le brouillon et sa révision, les versions, les jetons de
   connexion à usage unique, les sessions, les compteurs de limites, le
   journal et l'index des photos. KV, répliqué au bord et cohérent « à
   terme », ne sait rien garantir de tout ça — un jeton « à usage unique »
   lu dans KV peut servir deux fois.

   Ce fichier n'importe RIEN de `cloudflare:*` : il se teste sous Node
   (outils/simulateurs.mjs lui donne une base node:sqlite). La classe
   `Atelier` (atelier.js) ne fait que lui déléguer.

   Trois règles tiennent l'ensemble :

   1. Le schéma vit DANS LE CODE (`CREATE TABLE IF NOT EXISTS`, au
      constructeur). Aucune migration à appliquer client par client, rien à
      oublier lors d'une mise à jour du socle — leçon de Graine de Pensée,
      où une migration passée APRÈS le déploiement faisait tomber le code en
      marche en silence. Une colonne ajoutée plus tard devra passer par un
      `ALTER TABLE` gardé (`PRAGMA table_info`), jamais par un fichier à part.

   2. Tout ce qui lit puis écrit se fait d'un seul tenant, SANS `await` au
      milieu. Un Durable Object ne traite qu'un événement à la fois, mais
      chaque `await` sur une entrée-sortie (KV, R2) laisse entrer la requête
      suivante : lire la révision, attendre KV, puis écrire, c'est écrire
      sur un état périmé. Les calculs asynchrones (empreintes SHA-256) se
      font donc AVANT, et les écritures qui forment un tout passent par
      `transactionSync`. Les opérations qui changent le brouillon passent en
      plus par une file (`enFile`) : une publication attend KV, et pendant
      ce temps rien d'autre ne doit toucher au brouillon.

   3. Un jeton, une session : seule leur empreinte SHA-256 est en base. Une
      copie de la base ne permet d'entrer nulle part. */

import {
  validerContenu, formeCanonique, empreinteDe, sha256Hex, jetonValide, base64url, hex,
  adresseEmail, octets, objetSimple, aEnPropre
} from "./validation.js";
import { CLE_PUBLIE } from "./contenu.js";
import { urlMedia, photosCitees, TYPES_IMAGES, LIMITES_PHOTOS } from "./medias.js";

const MINUTE = 60_000;
const HEURE = 60 * MINUTE;
const JOUR = 24 * HEURE;

export const DUREE_JETON_MIN = 15;
export const DUREE_SESSION_S = 30 * 24 * 3600;
const DUREE_JETON = DUREE_JETON_MIN * MINUTE;
const DUREE_SESSION = DUREE_SESSION_S * 1000;
// `vu_le` dit quand un appareil a servi pour la dernière fois ; l'écrire à
// chaque enregistrement automatique (toutes les 1,2 s) ne dirait rien de
// plus et coûterait une écriture à chaque fois.
const RAFRAICHIR_VU = 10 * MINUTE;
const SESSIONS_PAR_ADRESSE = 20;
export const VERSIONS_GARDEES = 100;
const JOURNAL_GARDE = 500;
const JOURNAL_LU = 100;

/* Les limites de demandes de lien (spécification § 3). En base, jamais en
   KV : un compteur KV est lu depuis le cache du bord pendant 60 s, il ne
   limite rien et épuise le quota d'écritures (leçon de Graine de Pensée).

   ⚠️ Les plafonds courts se comptent par couple ADRESSE + CONNEXION, pas
   par adresse seule. Comptés par adresse, ils se retournaient contre la
   personne qu'ils protègent : dix demandes depuis n'importe où, au milieu
   de la nuit, et la vraie titulaire ne recevait plus aucun lien pendant
   24 heures, avec une page qui lui affirmait le contraire — à recommencer
   chaque jour, pour dix requêtes (relecture du 3 octobre 2026). Par
   adresse seule ne reste qu'un plafond nettement plus haut, qui borne le
   COÛT (le quota d'e-mails) et non l'accès ; une connexion d'où cette
   adresse est déjà entrée le franchit (`ip_connues`).

   Le plafond du SITE se franchit aussi depuis une connexion connue. Sans
   ça, viser deux adresses publiques (celle du client, celle de l'atelier)
   pendant trois heures suffisait à l'atteindre, et bloquait une troisième
   personne jamais visée, même depuis chez elle (contrôle du 3 octobre
   2026). La facture reste bornée : une connexion connue est l'une de celles
   d'où une personne autorisée est réellement entrée, et elle reste tenue
   par ses propres plafonds courts (10 liens par 24 heures).

   Le seau d'une limite est aussi ce que purge `purger` : un seau ajouté ici
   est purgé sans rien écrire d'autre. Un seau RETIRÉ d'ici garde ses
   lignes pour toujours — le laisser une journée de plus, le temps qu'elles
   vieillissent. */
const LIMITE_IP = { seau: "ip", fenetre: HEURE, max: 10, motif: "Limite atteinte : 10 demandes en une heure depuis la même connexion." };
const LIMITES_LIENS = [
  { seau: "adresse_ip", fenetre: 15 * MINUTE, max: 3, motif: "Limite atteinte : 3 liens en 15 minutes pour cette adresse depuis la même connexion." },
  { seau: "adresse_ip", fenetre: JOUR, max: 10, motif: "Limite atteinte : 10 liens en 24 heures pour cette adresse depuis la même connexion." },
  { seau: "adresse", fenetre: JOUR, max: 30, ipConnueFranchit: true, motif: "Limite atteinte : 30 liens en 24 heures pour cette adresse, toutes connexions confondues." },
  { seau: "site", fenetre: JOUR, max: 50, ipConnueFranchit: true, motif: "Limite atteinte : 50 e-mails de connexion en 24 heures pour le site." }
];
// La plus longue fenêtre de chaque seau : au-delà, une ligne ne compte plus.
const FENETRES = new Map();
for (const l of [LIMITE_IP, ...LIMITES_LIENS]) FENETRES.set(l.seau, Math.max(FENETRES.get(l.seau) || 0, l.fenetre));

/* La purge des compteurs ne passe qu'une fois par minute, et non à chaque
   demande : une demande anonyme ne doit jamais coûter plus que quelques
   lectures d'index (relecture du 3 octobre 2026, où chaque demande
   parcourait toute la table et où le coût total devenait quadratique). Les
   comptes, eux, ne dépendent pas de la purge : ils bornent sur `quand`. */
const PURGE_ESPACEE = MINUTE;

/* Une connexion d'où une adresse est déjà ENTRÉE (lien cliqué, session
   ouverte) est gardée trois mois, sous forme d'empreinte : plus longtemps
   qu'une session (30 jours), parce que c'est précisément quand la session a
   expiré qu'on redemande un lien. Gardée hors de `sessions` pour la même
   raison : une déconnexion ne doit pas retirer ce passe-droit. */
const GARDE_IP_CONNUE = 90 * JOUR;

/* Le quota de la médiathèque compte les photos VISIBLES. Une photo retirée
   reste dans R2 (une ancienne version la cite peut-être), mais compter les
   retirées enfermerait le client : il retirerait des photos sans jamais
   pouvoir en ajouter d'autres, sans comprendre pourquoi. */
export const QUOTA_MEDIAS = Object.freeze({ nombre: 1000, octets: 1024 * 1024 * 1024 });

/* Les méthodes que le Worker peut appeler sur le Durable Object — la liste
   blanche. `atelier.js` déclare exactement celles-là, et les tests le
   vérifient : une méthode ajoutée ici sans l'être là-bas serait
   injoignable, et l'inverse exposerait une méthode interne. */
export const METHODES_RPC = Object.freeze(["api", "session", "demanderLien", "verifierLien", "entrer", "entrerParLienDemo", "deconnecter", "signalerEchecEnvoi"]);

const SCHEMA = [
  /* Une seule ligne : le brouillon ET ce qui est en ligne, lus ensemble à
     chaque `etat`. Le contenu publié est gardé ici et non relu dans KV :
     KV peut servir une valeur vieille d'une minute, et « abandonner mes
     modifications » juste après une publication reviendrait alors à
     l'avant-dernière. */
  `CREATE TABLE IF NOT EXISTS brouillon (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    contenu TEXT NOT NULL,
    revision INTEGER NOT NULL,
    empreinte TEXT NOT NULL,
    modifie_le INTEGER NOT NULL,
    modifie_par TEXT,
    publie_contenu TEXT,
    publie_empreinte TEXT,
    publie_le INTEGER,
    publie_par TEXT,
    publie_version INTEGER
  )`,
  // AUTOINCREMENT : un numéro de version n'est jamais réattribué après une
  // purge. « Voir la version 7 » ne doit pas montrer un autre contenu demain.
  `CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quand INTEGER NOT NULL,
    par TEXT,
    origine TEXT NOT NULL,
    contenu TEXT NOT NULL,
    empreinte TEXT NOT NULL,
    taille INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS jetons (
    hash TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    cree_le INTEGER NOT NULL,
    expire_le INTEGER NOT NULL,
    utilise_le INTEGER
  )`,
  "CREATE INDEX IF NOT EXISTS jetons_par_expiration ON jetons (expire_le)",
  `CREATE TABLE IF NOT EXISTS sessions (
    hash TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    cree_le INTEGER NOT NULL,
    vu_le INTEGER NOT NULL,
    expire_le INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS sessions_par_adresse ON sessions (email, cree_le)",
  "CREATE INDEX IF NOT EXISTS sessions_par_expiration ON sessions (expire_le)",
  `CREATE TABLE IF NOT EXISTS demandes (
    seau TEXT NOT NULL,
    cle TEXT NOT NULL,
    quand INTEGER NOT NULL
  )`,
  // Le premier index sert les COMPTES (seau + clé + fenêtre), le second la
  // PURGE, seau par seau. Sans lui, « DELETE … WHERE quand <= ? » parcourait
  // toute la table à chaque demande (relecture du 3 octobre 2026).
  "CREATE INDEX IF NOT EXISTS demandes_par_seau ON demandes (seau, cle, quand)",
  "CREATE INDEX IF NOT EXISTS demandes_par_seau_quand ON demandes (seau, quand)",
  // `cle` = adresse + ":" + empreinte de la connexion (voir GARDE_IP_CONNUE).
  // Une ligne ne naît que d'un lien réellement cliqué : un anonyme ne peut
  // pas la remplir.
  `CREATE TABLE IF NOT EXISTS secret (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    valeur TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ip_connues (
    cle TEXT PRIMARY KEY,
    quand INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS ip_connues_par_quand ON ip_connues (quand)",
  `CREATE TABLE IF NOT EXISTS journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quand INTEGER NOT NULL,
    par TEXT,
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
  )`,
  // Pour `journaliserRefus`, que n'importe qui connaissant l'adresse peut
  // déclencher à chaque demande : une recherche d'index, pas un parcours.
  "CREATE INDEX IF NOT EXISTS journal_par_action ON journal (action, par, quand)",
  `CREATE TABLE IF NOT EXISTS medias (
    id TEXT PRIMARY KEY,
    ext TEXT NOT NULL,
    type TEXT NOT NULL,
    nom TEXT NOT NULL DEFAULT '',
    largeur INTEGER NOT NULL,
    hauteur INTEGER NOT NULL,
    taille INTEGER NOT NULL,
    vignette_ext TEXT,
    vignette_taille INTEGER NOT NULL DEFAULT 0,
    quand INTEGER NOT NULL,
    par TEXT,
    retire_le INTEGER
  )`
];

/* ----- Réponses de l'API -----

   Le cœur rend `{ statut, corps }` ; le Worker en fait une réponse HTTP.
   Les messages sont écrits pour un artisan : ils s'affichent tels quels. */
const MESSAGES = {
  non_connecte: "Votre connexion a expiré. Reconnectez-vous pour continuer.",
  conflit: "Le brouillon a été modifié ailleurs entre-temps.",
  requete_invalide: "La demande est incomplète. Rechargez la page et réessayez.",
  indisponible: "L'administration est momentanément indisponible. Réessayez dans quelques minutes.",
  publication_impossible: "La publication n'a pas pu se faire. Rien n'a changé sur le site : réessayez dans un instant.",
  quota_atteint: "La médiathèque est pleine (1 000 photos ou 1 Go). Retirez des photos pour en ajouter d'autres.",
  version_introuvable: "Cette version n'existe plus.",
  photo_introuvable: "Cette photo n'existe pas.",
  action_introuvable: "Cette action n'existe pas."
};

const ok = (corps, statut = 200) => ({ statut, corps });
const erreur = (statut, code, message, plus) => ({ statut, corps: Object.assign({ erreur: code, message }, plus || {}) });
const requeteInvalide = () => erreur(400, "requete_invalide", MESSAGES.requete_invalide);
const indisponible = () => erreur(503, "indisponible", MESSAGES.indisponible);
const autorise = (email, autorisees) => Array.isArray(autorisees) && autorisees.includes(email);
const idVersion = (v) => Number.isSafeInteger(v) && v > 0;
const idPhoto = (v) => typeof v === "string" && /^[0-9a-f]{32}$/.test(v);
const entierBorne = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;

/* La « connexion » d'une demande : l'adresse IPv4 telle quelle, mais le
   préfixe /64 d'une adresse IPv6. Un abonné reçoit un /64 entier et ses
   appareils y changent d'adresse tous les jours (adresses temporaires) :
   compté à l'adresse près, un plafond par connexion se contournait en
   changeant le dernier mot, et la connexion de la titulaire ne restait
   jamais « connue » plus d'une journée (relecture du 3 octobre 2026).
   Une forme qu'on ne sait pas lire est gardée telle quelle. */
export function connexionDe(ip) {
  const s = typeof ip === "string" ? ip.trim().toLowerCase() : "";
  if (!s) return "inconnue";
  if (!s.includes(":")) return s;
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (v4) return v4[1];
  const morceaux = s.split("::");
  if (morceaux.length > 2) return s;
  const tete = morceaux[0] ? morceaux[0].split(":") : [];
  const queue = morceaux.length === 2 && morceaux[1] ? morceaux[1].split(":") : [];
  const manque = 8 - tete.length - queue.length;
  if (morceaux.length === 1 ? tete.length !== 8 : manque < 1) return s;
  const groupes = tete.concat(Array(morceaux.length === 2 ? manque : 0).fill("0"), queue);
  if (!groupes.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return s;
  return groupes.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":") + "::/64";
}

/* L'adresse IP n'est jamais gardée en clair : seulement une empreinte
   SALÉE par un secret tiré au hasard à la naissance du Durable Object
   (table `secret`). Sans sel, l'empreinte d'une adresse IPv4 se renversait
   en deux heures sur un seul processeur — et `ip_connues` la garde des
   semaines, à côté d'une adresse e-mail (contrôle du 3 octobre 2026). Le
   sel vit dans la même base : il protège une empreinte qui circulerait
   seule (un journal, une capture), pas une copie entière de la base. */

function vueBrouillon(b) {
  return { contenu: JSON.parse(b.contenu), revision: b.revision, empreinte: b.empreinte, modifie_le: b.modifie_le, modifie_par: b.modifie_par ?? null };
}

function vuePublie(b) {
  return {
    empreinte: (b && b.publie_empreinte) ?? null,
    publie_le: (b && b.publie_le) ?? null,
    publie_par: (b && b.publie_par) ?? null
  };
}

function vueMedia(m) {
  return {
    id: m.id,
    url: urlMedia(m.id, m.ext),
    vignette: m.vignette_ext ? urlMedia(m.id, m.vignette_ext, true) : null,
    nom: m.nom,
    type: m.type,
    largeur: m.largeur,
    hauteur: m.hauteur,
    taille: m.taille,
    quand: m.quand
  };
}

const conflit = (b) => erreur(409, "conflit", MESSAGES.conflit, { brouillon: vueBrouillon(b) });

/* Une photo décrite par le Worker après lecture de ses octets. */
function fichierDecrit(f) {
  if (!objetSimple(f) || typeof f.ext !== "string" || !aEnPropre(TYPES_IMAGES, f.ext) || f.type !== TYPES_IMAGES[f.ext]) return null;
  if (!entierBorne(f.taille, 1, LIMITES_PHOTOS.image)) return null;
  if (f.largeur !== undefined && !entierBorne(f.largeur, 1, LIMITES_PHOTOS.cote)) return null;
  if (f.hauteur !== undefined && !entierBorne(f.hauteur, 1, LIMITES_PHOTOS.cote)) return null;
  return f;
}

/* Les opérations de l'API, et seulement elles. */
const OPERATIONS = {
  "etat": "opEtat",
  "brouillon": "opBrouillon",
  "publier": "opPublier",
  "versions": "opVersions",
  "version": "opVersion",
  "reprendre": "opReprendre",
  "abandonner": "opAbandonner",
  "medias": "opMedias",
  "medias.preparer": "opMediasPreparer",
  "medias.enregistrer": "opMediasEnregistrer",
  "medias.retirer": "opMediasRetirer",
  "journal": "opJournal",
  "export": "opExport",
  "deconnecter-partout": "opDeconnecterPartout"
};

export class CoeurAtelier {
  /* `stockage` = `ctx.storage` du Durable Object : `sql.exec(requête,
     ...liaisons)` et `transactionSync(fn)`. `options.maintenant()` et
     `options.aleatoire(n)` remplacent l'horloge et le hasard dans les
     tests (15 minutes, 30 jours, 24 heures ne s'attendent pas). */
  constructor(stockage, env, options = {}) {
    this.stockage = stockage;
    this.sql = stockage.sql;
    this.env = env && typeof env === "object" ? env : {};
    this.maintenant = typeof options.maintenant === "function" ? options.maintenant : () => Date.now();
    this.aleatoire = typeof options.aleatoire === "function" ? options.aleatoire : (n) => crypto.getRandomValues(new Uint8Array(n));
    this.file = Promise.resolve();
    // En mémoire seulement : un Durable Object réveillé purge à sa première
    // demande, et c'est très bien ainsi.
    this.prochainePurge = 0;
    for (const requete of SCHEMA) this.sql.exec(requete);
    this.sql.exec("INSERT OR IGNORE INTO secret (id, valeur) VALUES (1, ?)", hex(this.aleatoire(32)));
    this.sel = this.sql.exec("SELECT valeur FROM secret WHERE id = 1").one().valeur;
  }

  async empreinteConnexion(ip) {
    return (await sha256Hex(this.sel + ":ip:" + connexionDe(ip))).slice(0, 32);
  }

  /* ----- Accès à la base ----- */
  lignes(requete, ...liaisons) {
    return this.sql.exec(requete, ...liaisons).toArray();
  }
  ligne(requete, ...liaisons) {
    return this.lignes(requete, ...liaisons)[0] || null;
  }
  ecrire(requete, ...liaisons) {
    this.sql.exec(requete, ...liaisons);
  }

  /* Une seule opération sur le brouillon à la fois, de bout en bout, même
     quand elle attend KV. Une erreur ne bloque pas la file. */
  enFile(fn) {
    const suite = this.file.then(() => fn());
    this.file = suite.catch(() => {});
    return suite;
  }

  journaliser(action, par, detail = "") {
    this.ecrire("INSERT INTO journal (quand, par, action, detail) VALUES (?, ?, ?, ?)",
      this.maintenant(), par ?? null, action, String(detail ?? "").slice(0, 300));
    this.ecrire("DELETE FROM journal WHERE id <= (SELECT id FROM journal ORDER BY id DESC LIMIT 1 OFFSET ?)", JOURNAL_GARDE);
  }

  /* La version « départ » (le site tel qu'il était à l'ouverture de
     l'éditeur) n'est jamais purgée : c'est le seul chemin de retour vers le
     site livré, et cent publications plus tard on peut encore en avoir
     besoin. Elle ne compte pas dans les cent. */
  purgerVersions() {
    this.ecrire("DELETE FROM versions WHERE origine <> 'depart' AND id <= (SELECT id FROM versions WHERE origine <> 'depart' ORDER BY id DESC LIMIT 1 OFFSET ?)", VERSIONS_GARDEES);
  }

  /* Chaque suppression suit un index : elle ne lit que ce qu'elle retire. */
  purger(maintenant) {
    for (const [seau, fenetre] of FENETRES) this.ecrire("DELETE FROM demandes WHERE seau = ? AND quand <= ?", seau, maintenant - fenetre);
    this.ecrire("DELETE FROM jetons WHERE expire_le <= ?", maintenant);
    this.ecrire("DELETE FROM sessions WHERE expire_le <= ?", maintenant);
    this.ecrire("DELETE FROM ip_connues WHERE quand <= ?", maintenant - GARDE_IP_CONNUE);
  }

  purgerSiBesoin(maintenant) {
    if (maintenant < this.prochainePurge) return;
    this.purger(maintenant);
    this.prochainePurge = maintenant + PURGE_ESPACEE;
  }

  /* Le compte s'arrête à la limite : au-delà, compter plus loin ne
     changerait rien à la réponse et lirait pour rien. */
  compter(seau, cle, depuis, max) {
    return this.ligne("SELECT COUNT(*) AS n FROM (SELECT 1 FROM demandes WHERE seau = ? AND cle = ? AND quand > ? LIMIT ?)", seau, cle, depuis, max).n;
  }
  noter(seau, cle, quand) {
    this.ecrire("INSERT INTO demandes (seau, cle, quand) VALUES (?, ?, ?)", seau, cle, quand);
  }
  ipConnue(cle, maintenant) {
    return !!this.ligne("SELECT 1 AS x FROM ip_connues WHERE cle = ? AND quand > ?", cle, maintenant - GARDE_IP_CONNUE);
  }

  /* Un refus au journal, mais une fois par heure et par adresse : sans ça,
     quelqu'un qui connaît l'adresse du client pourrait remplir les 500
     lignes du journal de refus et en chasser les vraies connexions. */
  journaliserRefus(adresse, motif, maintenant) {
    const recent = this.ligne("SELECT 1 AS x FROM journal WHERE action = 'lien_refuse' AND par = ? AND quand > ? LIMIT 1", adresse, maintenant - HEURE);
    if (!recent) this.journaliser("lien_refuse", adresse, motif);
  }

  /* ----- Connexion ----- */

  /* La demande d'un lien. Toujours la même réponse VUE DE LA PAGE (le
     Worker ne montre rien de ce qui suit) ; ici, on décide si un lien part.
     Chaque demande compte pour sa connexion, adresse connue ou non : c'est
     ce qui borne le sondage d'adresses. Seuls les liens réellement créés
     comptent pour l'adresse et pour le site.

     ⚠️ Une connexion déjà au plafond n'écrit PLUS RIEN. Avant, chaque
     demande anonyme ajoutait sa ligne, même refusée, même pour une adresse
     inventée : une seule machine remplissait la table à volonté, et chaque
     demande la parcourait (relecture du 3 octobre 2026). Désormais une
     connexion écrit au plus 10 lignes de compteur par heure, quoi qu'elle
     envoie — plus trois par lien réellement parti, plafonnés eux aussi.
     → `{ envoyer: true, jeton, email }` | `{ envoyer: false, motif? }` */
  async demanderLien({ email, ip, autorisees } = {}) {
    const adresse = adresseEmail(email);
    const cleIp = await this.empreinteConnexion(ip);
    const jeton = base64url(this.aleatoire(32));
    const empreinteJeton = await sha256Hex(jeton);
    return this.stockage.transactionSync(() => {
      const maintenant = this.maintenant();
      this.purgerSiBesoin(maintenant);
      const cles = { ip: cleIp, adresse_ip: adresse + ":" + cleIp, adresse, site: "site" };
      const depasse = (l) => this.compter(l.seau, cles[l.seau], maintenant - l.fenetre, l.max) >= l.max;
      const refusIp = depasse(LIMITE_IP);
      if (!refusIp) this.noter("ip", cleIp, maintenant);
      if (!adresse || !autorise(adresse, autorisees)) return { envoyer: false };
      const limite = refusIp ? LIMITE_IP : LIMITES_LIENS.find((l) => depasse(l) && !(l.ipConnueFranchit && this.ipConnue(cles.adresse_ip, maintenant)));
      if (limite) {
        this.journaliserRefus(adresse, limite.motif, maintenant);
        return { envoyer: false, motif: limite.motif };
      }
      this.ecrire("INSERT INTO jetons (hash, email, cree_le, expire_le) VALUES (?, ?, ?, ?)", empreinteJeton, adresse, maintenant, maintenant + DUREE_JETON);
      for (const seau of ["adresse_ip", "adresse", "site"]) this.noter(seau, cles[seau], maintenant);
      this.journaliser("lien_demande", adresse, "");
      return { envoyer: true, jeton, email: adresse };
    });
  }

  /* Le lien est-il encore bon ? Ne le CONSOMME PAS : les antivirus et les
     aperçus de messagerie ouvrent les liens tout seuls. */
  async verifierLien({ jeton, autorisees } = {}) {
    if (!jetonValide(jeton)) return null;
    const empreinte = await sha256Hex(jeton);
    const j = this.ligne("SELECT email FROM jetons WHERE hash = ? AND utilise_le IS NULL AND expire_le > ?", empreinte, this.maintenant());
    return j && autorise(j.email, autorisees) ? { email: j.email } : null;
  }

  /* Le jeton est consommé d'un seul geste (`UPDATE … RETURNING` sur la
     condition « pas encore utilisé ») : deux clics simultanés n'ouvrent
     qu'une session. `RETURNING` et non `rowsWritten`, qui compte aussi les
     écritures d'index et ne dit donc pas combien de LIGNES ont changé.
     `ip` = la connexion d'où l'on clique : elle devient « connue » pour
     cette adresse (voir GARDE_IP_CONNUE). */
  async entrer({ jeton, autorisees, ip } = {}) {
    if (!jetonValide(jeton)) return null;
    const empreinte = await sha256Hex(jeton);
    const session = base64url(this.aleatoire(32));
    const empreinteSession = await sha256Hex(session);
    const cleIp = await this.empreinteConnexion(ip);
    return this.stockage.transactionSync(() => {
      const maintenant = this.maintenant();
      const j = this.lignes("UPDATE jetons SET utilise_le = ? WHERE hash = ? AND utilise_le IS NULL AND expire_le > ? RETURNING email",
        maintenant, empreinte, maintenant)[0];
      if (!j || !autorise(j.email, autorisees)) return null;
      this.ecrire("INSERT INTO sessions (hash, email, cree_le, vu_le, expire_le) VALUES (?, ?, ?, ?, ?)",
        empreinteSession, j.email, maintenant, maintenant, maintenant + DUREE_SESSION);
      this.ecrire("INSERT INTO ip_connues (cle, quand) VALUES (?, ?) ON CONFLICT (cle) DO UPDATE SET quand = excluded.quand",
        j.email + ":" + cleIp, maintenant);
      // Vingt appareils au plus par adresse : le plus ancien tombe.
      this.ecrire("DELETE FROM sessions WHERE email = ? AND hash NOT IN (SELECT hash FROM sessions WHERE email = ? ORDER BY cree_le DESC, rowid DESC LIMIT ?)",
        j.email, j.email, SESSIONS_PAR_ADRESSE);
      this.journaliser("connexion", j.email, "");
      return { session, email: j.email };
    });
  }

  /* L'entrée par le lien d'accès d'une maquette (admin.js a déjà vérifié
     la clé). Même session que par e-mail, sans jeton ; l'adresse doit être
     dans la liste autorisée, ce qui n'arrive que si le lien est actif
     (validation.js, `adressesAutorisees`). */
  async entrerParLienDemo({ email, autorisees } = {}) {
    const adresse = adresseEmail(email);
    if (!adresse || !autorise(adresse, autorisees)) return null;
    const session = base64url(this.aleatoire(32));
    const empreinteSession = await sha256Hex(session);
    return this.stockage.transactionSync(() => {
      const maintenant = this.maintenant();
      this.ecrire("INSERT INTO sessions (hash, email, cree_le, vu_le, expire_le) VALUES (?, ?, ?, ?, ?)",
        empreinteSession, adresse, maintenant, maintenant, maintenant + DUREE_SESSION);
      this.ecrire("DELETE FROM sessions WHERE email = ? AND hash NOT IN (SELECT hash FROM sessions WHERE email = ? ORDER BY cree_le DESC, rowid DESC LIMIT ?)",
        adresse, adresse, SESSIONS_PAR_ADRESSE);
      this.journaliser("connexion", adresse, "Lien d'accès de la maquette");
      return { session, email: adresse };
    });
  }

  /* Qui est derrière ce cookie ? Une adresse retirée de la liste perd ses
     sessions sur-le-champ : retirer quelqu'un de la fiche doit suffire à
     le mettre dehors, sans attendre 30 jours. */
  async qui(jeton, autorisees) {
    if (!jetonValide(jeton)) return null;
    const empreinte = await sha256Hex(jeton);
    const maintenant = this.maintenant();
    const s = this.ligne("SELECT email, vu_le FROM sessions WHERE hash = ? AND expire_le > ?", empreinte, maintenant);
    if (!s) return null;
    if (!autorise(s.email, autorisees)) {
      this.ecrire("DELETE FROM sessions WHERE hash = ?", empreinte);
      return null;
    }
    if (maintenant - s.vu_le >= RAFRAICHIR_VU) this.ecrire("UPDATE sessions SET vu_le = ? WHERE hash = ?", maintenant, empreinte);
    return { email: s.email };
  }

  async session({ session, autorisees } = {}) {
    return this.qui(session, autorisees);
  }

  async deconnecter({ session } = {}) {
    if (!jetonValide(session)) return { ok: true };
    const empreinte = await sha256Hex(session);
    return this.stockage.transactionSync(() => {
      const s = this.lignes("DELETE FROM sessions WHERE hash = ? RETURNING email", empreinte)[0];
      if (s) this.journaliser("deconnexion", s.email, "");
      return { ok: true };
    });
  }

  signalerEchecEnvoi({ email, cause } = {}) {
    return this.stockage.transactionSync(() => {
      this.journaliser("envoi_echoue", adresseEmail(email) || null, typeof cause === "string" ? cause : "Cause inconnue.");
      return { ok: true };
    });
  }

  /* ----- L'API de l'éditeur -----

   UN aller-retour par requête : la session est vérifiée ET l'opération
   exécutée dans le même appel. `demande` = `{ operation, session,
   autorisees, site, livre, params }` ; `livre` est le contenu livré avec
   le client (le Durable Object est commun à tous les clients et ne le
   connaît pas autrement). */
  async api(demande) {
    const d = objetSimple(demande) ? demande : {};
    const methode = typeof d.operation === "string" && aEnPropre(OPERATIONS, d.operation) ? OPERATIONS[d.operation] : null;
    if (!methode) return erreur(404, "introuvable", MESSAGES.action_introuvable);
    const qui = await this.qui(d.session, d.autorisees);
    if (!qui) return Object.assign(erreur(401, "non_connecte", MESSAGES.non_connecte), { effacerCookie: true });
    return this[methode](qui, d, objetSimple(d.params) ? d.params : {});
  }

  lireBrouillon() {
    return this.ligne("SELECT * FROM brouillon WHERE id = 1");
  }

  /* Ce que montre le site quand rien n'a été publié depuis l'éditeur : le
     contenu de KV s'il existe (posé à la main, par exemple), sinon le
     contenu livré.

     ⚠️ KV qui NE RÉPOND PAS rend `null` (→ 503), jamais le contenu livré.
     Ouvrir l'éditeur sur le contenu livré pendant une panne, puis publier,
     écraserait le vrai site par une vieille version — « je ne sais pas
     lire » ne vaut jamais « il n'y a rien ». Un contenu ILLISIBLE, lui,
     donne le contenu livré : c'est ce que montre la page publique. */
  async contenuHorsEditeur(livre) {
    let source = null;
    const kv = this.env.CONTENU;
    if (kv && typeof kv.get === "function") {
      let texte;
      try {
        texte = await kv.get(CLE_PUBLIE, "text");
      } catch (e) {
        console.error("Lecture du contenu en ligne impossible :", e);
        return null;
      }
      if (typeof texte === "string") {
        try {
          const v = JSON.parse(texte);
          if (objetSimple(v)) source = v;
        } catch { /* illisible : la page publique montre le contenu livré, nous aussi */ }
      }
    }
    const n = formeCanonique(source || (objetSimple(livre) ? livre : {}));
    return { json: n.json, empreinte: await empreinteDe(n.json) };
  }

  async contenuEnLigne(b, livre) {
    if (b && typeof b.publie_contenu === "string") return { json: b.publie_contenu, empreinte: b.publie_empreinte };
    return this.contenuHorsEditeur(livre);
  }

  /* Au premier appel, le brouillon naît du contenu en ligne. `INSERT OR
     IGNORE` : deux premiers appels simultanés (l'attente de KV les laisse
     se croiser) n'en créent qu'un. */
  async brouillonOuInitialiser(livre) {
    const b = this.lireBrouillon();
    if (b) return b;
    const depart = await this.contenuHorsEditeur(livre);
    if (!depart) return null;
    /* Le contenu de départ est AUSSI gardé comme version (« départ ») :
       sans elle, une fois la première publication faite, rien dans
       l'éditeur ne ramenait au site tel qu'il était — le contenu livré ne
       vit que dans le code (essai du 3 octobre 2026). Même transaction que
       la naissance du brouillon : si deux premiers appels se croisent,
       seul celui qui crée le brouillon crée la version. */
    this.stockage.transactionSync(() => {
      const quand = this.maintenant();
      const cree = this.lignes("INSERT OR IGNORE INTO brouillon (id, contenu, revision, empreinte, modifie_le, modifie_par) VALUES (1, ?, 1, ?, ?, NULL) RETURNING id",
        depart.json, depart.empreinte, quand);
      if (cree.length) {
        this.ecrire("INSERT INTO versions (quand, par, origine, contenu, empreinte, taille) VALUES (?, NULL, 'depart', ?, ?, ?)",
          quand, depart.json, depart.empreinte, octets(depart.json));
      }
    });
    return this.lireBrouillon();
  }

  /* Le brouillon, remis en phase avec le site s'il le faut.

     ⚠️ Tant que rien n'a été publié depuis l'éditeur, le site montre le
     contenu HORS ÉDITEUR (KV posé à la main, sinon le contenu livré), et
     celui-ci peut changer sans l'éditeur : l'atelier corrige
     `contenu.json` et redéploie. Le brouillon, né une fois pour toutes au
     premier appel, restait sur l'ancien : l'éditeur montrait une version
     périmée sans rien dire, et la première publication remettait en ligne
     cette version périmée par-dessus la bonne, qui n'existait plus nulle
     part (relecture du 3 octobre 2026). Désormais :
     — le nouveau contenu devient une version « départ » : il reste
       récupérable, quoi qu'il arrive ensuite ;
     — un brouillon resté identique à l'ancien départ le reprend (rien à
       perdre : il ne contenait que l'ancien départ, toujours en base) ;
     — un brouillon MODIFIÉ n'est pas touché : il contient le travail du
       client. Le journal le dit.
     KV qui ne répond pas : rien n'est fait — « je ne sais pas lire » ne
     vaut jamais « le site a changé » (`horsMuet`).

     Appelée DANS la file (`enFile`) : sinon la lecture de KV pourrait voir
     une publication en cours d'écriture et la prendre pour un changement
     venu d'ailleurs. Pas depuis `opBrouillon` : réaligner en pleine frappe
     ferait naître des conflits pour rien.
     → `{ b }` | `{ b, horsMuet: true }` | `{ b: null }` (KV muet à la naissance) */
  async brouillonAJour(livre) {
    const existant = this.lireBrouillon();
    if (!existant) return { b: await this.brouillonOuInitialiser(livre) };
    if (typeof existant.publie_contenu === "string") return { b: existant };
    const hors = await this.contenuHorsEditeur(livre);
    if (!hors) return { b: existant, horsMuet: true };
    const depart = this.ligne("SELECT id, empreinte FROM versions WHERE origine = 'depart' ORDER BY id DESC LIMIT 1");
    if (depart && depart.empreinte === hors.empreinte) return { b: existant };
    /* Même contenu sous une autre forme canonique (le socle a évolué depuis
       et `normaliser` complète autrement) : le départ est rafraîchi, mais ce
       n'est pas une nouvelle à écrire au journal. */
    let memeContenu = false;
    if (depart) {
      try {
        const ancien = this.ligne("SELECT contenu FROM versions WHERE id = ?", depart.id);
        memeContenu = formeCanonique(JSON.parse(ancien.contenu)).json === hors.json;
      } catch { /* illisible : on le tient pour différent */ }
    }
    return { b: this.realigner(hors, depart, memeContenu) };
  }

  realigner(hors, depart, memeContenu) {
    return this.stockage.transactionSync(() => {
      const b = this.lireBrouillon();
      if (!b || typeof b.publie_contenu === "string") return b;
      const quand = this.maintenant();
      // Sans départ connu (base d'avant la version « départ »), seul un
      // brouillon que personne n'a touché est sûr d'être intact.
      const intact = depart ? b.empreinte === depart.empreinte : b.modifie_par === null;
      const v = this.lignes("INSERT INTO versions (quand, par, origine, contenu, empreinte, taille) VALUES (?, NULL, 'depart', ?, ?, ?) RETURNING id",
        quand, hors.json, hors.empreinte, octets(hors.json))[0];
      const aNoter = depart && !memeContenu;
      if (intact && b.empreinte !== hors.empreinte) {
        this.ecrire("UPDATE brouillon SET contenu = ?, revision = revision + 1, empreinte = ?, modifie_le = ?, modifie_par = NULL WHERE id = 1",
          hors.json, hors.empreinte, quand);
        if (aNoter) this.journaliser("hors_editeur", null, "Le site a changé hors de l'éditeur. Le brouillon, encore intact, a repris le nouveau contenu (version " + v.id + ").");
      } else if (!intact && aNoter) {
        this.journaliser("hors_editeur", null, "Le site a changé hors de l'éditeur. Le brouillon modifié est gardé tel quel ; le nouveau contenu est dans la version " + v.id + ".");
      }
      return this.lireBrouillon();
    });
  }

  /* Ne jamais écraser en silence : le brouillon qu'on va remplacer est mis
     de côté, sauf s'il est déjà en ligne ou déjà dans la dernière
     sauvegarde (cliquer trois fois « Reprendre » ne fait pas trois copies).
     → vrai si une sauvegarde a été écrite. */
  mettreDeCote(b, par, quand) {
    if (b.empreinte === b.publie_empreinte) return false;
    const derniere = this.ligne("SELECT empreinte FROM versions WHERE origine = 'sauvegarde' ORDER BY id DESC LIMIT 1");
    if (derniere && derniere.empreinte === b.empreinte) return false;
    this.ecrire("INSERT INTO versions (quand, par, origine, contenu, empreinte, taille) VALUES (?, ?, 'sauvegarde', ?, ?, ?)",
      quand, par, b.contenu, b.empreinte, octets(b.contenu));
    this.purgerVersions();
    return true;
  }

  remplacerBrouillon(qui, revision, json, empreinte, action, detail) {
    return this.stockage.transactionSync(() => {
      const b = this.lireBrouillon();
      if (b.revision !== revision) return conflit(b);
      const quand = this.maintenant();
      if (b.empreinte !== empreinte) {
        this.mettreDeCote(b, qui.email, quand);
        this.ecrire("UPDATE brouillon SET contenu = ?, revision = revision + 1, empreinte = ?, modifie_le = ?, modifie_par = ? WHERE id = 1",
          json, empreinte, quand, qui.email);
      }
      this.journaliser(action, qui.email, detail);
      return ok({ brouillon: vueBrouillon(this.lireBrouillon()) });
    });
  }

  opEtat(qui, d) {
    return this.enFile(async () => {
      const { b } = await this.brouillonAJour(d.livre);
      if (!b) return indisponible();
      return ok({ site: objetSimple(d.site) ? d.site : null, utilisateur: { email: qui.email }, brouillon: vueBrouillon(b), publie: vuePublie(b) });
    });
  }

  /* Contenu identique au brouillon : `200` avec la révision ACTUELLE, même
     si le navigateur travaillait sur une révision plus ancienne. Il n'y a
     rien à départager — lui répondre « conflit » ouvrirait pour rien la
     fenêtre « modifié ailleurs ».

     `ecraser: true` : l'éditeur remplace SCIEMMENT un brouillon qu'il n'a
     pas vu (« Garder mes modifications » après un conflit, reprise d'une
     copie de l'appareil). Ce brouillon-là est d'abord mis de côté, comme
     pour « Reprendre » et « Abandonner ». Sans ça, le travail fait sur
     l'autre appareil disparaissait sans laisser ni version ni ligne au
     journal (relecture du 3 octobre 2026). Le drapeau ne lève PAS le
     contrôle de révision : on n'écrase que ce qu'on a vu passer dans le
     conflit. */
  async opBrouillon(qui, d, p) {
    if (!Number.isSafeInteger(p.revision)) return requeteInvalide();
    const v = validerContenu(p.contenu);
    if (!v.ok) return erreur(v.statut, v.erreur, v.message, v.chemin ? { chemin: v.chemin } : null);
    const empreinte = await empreinteDe(v.json);
    const ecraser = p.ecraser === true;
    return this.enFile(async () => {
      if (!(await this.brouillonOuInitialiser(d.livre))) return indisponible();
      return this.stockage.transactionSync(() => {
        const b = this.lireBrouillon();
        if (b.empreinte === empreinte) return ok({ revision: b.revision, empreinte, modifie_le: b.modifie_le });
        if (b.revision !== p.revision) return conflit(b);
        const quand = this.maintenant();
        if (ecraser) {
          const garde = this.mettreDeCote(b, qui.email, quand);
          this.journaliser("ecrasement", qui.email, "Brouillon remplacé" + (b.modifie_par ? " (dernière modification par " + b.modifie_par + ")" : "") +
            (garde ? " : il est mis de côté dans les versions." : " : il était déjà dans les versions."));
        }
        this.ecrire("UPDATE brouillon SET contenu = ?, revision = revision + 1, empreinte = ?, modifie_le = ?, modifie_par = ? WHERE id = 1",
          v.json, empreinte, quand, qui.email);
        return ok({ revision: b.revision + 1, empreinte, modifie_le: quand });
      });
    });
  }

  /* On publie ce qu'on VOIT : le brouillon à la révision annoncée. KV
     d'abord ; s'il refuse, rien n'est enregistré — ni version, ni marque
     « publié » — et le site reste tel qu'il était.

     Avant le contrôle de révision, le brouillon est remis en phase avec le
     site (`brouillonAJour`) : s'il change ainsi, la révision bouge et la
     réponse est un conflit qui MONTRE le nouveau brouillon — rien ne part
     en ligne à l'aveugle. Et tant que rien n'a été publié, un KV qui ne
     répond pas refuse la publication : on ne sait plus si le brouillon est
     encore à jour, et deviner, c'est risquer d'écraser le vrai site. */
  async opPublier(qui, d, p) {
    if (!Number.isSafeInteger(p.revision)) return requeteInvalide();
    return this.enFile(async () => {
      const { b, horsMuet } = await this.brouillonAJour(d.livre);
      if (!b) return indisponible();
      if (horsMuet) return erreur(503, "publication_impossible", MESSAGES.publication_impossible);
      if (b.revision !== p.revision) return conflit(b);
      if (b.empreinte === b.publie_empreinte) return ok({ inchange: true, publie: vuePublie(b) });
      const kv = this.env.CONTENU;
      try {
        if (!kv || typeof kv.put !== "function") throw new Error("Aucun espace CONTENU n'est relié à ce site.");
        await kv.put(CLE_PUBLIE, b.contenu);
      } catch (e) {
        console.error("Publication impossible :", e);
        return erreur(503, "publication_impossible", MESSAGES.publication_impossible);
      }
      return this.stockage.transactionSync(() => {
        const quand = this.maintenant();
        const version = this.lignes("INSERT INTO versions (quand, par, origine, contenu, empreinte, taille) VALUES (?, ?, 'publication', ?, ?, ?) RETURNING id",
          quand, qui.email, b.contenu, b.empreinte, octets(b.contenu))[0];
        this.ecrire("UPDATE brouillon SET publie_contenu = ?, publie_empreinte = ?, publie_le = ?, publie_par = ?, publie_version = ? WHERE id = 1",
          b.contenu, b.empreinte, quand, qui.email, version.id);
        this.purgerVersions();
        this.journaliser("publication", qui.email, "Version " + version.id);
        return ok({ publie: { empreinte: b.empreinte, publie_le: quand, publie_par: qui.email }, version: { id: version.id, quand } });
      });
    });
  }

  opVersions() {
    const b = this.lireBrouillon();
    const active = b ? b.publie_version : null;
    // Les cent dernières, puis TOUJOURS la version de départ, en dernier :
    // elle est la plus ancienne, et la seule qui ne soit jamais purgée.
    const versions = this.lignes("SELECT id, quand, par, origine, empreinte, taille FROM versions WHERE origine <> 'depart' ORDER BY id DESC LIMIT ?", VERSIONS_GARDEES)
      .concat(this.lignes("SELECT id, quand, par, origine, empreinte, taille FROM versions WHERE origine = 'depart' ORDER BY id DESC LIMIT 1"))
      .map((v) => ({ id: v.id, quand: v.quand, par: v.par, origine: v.origine, empreinte: v.empreinte, taille: v.taille, active: v.id === active }));
    return ok({ versions });
  }

  opVersion(qui, d, p) {
    if (!idVersion(p.id)) return erreur(404, "introuvable", MESSAGES.version_introuvable);
    const v = this.ligne("SELECT id, quand, par, origine, contenu FROM versions WHERE id = ?", p.id);
    if (!v) return erreur(404, "introuvable", MESSAGES.version_introuvable);
    return ok({ version: { id: v.id, quand: v.quand, par: v.par, origine: v.origine, contenu: JSON.parse(v.contenu) } });
  }

  /* Reprendre une version ne publie PAS : elle devient le brouillon, et
     le client la publie s'il le veut. Elle repasse par `normaliser` : le
     socle a pu évoluer depuis qu'elle a été enregistrée. */
  async opReprendre(qui, d, p) {
    if (!idVersion(p.id)) return erreur(404, "introuvable", MESSAGES.version_introuvable);
    if (!Number.isSafeInteger(p.revision)) return requeteInvalide();
    return this.enFile(async () => {
      const v = this.ligne("SELECT contenu FROM versions WHERE id = ?", p.id);
      if (!v) return erreur(404, "introuvable", MESSAGES.version_introuvable);
      const n = formeCanonique(JSON.parse(v.contenu));
      const empreinte = await empreinteDe(n.json);
      if (!(await this.brouillonOuInitialiser(d.livre))) return indisponible();
      return this.remplacerBrouillon(qui, p.revision, n.json, empreinte, "reprise", "Version " + p.id);
    });
  }

  async opAbandonner(qui, d, p) {
    if (!Number.isSafeInteger(p.revision)) return requeteInvalide();
    return this.enFile(async () => {
      const b = await this.brouillonOuInitialiser(d.livre);
      if (!b) return indisponible();
      const enLigne = await this.contenuEnLigne(b, d.livre);
      if (!enLigne) return indisponible();
      return this.remplacerBrouillon(qui, p.revision, enLigne.json, enLigne.empreinte, "abandon", "");
    });
  }

  /* ----- Photos ----- */
  usageMedias() {
    const r = this.ligne("SELECT COUNT(*) AS nombre, COALESCE(SUM(taille + vignette_taille), 0) AS octets FROM medias WHERE retire_le IS NULL");
    return { nombre: r.nombre, octets: r.octets };
  }

  opMedias() {
    const medias = this.lignes("SELECT * FROM medias WHERE retire_le IS NULL ORDER BY quand DESC, rowid DESC").map(vueMedia);
    return ok({ medias });
  }

  /* Avant de lire 8 Mo et d'écrire dans R2 : la session, le quota, et
     l'identifiant de la future photo. */
  opMediasPreparer() {
    const u = this.usageMedias();
    if (u.nombre >= QUOTA_MEDIAS.nombre || u.octets >= QUOTA_MEDIAS.octets) return erreur(409, "quota_atteint", MESSAGES.quota_atteint);
    return ok({ id: hex(this.aleatoire(16)) });
  }

  /* Après l'écriture dans R2 : le quota est revérifié avec la taille
     réelle. Refusé ici, le Worker retire les fichiers qu'il vient
     d'écrire. */
  opMediasEnregistrer(qui, d, p) {
    const image = fichierDecrit(p.image);
    const vignette = p.vignette === null || p.vignette === undefined ? null : fichierDecrit(p.vignette);
    if (!idPhoto(p.id) || !image || !image.largeur || !image.hauteur || (p.vignette != null && !vignette)) return requeteInvalide();
    const nom = typeof p.nom === "string" ? p.nom.slice(0, LIMITES_PHOTOS.nom) : "";
    return this.stockage.transactionSync(() => {
      const u = this.usageMedias();
      const ajout = image.taille + (vignette ? vignette.taille : 0);
      if (u.nombre + 1 > QUOTA_MEDIAS.nombre || u.octets + ajout > QUOTA_MEDIAS.octets) return erreur(409, "quota_atteint", MESSAGES.quota_atteint);
      this.ecrire("INSERT INTO medias (id, ext, type, nom, largeur, hauteur, taille, vignette_ext, vignette_taille, quand, par) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        p.id, image.ext, image.type, nom, image.largeur, image.hauteur, image.taille,
        vignette ? vignette.ext : null, vignette ? vignette.taille : 0, this.maintenant(), qui.email);
      this.journaliser("media_ajoute", qui.email, nom);
      return ok({ media: vueMedia(this.ligne("SELECT * FROM medias WHERE id = ?", p.id)) }, 201);
    });
  }

  /* Retirer n'efface RIEN dans R2 : une ancienne version qu'on reprendrait
     cite peut-être la photo, et elle doit encore s'afficher. */
  opMediasRetirer(qui, d, p) {
    if (!idPhoto(p.id)) return erreur(404, "introuvable", MESSAGES.photo_introuvable);
    return this.stockage.transactionSync(() => {
      const r = this.lignes("UPDATE medias SET retire_le = ? WHERE id = ? AND retire_le IS NULL RETURNING nom", this.maintenant(), p.id)[0];
      if (r) {
        this.journaliser("media_retire", qui.email, r.nom);
        return ok({ ok: true });
      }
      return this.ligne("SELECT 1 AS x FROM medias WHERE id = ?", p.id) ? ok({ ok: true }) : erreur(404, "introuvable", MESSAGES.photo_introuvable);
    });
  }

  /* ----- Journal, export, appareils ----- */
  opJournal() {
    const evenements = this.lignes("SELECT quand, par, action, detail FROM journal ORDER BY id DESC LIMIT ?", JOURNAL_LU)
      .map((e) => ({ quand: e.quand, par: e.par, action: e.action, detail: e.detail }));
    return ok({ evenements });
  }

  /* La copie de sauvegarde du client : le contenu EN LIGNE (pas le
     brouillon), et les adresses de ses photos — celles de la médiathèque
     et celles que cite le contenu, même retirées depuis. Le Worker en fait
     des adresses absolues. */
  async opExport(qui, d) {
    const enLigne = await this.contenuEnLigne(this.lireBrouillon(), d.livre);
    if (!enLigne) return indisponible();
    const mediatheque = this.lignes("SELECT id, ext FROM medias WHERE retire_le IS NULL ORDER BY quand, rowid").map((m) => urlMedia(m.id, m.ext));
    const medias = [...new Set(mediatheque.concat(photosCitees(enLigne.json)))];
    const site = objetSimple(d.site) && typeof d.site.id === "string" ? d.site.id : "";
    return ok({ site, exporte_le: this.maintenant(), contenu: JSON.parse(enLigne.json), medias });
  }

  opDeconnecterPartout(qui) {
    return this.stockage.transactionSync(() => {
      const n = this.lignes("DELETE FROM sessions WHERE email = ? RETURNING hash", qui.email).length;
      this.journaliser("deconnexion_partout", qui.email, n > 1 ? n + " appareils" : "1 appareil");
      return Object.assign(ok({ ok: true }), { effacerCookie: true });
    });
  }
}
