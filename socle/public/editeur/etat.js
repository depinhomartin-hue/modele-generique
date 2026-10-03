/* =========================================================
   L'état de l'éditeur — une seule source, une seule porte
   =========================================================

   Module PUR (ni `document` ni `window`), testé sous Node.

   Tout ce que l'éditeur sait vit ici : le contenu du brouillon, la
   révision du serveur sur laquelle il repose, les empreintes du brouillon
   et du publié, la page affichée, le mode (édition, aperçu, version), la
   section choisie. Et TOUTE modification du contenu passe par une des deux
   portes :

     modifier(chemin, valeur)   un texte, un réglage — écrit sur place
     transformer(fn)            tout le reste — fn reçoit une COPIE

   Chacune empile l'instantané d'avant (annulation), puis prévient les
   écouteurs : la file d'enregistrement planifie un envoi, le cadre redessine
   ce qu'il faut, le panneau suit. Une modification qui contournerait ces
   portes ne serait ni annulable ni enregistrée — c'est précisément le
   défaut qu'une porte unique empêche.

   L'annulation garde 100 instantanés du contenu ENTIER, en JSON. Un
   contenu pèse 20 Ko d'ordinaire, 300 Ko au plus (limite du serveur) :
   quelques mégaoctets dans le pire cas, et une annulation toujours exacte,
   là où des « opérations inverses » finissent toujours par en oublier une.

   La frappe dans un même champ ne fait qu'UN pas (`fusion`) : annuler
   retire le mot tapé, pas la dernière lettre. Quitter le champ coupe le
   pas (`couperFusion`) — y revenir plus tard en ouvre un nouveau. */

import { normaliser, PAGE_ACCUEIL } from "/rendu/page.js";
import { lireChemin, ecrireChemin } from "/rendu/structure.js";

export const TAILLE_HISTORIQUE = 100;
const aEnPropre = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);

function infosBrouillon(b) {
  const o = b && typeof b === "object" ? b : {};
  return {
    revision: Number.isFinite(Number(o.revision)) ? Number(o.revision) : 0,
    empreinte: typeof o.empreinte === "string" ? o.empreinte : null,
    modifie_le: typeof o.modifie_le === "number" ? o.modifie_le : null,
    modifie_par: typeof o.modifie_par === "string" ? o.modifie_par : null
  };
}

function infosPublie(p) {
  const o = p && typeof p === "object" ? p : {};
  return {
    empreinte: typeof o.empreinte === "string" ? o.empreinte : null,
    publie_le: typeof o.publie_le === "number" ? o.publie_le : null,
    publie_par: typeof o.publie_par === "string" ? o.publie_par : null
  };
}

