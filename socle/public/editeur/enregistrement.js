/* =========================================================
   La file d'enregistrement — rien ne se perd
   =========================================================

   Module PUR : le serveur, l'horloge, les minuteries et le stockage local
   sont injectés. Les tests rejouent sous Node un réseau qui tombe, un
   conflit, une connexion expirée, sans navigateur.

   Les règles (spécification § 6.6) :
   — on enregistre 1,2 s après la DERNIÈRE modification ;
   — UN SEUL envoi à la fois, et le dernier état gagne : ce qui a changé
     pendant un envoi repart dès qu'il revient ;
   — réseau en panne (ou serveur en erreur) : nouvelle tentative à 5 s,
     15 s, 30 s, puis toutes les minutes, et une COPIE dans le stockage du
     navigateur, effacée au premier succès ;
   — conflit (409) ou connexion expirée (401) : la file s'arrête et attend
     la décision de l'artisan. Elle ne réessaie jamais seule par-dessus un
     brouillon modifié ailleurs : ce serait écraser en silence ;
   — contenu refusé (400, 413) : la file s'arrête aussi, et repart à la
     modification suivante — c'est souvent une annulation qui répare.

   Pourquoi la copie locale en plus des relances : une relance ne survit pas
   à un onglet fermé, à une batterie vide ou à un navigateur qui plante. La
   copie, si. Elle est proposée au démarrage suivant (`analyserCopie`).

   ⚠️ UNE COPIE PAR ONGLET (relecture du 3 octobre 2026). La clé ne
   dépendait que du site : deux onglets de l'éditeur partageaient la même
   copie, et l'enregistrement réussi de l'un effaçait celle que l'autre
   venait d'écrire après un conflit — son texte n'existait plus que dans un
   onglet que le navigateur pouvait jeter à tout moment. Chaque chargement
   de l'éditeur écrit désormais sous sa propre clé
   (`atelier-brouillon:<site>:<onglet>`), n'efface que celle-là, et le
   démarrage passe en revue TOUTES les copies du site (`copiesDuSite`),
   l'ancienne clé sans onglet comprise. */

import { normaliser } from "/rendu/page.js";

export const DELAI_ENREGISTREMENT = 1200;
export const RELANCES = Object.freeze([5000, 15000, 30000, 60000]);
/* Un envoi `keepalive` (celui qui survit à la fermeture de l'onglet) est
   refusé par le navigateur au-delà de 64 Kio de corps. Au-dessus, on envoie
   normalement — l'onglet seulement caché le recevra quand même — et la
   copie locale couvre le cas de l'onglet fermé. */
export const LIMITE_KEEPALIVE = 60000;

/* `onglet` : l'identifiant du chargement de l'éditeur qui écrit. Sans lui,
   la clé d'avant (une seule copie par site) — encore lue au démarrage. */
export function cleCopie(siteId, onglet = "") {
  return "atelier-brouillon:" + String(siteId || "site") + (onglet ? ":" + String(onglet) : "");
}

/* La copie telle qu'elle est rangée. Le contenu arrive déjà en JSON : on
   ne le re-sérialise pas. `ecartee` : des modifications mises de côté sur
   l'appareil au moment de charger une version modifiée ailleurs. */
export function chaineCopie(json, revision, quand, { ecartee = false } = {}) {
  return '{"contenu":' + json + ',"revisionBase":' + Number(revision) + ',"quand":' + Number(quand) + (ecartee ? ',"ecartee":true' : "") + "}";
}

/* Toutes les copies laissées pour ce site, quel que soit l'onglet qui les a
   écrites : `[{ cle, chaine }]`. Jamais d'exception (stockage bloqué,
   navigation privée) : une liste vide. */
export function copiesDuSite(ls, siteId) {
  const base = cleCopie(siteId);
  const copies = [];
  try {
    if (!ls) return copies;
    const cles = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (typeof k === "string" && (k === base || k.startsWith(base + ":"))) cles.push(k);
    }
    for (const cle of cles) {
      const chaine = ls.getItem(cle);
      if (typeof chaine === "string" && chaine) copies.push({ cle, chaine });
    }
  } catch { /* rien à proposer */ }
  return copies;
}

/* Le stockage local, toujours dans un try/catch : navigation privée,
   stockage plein ou bloqué par l'utilisateur lèvent — et un enregistrement
   ne doit jamais échouer pour une copie de secours. */
export function creerStockage(ls, cle) {
  return {
    lire() { try { return ls ? ls.getItem(cle) : null; } catch { return null; } },
    ecrire(chaine) { try { if (!ls) return false; ls.setItem(cle, chaine); return true; } catch { return false; } },
    effacer() { try { if (ls) ls.removeItem(cle); } catch { /* rien à faire */ } }
  };
}

