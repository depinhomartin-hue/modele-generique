/* Les simulateurs de la plateforme Cloudflare, pour tester sous Node.

   KV, R2, Durable Object, Email Service, `caches.default`, `ctx.waitUntil` :
   chacun imite l'API réelle sur les points dont le socle DÉPEND, et lève
   là où la plateforme lèverait. Un simulateur trop gentil fait passer des
   tests sur du code qui tombera en production — c'est le piège qu'ils sont
   faits pour éviter.

   Le faux Durable Object appelle le VRAI cœur (socle/serveur/atelier-coeur.js)
   sur une base node:sqlite. Points de fidélité qui ont un sens :
   — `sql.exec()` refuse BEGIN, COMMIT, SAVEPOINT… comme le Durable Object ;
     seul `transactionSync()` ouvre une transaction, et il annule TOUT si la
     fonction lève ;
   — `one()` lève s'il n'y a pas exactement une ligne ;
   — une liaison `undefined` ou booléenne lève (node:sqlite et le Durable
     Object la refusent tous deux) ;
   — chaque appel RPC passe ses arguments et son résultat par un clonage
     structuré : une valeur non transmissible échoue ici comme là-bas ;
   — seules les méthodes de `METHODES_RPC` existent sur le « stub » ;
   — une seule alarme par Durable Object (`getAlarm`, `setAlarm`,
     `deleteAlarm`), qui sonne quand les tests la font sonner
     (`declencherAlarme`), jamais par un appel du Worker. */
import { DatabaseSync } from "node:sqlite";
import { CoeurAtelier, METHODES_RPC } from "../socle/serveur/atelier-coeur.js";

const encodeur = new TextEncoder();
const decodeur = new TextDecoder();

/* ----- L'horloge -----
   Quinze minutes, trente jours, vingt-quatre heures ne s'attendent pas. */
export function creerHorloge(depart = Date.UTC(2026, 9, 3, 10, 0, 0)) {
  let t = depart;
  return {
    maintenant: () => t,
    avancer(ms) { t += ms; return t; },
    regler(v) { t = v; }
  };
}

export const MINUTE = 60_000;
export const HEURE = 60 * MINUTE;
export const JOUR = 24 * HEURE;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----- KV ----- */
export function fauxKV() {
  const donnees = new Map();
  const kv = {
    donnees,
    panne: { lecture: false, ecriture: false },
    // Une écriture lente (en millisecondes réelles) : pour vérifier que
    // rien ne se glisse pendant qu'une publication attend KV.
    delaiEcriture: 0,
    lectures: 0,
    ecritures: 0,
    async get(cle, type) {
      kv.lectures++;
      if (kv.panne.lecture) throw new Error("KV : lecture impossible (panne simulée)");
      if (!donnees.has(cle)) return null;
      const v = donnees.get(cle);
      const t = typeof type === "string" ? type : (type && type.type) || "text";
      if (t === "json") return JSON.parse(v);
      if (t === "arrayBuffer") return encodeur.encode(v).buffer;
      return v;
    },
    async put(cle, valeur) {
      if (typeof valeur !== "string" && !(valeur instanceof ArrayBuffer) && !ArrayBuffer.isView(valeur)) {
        throw new TypeError("KV.put : la valeur doit être une chaîne, un ArrayBuffer ou un flux");
      }
      if (kv.delaiEcriture) await pause(kv.delaiEcriture);
      if (kv.panne.ecriture) throw new Error("KV : écriture refusée (panne simulée)");
      kv.ecritures++;
      donnees.set(cle, typeof valeur === "string" ? valeur : decodeur.decode(valeur));
    },
    async delete(cle) { donnees.delete(cle); }
  };
  return kv;
}

/* ----- R2 ----- */
function enOctets(valeur) {
  if (valeur instanceof Uint8Array) return valeur.slice();
  if (valeur instanceof ArrayBuffer) return new Uint8Array(valeur.slice(0));
  if (ArrayBuffer.isView(valeur)) return new Uint8Array(valeur.buffer.slice(valeur.byteOffset, valeur.byteOffset + valeur.byteLength));
  if (typeof valeur === "string") return encodeur.encode(valeur);
  throw new TypeError("R2.put : type de valeur non pris en charge par le simulateur");
}

