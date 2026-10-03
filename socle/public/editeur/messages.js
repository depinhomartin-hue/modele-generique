/* =========================================================
   Les messages du formulaire de contact — la logique
   =========================================================

   Module PUR (ni `document` ni `window`), testé sous Node
   (outils/tester-editeur.mjs). L'onglet « Messages » (panneau-messages.js)
   ne fait que dessiner ce que ce module décide.

   ⚠️ Tout ce qui arrive ici a été ÉCRIT PAR UN VISITEUR : nom, adresse,
   téléphone, message. N'importe qui peut remplir le formulaire d'un site,
   et y glisser du HTML, un faux lien ou des caractères qui retournent le
   texte. Rien de tout cela n'entre dans l'éditeur par `innerHTML` : le
   panneau le pose en texte (`h`, dom.js). Les deux seuls liens construits
   avec ces valeurs — « Répondre » et l'appel — sont FABRIQUÉS ici, par
   encodage ou par la règle du rendu, jamais recopiés tels que tapés.

   La boîte (`creerBoiteMessages`) garde la liste chargée entre deux
   reconstructions du panneau : un pas d'annulation, une case cochée dans
   un autre onglet reconstruisent le panneau, et le message qu'on lisait ne
   doit pas se refermer pour autant, ni la liste repartir au serveur. */

import { lienTelephone, texteBrut } from "/rendu/outils.js";
import { BLOCS, valeurReglage } from "/rendu/registre.js";
import { nomDuBloc } from "/rendu/structure.js";
import { compte, messageErreur } from "./textes.js";

const aEnPropre = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
const chaine = (v) => (typeof v === "string" ? v : "");
const entierPositif = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);

/* Le serveur n'en rend jamais plus D'UN COUP (spécification § 3.2) : une
   réponse plus longue n'est pas la sienne, on ne la déroule pas. Les plus
   anciens se demandent page par page (`chargerPlusAnciens`). */
export const MAX_MESSAGES = 200;

/* Une liste chargée il y a moins d'une minute ne se recharge pas à chaque
   reconstruction de l'onglet ; « Actualiser » la recharge quand on veut, et
   ARRIVER sur l'onglet aussi (panneau-messages.js). */
export const FRAICHEUR_MS = 60 * 1000;

/* La pastille des non-lus se remet à jour toute seule, toutes les deux
   minutes au plus, tant que l'éditeur est affiché — et au retour sur
   l'onglet du navigateur, dès qu'il redevient visible.

   Relecture du 3 octobre 2026 : elle ne se rechargeait qu'au retour sur
   l'onglet, et seulement après cinq minutes. Une page restée AU PREMIER
   PLAN ne reçoit jamais `visibilitychange` : l'artisan qui travaillait deux
   heures dans l'éditeur ne voyait pas le message arrivé à 10 h 05 — et sans
   adresse d'expédition configurée, ou passé les vingt alertes du jour, la
   pastille est le SEUL signal qu'un client a écrit.

   Deux minutes : un Durable Object réveillé trente fois par heure au plus,
   pour un éditeur ouvert ; rien pour un onglet caché. Le retour, lui, ne
   recharge pas une liste de moins de quelques secondes : quitter l'onglet
   et y revenir aussitôt ne doit pas faire deux appels. */
export const RAFRAICHIR_MESSAGES_MS = 2 * 60 * 1000;
export const RETOUR_MIN_MS = 5 * 1000;

/* Faut-il recharger, sans que personne ne l'ait demandé ? Jamais pour une
   page cachée, jamais par-dessus un chargement en cours. `retour` : la
   page vient de redevenir visible (ou la fenêtre de reprendre la main). */
export function fautRafraichir({ visible, age, enCours, retour = false } = {}) {
  if (visible !== true || enCours) return false;
  const a = typeof age === "number" && !Number.isNaN(age) ? age : Infinity;
  return a > (retour ? RETOUR_MIN_MS : RAFRAICHIR_MESSAGES_MS);
}

