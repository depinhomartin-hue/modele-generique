/* =========================================================
   L'éditeur — ce qui relie tout
   =========================================================

   Un seul état (etat.js), une seule file d'enregistrement
   (enregistrement.js), un cadre qui montre la page (cadre.js), des barres
   flottantes, un panneau, une barre du haut. Ce module les fabrique, les
   branche sur l'état, et porte les GESTES de l'artisan (monter une section,
   publier, reprendre une version…) : chacun passe par `etat.transformer`,
   donc s'annule, s'enregistre et se redessine de la même façon.

   Ce qui ne se perd jamais :
   — une modification part au serveur 1,2 s après la dernière frappe ;
   — hors ligne, elle est gardée dans le navigateur et proposée au retour ;
   — modifiée ailleurs entre-temps : on DEMANDE, on n'écrase pas — et ce
     que le choix remplace est mis de côté (dans les versions, ou sur cet
     appareil), jamais jeté ;
   — quitter la page avec un enregistrement en attente : le navigateur
     prévient, et la copie locale est écrite. */

import { PAGE_ACCUEIL, normaliser } from "/rendu/page.js";
import { BLOCS } from "/rendu/registre.js";
import { nomDuBloc, ecrireChemin } from "/rendu/structure.js";
import { PAGE_MENTIONS, pageMentionsLegales } from "/rendu/modeles-pages.js";
import { creerApi } from "./api.js";
import { creerBoiteMessages, fautRafraichir, RAFRAICHIR_MESSAGES_MS } from "./messages.js";
import { creerEtat } from "./etat.js";
import { creerFile, creerStockage, cleCopie, chaineCopie, copiesDuSite, analyserCopie } from "./enregistrement.js";
import * as Op from "./operations.js";
import { nomDePage } from "./liens.js";
import { messageErreur, momentLisible, dateLongue, compte } from "./textes.js";
import { h, bouton } from "./dom.js";
import { initialiserDialogues, ouvrirFenetre, confirmer, informer, notifier, annoncer, fenetreOuverte } from "./dialogues.js";
import { creerCadre } from "./cadre.js";
import { creerMiseEnForme } from "./mise-en-forme.js";
import { creerBarres } from "./barres.js";
import { creerPanneau } from "./panneau.js";
import { creerBarreHaut } from "./barre-haut.js";
import { ouvrirFenetreLien } from "./fenetre-lien.js";
import { ouvrirMediatheque } from "./medias.js";

export function afficherPanne(racine, titre, texte, detail = "") {
  racine.replaceChildren(h("div", { classe: "ed-panne", role: "alert" },
    h("h1", null, titre),
    h("p", null, texte),
    h("p", null, h("button", { type: "button", classe: "ed-bouton ed-bouton--principal", quand: { click: () => location.reload() } }, "Recharger la page")),
    detail ? h("details", null, h("summary", null, "Détail pour l'atelier"), h("pre", null, detail)) : null));
}