export function fauxR2() {
  const objets = new Map();
  let compteur = 0;
  function decrire(cle, o, avecCorps) {
    const d = {
      key: cle,
      size: o.octets.byteLength,
      etag: o.etag,
      httpEtag: '"' + o.etag + '"',
      uploaded: new Date(o.quand),
      httpMetadata: Object.assign({}, o.httpMetadata),
      customMetadata: Object.assign({}, o.customMetadata),
      writeHttpMetadata(h) {
        if (o.httpMetadata.contentType) h.set("content-type", o.httpMetadata.contentType);
      }
    };
    if (avecCorps) {
      d.body = new Blob([o.octets]).stream();
      d.arrayBuffer = async () => o.octets.slice().buffer;
      d.text = async () => decodeur.decode(o.octets);
    }
    return d;
  }
  const r2 = {
    objets,
    lectures: 0,
    async put(cle, valeur, options = {}) {
      const o = {
        octets: enOctets(valeur),
        httpMetadata: Object.assign({}, options.httpMetadata),
        customMetadata: Object.assign({}, options.customMetadata),
        etag: "etag" + ++compteur,
        quand: Date.now()
      };
      objets.set(cle, o);
      return decrire(cle, o, false);
    },
    async get(cle) {
      r2.lectures++;
      const o = objets.get(cle);
      return o ? decrire(cle, o, true) : null;
    },
    async head(cle) {
      const o = objets.get(cle);
      return o ? decrire(cle, o, false) : null;
    },
    async delete(cles) {
      for (const c of [].concat(cles)) objets.delete(c);
    }
  };
  return r2;
}

/* ----- Le stockage SQLite d'un Durable Object ----- */
const TRANSACTION_SQL = /^\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

function curseur(lignes, ecrites) {
  let i = 0;
  const reste = () => { const r = lignes.slice(i); i = lignes.length; return r; };
  return {
    columnNames: lignes.length ? Object.keys(lignes[0]) : [],
    rowsRead: lignes.length,
    rowsWritten: ecrites,
    toArray: reste,
    one() {
      const r = reste();
      if (r.length !== 1) {
        throw new Error(r.length ? "Expected exactly one result from SQL query, but got multiple." : "Expected exactly one result from SQL query, but got no results.");
      }
      return r[0];
    },
    raw() {
      const r = reste().map((l) => Object.values(l));
      return r[Symbol.iterator]();
    },
    next() {
      return i < lignes.length ? { done: false, value: lignes[i++] } : { done: true, value: undefined };
    },
    [Symbol.iterator]() { return this; }
  };
}

/* L'alarme d'un Durable Object : une seule à la fois, une heure en
   millisecondes (ou une `Date`), remplacée par chaque `setAlarm`. Elle ne
   sonne pas toute seule ici : `fauxEspaceAtelier().declencherAlarme()` la
   fait sonner si son heure est passée, comme la plateforme le ferait. */
export function fauxStockageDO() {
  const db = new DatabaseSync(":memory:");
  const total = db.prepare("SELECT total_changes() AS n");
  let profondeur = 0;
  let alarme = null;
  const sql = {
    exec(requete, ...liaisons) {
      if (typeof requete !== "string") throw new TypeError("sql.exec : la requête doit être une chaîne");
      if (TRANSACTION_SQL.test(requete)) {
        throw new Error("sql.exec : pas de transaction SQL dans un Durable Object — passer par transactionSync()");
      }
      const avant = total.get().n;
      // Les lignes de node:sqlite n'ont pas de prototype ; celles du
      // Durable Object sont des objets ordinaires.
      const lignes = db.prepare(requete).all(...liaisons).map((l) => Object.assign({}, l));
      return curseur(lignes, total.get().n - avant);
    },
    get databaseSize() {
      const p = db.prepare("PRAGMA page_count").get().page_count;
      const t = db.prepare("PRAGMA page_size").get().page_size;
      return p * t;
    }
  };
  return {
    db,
    sql,
    // L'heure de l'alarme posée, `null` sans alarme (lecture pour les tests).
    get alarme() { return alarme; },
    async getAlarm() { return alarme; },
    async setAlarm(quand) {
      const t = quand instanceof Date ? quand.getTime() : quand;
      if (typeof t !== "number" || !Number.isFinite(t)) throw new TypeError("setAlarm : une heure en millisecondes (ou une Date) est attendue");
      alarme = t;
    },
    async deleteAlarm() { alarme = null; },
    transactionSync(fn) {
      const nom = "t" + profondeur++;
      db.exec("SAVEPOINT " + nom);
      try {
        const resultat = fn();
        if (resultat && typeof resultat.then === "function") {
          throw new Error("transactionSync : la fonction ne doit pas être asynchrone");
        }
        db.exec("RELEASE " + nom);
        return resultat;
      } catch (e) {
        db.exec("ROLLBACK TO " + nom);
        db.exec("RELEASE " + nom);
        throw e;
      } finally {
        profondeur--;
      }
    }
  };
}