/* L'identifiant d'un message : un entier positif (la clé de la table). */
export function idMessage(v) {
  if (Number.isSafeInteger(v) && v > 0) return v;
  if (typeof v === "string" && /^[1-9][0-9]{0,14}$/.test(v)) return Number(v);
  return null;
}

/* La réponse de `GET /admin/api/messages`, sous une forme sûre : un message
   sans identifiant valable est écarté (on ne pourrait ni le marquer ni le
   supprimer), un champ qui n'est pas du texte devient vide, et la liste va
   du plus récent au plus ancien — l'ordre du serveur, redit ici pour ne
   pas dépendre d'un détail de sa requête. */
export function normaliserMessages(donnees) {
  const brut = donnees && typeof donnees === "object" && Array.isArray(donnees.messages) ? donnees.messages : [];
  const vus = new Set();
  const liste = [];
  for (const m of brut) {
    if (liste.length >= MAX_MESSAGES) break;
    if (!m || typeof m !== "object" || Array.isArray(m)) continue;
    const id = idMessage(m.id);
    if (id === null || vus.has(id)) continue;
    vus.add(id);
    liste.push({
      id,
      quand: Number.isFinite(m.quand) ? m.quand : null,
      page: chaine(m.page),
      nom: chaine(m.nom),
      email: chaine(m.email),
      telephone: chaine(m.telephone),
      message: chaine(m.message),
      // `true` du serveur, ou le 1 d'une colonne SQLite passée telle quelle.
      lu: m.lu === true || m.lu === 1
    });
  }
  liste.sort(duPlusRecent);
  return liste;
}
const duPlusRecent = (a, b) => (b.quand ?? 0) - (a.quand ?? 0) || b.id - a.id;

/* La réponse entière : la liste, et ce que le serveur dit de ce qu'elle ne
   montre pas (socle 0.3.0, `{ messages, suite, total, nonLus }`).
   `total`, `nonLus` : les comptes de TOUTE la boîte du serveur, ou `null`
   s'il ne les donne pas. `suite` : `true` s'il reste des messages plus
   anciens (le serveur peut l'écrire `true` ou par l'identifiant d'où
   repartir), `false` s'il n'en reste pas, `null` s'il ne le dit pas. */
export function lireReponseMessages(donnees) {
  const d = donnees && typeof donnees === "object" ? donnees : {};
  let suite = null;
  if (d.suite === true || idMessage(d.suite) !== null) suite = true;
  else if (d.suite === false || d.suite === null || d.suite === 0) suite = false;
  return { liste: normaliserMessages(d), total: entierPositif(d.total), nonLus: entierPositif(d.nonLus), suite };
}

/* ----- Ce que l'écran affiche ----- */

/* Les caractères qui RETOURNENT le texte (U+202A à U+202E, U+2066 à
   U+2069) : un nom piégé pourrait faire lire à l'envers la ligne qui le
   suit. Retirés de l'aperçu, d'une ligne ; le message ouvert, lui, est
   posé dans un élément isolé (`dir="auto"`, panneau-messages.js). */
const RETOURNEMENTS = /[\u202A-\u202E\u2066-\u2069]/g;

/* Le début d'un message, sur une ligne, pour la liste : les retours à la
   ligne deviennent des espaces, et on coupe sur un mot. */
export function apercuMessage(texte, max = 90) {
  const plat = chaine(texte)
    .replace(RETOURNEMENTS, "")
    .replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const lettres = Array.from(plat);
  if (lettres.length <= max) return plat;
  const coupe = lettres.slice(0, max - 1).join("");
  const surUnMot = coupe.replace(/\s+\S*$/, "");
  // Un seul mot très long (une adresse collée) : on coupe au caractère.
  return (surUnMot.length >= coupe.length * 0.6 ? surUnMot : coupe).trimEnd() + "…";
}

/* Le nom du visiteur, d'une ligne. Un nom vide ne laisse pas un bouton
   muet dans la liste. */
export function nomVisiteur(nom) {
  return apercuMessage(nom, 100) || "Sans nom";
}

/* L'objet tout prêt de la réponse. */
export function objetReponse(nomSite) {
  return "Votre message sur " + (texteBrut(nomSite) || "notre site");
}

