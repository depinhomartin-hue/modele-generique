/* =========================================================
   L'API de l'administration, vue du navigateur
   =========================================================

   Le SEUL endroit de l'éditeur qui parle au serveur (contrat HTTP,
   spécification § 2). Chaque appel rend les données JSON, ou lève une
   `ErreurApi` qui porte le statut, le code (`erreur`) et la phrase du
   serveur — jamais une exception brute de `fetch` : l'écran doit toujours
   pouvoir dire ce qui s'est passé.

   `fetch` est injectable : les tests sous Node rejouent les réponses du
   serveur sans serveur. L'envoi des photos passe par XMLHttpRequest, seul
   moyen de suivre la progression d'un envoi (fetch ne la donne pas). */

export class ErreurApi extends Error {
  constructor({ statut = 0, erreur = "inconnue", message = "", donnees = null } = {}) {
    super(message || erreur);
    this.name = "ErreurApi";
    this.statut = statut;
    this.erreur = erreur;
    this.donnees = donnees;
  }
}

/* Un statut sans corps lisible (une page d'erreur de Cloudflare, un proxy
   d'hôtel…) reçoit quand même un code que l'écran sait traduire. */
function codeParDefaut(statut) {
  if (statut === 401) return "non_connecte";
  if (statut === 404) return "introuvable";
  if (statut === 409) return "conflit";
  if (statut === 413) return "trop_lourd";
  return "http_" + statut;
}

const ID_MEDIA = /^[0-9a-f]{32}$/;
/* L'identifiant d'un message : la clé entière de sa table. Vérifié AVANT
   l'appel, comme celui d'une photo : rien d'autre n'entre dans l'adresse. */
const ID_MESSAGE = /^[1-9][0-9]{0,14}$/;
const refusIntrouvable = () => Promise.reject(new ErreurApi({ statut: 404, erreur: "introuvable" }));

/* Le délai au-delà duquel un appel est abandonné, et traité comme une
   panne du réseau (copie locale, nouvel essai). `fetch` n'en a aucun : sur
   un réseau qui « pend » (wifi de marché, portail d'hôtel), un envoi ne se
   terminait jamais, la barre affichait « Enregistrement… » sans fin, rien
   n'était copié sur l'appareil, et « Publier » restait figé (relecture du
   3 octobre 2026).
   GÉNÉREUX et proportionné au corps : un brouillon de 300 Ko met près de
   40 s à partir sur une liaison lente (64 kbit/s). Un délai fixe de 20 s
   l'aurait abandonné, relancé, abandonné encore — il ne serait jamais
   arrivé. Ici : 30 s, plus le temps d'envoyer le corps à 32 kbit/s. */
export function delaiAppel(octets = 0) {
  return 30000 + Math.ceil(Math.max(0, Number(octets) || 0) / 4);
}