export async function demarrer(racine) {
  const api = creerApi();
  let depart;
  try {
    depart = await api.etat();
  } catch (e) {
    if (e && e.statut === 401) { location.assign("/admin"); return; }
    afficherPanne(racine, "L'éditeur n'a pas pu se charger", messageErreur(e), e && e.erreur ? String(e.erreur) : "");
    return;
  }

  const etat = creerEtat(depart);
  let ls = null;
  try { ls = window.localStorage; } catch { ls = null; }
  // Chaque chargement de l'éditeur a SA copie (enregistrement.js) : un autre
  // onglet ne peut plus effacer ce que celui-ci a gardé, ni l'inverse.
  const onglet = identifiantOnglet();
  const stockage = creerStockage(ls, cleCopie(etat.site.id, onglet));
  // Les copies laissées par les séances précédentes (tous onglets), lues
  // avant que quoi que ce soit ne s'écrive.
  const copiesAuDemarrage = copiesDuSite(ls, etat.site.id);
  // Les modifications mises de côté sur l'appareil en chargeant une version
  // modifiée ailleurs (voir `conflit`) : `{ json, stockage }`. Chacune est
  // effacée dès que le serveur a reçu exactement ce contenu.
  const ecartees = [];

  const app = {
    api, etat,
    annoncer,
    signaler(message, { genre = "info" } = {}) {
      notifier(message, { genre, duree: genre === "erreur" ? 0 : 9000 });
    }
  };
  /* Les messages du formulaire de contact (messages.js) : le compte des
     non-lus vient de l'état du serveur au démarrage, la liste se charge à
     l'ouverture de l'onglet. Créée AVANT la barre et le panneau, qui
     affichent sa pastille. */
  app.boite = creerBoiteMessages({
    api,
    // `null` : un serveur qui ne donne pas le compte — la minuterie
    // chargera la liste pour le connaître.
    nonLus: depart && depart.messages && typeof depart.messages === "object" ? depart.messages.nonLus : null
  });
  let quitterSansAvertir = false;
  let publicationEnCours = false;
  let conflitOuvert = false;
  let expirationOuverte = false;
  let dernierFocusCadre = null;
  let largeur = "ordinateur";
  let statutPrecedent = "enregistre";

  /* ----- La file d'enregistrement ----- */
  const file = creerFile({
    envoyer: (json, revision, options) => api.enregistrer(json, revision, options),
    lire: () => ({ json: etat.json(), revision: etat.brouillon.revision }),
    surSucces: (rep, json) => {
      etat.majBrouillon({
        revision: typeof rep.revision === "number" ? rep.revision : etat.brouillon.revision,
        empreinte: typeof rep.empreinte === "string" ? rep.empreinte : etat.brouillon.empreinte,
        modifie_le: typeof rep.modifie_le === "number" ? rep.modifie_le : Date.now(),
        modifie_par: etat.utilisateur.email || null
      });
      // Des modifications écartées que le serveur vient de recevoir (une
      // annulation les a remises) : leur copie n'a plus lieu d'être.
      for (let i = ecartees.length - 1; i >= 0; i--) {
        if (ecartees[i].json === json) { ecartees[i].stockage.effacer(); ecartees.splice(i, 1); }
      }
    },
    surConflit: (brouillon) => conflit(brouillon),
    surExpiration: () => app.connexionExpiree(),
    surRefus: (e) => informer({
      titre: "Votre dernière modification n'a pas pu être enregistrée",
      texte: messageErreur(e) + " Elle reste gardée sur cet appareil en attendant."
    }),
    surStatut: (s) => {
      if (s === "hors_ligne" && statutPrecedent !== "hors_ligne") annoncer("Hors ligne : vos modifications sont gardées sur cet appareil. Nouvel essai dans quelques secondes.", { urgent: true });
      if (s === "enregistre" && statutPrecedent === "hors_ligne") annoncer("Connexion retrouvée : tout est enregistré.");
      statutPrecedent = s;
      if (app.haut) app.haut.maj();
    },
    stockage
  });
  file.marquerEnregistre(etat.json());
  app.file = file;
  app.publicationEnCours = () => publicationEnCours;

  /* ----- La charpente ----- */
  const fenetres = h("div", { classe: "ed-fenetres" });
  const annonces = h("div", { classe: "ed-cache", "aria-live": "polite", "aria-atomic": "true" });
  const alertes = h("div", { classe: "ed-cache", "aria-live": "assertive", "aria-atomic": "true" });
  const calque = h("div", { classe: "ed-calque" });
  const bandeau = h("div", { classe: "ed-bandeau", hidden: true });
  const scene = h("div", { classe: "ed-scene", "data-largeur": "ordinateur" });
  const zone = h("main", { classe: "ed-zone", "aria-label": "Votre page" }, bandeau, scene);
  app.haut = creerBarreHaut(app);
  app.panneau = creerPanneau(app);
  const corps = h("div", { classe: "ed-corps" }, zone, app.panneau.element);
  const appEl = h("div", { classe: "ed-app", "data-mode": "edition" }, app.haut.element, corps, calque);
  racine.replaceChildren(appEl, fenetres, annonces, alertes);
  initialiserDialogues({ fenetres, application: appEl, annonces, alertes });

  app.cadre = creerCadre(app, scene);
  app.forme = creerMiseEnForme(app, calque);
  app.barres = creerBarres(app, calque);

  /* La pastille des messages suit la boîte, sur l'onglet et sur « Outils ».
     L'onglet ouvert se redessine ; les autres n'ont rien à en savoir. */
  const majMessages = () => {
    app.panneau.majPastille(app.boite.nonLus);
    app.haut.majMessages(app.boite.nonLus);
    if (app.panneau.onglet() === "messages") app.panneau.reconstruire();
  };
  app.boite.ecouter(majMessages);
  app.panneau.majPastille(app.boite.nonLus);
  app.haut.majMessages(app.boite.nonLus);

  /* ----- Ce que l'état change ----- */
  etat.ecouter((evt) => {
    // Annuler (ou rétablir) par-dessus une version chargée après un conflit
    // remplace le travail d'un autre appareil : le serveur le met de côté.
    if (evt.type === "structure" && evt.ecrase) file.ecraserAuProchainEnvoi(true);
    if (evt.type === "texte" || evt.type === "structure") file.planifier();
    if (evt.type === "texte") {
      app.cadre.texteModifie(evt.chemin, evt.valeur, evt.origine);
      app.panneau.majNoms();
      app.haut.maj();
      app.barres.repositionner();
    } else if (evt.type === "structure") {
      // Annuler, rétablir, remplacer : la page DOIT montrer le nouvel
      // état, même si un champ a le focus.
      app.cadre.rafraichir({ forcer: evt.origine === "annulation" || evt.origine === "retablissement" || evt.origine === "serveur" });
      app.panneau.reconstruire();
      app.haut.maj();
    } else if (evt.type === "vue") {
      if (evt.quoi === "bloc") {
        app.cadre.marquerChoix(etat.blocChoisi);
        app.barres.repositionner();
        if (app.panneau.onglet() === "page") app.panneau.reconstruire();
      } else {
        appEl.dataset.mode = etat.mode;
        app.barres.masquerTout();
        app.forme.masquer();
        app.cadre.rafraichir({ forcer: true, enHaut: evt.quoi === "page" });
        app.panneau.reconstruire();
        app.haut.maj();
        majBandeau();
      }
    } else if (evt.type === "serveur") {
      app.haut.maj();
      // Une publication ajoute une version : la liste ouverte doit la montrer.
      if (evt.quoi === "publie" && app.panneau.onglet() === "versions") app.panneau.reconstruire();
    }
  });

  /* ----- Les gestes ----- */

  /* Toute transformation passe par ici : un refus expliqué s'affiche, une
     vraie erreur remonte. */
  app.executer = (fn, { annonce = null } = {}) => {
    try {
      const r = etat.transformer(fn);
      if (annonce) annoncer(annonce);
      return r;
    } catch (e) {
      if (e instanceof Op.Refus) {
        app.signaler(e.message, { genre: "erreur" });
        return undefined;
      }
      throw e;
    }
  };

  app.allerA = (pageId) => {
    if (etat.allerA(pageId)) annoncer("Page « " + nomDePage(etat.contenuAffiche(), pageId) + " » affichée.");
  };

  /* Sous 900 px, le panneau est un tiroir qui couvre presque toute la page :
     un geste fait pour MONTRER quelque chose sur la page (« Voir sur la
     page », le nom d'une section ou d'un élément dans le panneau) faisait
     défiler la page derrière lui, et rien ne se voyait (relecture du
     3 octobre 2026). Ces gestes ferment d'abord le tiroir ; « Outils » le
     rouvre là où on l'a laissé. Les gestes qui travaillent DANS le panneau
     (monter, ajouter, régler) le laissent ouvert.

     ⚠️ Toucher le NOM d'une section dans le panneau n'en fait pas partie :
     ce geste déplie ses réglages, dans le panneau. Le fermer obligeait à
     rouvrir « Outils » pour régler la section qu'on venait de choisir
     (contrôle du 3 octobre 2026). Sous 900 px, on ne fait donc pas défiler
     la page cachée : seul « Voir sur la page » la montre. */
  function degagerLaPage() {
    if (app.panneau.estTiroir()) app.panneau.fermerTiroir();
  }

  app.choisirBloc = (id, { defiler = false, depuis = null } = {}) => {
    etat.choisirBloc(id);
    if (defiler && id) {
      if (depuis === "panneau" && app.panneau.estTiroir()) return;
      app.cadre.defilerVersBloc(id);
    }
  };

  app.voirBloc = (id) => {
    degagerLaPage();
    app.cadre.defilerVersBloc(id);
  };

  /* Rend `true` si le geste a eu lieu : le panneau oublie la place où il
     comptait rendre le focus quand l'artisan renonce (une confirmation
     refusée). */
  app.actionBloc = async (action, id) => {
    if (etat.mode !== "edition") return false;
    const pageId = etat.pageId;
    const bloc = etat.contenu.blocs[id];
    if (!bloc) return false;
    const nom = nomDuBloc(bloc);
    if (action === "monter" || action === "descendre") {
      if (!app.executer((c) => Op.deplacerBloc(c, pageId, id, action === "monter" ? -1 : 1))) return false;
      app.cadre.defilerVersBloc(id);
      annoncer("Section « " + nom + " » " + (action === "monter" ? "montée." : "descendue."));
      return true;
    }
    if (action === "masquer") {
      // Compté AVANT de masquer, avec l'ancre en vigueur : les liens qui la
      // visent ne mèneront nulle part sur le site. La suppression le disait,
      // le masquage non (relecture du 3 octobre 2026).
      const liens = Op.liensVersBloc(etat.contenu, pageId, id).length;
      const masque = app.executer((c) => Op.basculerMasque(c, id));
      if (masque === undefined) return false;
      // Le masquage ne touche que le brouillon : « vos visiteurs ne la voient
      // plus » était faux tant que rien n'était publié — et c'est quand on
      // cache d'urgence un tarif périmé qu'on le croit sur parole.
      if (masque) {
        // La page des mentions légales qui n'affiche plus rien : elle est
        // obligatoire. Masquer pour faire taire un « [À compléter » la
        // vidait sans un mot (relecture du 3 octobre 2026). Le geste reste
        // permis — « Annuler » le défait.
        const mentionsVides = pageId === PAGE_MENTIONS && Op.etatPageMentions(etat.contenu).vide;
        notifier("Section masquée dans votre brouillon. Vos visiteurs la voient encore : cliquez sur « Publier » pour la retirer du site." +
          (liens ? " Attention : " + compte(liens, "lien du site mène", "liens du site mènent") + " à cette section (menu, boutons ou textes) ; une fois la page publiée, " +
            (liens > 1 ? "ils ne mèneront" : "il ne mènera") + " plus nulle part. Pensez à " + (liens > 1 ? "les" : "le") + " changer ou à " + (liens > 1 ? "les" : "le") + " retirer." : "") +
          (mentionsVides ? " Attention : la page des mentions légales n'affiche plus rien. Une fois publiée, vos visiteurs n'auront plus accès à vos mentions légales, qui sont obligatoires : remplissez-la plutôt que de la masquer." : ""),
          { genre: "info", duree: liens || mentionsVides ? 0 : 9000 });
      } else {
        app.signaler("Section affichée dans votre brouillon : vos visiteurs la verront après la publication.", { genre: "info" });
      }
      return true;
    }
    if (action === "dupliquer") {
      const nouvel = app.executer((c) => Op.dupliquerBloc(c, pageId, id));
      if (!nouvel) return false;
      etat.choisirBloc(nouvel);
      app.cadre.defilerVersBloc(nouvel);
      annoncer("Section dupliquée, juste en dessous.");
      return true;
    }
    if (action === "supprimer") {
      const liens = Op.liensVersBloc(etat.contenu, pageId, id).length;
      const ok = await confirmer({
        titre: "Supprimer la section « " + nom + " » ?",
        texte: "Elle sera retirée de la page, avec son contenu." +
          (liens ? " Attention : " + compte(liens, "lien du site mène", "liens du site mènent") + " à cette section (menu, boutons ou textes) ; " + (liens > 1 ? "ils ne mèneront" : "il ne mènera") + " plus nulle part." : "") +
          " Le bouton « Annuler », en haut, permet de revenir en arrière.",
        oui: "Supprimer la section", danger: true
      });
      if (!(ok && app.executer((c) => Op.supprimerBloc(c, pageId, id)))) return false;
      annoncer("Section supprimée.");
      return true;
    }
    if (action === "reglages") {
      etat.choisirBloc(id);
      app.panneau.montrer("page");
      if (app.panneau.estTiroir()) app.panneau.ouvrirTiroir({ focus: false });
      app.panneau.focaliser("bloc:" + id + ":nom");
      return true;
    }
    return false;
  };

  app.ajouterSection = (type, apres) => {
    const id = app.executer((c) => Op.ajouterBloc(c, etat.pageId, type, apres));
    if (!id) return;
    app.panneau.focaliser("bloc:" + id + ":nom", { avant: () => etat.choisirBloc(id) });
    app.cadre.defilerVersBloc(id);
    annoncer("Section « " + BLOCS[type].nom + " » ajoutée. Cliquez sur ses textes pour les remplacer.");
  };

  app.actionListe = (action, chemin, index) => {
    if (etat.mode !== "edition") return undefined;
    const i = app.executer((c) => Op.operationListe(c, chemin, index, action));
    if (typeof i !== "number") return i;
    const messages = { monter: "Élément monté.", descendre: "Élément descendu.", dupliquer: "Élément dupliqué.", "ajouter-apres": "Élément ajouté.", ajouter: "Élément ajouté.", supprimer: "Élément supprimé. « Annuler » le fait revenir." };
    annoncer(messages[action] || "");
    app.barres.suivre(chemin, i);
    if (action !== "supprimer" && i >= 0) app.montrerElement(chemin, i, { discret: true });
    return i;
  };

  /* Fait défiler la page jusqu'à un élément de liste et le fait briller un
     instant : on voit ce qu'on vient de toucher dans le panneau. */
  app.montrerElement = (chemin, index, { discret = false } = {}) => {
    const doc = app.cadre.document();
    if (!doc) return;
    const el = [...doc.querySelectorAll("[data-liste][data-index]")].find((x) => x.getAttribute("data-liste") === chemin && x.getAttribute("data-index") === String(index));
    if (!el) return;
    // « Montrer sur la page » depuis le panneau : la page doit se voir.
    if (!discret) degagerLaPage();
    if (!discret || el.getBoundingClientRect().bottom < 0 || el.getBoundingClientRect().top > doc.documentElement.clientHeight) {
      el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
    el.setAttribute("data-ed-eclair", "");
    setTimeout(() => el.removeAttribute("data-ed-eclair"), 1600);
  };

  app.ouvrirLien = async (chemin) => {
    if (etat.mode !== "edition") return;
    const res = await ouvrirFenetreLien(app, { chemin });
    if (!res) return;
    const parent = chemin.replace(/\.[^.]+$/, "");
    app.executer((c) => {
      ecrireChemin(c, chemin, res.vers);
      if (res.style) ecrireChemin(c, parent + ".style", res.style);
    });
    annoncer(res.vers ? "Lien enregistré." : "Lien retiré.");
  };

  app.ouvrirPhoto = (chemin) => {
    if (etat.mode !== "edition") return;
    ouvrirMediatheque(app, { chemin }).catch((e) => {
      console.error("Médiathèque :", e);
      app.signaler("La médiathèque n'a pas pu s'ouvrir. Rechargez la page, puis réessayez.", { genre: "erreur" });
    });
  };

  app.renommerAncre = (id, texte) => {
    const r = app.executer((c) => Op.renommerAncre(c, etat.pageId, id, texte));
    if (!r) return;
    app.signaler("Adresse de la section : #" + r.ancre + (r.liens ? " — " + compte(r.liens, "lien suivi", "liens suivis") + "." : "."), { genre: "succes" });
  };

  app.ajouterPage = (nom, { auMenu }) => {
    const r = app.executer((c) => Op.ajouterPage(c, nom, { auMenu }));
    if (!r) return;
    etat.allerA(r.pageId);
    app.panneau.montrer("page");
    app.signaler("La page « " + String(nom).trim() + " » est créée (adresse : /" + r.pageId + ")" +
      (r.auMenu ? " et ajoutée au menu." : r.menuPlein ? ". Le menu a déjà 8 liens : retirez-en un pour l'y ajouter." : "."), { genre: "succes" });
  };

  /* La page des mentions légales (onglet « Site ») : créée depuis le modèle
     du rendu (`pageMentionsLegales`, qui n'écrit rien), insérée comme un
     seul geste — « Annuler » la retire d'un coup —, puis montrée, puisque
     ses « [À compléter …] » se remplissent en cliquant dessus. */
  const aLaPage = (c, id) => Object.prototype.hasOwnProperty.call(c.pages, id);
  app.voirMentionsLegales = () => {
    if (!aLaPage(etat.contenu, PAGE_MENTIONS)) return;
    app.allerA(PAGE_MENTIONS);
    app.panneau.montrer("page");
    degagerLaPage();
  };
  app.ajouterMentionsLegales = () => {
    if (aLaPage(etat.contenu, PAGE_MENTIONS)) { app.voirMentionsLegales(); return; }
    const r = app.executer((c) => Op.ajouterPageModele(c, pageMentionsLegales(c)));
    if (!r) return;
    etat.allerA(r.pageId);
    app.panneau.montrer("page");
    degagerLaPage();
    app.signaler("La page des mentions légales est créée (adresse : /" + r.pageId + "), avec un lien en bas de chaque page. " +
      "Cliquez sur chaque « [À compléter …] » pour y écrire vos informations, puis publiez.", { genre: "succes" });
  };

  /* Rend `true` si la page a été supprimée (voir `actionBloc`). */
  app.supprimerPage = async (pageId) => {
    let bilan;
    try { bilan = Op.analyserSuppressionPage(etat.contenu, pageId); } catch (e) {
      if (e instanceof Op.Refus) { app.signaler(e.message, { genre: "erreur" }); return false; }
      throw e;
    }
    const nom = nomDePage(etat.contenu, pageId);
    const ok = await confirmer({
      titre: "Supprimer la page « " + nom + " » ?",
      texte: "La page et " + (bilan.sections ? compte(bilan.sections, "section", "sections") : "son contenu") + " seront supprimées." +
        (bilan.retires ? " " + compte(bilan.retires, "lien qui y mène sera retiré", "liens qui y mènent seront retirés") + " du menu et du bas de page." : "") +
        (bilan.vides === 1 ? " Un autre bouton qui y mène n'aura plus de lien : il disparaîtra du site jusqu'à ce que vous lui en donniez un." : "") +
        (bilan.vides > 1 ? " " + bilan.vides + " autres boutons qui y mènent n'auront plus de lien : ils disparaîtront du site jusqu'à ce que vous leur en donniez un." : "") +
        (bilan.textes ? " " + compte(bilan.textes, "lien écrit dans vos textes y mène : ses mots redeviendront", "liens écrits dans vos textes y mènent : leurs mots redeviendront") + " du texte simple." : "") +
        // Le lien du bas de page ne vit que tant que la page existe (page.js) :
        // la supprimer le retire de partout, sans autre signe.
        (pageId === PAGE_MENTIONS ? " Les mentions légales sont obligatoires pour un professionnel : sans cette page, le lien « Mentions légales » disparaît du bas de chaque page." : "") +
        " Le bouton « Annuler », en haut, permet de revenir en arrière.",
      oui: "Supprimer la page", danger: true
    });
    if (!(ok && app.executer((c) => Op.supprimerPage(c, pageId)))) return false;
    annoncer("Page supprimée.");
    return true;
  };

  /* Masquer le bouton ne vide plus son texte (`entete.bouton.masque`,
     operations.js) : le libellé survit au rechargement de l'éditeur. */
  app.afficherBoutonEntete = (afficher) => {
    const sansLien = app.executer((c) => Op.afficherBoutonEntete(c, afficher));
    if (sansLien === undefined) return;
    if (!afficher) {
      annoncer("Le bouton de l'en-tête est masqué dans votre brouillon. Son texte est gardé.");
      return;
    }
    annoncer("Le bouton de l'en-tête est de nouveau affiché dans votre brouillon.");
    if (sansLien) app.ouvrirLien("entete.bouton.vers");
  };

  app.retirerLogo = () => {
    app.executer((c) => { c.site.logo = ""; });
    annoncer("Logo retiré : le nom du site s'affiche à sa place.");
  };

  app.annuler = () => {
    if (etat.annuler()) annoncer("Modification annulée.");
  };
  app.retablir = () => {
    if (etat.retablir()) annoncer("Modification rétablie.");
  };

  app.enregistrerMaintenant = async () => {
    const ok = await file.vider();
    annoncer(ok ? "Tout est enregistré." : "L'enregistrement n'a pas pu se faire pour l'instant : vos modifications sont gardées sur cet appareil.");
  };

  /* ----- Aperçu, largeur, tiroir ----- */
  app.basculerApercu = () => {
    if (etat.mode === "version") return;
    etat.changerMode(etat.mode === "apercu" ? "edition" : "apercu");
    annoncer(etat.mode === "apercu" ? "Aperçu : la page telle que la verront vos visiteurs. Les liens fonctionnent." : "Retour à l'édition.");
  };
  app.changerLargeur = (id) => {
    largeur = id;
    scene.dataset.largeur = id;
    app.haut.majLargeur(id);
    requestAnimationFrame(() => app.repositionner());
  };
  app.basculerTiroir = () => {
    if (document.body.classList.contains("ed-tiroir-ouvert")) app.panneau.fermerTiroir();
    else app.panneau.ouvrirTiroir();
  };

  /* Dans l'aperçu (et dans une version), les liens fonctionnent sans
     quitter l'éditeur : une ancre fait défiler, une page du site s'affiche,
     un autre site s'ouvre dans un nouvel onglet. */
  app.suivreLienApercu = (href) => {
    if (href.startsWith("#")) { app.cadre.defilerVersAncre(href.slice(1)); return; }
    if (/^https?:\/\//i.test(href)) { window.open(href, "_blank", "noopener"); return; }
    const m = /^\/([a-z][a-z0-9-]{0,47})?(?:#(.*))?$/.exec(href);
    if (!m) return;
    const page = m[1] || PAGE_ACCUEIL;
    const contenu = etat.contenuAffiche();
    if (!Object.prototype.hasOwnProperty.call(contenu.pages, page)) {
      app.signaler("Ce lien mène à une page qui n'existe pas sur votre site.", { genre: "erreur" });
      return;
    }
    if (page !== etat.pageId) etat.allerA(page);
    app.cadre.defilerVersAncre(m[2] || "");
  };

  /* ----- Le bandeau (aperçu, version) ----- */
  function majBandeau() {
    if (etat.mode === "apercu") {
      bandeau.hidden = false;
      bandeau.replaceChildren(
        h("p", null, h("strong", null, "Aperçu"), " — votre page telle que la verront vos visiteurs. Les liens fonctionnent."),
        bouton({ libelle: "Revenir à l'édition", classe: "ed-bouton--principal", quand: () => app.basculerApercu() }));
    } else if (etat.mode === "version" && etat.version) {
      const v = etat.version;
      bandeau.hidden = false;
      bandeau.replaceChildren(
        h("p", null, "Vous regardez la version du " + dateLongue(v.quand) + (v.par ? " (" + (v.origine === "publication" ? "publiée" : "mise de côté") + " par " + v.par + ")" : "") + ". Elle ne se modifie pas."),
        h("div", { classe: "ed-outils" },
          bouton({ libelle: "Reprendre cette version", classe: "ed-bouton--principal", quand: () => app.reprendreVersion() }),
          bouton({ libelle: "Revenir au brouillon", quand: () => app.revenirAuBrouillon() })));
    } else {
      bandeau.hidden = true;
      bandeau.replaceChildren();
    }
    requestAnimationFrame(() => app.repositionner());
  }

  /* Tout envoyer avant un geste qui touche au serveur (publier, reprendre,
     abandonner). Un échec se DIT, avec ce qu'il faut faire : un bouton qui ne
     fait rien sans un mot est le pire des défauts. Le conflit et la
     connexion expirée ont déjà leur fenêtre ouverte. */
  async function toutEnvoyer(titre) {
    if (await file.vider()) return true;
    const pause = file.enPause();
    if (pause === "refus") {
      await informer({ titre, texte: "Votre dernière modification n'a pas pu être enregistrée. Annulez-la avec le bouton « Annuler », en haut, puis réessayez." });
    } else if (!pause) {
      await informer({ titre, texte: "Vos dernières modifications ne sont pas encore enregistrées. Vérifiez votre connexion à Internet, puis réessayez. (Elles sont gardées sur cet appareil.)" });
    }
    return false;
  }

  /* ----- Publier ----- */
  app.publier = async () => {
    if (publicationEnCours || etat.mode === "version") return;
    publicationEnCours = true;
    app.haut.maj();
    try {
      if (!(await toutEnvoyer("Publication impossible pour l'instant"))) return;
      publicationEnCours = false;
      app.haut.maj();
      if (etat.publie.empreinte && etat.brouillon.empreinte === etat.publie.empreinte) {
        app.signaler("Votre site est déjà à jour : il n'y a rien de nouveau à publier.", { genre: "info" });
        return;
      }
      // Des textes ou des photos d'exemple encore en place, une page des
      // mentions légales qui n'afficherait rien : on PRÉVIENT, sans bloquer
      // (un texte d'exemple peut être gardé exprès). Liste nominative, pour
      // que le client sache où aller. Les phrases viennent d'operations.js
      // (`avertissementPublication`), testées sous Node.
      const avis = Op.avertissementPublication(etat.contenu);
      const avertissement = avis
        ? h("div", { classe: "ed-aide ed-aide--note" },
            avis.intro ? h("p", null, avis.intro) : null,
            avis.lignes.length ? h("ul", null, ...avis.lignes.map((l) => h("li", null, l))) : null,
            avis.mentions ? h("p", null, avis.mentions) : null)
        : null;
      const oui = await confirmer({
        titre: "Publier vos modifications ?",
        texte: "Vos modifications seront visibles par tous vos visiteurs d'ici une minute.",
        corps: avertissement,
        oui: avis ? "Publier quand même" : "Publier"
      });
      if (!oui) return;
      publicationEnCours = true;
      app.haut.maj();
      if (file.enAttente() && !(await file.vider())) return;
      const rep = await api.publier(etat.brouillon.revision);
      if (rep.publie) etat.majPublie(rep.publie);
      if (rep.inchange) app.signaler("Votre site était déjà à jour : rien n'a changé.", { genre: "info" });
      // notifier() annonce lui-même son message. Un annoncer() de plus, sans
      // condition, faisait entendre « C'est en ligne. » à la place de « déjà
      // à jour » (contrôle du 3 octobre 2026).
      else notifier("C'est en ligne.", { lien: { href: etat.site.adresse || "/", texte: "Voir le site" }, genre: "succes" });
    } catch (e) {
      if (e && e.statut === 409) conflit(e.donnees && e.donnees.brouillon, { publication: true });
      else if (e && e.statut === 401) app.connexionExpiree();
      // Le titre ne répète pas la phrase du serveur (« La publication n'a pas
      // pu se faire… ») : relecture du 3 octobre 2026.
      else await informer({ titre: "Publication impossible pour l'instant", texte: messageErreur(e) });
    } finally {
      publicationEnCours = false;
      app.haut.maj();
    }
  };

  /* ----- Conflit : modifié ailleurs ----- */
  async function conflit(brouillonServeur, { publication = false } = {}) {
    if (conflitOuvert) return;
    conflitOuvert = true;
    try {
      let b = brouillonServeur && typeof brouillonServeur === "object" ? brouillonServeur : null;
      if (!b) {
        try { b = (await api.etat()).brouillon; } catch { b = null; }
      }
      if (!b) {
        await informer({ titre: "Ce brouillon a été modifié ailleurs", texte: "Rechargez la page pour voir la dernière version. Vos modifications sont gardées sur cet appareil et vous seront proposées." });
        return;
      }
      const qui = [b.modifie_par ? "par " + b.modifie_par : "", typeof b.modifie_le === "number" ? momentLisible(b.modifie_le) : ""].filter(Boolean).join(", ");
      /* Aucun des deux choix ne perd quoi que ce soit, et chaque phrase dit
         où va ce qui est remplacé (relecture du 3 octobre 2026 : « Garder »
         effaçait pour toujours le travail de l'autre appareil pendant que
         l'option voisine promettait qu'on pouvait tout récupérer). */
      const choix = await ouvrirFenetre({
        titre: "Ce brouillon a été modifié ailleurs",
        texte: "Ce brouillon a été modifié ailleurs" + (qui ? " (" + qui + ")" : "") + " — dans un autre onglet ou sur un autre appareil — pendant que vous travailliez ici.",
        corps: h("ul", { classe: "ed-liste-choix" },
          h("li", null, h("strong", null, "Charger la dernière version"), " : vous verrez ces autres modifications. Les vôtres restent gardées sur cet appareil : le bouton « Annuler » vous les rend."),
          h("li", null, h("strong", null, "Garder mes modifications"), " : votre version remplace l'autre, qui est d'abord mise de côté dans l'onglet « Versions ».")),
        role: "alertdialog",
        actions: [
          { libelle: "Charger la dernière version", valeur: "charger", style: "secondaire" },
          { libelle: "Garder mes modifications", valeur: "garder", style: "principal" }
        ]
      }).promesse;
      if (choix === "charger") {
        if (etat.mode === "version") etat.changerMode("edition");
        // Ce qu'on avait à l'écran n'existe plus que dans la pile
        // d'annulation, en mémoire : la file allait effacer la copie de
        // l'appareil dès l'envoi suivant (relecture du 3 octobre 2026). Une
        // copie à part, que la file ne touche pas, le garde ; elle est
        // proposée au prochain démarrage, et s'efface d'elle-même si une
        // annulation le renvoie au serveur.
        mettreDeCoteSurAppareil(b);
        etat.remplacerBrouillon(b, { ailleurs: true });
        file.ecraserAuProchainEnvoi(false);
        file.marquerEnregistre(etat.json());
        file.reprendre();
        app.signaler("La dernière version est chargée. Le bouton « Annuler » vous rend vos modifications." +
          (publication ? " Rien n'a été publié : vérifiez la page, puis cliquez sur « Publier »." : ""), { genre: "info" });
      } else {
        etat.majBrouillon({ revision: b.revision, empreinte: b.empreinte, modifie_le: b.modifie_le, modifie_par: b.modifie_par });
        // Le contenu affiché DOIT repartir, même s'il était déjà enregistré
        // avant le conflit : c'est lui qu'on garde, et c'est lui qu'on publiera.
        // Et le serveur met d'abord de côté le brouillon qu'il remplace.
        file.ecraserAuProchainEnvoi(true);
        file.marquerEnregistre(null);
        file.reprendre();
        app.signaler("Vos modifications sont gardées. L'autre version est mise de côté dans l'onglet « Versions »." +
          (publication ? " Rien n'a encore été publié : cliquez de nouveau sur « Publier »." : ""), { genre: "info" });
      }
    } finally {
      conflitOuvert = false;
    }
  }

  /* Rien à mettre de côté si l'écran montre déjà ce que le serveur a : une
     copie de son propre brouillon serait proposée plus tard comme des
     « modifications écartées » qui n'en sont pas. */
  function mettreDeCoteSurAppareil(brouillonServeur) {
    const json = etat.json();
    if (JSON.stringify(normaliser(brouillonServeur && brouillonServeur.contenu)) === json) return;
    if (ecartees.some((x) => x.json === json)) return;
    const st = creerStockage(ls, cleCopie(etat.site.id, onglet) + ":ecartee-" + Date.now() + "-" + ecartees.length);
    if (st.ecrire(chaineCopie(json, etat.brouillon.revision, Date.now(), { ecartee: true }))) ecartees.push({ json, stockage: st });
  }

  /* ----- Connexion expirée ----- */
  app.connexionExpiree = () => {
    if (expirationOuverte) return;
    expirationOuverte = true;
    file.ecrireCopie();
    const lien = h("a", { href: "/admin", classe: "ed-bouton ed-bouton--principal" }, "Me reconnecter");
    lien.addEventListener("click", () => { quitterSansAvertir = true; });
    ouvrirFenetre({
      titre: "Votre connexion a expiré",
      texte: "Votre connexion à l'administration a pris fin (elle dure 30 jours au plus, et se ferme si vous avez déconnecté tous vos appareils). " +
        "Vos dernières modifications sont gardées sur cet appareil : reconnectez-vous, elles vous seront proposées.",
      corps: h("p", null, lien),
      role: "alertdialog"
    });
  };

  /* ----- Versions ----- */
  app.voirVersion = async (id) => {
    try {
      const d = await api.version(id);
      if (!d.version) throw new Error("version absente");
      etat.changerMode("version", d.version);
      annoncer("Vous regardez la version du " + dateLongue(d.version.quand) + ".");
    } catch (e) {
      if (e && e.statut === 401) { app.connexionExpiree(); return; }
      app.signaler(messageErreur(e), { genre: "erreur" });
    }
  };
  app.revenirAuBrouillon = () => {
    etat.changerMode("edition");
    annoncer("Retour à votre brouillon.");
  };
  app.reprendreVersion = async () => {
    const v = etat.version;
    if (!v) return;
    const ok = await confirmer({
      titre: "Reprendre cette version ?",
      texte: "Elle remplacera votre brouillon. Votre brouillon actuel sera d'abord mis de côté dans la liste des versions. Rien n'est publié tant que vous ne cliquez pas sur « Publier ».",
      oui: "Reprendre cette version"
    });
    if (!ok) return;
    await remplacerParLeServeur(() => api.reprendre(v.id, etat.brouillon.revision),
      "Cette version est maintenant votre brouillon. Cliquez sur « Publier » pour la mettre en ligne.");
  };
  app.abandonner = async () => {
    const ok = await confirmer({
      titre: "Abandonner vos modifications non publiées ?",
      texte: "Votre brouillon reprendra le contenu actuellement en ligne. Vos modifications ne sont pas perdues : elles sont mises de côté dans la liste des versions.",
      oui: "Abandonner mes modifications", danger: true
    });
    if (!ok) return;
    await remplacerParLeServeur(() => api.abandonner(etat.brouillon.revision),
      "Votre brouillon est revenu au contenu en ligne. Vos modifications sont dans la liste des versions.");
  };
  async function remplacerParLeServeur(appel, message) {
    if (!(await toutEnvoyer("Impossible pour l'instant"))) return;
    try {
      const rep = await appel();
      if (etat.mode !== "edition") etat.changerMode("edition");
      etat.remplacerBrouillon(rep.brouillon);
      file.marquerEnregistre(etat.json());
      app.signaler(message, { genre: "succes" });
      app.panneau.reconstruire({ forcer: true });
    } catch (e) {
      if (e && e.statut === 409) conflit(e.donnees && e.donnees.brouillon);
      else if (e && e.statut === 401) app.connexionExpiree();
      else await informer({ titre: "L'opération n'a pas abouti", texte: messageErreur(e) });
    }
  }

  /* ----- Compte ----- */
  app.surDeconnexion = async (ev, formulaire) => {
    ev.preventDefault();
    const ok = await file.vider();
    if (!ok && file.enAttente()) {
      const quandMeme = await confirmer({
        titre: "Vos dernières modifications ne sont pas enregistrées",
        texte: "Elles restent gardées sur cet appareil et vous seront proposées à votre prochaine connexion ici. Se déconnecter quand même ?",
        oui: "Me déconnecter quand même"
      });
      if (!quandMeme) return;
      file.ecrireCopie();
    }
    quitterSansAvertir = true;
    formulaire.submit();
  };
  app.deconnecterPartout = async () => {
    const ok = await confirmer({
      titre: "Déconnecter tous vos appareils ?",
      texte: "Vous serez déconnecté partout, y compris ici. Pour revenir, il faudra demander un nouveau lien de connexion par e-mail.",
      oui: "Tout déconnecter", danger: true
    });
    if (!ok) return;
    await file.vider();
    try {
      await api.deconnecterPartout();
    } catch (e) {
      if (!(e && e.statut === 401)) { await informer({ titre: "La déconnexion n'a pas abouti", texte: messageErreur(e) }); return; }
    }
    quitterSansAvertir = true;
    location.assign("/admin");
  };

  /* ----- Le cadre prévient ----- */
  app.apresRenduCadre = () => {
    app.barres.repositionner();
    const champ = app.cadre.champActif();
    if (!champ) app.forme.masquer();
  };
  app.cadreEnPanne = (e) => {
    console.error("Cadre de l'éditeur :", e);
    scene.replaceChildren(h("div", { classe: "ed-panne", role: "alert" },
      h("p", null, "L'aperçu de votre page n'a pas pu s'afficher."),
      h("p", null, "Rechargez la page. Si cela se reproduit, prévenez l'atelier."),
      h("button", { type: "button", classe: "ed-bouton ed-bouton--principal", quand: { click: () => location.reload() } }, "Recharger la page")));
  };
  app.surFocusCadre = (el) => {
    if (!el || !el.closest) return;
    dernierFocusCadre = el;
    const champ = el.closest("[data-edit]");
    if (champ && champ.hasAttribute("data-edit-riche") && etat.mode === "edition") app.forme.afficher(champ);
    else app.forme.masquer();
    app.barres.focus(el);
    const section = el.closest("section[data-bloc]");
    if (section && etat.mode === "edition") etat.choisirBloc(section.getAttribute("data-bloc"));
  };
  app.surSortieCadre = () => {
    if (app.forme.contientFocus()) return;
    const champ = app.cadre.champActif();
    if (!champ || !champ.hasAttribute("data-edit-riche")) app.forme.masquer();
    if (!app.cadre.document() || !app.cadre.document().hasFocus()) app.barres.sortieFocus();
  };
  app.surSurvolCadre = (cible) => app.barres.survoler(cible);
  app.quitterCadre = () => app.barres.quitterCadre();
  app.surSelectionCadre = () => app.forme.surSelection();
  app.repositionner = () => {
    app.forme.repositionner();
    app.barres.repositionner();
  };
  app.allerAuxOutils = () => {
    if (app.forme.focaliser()) return;
    if (app.barres.focaliser()) return;
    annoncer("Pas d'outil ici. Tous les outils sont aussi dans le panneau « Outils ».");
  };
  app.revenirAuCadre = () => {
    const el = dernierFocusCadre && dernierFocusCadre.isConnected ? dernierFocusCadre : null;
    if (el) {
      app.cadre.fenetre().focus();
      el.focus({ preventScroll: true });
    } else {
      app.cadre.element.focus();
    }
  };

  /* ----- Le clavier, partout ----- */
  const saisieTexte = (t) => !!t && (t.isContentEditable || t.matches?.("textarea") ||
    (t.matches?.("input") && /^(text|email|tel|url|search|number|password)$/.test(t.type)));
  document.addEventListener("keydown", (e) => {
    if (fenetreOuverte()) return;
    const mod = e.metaKey || e.ctrlKey;
    const cle = typeof e.key === "string" ? e.key.toLowerCase() : "";
    if (mod && !e.altKey && cle === "s") { e.preventDefault(); app.enregistrerMaintenant(); return; }
    if (e.altKey && e.key === "F10") { e.preventDefault(); app.allerAuxOutils(); return; }
    if (mod && !e.altKey && (cle === "z" || cle === "y") && !saisieTexte(e.target)) {
      e.preventDefault();
      if (cle === "y" || e.shiftKey) app.retablir(); else app.annuler();
    }
  });

  /* ----- Ne rien perdre en partant ----- */
  window.addEventListener("beforeunload", (e) => {
    if (quitterSansAvertir || !file.enAttente()) return;
    file.ecrireCopie();
    e.preventDefault();
    e.returnValue = "";
  });
  /* La pastille des messages se remet à jour toute seule : au retour sur
     l'onglet du navigateur (la page redevient visible, ou la fenêtre
     reprend la main après une autre application), et toutes les deux
     minutes au plus tant que l'éditeur est affiché. La décision vit dans
     messages.js (`fautRafraichir`), testée sous Node.
     Relecture du 3 octobre 2026 : seul le retour sur l'onglet, après cinq
     minutes, la rechargeait. Une page restée au premier plan ne reçoit
     jamais `visibilitychange` : deux heures de travail dans l'éditeur, et
     le message arrivé entre-temps restait invisible — sans alerte e-mail
     configurée, la pastille est le seul signal.
     En silence (`discret`) : une erreur se dira dans l'onglet « Messages »,
     et un chargement qui ne change rien ne redessine rien. Un onglet caché
     ne réveille pas le serveur. */
  const verifierMessages = (retour = false) => {
    if (fautRafraichir({ visible: document.visibilityState === "visible", age: app.boite.age(), enCours: app.boite.enCours, retour })) {
      app.boite.charger({ discret: true });
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") file.auDepart();
    else verifierMessages(true);
  });
  // La fenêtre quittée pour une autre application, puis retrouvée. Le
  // focus qui passe dans la page (le cadre) fait aussi perdre le focus à la
  // fenêtre : `hasFocus()` distingue les deux, sans quoi chaque clic dans
  // la page puis dans le panneau compterait pour un retour.
  let fenetreQuittee = false;
  window.addEventListener("blur", () => setTimeout(() => { if (!document.hasFocus()) fenetreQuittee = true; }, 0));
  window.addEventListener("focus", () => {
    if (!fenetreQuittee) return;
    fenetreQuittee = false;
    verifierMessages(true);
  });
  // Le quart du délai : un rechargement tombe entre deux et deux minutes et
  // demie après le précédent, jamais plus tôt.
  setInterval(() => verifierMessages(false), RAFRAICHIR_MESSAGES_MS / 4);
  window.addEventListener("pagehide", () => file.auDepart());
  window.addEventListener("online", () => file.reessayer());
  // Une photo lâchée à côté de la zone prévue ne doit pas remplacer
  // l'éditeur par la photo (et faire quitter la page).
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());
  window.addEventListener("resize", () => app.repositionner());
  // Une erreur imprévue ne doit pas laisser un bouton muet : on le dit, une
  // fois de temps en temps, sans alarmer (tout est enregistré au fil de
  // l'eau).
  let derniereErreur = 0;
  const erreurImprevue = (raison) => {
    // Le navigateur signale ainsi une simple boucle de mise en page, sans
    // conséquence : pas de quoi inquiéter l'artisan.
    if (/ResizeObserver/.test(String(raison && raison.message ? raison.message : raison))) return;
    console.error("Erreur imprévue dans l'éditeur :", raison);
    if (Date.now() - derniereErreur < 30000) return;
    derniereErreur = Date.now();
    app.signaler("Quelque chose n'a pas fonctionné. Si un bouton ne répond plus, rechargez la page : vos modifications sont enregistrées au fur et à mesure.", { genre: "erreur" });
  };
  window.addEventListener("error", (e) => erreurImprevue(e.error || e.message));
  window.addEventListener("unhandledrejection", (e) => erreurImprevue(e.reason));

  app.haut.maj();
  app.haut.majLargeur(largeur);
  app.panneau.montrer("page");
  majBandeau();

  /* ----- Les copies laissées sur cet appareil -----
     Toutes celles du site, quel que soit l'onglet qui les a écrites, la plus
     récente d'abord. Une copie identique au brouillon s'efface sans rien
     demander ; une copie illisible reste (on ne jette pas ce qu'on ne sait
     pas lire) ; les autres sont PROPOSÉES une à une. Une fois une copie
     reprise, les suivantes attendent le prochain démarrage : en reprendre
     deux de suite remplacerait la première par la seconde. */
  const copies = copiesAuDemarrage
    .map((x) => ({ cle: x.cle, copie: analyserCopie(x.chaine, depart.brouillon) }))
    .filter((x) => x.copie && !x.copie.illisible)
    .sort((a, b) => (b.copie.quand || 0) - (a.copie.quand || 0));
  for (const { cle, copie } of copies) {
    const sienne = creerStockage(ls, cle);
    if (copie.identique) { sienne.effacer(); continue; }
    const b = depart.brouillon || {};
    const moment = copie.quand ? " (" + momentLisible(copie.quand) + ")" : "";
    const choix = await ouvrirFenetre({
      titre: copie.ecartee ? "Des modifications ont été écartées" : "Des modifications n'ont pas été enregistrées",
      texte: (copie.ecartee
        ? "Des modifications faites sur cet appareil ont été écartées" + moment + " quand la version modifiée ailleurs a été chargée."
        : "Des modifications faites sur cet appareil" + moment + " n'ont pas pu être envoyées.") +
        " Elles sont toujours là. Voulez-vous les reprendre ? Si vous ne les reprenez pas, elles seront effacées de cet appareil.",
      corps: copie.aChange
        ? h("p", { classe: "ed-aide ed-aide--note" }, "Attention : depuis, le brouillon a été modifié" +
            (b.modifie_par ? " par " + b.modifie_par : "") + (typeof b.modifie_le === "number" ? ", " + momentLisible(b.modifie_le) : "") +
            ". Reprendre les modifications de cet appareil remplacera ces changements : ils seront d'abord mis de côté dans l'onglet « Versions », et le bouton « Annuler » permettra de revenir en arrière.")
        : null,
      role: "alertdialog",
      actions: [
        // « Garder le brouillon enregistré » sonnait comme le choix prudent,
        // et effaçait pour toujours le travail gardé sur l'appareil
        // (relecture du 3 octobre 2026) : le bouton dit ce qu'il fait.
        { libelle: "Ne pas les reprendre (les effacer de cet appareil)", valeur: "serveur", style: "secondaire-danger" },
        { libelle: "Reprendre les modifications de cet appareil", valeur: "copie", style: "principal" }
      ]
    }).promesse;
    if (choix !== "copie") { sienne.effacer(); continue; }
    const repris = JSON.parse(JSON.stringify(copie.contenu));
    // Le brouillon a changé depuis la copie : le remplacer, c'est remplacer
    // le travail d'un autre appareil — le serveur le met de côté d'abord.
    if (copie.aChange) file.ecraserAuProchainEnvoi(true);
    etat.transformer((c) => {
      for (const k of Object.keys(c)) delete c[k];
      Object.assign(c, repris);
    });
    // La copie reprise passe sous la clé de CET onglet avant que l'ancienne
    // ne s'efface : entre les deux, elle n'est jamais nulle part.
    if (file.ecrireCopie() && cle !== cleCopie(etat.site.id, onglet)) sienne.effacer();
    annoncer("Les modifications de cet appareil sont reprises.");
    break;
  }
}

/* L'identifiant de ce chargement de l'éditeur, pour la clé de sa copie
   locale. Tiré au hasard à chaque chargement (et non gardé dans l'onglet) :
   un onglet DUPLIQUÉ par le navigateur recopie le stockage de l'onglet, et
   deux éditeurs auraient de nouveau partagé la même clé. Le démarrage lit
   les copies de tous les onglets : celle d'avant un rechargement est
   retrouvée quand même. */
function identifiantOnglet() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  } catch { /* repli ci-dessous */ }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