/* « Répondre » : un lien `mailto:` vers le visiteur, avec l'objet tout
   prêt — ou `null` si l'adresse n'en a pas la forme (espaces, retour à la
   ligne, pas d'arobase) : elle reste lisible à l'écran, sans lien.

   L'adresse est ENCODÉE, morceau par morceau : une adresse piégée
   (« moi@exemple.fr?bcc=… », « …&body=… ») ajouterait sinon des
   destinataires ou un texte au message que l'artisan croit écrire lui-même.
   Encodée, elle n'est plus qu'une adresse — fausse, au pire. */
export function lienRepondre(email, nomSite) {
  const e = chaine(email).trim();
  if (!e || e.length > 254 || /[\s\u0000-\u001F\u007F]/.test(e)) return null;
  const arobase = e.lastIndexOf("@");
  if (arobase < 1) return null;
  const local = e.slice(0, arobase);
  const domaine = e.slice(arobase + 1);
  if (!/^[^@.]+(\.[^@.]+)*\.[^@.]{2,}$/.test(domaine)) return null;
  try {
    return "mailto:" + encodeURIComponent(local) + "@" + encodeURIComponent(domaine) +
      "?subject=" + encodeURIComponent(objetReponse(nomSite));
  } catch {
    // Un caractère que l'encodage refuse (une moitié de caractère, venue
    // d'un JSON abîmé) : pas de lien plutôt qu'une erreur dans le panneau.
    return null;
  }
}

/* L'appel : la règle même du site (`lienTelephone`, outils.js), qui
   n'accepte que des chiffres, des espaces et la ponctuation d'un numéro. */
export function lienAppel(telephone) {
  return lienTelephone(chaine(telephone)) || null;
}

/* La pastille de l'onglet : rien à zéro, « 99+ » au-delà. */
export function libellePastille(n) {
  const v = Number.isSafeInteger(n) && n > 0 ? n : 0;
  return v > 99 ? "99+" : v ? String(v) : "";
}

export function phraseNonLus(n) {
  return compte(Number.isSafeInteger(n) && n > 0 ? n : 0, "message non lu", "messages non lus", "aucun message non lu");
}

/* « 3 messages, dont 1 non lu. » — ce qu'annonce la liste.

   `boite` (facultatif) : ce que le serveur compte en tout (`total`,
   `nonLus`). Quand la liste n'en montre qu'une partie, le résumé dit LES
   COMPTES DU SERVEUR, pas ceux de la liste : « 200 messages, dont 200 non
   lus » pendant que la pastille affichait 201 faisait disparaître sans un
   mot le message d'une cliente arrivé avant 200 messages de robots
   (relecture du 3 octobre 2026). `phraseListeCoupee` dit le reste. */
export function resumeMessages(liste, boite = null) {
  const l = Array.isArray(liste) ? liste : [];
  const total = boite && entierPositif(boite.total);
  if (total !== null && total > l.length) {
    const nonLus = entierPositif(boite.nonLus) ?? l.filter((m) => m && !m.lu).length;
    return compte(total, "message", "messages") + (nonLus ? ", dont " + compte(nonLus, "non lu", "non lus") : "") + ".";
  }
  if (!l.length) return "Aucun message.";
  const nonLus = l.filter((m) => m && !m.lu).length;
  return compte(l.length, "message", "messages") + (nonLus ? ", dont " + compte(nonLus, "non lu", "non lus") : "") + ".";
}

/* Sous le résumé, quand la liste ne montre pas tout : combien sont
   affichés, et où trouver les autres. `peutCharger` : le bouton
   « Afficher les messages plus anciens » est là. */
export const LIBELLE_PLUS_ANCIENS = "Afficher les messages plus anciens";
/* La copie de l'onglet « Compte » n'emporte que les plus récents : le
   serveur en exporte 2 000 au plus (MESSAGES_EXPORTES, atelier-coeur.js —
   tester-editeur.mjs vérifie que les deux chiffres restent les mêmes). */