export function creerApi({ fetch: f = (...a) => globalThis.fetch(...a), base = "", delai = delaiAppel } = {}) {
  /* `geste` : une action volontaire qui CHANGE le serveur (publier,
     reprendre, abandonner, retirer une photo, déconnecter). Son délai est
     quatre fois plus long : l'abandonner au bout de 30 s alors que le
     serveur avait déjà agi annonçait un échec, puis l'enregistrement
     suivant tombait sur un conflit né du geste même de l'artisan (contrôle
     du 3 octobre 2026). L'enregistrement automatique garde le délai court :
     c'est lui qui doit vite passer en « hors ligne ». */
  async function appeler(methode, chemin, { corps, brut, keepalive = false, geste = false } = {}) {
    const init = {
      method: methode,
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store"
    };
    if (brut !== undefined || corps !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = brut !== undefined ? brut : JSON.stringify(corps);
    }
    if (keepalive) init.keepalive = true;
    // Pas de délai pour un envoi `keepalive` : il part pendant que l'onglet
    // se ferme, personne n'attend sa réponse, et l'abandonner ne ferait que
    // perdre une chance qu'il arrive.
    const abandon = !keepalive && typeof AbortController === "function" ? new AbortController() : null;
    let minuteur = null;
    if (abandon) {
      init.signal = abandon.signal;
      minuteur = setTimeout(() => abandon.abort(), delai(typeof init.body === "string" ? init.body.length : 0) * (geste ? 4 : 1));
    }
    let rep;
    let donnees = null;
    try {
      try {
        rep = await f(base + chemin, init);
      } catch (e) {
        throw new ErreurApi({ statut: 0, erreur: "reseau", message: "" });
      }
      // Le délai couvre aussi la lecture de la réponse : une réponse dont
      // le corps n'arrive jamais fige l'écran tout autant.
      try { donnees = await rep.json(); } catch {
        if (abandon && abandon.signal.aborted) throw new ErreurApi({ statut: 0, erreur: "reseau", message: "" });
        donnees = null;
      }
    } finally {
      if (minuteur !== null) clearTimeout(minuteur);
    }
    if (!rep.ok) {
      const d = donnees && typeof donnees === "object" ? donnees : {};
      throw new ErreurApi({
        statut: rep.status,
        erreur: typeof d.erreur === "string" ? d.erreur : codeParDefaut(rep.status),
        message: typeof d.message === "string" ? d.message : "",
        donnees: d
      });
    }
    return donnees && typeof donnees === "object" ? donnees : {};
  }

  return {
    etat: () => appeler("GET", "/admin/api/etat"),

    /* Le contenu arrive DÉJÀ en JSON (la file d'enregistrement le fige au
       moment de l'envoi) : on ne le re-sérialise pas, 300 Ko à chaque
       enregistrement automatique. */
    /* `ecraser` : cet envoi remplace SCIEMMENT un brouillon modifié ailleurs
       (« Garder mes modifications », une copie de l'appareil reprise par-
       dessus, une annulation qui passe au-dessus d'une version chargée après
       un conflit). Le serveur met alors le brouillon remplacé de côté dans
       les versions : rien n'est écrasé en silence (relecture du 3 octobre
       2026 — le travail de l'autre appareil était perdu pour toujours). */
    enregistrer: (json, revision, { keepalive = false, ecraser = false } = {}) =>
      appeler("PUT", "/admin/api/brouillon", { brut: '{"contenu":' + json + ',"revision":' + Number(revision) + (ecraser ? ',"ecraser":true' : "") + "}", keepalive }),

    publier: (revision) => appeler("POST", "/admin/api/publier", { corps: { revision }, geste: true }),
    versions: () => appeler("GET", "/admin/api/versions"),
    version: (id) => appeler("GET", "/admin/api/versions/" + Number(id)),
    reprendre: (id, revision) => appeler("POST", "/admin/api/versions/" + Number(id) + "/reprendre", { corps: { revision }, geste: true }),
    abandonner: (revision) => appeler("POST", "/admin/api/brouillon/abandonner", { corps: { revision }, geste: true }),
    medias: () => appeler("GET", "/admin/api/medias"),
    retirerMedia: (id) => {
      if (!ID_MEDIA.test(String(id))) return Promise.reject(new ErreurApi({ statut: 404, erreur: "introuvable" }));
      return appeler("POST", "/admin/api/medias/" + id + "/retirer", { corps: {}, geste: true });
    },
    journal: () => appeler("GET", "/admin/api/journal"),
    deconnecterPartout: () => appeler("POST", "/admin/api/deconnecter-partout", { corps: {}, geste: true }),

    /* Les messages du formulaire de contact (spécification 0.3, § 3.2) : les
       200 plus récents, ou, avec `avant`, les 200 qui précèdent ce message
       (« Afficher les messages plus anciens », relecture du 3 octobre 2026).
       L'identifiant est vérifié comme les autres avant d'entrer dans
       l'adresse. */
    messages: (avant = null) => {
      if (avant === null || avant === undefined) return appeler("GET", "/admin/api/messages");
      if (!ID_MESSAGE.test(String(avant))) return refusIntrouvable();
      return appeler("GET", "/admin/api/messages?avant=" + Number(avant));
    },
    marquerMessage: (id, lu) => {
      if (!ID_MESSAGE.test(String(id))) return refusIntrouvable();
      return appeler("POST", "/admin/api/messages/" + Number(id) + "/lu", { corps: { lu: lu === true }, geste: true });
    },
    supprimerMessage: (id) => {
      if (!ID_MESSAGE.test(String(id))) return refusIntrouvable();
      return appeler("POST", "/admin/api/messages/" + Number(id) + "/supprimer", { corps: {}, geste: true });
    },

    /* L'envoi d'une photo : multipart (l'exception au JSON du contrat), avec
       sa progression. Le navigateur pose lui-même `Origin` sur un POST, ce
       que le serveur exige. */
    envoyerMedia(formulaire, { progression } = {}) {
      return new Promise((resoudre, rejeter) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", base + "/admin/api/medias");
        xhr.setRequestHeader("Accept", "application/json");
        xhr.responseType = "text";
        if (progression) {
          xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable && e.total > 0) progression(e.loaded / e.total);
          });
        }
        xhr.addEventListener("load", () => {
          let d = null;
          try { d = JSON.parse(xhr.responseText); } catch { d = null; }
          if (xhr.status >= 200 && xhr.status < 300 && d && typeof d === "object") return resoudre(d);
          const o = d && typeof d === "object" ? d : {};
          rejeter(new ErreurApi({
            statut: xhr.status,
            erreur: typeof o.erreur === "string" ? o.erreur : codeParDefaut(xhr.status),
            message: typeof o.message === "string" ? o.message : "",
            donnees: o
          }));
        });
        xhr.addEventListener("error", () => rejeter(new ErreurApi({ statut: 0, erreur: "reseau" })));
        xhr.addEventListener("abort", () => rejeter(new ErreurApi({ statut: 0, erreur: "reseau" })));
        // Le même délai que les autres appels, compté sur le poids de la
        // photo : un envoi qui « pend » finit en erreur lisible au lieu d'une
        // ligne « Envoi… » éternelle.
        let poids = 0;
        try { for (const [, v] of formulaire.entries()) poids += v && typeof v.size === "number" ? v.size : String(v).length; } catch { poids = 0; }
        xhr.timeout = delai(poids);
        xhr.addEventListener("timeout", () => rejeter(new ErreurApi({ statut: 0, erreur: "reseau" })));
        xhr.send(formulaire);
      });
    }
  };
}