/* `depart` : la réponse de `GET /admin/api/etat`. */
export function creerEtat(depart) {
  const d = depart && typeof depart === "object" ? depart : {};
  const brouillon = d.brouillon && typeof d.brouillon === "object" ? d.brouillon : {};
  const s = {
    site: d.site && typeof d.site === "object" ? d.site : {},
    utilisateur: d.utilisateur && typeof d.utilisateur === "object" ? d.utilisateur : {},
    contenu: normaliser(brouillon.contenu),
    brouillon: infosBrouillon(brouillon),
    publie: infosPublie(d.publie),
    pageId: PAGE_ACCUEIL,
    mode: "edition",          // "edition" | "apercu" | "version"
    version: null,            // { id, quand, par, origine, contenu } en mode « version »
    blocChoisi: null
  };
  const passe = [];
  const futur = [];
  let fusionCourante = null;
  const ecouteurs = new Set();

  function notifier(evt) {
    // Un écouteur qui lève (un défaut d'affichage) ne doit pas empêcher les
    // autres de passer : la file d'enregistrement en fait partie.
    for (const f of [...ecouteurs]) {
      try { f(evt); } catch (e) { if (typeof console !== "undefined") console.error("Écouteur de l'état :", e); }
    }
  }

  const contenuAffiche = () => (s.mode === "version" && s.version ? s.version.contenu : s.contenu);
  const pageExiste = (contenu, id) => aEnPropre(contenu.pages, id);

  /* Après tout changement de contenu, la vue doit rester possible : une
     page supprimée (ou rendue absente par une annulation) ramène à
     l'accueil, une section disparue n'est plus « choisie ». */
  function verifierVue() {
    const c = contenuAffiche();
    if (!pageExiste(c, s.pageId)) s.pageId = PAGE_ACCUEIL;
    if (s.blocChoisi && !c.pages[s.pageId].ordre.includes(s.blocChoisi)) s.blocChoisi = null;
  }

  function pousser(entree) {
    passe.push(entree);
    if (passe.length > TAILLE_HISTORIQUE) passe.splice(0, passe.length - TAILLE_HISTORIQUE);
    futur.length = 0;
  }

  function modifier(chemin, valeur, { fusion = null, origine = null } = {}) {
    if (s.mode === "version") return false;
    const avant = lireChemin(s.contenu, chemin);
    if (avant === valeur) return false;
    if (valeur && typeof valeur === "object" && JSON.stringify(avant) === JSON.stringify(valeur)) return false;
    const fusionne = fusion !== null && fusion === fusionCourante;
    const instantane = fusionne ? null : { json: JSON.stringify(s.contenu), pageId: s.pageId };
    if (!ecrireChemin(s.contenu, chemin, valeur)) return false;
    if (instantane) {
      pousser(instantane);
      fusionCourante = fusion;
    }
    notifier({ type: "texte", chemin, valeur, origine });
    return true;
  }

  /* `fn` reçoit une copie du contenu et la modifie ; elle peut lever (un
     refus expliqué, voir operations.js) : rien n'est alors appliqué. Le
     résultat est normalisé — la forme que le serveur stockera —, pour que
     l'éditeur montre exactement ce qui sera enregistré. Une transformation
     qui ne change rien n'empile rien. */
  function transformer(fn, { fusion = null, origine = null } = {}) {
    if (s.mode === "version") return undefined;
    const avant = JSON.stringify(s.contenu);
    const copie = JSON.parse(avant);
    const resultat = fn(copie);
    const apres = normaliser(copie);
    if (JSON.stringify(apres) === avant) return resultat;
    if (!(fusion !== null && fusion === fusionCourante)) {
      pousser({ json: avant, pageId: s.pageId });
      fusionCourante = fusion;
    }
    s.contenu = apres;
    verifierVue();
    notifier({ type: "structure", origine });
    return resultat;
  }

  /* Annuler revient à la page où la modification avait été faite : on voit
     ce qu'on annule (un texte retiré d'une autre page, sans la montrer,
     serait une annulation à l'aveugle).

     Un pas marqué `ecrase` est un remplacement venu d'AILLEURS (la version
     chargée après un conflit) : le franchir, dans un sens ou dans l'autre,
     réécrit par-dessus le travail d'un autre appareil. L'événement le dit
     (`ecrase: true`), et l'éditeur demande alors au serveur de mettre ce
     travail de côté avant de le remplacer (relecture du 3 octobre 2026). */
  function annuler() {
    if (s.mode === "version" || !passe.length) return false;
    const e = passe.pop();
    futur.push({ json: JSON.stringify(s.contenu), pageId: e.pageId, ecrase: e.ecrase === true });
    s.contenu = JSON.parse(e.json);
    fusionCourante = null;
    if (pageExiste(s.contenu, e.pageId)) s.pageId = e.pageId;
    verifierVue();
    notifier({ type: "structure", origine: "annulation", ecrase: e.ecrase === true });
    return true;
  }

  function retablir() {
    if (s.mode === "version" || !futur.length) return false;
    const e = futur.pop();
    passe.push({ json: JSON.stringify(s.contenu), pageId: e.pageId, ecrase: e.ecrase === true });
    s.contenu = JSON.parse(e.json);
    fusionCourante = null;
    if (pageExiste(s.contenu, e.pageId)) s.pageId = e.pageId;
    verifierVue();
    notifier({ type: "structure", origine: "retablissement", ecrase: e.ecrase === true });
    return true;
  }

  /* Le serveur a remplacé le brouillon (reprise d'une version, abandon,
     « charger la dernière version » après un conflit). Le remplacement est
     un pas d'annulation comme un autre : « Annuler » juste après rend ce
     qu'on avait à l'écran — rien n'est perdu par un clic malheureux.
     `ailleurs` : ce brouillon vient d'un autre onglet ou d'un autre appareil
     (le conflit) — voir `annuler`. Une reprise ou un abandon n'en ont pas
     besoin : le serveur a déjà mis l'ancien brouillon de côté. */
  function remplacerBrouillon(b, { annulable = true, ailleurs = false } = {}) {
    const contenu = normaliser(b && b.contenu);
    const avant = JSON.stringify(s.contenu);
    if (annulable && JSON.stringify(contenu) !== avant) pousser({ json: avant, pageId: s.pageId, ecrase: !!ailleurs });
    s.contenu = contenu;
    s.brouillon = infosBrouillon(b);
    fusionCourante = null;
    verifierVue();
    notifier({ type: "structure", origine: "serveur" });
  }

  return {
    get site() { return s.site; },
    get utilisateur() { return s.utilisateur; },
    get contenu() { return s.contenu; },
    get brouillon() { return s.brouillon; },
    get publie() { return s.publie; },
    get pageId() { return s.pageId; },
    get mode() { return s.mode; },
    get version() { return s.version; },
    get blocChoisi() { return s.blocChoisi; },
    contenuAffiche,
    json: () => JSON.stringify(s.contenu),

    modifier,
    transformer,
    annuler,
    retablir,
    remplacerBrouillon,
    peutAnnuler: () => s.mode !== "version" && passe.length > 0,
    peutRetablir: () => s.mode !== "version" && futur.length > 0,
    couperFusion() { fusionCourante = null; },

    /* Ce que le serveur dit du brouillon après un enregistrement : rien ne
       change dans le contenu, aucun pas d'annulation. */
    majBrouillon(infos) {
      s.brouillon = Object.assign({}, s.brouillon, infosBrouillon(Object.assign({}, s.brouillon, infos)));
      notifier({ type: "serveur", quoi: "brouillon" });
    },
    majPublie(infos) {
      s.publie = infosPublie(infos);
      notifier({ type: "serveur", quoi: "publie" });
    },

    allerA(pageId) {
      if (!pageExiste(contenuAffiche(), pageId) || pageId === s.pageId) return false;
      s.pageId = pageId;
      s.blocChoisi = null;
      notifier({ type: "vue", quoi: "page" });
      return true;
    },
    choisirBloc(id) {
      const valide = id && contenuAffiche().pages[s.pageId].ordre.includes(id) ? id : null;
      if (valide === s.blocChoisi) return false;
      s.blocChoisi = valide;
      notifier({ type: "vue", quoi: "bloc" });
      return true;
    },
    /* « edition », « apercu », ou « version » avec la version à montrer
       (non modifiable : `modifier` et `transformer` n'y font rien). */
    changerMode(mode, version = null) {
      if (mode === "version") {
        if (!version || typeof version !== "object") return false;
        s.version = Object.assign({}, version, { contenu: normaliser(version.contenu) });
      } else {
        s.version = null;
      }
      s.mode = mode === "apercu" || mode === "version" ? mode : "edition";
      fusionCourante = null;
      verifierVue();
      notifier({ type: "vue", quoi: "mode" });
      return true;
    },

    ecouter(f) {
      ecouteurs.add(f);
      return () => ecouteurs.delete(f);
    }
  };
}