export const MESSAGES_EXPORTES = 2000;
// « 36 500 » et non « 36500 » ; l'espace insécable garde le nombre d'un bloc.
const milliers = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0");
export function phraseListeCoupee({ affiches = 0, total = null, peutCharger = false } = {}) {
  const n = entierPositif(affiches) ?? 0;
  const t = entierPositif(total);
  const debut = !n ? "Aucun n'est affiché pour l'instant"
    : n === 1 ? "Seul le plus récent est affiché"
    : "Seuls les " + milliers(n) + " plus récents sont affichés";
  /* « Les contient tous » seulement quand c'est vrai. Contrôle du 3 octobre
     2026 : la phrase le promettait sans condition, alors qu'au-delà de
     2 000 messages (vingt jours de robots au plafond du site) la copie
     s'arrête aux plus récents — l'onglet « Compte » le dit lui-même. */
  const copie = t !== null && t <= MESSAGES_EXPORTES
    ? "la copie de votre contenu (onglet « Compte ») les contient tous"
    : "la copie de votre contenu (onglet « Compte ») contient les " + milliers(MESSAGES_EXPORTES) + " plus récents";
  return debut + (t !== null && t > n ? " (sur " + milliers(t) + ")" : "") + ". " +
    (peutCharger ? "« " + LIBELLE_PLUS_ANCIENS + " » ajoute les suivants à la liste. " : "") +
    "Les messages sont gardés un an, et " + copie + ".";
}

/* Le chargement de la liste a échoué : la même phrase à l'écran et aux
   lecteurs d'écran (panneau-messages.js), écrite une seule fois. */
export function phraseEchecChargement(erreur, { listeDejaLa = false } = {}) {
  return (listeDejaLa
    ? "La liste n'a pas pu être mise à jour : elle peut ne pas montrer les tout derniers messages. "
    : "Les messages n'ont pas pu être chargés. ") + messageErreur(erreur);
}

/* ----- Le formulaire est-il en place ? -----

   Les sections « Contact » du brouillon, rangées en trois : celles qui
   affichent le formulaire, celles qui ne l'affichent pas, et celles qui
   sont masquées. La case se lit par `valeurReglage`, la règle même du
   rendu : le panneau dit ce que la page montre. */
export function etatFormulaire(contenu) {
  const r = { actifs: [], sansFormulaire: [], masques: [] };
  if (!contenu || typeof contenu !== "object" || !contenu.pages || !contenu.blocs) return r;
  const vus = new Set();
  for (const [pageId, page] of Object.entries(contenu.pages)) {
    if (!page || !Array.isArray(page.ordre)) continue;
    for (const id of page.ordre) {
      if (typeof id !== "string" || vus.has(id) || !aEnPropre(contenu.blocs, id)) continue;
      vus.add(id);
      const b = contenu.blocs[id];
      if (!b || b.type !== "contact") continue;
      // `formulaire` : la case est-elle cochée ? Une section masquée la
      // garde, et la consigne en dépend (`phraseSansMessage`).
      const quoi = { pageId, id, nom: nomDuBloc(b), formulaire: valeurReglage(b, "formulaire") === true };
      if (b.masque === true) r.masques.push(quoi);
      else if (valeurReglage(b, "formulaire") === true) r.actifs.push(quoi);
      else r.sansFormulaire.push(quoi);
    }
  }
  return r;
}

/* Le libellé de la case, lu dans le registre et non recopié : s'il change
   dans le bloc, la consigne suit. `null` si le socle n'a pas de formulaire. */
function libelleCase() {
  const contact = aEnPropre(BLOCS, "contact") ? BLOCS.contact : null;
  const r = contact && Array.isArray(contact.reglages) ? contact.reglages.find((x) => x && x.cle === "formulaire") : null;
  return r && typeof r.libelle === "string" ? r.libelle : null;
}

/* Ce que dit une boîte vide : où arrivent les messages, et comment
   afficher le formulaire s'il ne l'est pas. `cible` : la section à ouvrir
   pour le faire (le panneau en fait un bouton), ou `null`. */