/* ----- L'espace de noms du Durable Object `ATELIER` ----- */
export function fauxEspaceAtelier(env, options = {}) {
  const stockage = fauxStockageDO();
  let coeur = null;
  const espace = {
    stockage,
    appels: 0,
    // Le compte par méthode : « la session a-t-elle été vérifiée AVANT que
    // le corps parte vers l'API ? » se lit ici.
    parMethode: Object.fromEntries(METHODES_RPC.map((m) => [m, 0])),
    noms: [],
    idFromName(nom) {
      espace.noms.push(nom);
      return { name: nom, toString: () => "id:" + nom };
    },
    get(id) {
      if (!id || typeof id.toString !== "function") throw new TypeError("ATELIER.get : identifiant invalide");
      return Object.freeze(Object.fromEntries(METHODES_RPC.map((m) => [m, async (argument) => {
        espace.appels++;
        espace.parMethode[m]++;
        if (!coeur) coeur = new CoeurAtelier(stockage, env, options);
        const copie = argument === undefined ? undefined : structuredClone(argument);
        return structuredClone(await coeur[m](copie));
      }])));
    },
    // Le Durable Object est évincé de la mémoire ; sa base reste.
    redemarrer() { coeur = null; },
    /* L'alarme sonne, si elle est posée et que son heure est passée (à
       l'horloge des tests) : la plateforme l'efface, puis appelle
       `alarm()` — un Durable Object évincé est réveillé pour ça, sans
       aucun appel du Worker. Comme `atelier.js`, on délègue au cœur.
       → vrai si elle a sonné. */
    alarmes: 0,
    async declencherAlarme() {
      const maintenant = typeof options.maintenant === "function" ? options.maintenant() : Date.now();
      const prevue = stockage.alarme;
      if (prevue === null || prevue > maintenant) return false;
      await stockage.deleteAlarm();
      espace.alarmes++;
      if (!coeur) coeur = new CoeurAtelier(stockage, env, options);
      await coeur.alarme();
      return true;
    }
  };
  return espace;
}

/* ----- Email Service ----- */
export function fauxCourriel() {
  const c = {
    envois: [],
    echec: null,
    async send(message) {
      if (c.echec) {
        const e = new Error(c.echec.message || "Envoi refusé");
        e.code = c.echec.code || "E_DELIVERY_FAILED";
        throw e;
      }
      const from = message && message.from;
      const expediteur = typeof from === "string" ? from : from && from.email;
      // `replyTo`, quand il est là : une chaîne ou `{ email, name }`, comme
      // `from` (forme lue dans miniflare, wrangler 4.147, le 3 octobre 2026).
      const repondre = message && message.replyTo;
      const repondreValide = repondre === undefined || typeof repondre === "string" || (!!repondre && typeof repondre.email === "string");
      if (!message || typeof message.to !== "string" || !expediteur || typeof message.subject !== "string" || (!message.text && !message.html) || !repondreValide) {
        const e = new Error("Message incomplet");
        e.code = "E_VALIDATION_ERROR";
        throw e;
      }
      c.envois.push(structuredClone(message));
      return { messageId: "message-" + c.envois.length };
    }
  };
  return c;
}

/* ----- caches.default ----- */
export function fauxCaches() {
  const entrees = new Map();
  const cache = {
    entrees,
    lectures: 0,
    ecritures: 0,
    async match(requete) {
      const url = typeof requete === "string" ? requete : requete.url;
      const e = entrees.get(url);
      if (!e) return undefined;
      cache.lectures++;
      return new Response(e.octets.slice(), { status: e.statut, headers: e.entetes });
    },
    async put(requete, reponse) {
      const r = typeof requete === "string" ? new Request(requete) : requete;
      if (r.method !== "GET") throw new TypeError("Cache.put : seules les requêtes GET se mettent en cache");
      const octets = new Uint8Array(await reponse.arrayBuffer());
      entrees.set(r.url, { octets, statut: reponse.status, entetes: [...reponse.headers] });
      cache.ecritures++;
    },
    async delete(requete) {
      return entrees.delete(typeof requete === "string" ? requete : requete.url);
    }
  };
  return { default: cache };
}

/* ----- ctx.waitUntil -----
   Les promesses confiées à `waitUntil` sont gardées ; `terminer()` les
   attend toutes, comme la plateforme le fait après la réponse. */
export function fauxCtx() {
  const promesses = [];
  return {
    promesses,
    waitUntil(p) { promesses.push(Promise.resolve(p)); },
    passThroughOnException() {},
    async terminer() {
      while (promesses.length) await Promise.allSettled(promesses.splice(0));
    }
  };
}

/* ----- Un environnement complet -----
   Tout neuf à chaque appel : chaque groupe de tests part d'un site vierge. */
export function creerEnvironnement({
  adresses = "essai@example.com",
  expediteur = "connexion@atelier.example",
  journalLocal = false,
  sansAtelier = false,
  sansMedias = false,
  sansContenu = false,
  sansCourriel = false,
  depart
} = {}) {
  const horloge = creerHorloge(depart);
  const kv = fauxKV();
  const r2 = fauxR2();
  const courriel = fauxCourriel();
  const caches = fauxCaches();
  const env = { ADRESSES_ATELIER: adresses, COURRIEL_EXPEDITEUR: expediteur };
  if (!sansCourriel) env.COURRIEL = courriel;
  if (!sansContenu) env.CONTENU = kv;
  if (!sansMedias) env.MEDIAS = r2;
  if (journalLocal) env.COURRIEL_JOURNAL = "1";
  const espace = sansAtelier ? null : fauxEspaceAtelier(env, { maintenant: horloge.maintenant });
  if (espace) env.ATELIER = espace;
  return { env, horloge, kv, r2, courriel, caches, espace };
}