/* La copie trouvée au démarrage, comparée au brouillon du serveur.
   → `null` : rien à proposer (pas de copie) ;
   → `{ illisible: true }` : une copie abîmée, qu'on ne peut pas appliquer ;
   → `{ contenu, revisionBase, quand, identique, aChange }`.
   `identique` : la copie ne contient rien de plus que le serveur — elle peut
   partir sans rien demander. `aChange` : le brouillon a été modifié
   ailleurs depuis que cette copie a été faite — il faut le DIRE. */
export function analyserCopie(chaine, brouillon) {
  if (typeof chaine !== "string" || !chaine) return null;
  let o;
  try { o = JSON.parse(chaine); } catch { return { illisible: true }; }
  if (!o || typeof o !== "object" || !o.contenu || typeof o.contenu !== "object" || Array.isArray(o.contenu)) return { illisible: true };
  const contenu = normaliser(o.contenu);
  const b = brouillon && typeof brouillon === "object" ? brouillon : {};
  const identique = JSON.stringify(contenu) === JSON.stringify(normaliser(b.contenu));
  const revisionBase = Number(o.revisionBase);
  return {
    contenu,
    revisionBase: Number.isFinite(revisionBase) ? revisionBase : null,
    quand: typeof o.quand === "number" ? o.quand : null,
    identique,
    aChange: !Number.isFinite(revisionBase) || revisionBase !== Number(b.revision),
    ecartee: o.ecartee === true
  };
}

/* Statuts : « enregistre », « modifie » (un envoi est prévu), « en_cours »,
   « hors_ligne » (relance prévue), « conflit », « expiration », « refus ». */