export function phraseSansMessage(contenu) {
  const e = etatFormulaire(contenu);
  const debut = "Aucun message pour l'instant. Les messages que vos visiteurs envoient avec le formulaire de contact de votre site arrivent ici.";
  const caseFormulaire = libelleCase();
  if (e.actifs.length) {
    return { texte: debut + " Votre formulaire est activé dans la section « " + e.actifs[0].nom + " » : il apparaît sur votre site une fois la page publiée.", cible: null };
  }
  if (!caseFormulaire) return { texte: debut, cible: null };
  const consigne = "cochez « " + caseFormulaire + " », puis publiez.";
  if (e.sansFormulaire.length) {
    const s = e.sansFormulaire[0];
    return { texte: debut + " Pour en proposer un : ouvrez la section « " + s.nom + " » (onglet « Page »), " + consigne, cible: s };
  }
  if (e.masques.length) {
    // Une section masquée dont la case est DÉJÀ cochée : « cochez » faisait
    // cliquer sur la case, donc la DÉCOCHER, et publier une section Contact
    // sans formulaire (relecture du 3 octobre 2026). On ne demande de cocher
    // que ce qui ne l'est pas. Une section dont la case est cochée passe
    // devant : l'afficher suffit.
    const s = e.masques.find((x) => x.formulaire) || e.masques[0];
    return {
      texte: debut + " Votre section « " + s.nom + " » est masquée : affichez-la" +
        (s.formulaire ? " (la case « " + caseFormulaire + " » est déjà cochée), puis publiez." : ", " + consigne),
      cible: s
    };
  }
  return { texte: debut + " Pour en proposer un : ajoutez une section « Contact » (onglet « Page », « Ajouter une section »), " + consigne, cible: null };
}

/* ----- La boîte -----

   `api` : celle d'api.js (`messages(avant?)`, `marquerMessage`,
   `supprimerMessage`). `nonLus` : le compte que donne `GET /admin/api/etat`
   au démarrage, avant que la liste ne soit chargée.

   ⚠️ La liste chargée n'est pas toujours TOUTE la boîte : le serveur rend
   les 200 plus récents, puis les suivants à la demande (`?avant=<id>`). À
   chaque réponse, la boîte retient donc ce que le serveur compte EN DEHORS
   de la liste (`horsListe`) ; les gestes faits ici (ouvrir, non lu,
   supprimer) ne touchent que des messages de la liste, qui se recompte.
   Total et non-lus = la liste + le reste.
   Relecture du 3 octobre 2026 : le compte de la liste REMPLAÇAIT celui du
   serveur. Après deux jours de robots (100 messages par jour, la limite du
   site), la pastille passait de « 99+ » à 200 en ouvrant l'onglet, la liste
   disait « 200 messages, dont 200 non lus », et le message de la cliente,
   le 201e, n'était plus nulle part — sans un mot.

   Chaque geste rend `{ ok, erreur?, introuvable? }` et ne lève jamais :
   l'écran dit ce qui s'est passé. Un message introuvable (supprimé depuis
   un autre appareil) est retiré de la liste — c'est ce qu'on voulait voir. */
export function creerBoiteMessages({ api, nonLus = null, maintenant = () => Date.now() } = {}) {
  let liste = null;              // null : jamais chargée
  let essaiLe = 0;               // le dernier chargement, réussi ou non
  let erreur = null;             // l'erreur du dernier chargement
  let enCours = null;            // la promesse du chargement en cours
  let discret = false;           // ce chargement ne redessine rien s'il ne change rien
  const compteDepart = entierPositif(nonLus);
  // Le compte du démarrage vaut un chargement : la minuterie ne repart pas
  // au serveur une demi-minute après l'ouverture de l'éditeur.
  const compteLe = compteDepart !== null ? maintenant() : 0;
  let horsListe = { total: null, nonLus: null };
  let suiteBas = null;           // ce que la dernière page dit des plus anciens
  let curseur = null;            // le plus petit identifiant chargé : d'où repartir
  let pagesEnPlus = false;       // des pages plus anciennes ont été ajoutées
  let epuise = false;            // le serveur n'a rien rendu de plus ancien
  let enCoursPlus = null;        // la promesse des plus anciens
  const ouverts = new Set();
  /* Les messages marqués « lu » à l'ouverture dont la réponse n'est pas
     revenue. Une liste rechargée entre-temps (« Actualiser ») les aurait
     montrés non lus, ouverts sous les yeux de l'artisan. */
  const marquesEnRoute = new Map();
  const ecouteurs = new Set();

  const trouver = (id) => (liste ? liste.find((m) => m.id === id) || null : null);
  const plusPetitId = (l) => l.reduce((min, m) => (m.id < min ? m.id : min), Infinity);
  /* Un non-lu TEL QUE LE SERVEUR LE COMPTE : une marque « lu » encore en
     route n'est pas arrivée chez lui. */
  const nonLuPourLeServeur = (m) => !m.lu || marquesEnRoute.has(m.id);
  function prevenir() {
    for (const f of [...ecouteurs]) {
      try { f(); } catch (e) { if (typeof console !== "undefined") console.error("Écouteur des messages :", e); }
    }
  }
  function retirer(id) {
    if (liste) liste = liste.filter((m) => m.id !== id);
    ouverts.delete(id);
    marquesEnRoute.delete(id);
  }
  const introuvable = (e) => !!e && e.statut === 404;
  /* Ce que l'écran montre de la boîte : un chargement discret (la
     minuterie) qui n'y change rien ne reconstruit pas l'onglet — sinon,
     toutes les deux minutes, le focus serait rendu au même bouton, et un
     lecteur d'écran le relirait. */
  const empreinte = () => JSON.stringify([
    liste && liste.map((m) => m.id + (m.lu ? "+" : "-")), horsListe, suiteBas, epuise,
    erreur ? [erreur.statut, erreur.erreur] : null
  ]);
  /* Ce que le serveur compte hors de la liste. `vus` : les non-lus de la
     liste tels qu'il les voit. Un compte qu'il ne donne pas (serveur
     d'avant la pagination) reste inconnu : la liste fait alors foi. */
  function majHorsListe(r, vus, ajoutes = 0) {
    horsListe = {
      total: r.total !== null ? Math.max(0, r.total - liste.length)
        : horsListe.total !== null && ajoutes ? Math.max(0, horsListe.total - ajoutes) : r.total,
      nonLus: r.nonLus !== null ? Math.max(0, r.nonLus - vus) : null
    };
  }

  /* Ne prévient PAS en partant, seulement en arrivant : le panneau appelle
     `charger` pendant qu'il se construit, et un écouteur qui le
     reconstruirait au même instant le ferait se construire dans lui-même.
     `discret` : la minuterie ou le retour sur l'onglet du navigateur —
     personne n'a rien demandé, rien ne se redessine pour rien. */
  function charger({ discret: d = false } = {}) {
    if (enCours) {
      if (!d) discret = false;
      return enCours;
    }
    discret = d;
    const avant = empreinte();
    enCours = (async () => {
      try {
        const r = lireReponseMessages(await api.messages());
        const page = r.liste;
        let vus = page.filter((m) => !m.lu).length;
        for (const m of page) if (marquesEnRoute.has(m.id)) m.lu = true;
        /* Des messages plus anciens déjà affichés RESTENT, s'ils prolongent
           la nouvelle page sans trou : un rafraîchissement toutes les deux
           minutes ne doit pas refermer la liste qu'on est en train de
           remonter. Avec un trou (plus de 200 messages arrivés entre-temps),
           on repart de la seule première page. */
        let nouvelle = page;
        let garde = false;
        if (pagesEnPlus && liste && page.length) {
          const bas = plusPetitId(page);
          const anciens = liste.filter((m) => m.id < bas);
          if (anciens.length && liste.some((m) => m.id >= bas)) {
            nouvelle = page.concat(anciens);
            vus += anciens.filter(nonLuPourLeServeur).length;
            garde = true;
          }
        }
        if (!garde) {
          pagesEnPlus = false;
          suiteBas = r.suite;
          const bas = page.length ? plusPetitId(page) : null;
          /* Un bas de liste qui a bougé rend le bouton : « rien de plus
             ancien » ne valait que pour l'ancien bas. Contrôle du 3 octobre
             2026 : `epuise` ne retombait jamais. Un clic sans résultat (de
             nouveaux messages arrivés EN HAUT entre-temps) retirait le bouton
             pour toute la session, et après un déluge de 300 messages de
             plus, les plus anciens redevenaient inaccessibles — le défaut
             qu'on venait de fermer. */
          if (bas !== curseur) epuise = false;
          curseur = bas;
        }
        liste = nouvelle;
        for (const id of [...ouverts]) if (!liste.some((m) => m.id === id)) ouverts.delete(id);
        majHorsListe(r, vus);
        erreur = null;
        return { ok: true };
      } catch (e) {
        erreur = e;
        return { ok: false, erreur: e };
      } finally {
        essaiLe = maintenant();
        enCours = null;
        if (!discret || empreinte() !== avant) prevenir();
      }
    })();
    return enCours;
  }

  /* « Afficher les messages plus anciens » : la page suivante, ajoutée au
     bas de la liste. Rend `{ ok, ajoutes, premier? }` — `premier` : le plus
     récent des messages ajoutés, où le panneau porte le focus. */
  function chargerPlusAnciens() {
    if (enCoursPlus) return enCoursPlus;
    enCoursPlus = (async () => {
      try {
        if (enCours) await enCours;
        const depuis = curseur;
        if (!liste || depuis === null) return { ok: true, ajoutes: 0 };
        const r = lireReponseMessages(await api.messages(depuis));
        // La liste a été rechargée entre-temps et son bas a bougé : ajouter
        // cette page laisserait un trou. On ne touche à rien ; un second
        // clic repart du bon endroit.
        if (!liste || curseur !== depuis) return { ok: true, ajoutes: 0 };
        const deja = new Set(liste.map((m) => m.id));
        const nouveaux = r.liste.filter((m) => m.id < depuis && !deja.has(m.id));
        // Rien de plus ancien alors que le serveur en annonçait : on ne
        // propose plus le bouton (un serveur qui ignorerait `avant`
        // rendrait toujours la même page, et le bouton ne ferait rien).
        // Ce que le serveur dit de la suite est retenu : des plus anciens
        // supprimés depuis un autre appareil ne laissent pas la note
        // annoncer une liste coupée.
        if (!nouveaux.length) { epuise = true; suiteBas = r.suite; return { ok: true, ajoutes: 0 }; }
        const vusNouveaux = nouveaux.filter((m) => !m.lu).length;
        for (const m of nouveaux) if (marquesEnRoute.has(m.id)) m.lu = true;
        const vusAvant = liste.filter(nonLuPourLeServeur).length;
        liste = liste.concat(nouveaux).sort(duPlusRecent);
        curseur = Math.min(depuis, plusPetitId(nouveaux));
        pagesEnPlus = true;
        suiteBas = r.suite;
        majHorsListe(r, vusAvant + vusNouveaux, nouveaux.length);
        return { ok: true, ajoutes: nouveaux.length, premier: nouveaux[0].id };
      } catch (e) {
        return { ok: false, erreur: e };
      } finally {
        enCoursPlus = null;
        prevenir();
      }
    })();
    return enCoursPlus;
  }

  /* Ouvrir un message le marque lu, tout de suite à l'écran ; si le
     serveur refuse, il redevient non lu. */
  async function ouvrir(id) {
    ouverts.add(id);
    const m = trouver(id);
    if (!m || m.lu) { prevenir(); return { ok: true }; }
    const jeton = {};
    m.lu = true;
    marquesEnRoute.set(id, jeton);
    prevenir();
    try {
      await api.marquerMessage(id, true);
      return { ok: true };
    } catch (e) {
      if (introuvable(e)) { retirer(id); return { ok: true, introuvable: true }; }
      const encore = trouver(id);
      if (encore && marquesEnRoute.get(id) === jeton) encore.lu = false;
      return { ok: false, erreur: e };
    } finally {
      if (marquesEnRoute.get(id) === jeton) marquesEnRoute.delete(id);
      prevenir();
    }
  }

  function fermer(id) {
    if (ouverts.delete(id)) prevenir();
  }

  /* « Marquer comme non lu » attend la réponse du serveur : sinon un
     message qu'on croit avoir mis de côté serait déjà lu ailleurs. Il se
     referme — ouvert, il se marquerait lu de nouveau à la prochaine
     ouverture, ce qui est bien ce qu'on attend. */
  async function marquerNonLu(id) {
    try {
      await api.marquerMessage(id, false);
      marquesEnRoute.delete(id);
      const m = trouver(id);
      if (m) m.lu = false;
      ouverts.delete(id);
      return { ok: true };
    } catch (e) {
      if (introuvable(e)) { retirer(id); return { ok: true, introuvable: true }; }
      return { ok: false, erreur: e };
    } finally {
      prevenir();
    }
  }

  /* Définitif : la confirmation est demandée AVANT, par le panneau. */
  async function supprimer(id) {
    try {
      await api.supprimerMessage(id);
      retirer(id);
      return { ok: true };
    } catch (e) {
      if (introuvable(e)) { retirer(id); return { ok: true, introuvable: true }; }
      return { ok: false, erreur: e };
    } finally {
      prevenir();
    }
  }

  const boite = {
    get liste() { return liste; },
    get erreur() { return erreur; },
    get enCours() { return !!enCours; },
    /* Un chargement que l'écran doit montrer (« Chargement des
       messages… ») : pas celui de la minuterie, qui passe sans bruit. */
    get chargementAffiche() { return !!enCours && !discret; },
    /* Les non-lus de TOUTE la boîte : ceux de la liste, plus ceux que le
       serveur compte au-delà. Avant le premier chargement, le compte du
       démarrage. */
    get nonLus() {
      if (!liste) return compteDepart ?? 0;
      return liste.filter((m) => !m.lu).length + (horsListe.nonLus ?? 0);
    },
    /* Le nombre de messages de toute la boîte, ou `null` si le serveur ne
       le donne pas. */
    get total() { return liste && horsListe.total !== null ? liste.length + horsListe.total : null; },
    /* Des messages PLUS ANCIENS que le bas de la liste restent sur le
       serveur. Sa dernière page le dit (`suite`) ; sans elle, son compte.
       Contrôle du 3 octobre 2026 : le compte seul ne suffit pas. Des
       messages arrivés EN HAUT depuis le dernier chargement le font
       dépasser la liste alors que rien de plus ancien ne reste : la note
       annonçait « Seuls les 250 plus récents sont affichés (sur 255) » —
       ce sont justement les plus récents qui manquaient —, et le bouton
       ne ramenait rien. Le prochain rechargement les apporte. */
    get tronquee() {
      if (!liste) return false;
      return suiteBas !== null ? suiteBas === true : horsListe.total !== null && horsListe.total > 0;
    },
    get peutChargerPlusAnciens() { return boite.tronquee && !epuise && curseur !== null; },
    estOuvert: (id) => ouverts.has(id),
    /* Le temps écoulé depuis que le compte des non-lus est connu : dernier
       chargement (réussi ou non), ou démarrage s'il l'a donné. Infinity :
       jamais. */
    age: () => {
      const t = Math.max(essaiLe, compteLe);
      return t ? maintenant() - t : Infinity;
    },
    /* Faut-il (re)charger en reconstruisant l'onglet ? Jamais tenté, ou
       tenté il y a plus d'une minute — un échec récent ne se relance pas
       tout seul à chaque reconstruction du panneau : « Réessayer » est là
       pour ça. */
    doitCharger(fraicheur = FRAICHEUR_MS) {
      if (enCours) return false;
      return !essaiLe || maintenant() - essaiLe > fraicheur;
    },
    charger,
    chargerPlusAnciens,
    ouvrir,
    fermer,
    marquerNonLu,
    supprimer,
    ecouter(f) {
      ecouteurs.add(f);
      return () => ecouteurs.delete(f);
    }
  };
  return boite;
}