export function creerFile({
  envoyer: envoyerAuServeur,   // (json, revision, { keepalive }) => Promise<{ revision, empreinte, modifie_le }>
  lire,                        // () => ({ json, revision }) : le contenu courant et la révision sur laquelle il repose
  surSucces = () => {},        // (reponse, jsonEnvoye)
  surConflit = () => {},       // (brouillonDuServeur, erreur)
  surExpiration = () => {},    // (erreur)
  surRefus = () => {},         // (erreur)
  surStatut = () => {},        // (statut, erreur?)
  stockage = creerStockage(null, ""),
  minuterie = { poser: (f, ms) => setTimeout(f, ms), retirer: (id) => clearTimeout(id) },
  maintenant = () => Date.now(),
  delai = DELAI_ENREGISTREMENT,
  relances = RELANCES
}) {
  let dernierEnregistre = null;
  let minuteur = null;
  let genreMinuteur = null;      // "attente" | "relance"
  let vol = null;                // l'envoi en cours (une promesse)
  let tentative = 0;
  let pause = null;              // "conflit" | "expiration" | "refus"
  let statut = "enregistre";
  let ecraser = false;           // le prochain envoi remplace sciemment le brouillon du serveur

  function changerStatut(nouveau, detail) {
    if (nouveau === statut && !detail) return;
    statut = nouveau;
    surStatut(statut, detail);
  }
  const sale = () => lire().json !== dernierEnregistre;

  /* `true` si la copie est écrite, ou s'il n'y avait rien à copier (le
     serveur a déjà tout). */
  function ecrireCopie() {
    const { json, revision } = lire();
    if (json === dernierEnregistre) return true;
    return stockage.ecrire(chaineCopie(json, revision, maintenant()));
  }

  function annulerMinuteur() {
    if (minuteur !== null) minuterie.retirer(minuteur);
    minuteur = null;
    genreMinuteur = null;
  }
  function poserMinuteur(genre, ms) {
    annulerMinuteur();
    genreMinuteur = genre;
    minuteur = minuterie.poser(() => {
      minuteur = null;
      genreMinuteur = null;
      envoyer();
    }, ms);
  }

  /* À appeler après chaque modification du contenu. */
  function planifier() {
    if (pause === "refus") pause = null;     // la modification suivante retente
    if (pause) { ecrireCopie(); return; }
    // Hors ligne : on garde le rythme des relances (taper ne doit pas
    // bombarder un serveur en panne), mais la copie reste à jour.
    if (genreMinuteur === "relance") { ecrireCopie(); return; }
    // Un envoi voyage encore : ce qu'on tape pendant ce temps n'est nulle
    // part ailleurs qu'à l'écran. Sur un réseau qui « pend », l'envoi peut
    // durer des minutes (relecture du 3 octobre 2026) — la copie locale ne
    // coûte presque rien, et le succès l'efface s'il a tout emporté.
    if (vol) ecrireCopie();
    if (statut === "enregistre") changerStatut("modifie");
    poserMinuteur("attente", delai);
  }

  function traiterEchec(e) {
    const code = e && typeof e.statut === "number" ? e.statut : 0;
    ecrireCopie();
    if (code === 409) {
      pause = "conflit";
      changerStatut("conflit");
      surConflit(e && e.donnees ? e.donnees.brouillon : null, e);
    } else if (code === 401) {
      pause = "expiration";
      changerStatut("expiration");
      surExpiration(e);
    } else if (code === 0 || code === 408 || code === 429 || code >= 500) {
      const attente = relances[Math.min(tentative, relances.length - 1)];
      tentative++;
      changerStatut("hors_ligne");
      poserMinuteur("relance", attente);
    } else {
      pause = "refus";
      changerStatut("refus", e);
      surRefus(e);
    }
  }

  /* Envoie l'état courant. Rend `true` si le serveur a reçu ce qui était à
     l'écran au moment de l'envoi, `false` sinon. Un appel pendant un envoi
     ne lance rien : il attend, et le dernier état part juste après. */
  async function envoyer({ keepalive = false } = {}) {
    if (pause) return false;
    if (vol) return vol.then(() => (pause ? false : envoyer()));
    if (genreMinuteur === "attente") annulerMinuteur();
    const { json, revision } = lire();
    if (json === dernierEnregistre) {
      tentative = 0;
      // Rien ne part : rien n'est remplacé. La marque ne doit pas survivre
      // jusqu'à un envoi ordinaire, bien plus tard.
      ecraser = false;
      if (genreMinuteur === "relance") annulerMinuteur();
      changerStatut("enregistre");
      stockage.effacer();
      return true;
    }
    changerStatut("en_cours");
    vol = (async () => {
      try {
        const options = { keepalive: keepalive && json.length < LIMITE_KEEPALIVE };
        if (ecraser) options.ecraser = true;
        const rep = await envoyerAuServeur(json, revision, options);
        dernierEnregistre = json;
        tentative = 0;
        // La marque ne sert qu'une fois : au premier envoi ARRIVÉ. Un envoi
        // perdu en route la garde pour le suivant.
        if (options.ecraser) ecraser = false;
        surSucces(rep || {}, json);
        return true;
      } catch (e) {
        traiterEchec(e);
        return false;
      }
    })();
    const ok = await vol;
    vol = null;
    if (!ok) return false;
    if (sale()) {
      // Modifié pendant l'envoi : la copie écrite en vol porte l'ANCIENNE
      // révision. On la réécrit avec celle que le serveur vient de donner —
      // sinon, l'onglet fermé avant l'envoi suivant, elle passait au
      // démarrage pour « modifiée ailleurs », par l'artisan lui-même
      // (contrôle du 3 octobre 2026).
      ecrireCopie();
      // Si l'attente de 1,2 s court déjà, elle enverra ; sinon on repart
      // tout de suite.
      if (genreMinuteur === null) return envoyer();
      changerStatut("modifie");
      return true;
    }
    changerStatut("enregistre");
    stockage.effacer();
    return true;
  }

  /* Tout envoyer MAINTENANT et attendre la réponse : avant de publier, de
     reprendre une version, de se déconnecter. `true` si le serveur a tout. */
  async function vider() {
    if (genreMinuteur === "attente") annulerMinuteur();
    for (let i = 0; i < 6; i++) {
      if (pause) return false;
      if (vol) { await vol.catch(() => false); continue; }
      if (!sale()) {
        if (genreMinuteur === "relance") annulerMinuteur();
        changerStatut("enregistre");
        stockage.effacer();
        return true;
      }
      if (genreMinuteur === "relance") annulerMinuteur();
      if (!(await envoyer())) return false;
    }
    return !sale() && !pause;
  }

  return {
    planifier,
    envoyer: () => envoyer(),
    vider,
    /* L'onglet est caché ou se ferme : la copie d'abord (elle ne dépend
       pas du réseau), puis un dernier envoi qui survit à la fermeture. */
    auDepart() {
      if (!(vol || sale())) return;
      ecrireCopie();
      if (!pause && !vol) envoyer({ keepalive: true });
    },
    /* Le réseau revient : on n'attend pas la fin de la relance. */
    reessayer() {
      if (pause || vol) return;
      if (genreMinuteur === "relance" || statut === "hors_ligne") {
        annulerMinuteur();
        tentative = 0;
        envoyer();
      }
    },
    /* Après la décision de l'artisan (conflit) ou une reconnexion. */
    reprendre() {
      pause = null;
      tentative = 0;
      return envoyer();
    },
    /* Le prochain envoi remplace sciemment un brouillon modifié ailleurs :
       le serveur mettra celui-ci de côté (`ecraser`, api.js). `false` retire
       la marque (une version chargée : plus rien à remplacer). */
    ecraserAuProchainEnvoi(oui = true) { ecraser = !!oui; },
    ecrasementPrevu: () => ecraser,
    /* Ce JSON est celui du serveur (au démarrage, après un remplacement). */
    marquerEnregistre(json) {
      dernierEnregistre = json;
      if (!sale() && !vol) {
        if (genreMinuteur) annulerMinuteur();
        changerStatut("enregistre");
      }
    },
    enAttente: () => vol !== null || sale(),
    ecrireCopie,
    effacerCopie: () => stockage.effacer(),
    statut: () => statut,
    enPause: () => pause
  };
}
