/* =========================================================
   Onglet « Messages » — ce que les visiteurs ont écrit
   =========================================================

   Les messages du formulaire de contact du site (socle 0.3.0), du plus
   récent au plus ancien. Un message se déplie d'un clic, et se marque lu
   en s'ouvrant ; « Répondre » ouvre la messagerie de l'artisan avec
   l'adresse du visiteur et un objet tout prêt ; « Supprimer » demande
   confirmation, parce que c'est définitif.

   ⚠️ Chaque texte de cet onglet a été écrit par un VISITEUR — n'importe
   qui peut remplir un formulaire. Tout passe par `h` (dom.js), donc par
   des nœuds de texte : jamais `innerHTML`. Les liens « Répondre » et
   d'appel sont fabriqués par messages.js, qui encode ce qu'il reprend.

   La logique (liste, lu / non lu, compte des non-lus) vit dans
   messages.js, testée sous Node ; ce fichier ne fait que dessiner. */

import { h, bouton, icone, idUnique } from "./dom.js";
import { groupe, aide, outils } from "./panneau-commun.js";
import { texteBrut } from "/rendu/outils.js";
import { nomDePage } from "./liens.js";
import { messageErreur, momentLisible, compte } from "./textes.js";
import { confirmer } from "./dialogues.js";
import {
  apercuMessage, nomVisiteur, lienRepondre, lienAppel, phraseSansMessage, resumeMessages,
  phraseListeCoupee, phraseEchecChargement, LIBELLE_PLUS_ANCIENS
} from "./messages.js";

const aEnPropre = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);

export function construireMessages(app, ctx) {
  const boite = app.boite;
  const contenu = app.etat.contenu;
  const nomSite = texteBrut(contenu && contenu.site ? contenu.site.nom : "");
  const corps = [h("h2", { classe: "ed-panneau__titre" }, "Messages")];

  /* Un chargement demandé depuis cet onglet qui échoue se DIT aux lecteurs
     d'écran, par `annoncer` — la note posée à l'écran, insérée avec son
     texte, n'est pas lue de façon sûre (dialogues.js).
     Relecture du 3 octobre 2026 : « Actualiser » sans réseau faisait
     entendre « Chargement des messages… », puis plus rien ; on croyait sa
     liste à jour. Une connexion expirée a déjà sa fenêtre (`zone`). Un
     échec arrivé après qu'on a quitté l'onglet ne s'annonce pas : il ne
     parlerait plus de ce qu'on regarde. */
  const direEchecChargement = (r) => {
    if (r.ok || (r.erreur && r.erreur.statut === 401) || app.panneau.onglet() !== "messages") return false;
    app.annoncer(phraseEchecChargement(r.erreur, { listeDejaLa: boite.liste !== null }), { urgent: true });
    return true;
  };

  /* La liste se recharge à chaque ARRIVÉE sur l'onglet — c'est en y
     revenant qu'on s'attend à voir le dernier message —, et quand une
     reconstruction la trouve trop ancienne. Un chargement de la minuterie
     déjà en route est rejoint : il devient visible (« Chargement… ») et
     redessine l'onglet en arrivant. Le chargement prévient la boîte en
     ARRIVANT : le panneau se reconstruit alors, avec la liste. */
  if (ctx.arrivee || boite.doitCharger()) boite.charger().then(direEchecChargement);

  /* Une erreur du serveur, dite en clair. Une connexion expirée ouvre sa
     fenêtre (une seule fois, application.js), comme partout ailleurs. */
  const direErreur = (e, avant = "") => {
    if (e && e.statut === 401) { app.connexionExpiree(); return; }
    app.signaler(avant + messageErreur(e), { genre: "erreur" });
  };

  async function actualiser() {
    ctx.viser("messages:actualiser");
    app.annoncer("Chargement des messages…");
    const r = await boite.charger();
    if (r.ok) app.annoncer("Liste à jour. " + resumeMessages(boite.liste, boite));
    else direEchecChargement(r);
  }

  async function plusAnciens() {
    ctx.viser("messages:plus-anciens");
    app.annoncer("Chargement des messages plus anciens…");
    const r = await boite.chargerPlusAnciens();
    if (!r.ok) { ctx.viser(null); direErreur(r.erreur, "Les messages plus anciens n'ont pas pu être chargés. "); return; }
    if (r.ajoutes) {
      // Le focus va au premier message ajouté : on lit la suite là où elle
      // commence, sans repartir du haut de la liste.
      ctx.viser("message:" + r.premier);
      ctx.reconstruire();
      app.annoncer(compte(r.ajoutes, "message plus ancien ajouté", "messages plus anciens ajoutés") + " à la liste.");
    } else {
      app.annoncer("Il n'y a pas d'autre message à afficher pour l'instant.");
    }
  }

  // « Chargement… » se lit à l'écran ; aux lecteurs d'écran, c'est
  // `annoncer` qui le dit (une région insérée avec son texte n'est pas lue
  // de façon sûre : dialogues.js). La minuterie (application.js) recharge
  // sans rien afficher : elle passe toutes les deux minutes.
  corps.push(groupe(null,
    aide("Les messages que vos visiteurs envoient avec le formulaire de contact de votre site. Ils sont effacés au bout d'un an."),
    outils(bouton({ libelle: "Actualiser", icone: "actualiser", quand: actualiser, attributs: { "data-cle": "messages:actualiser" } })),
    boite.chargementAffiche ? aide("Chargement des messages…") : null,
    zone()));
  return corps;

  function zone() {
    const liste = boite.liste;
    const erreur = boite.erreur;
    if (erreur && erreur.statut === 401) app.connexionExpiree();
    if (liste === null) {
      if (!erreur || boite.enCours) return null;
      return h("div", { classe: "ed-chargement-zone" },
        h("p", { classe: "ed-erreur" }, phraseEchecChargement(erreur, { listeDejaLa: false })),
        bouton({ libelle: "Réessayer", quand: actualiser, attributs: { "data-cle": "messages:reessayer" } }));
    }
    const morceaux = [];
    // Une liste déjà là, mais qui n'a pas pu se mettre à jour : on la
    // garde, et on le dit.
    if (erreur && !boite.enCours) {
      morceaux.push(h("p", { classe: "ed-aide ed-aide--note" }, phraseEchecChargement(erreur, { listeDejaLa: true })));
    }
    if (!liste.length && !boite.tronquee) {
      const vide = phraseSansMessage(contenu);
      morceaux.push(h("p", { classe: "ed-aide" }, vide.texte));
      if (vide.cible) {
        const cible = vide.cible;
        morceaux.push(bouton({
          libelle: "Ouvrir la section « " + cible.nom + " »", icone: "reglages",
          attributs: { "data-cle": "messages:section" },
          quand: () => {
            app.allerA(cible.pageId);
            app.etat.choisirBloc(cible.id);
            app.panneau.montrer("page");
            app.panneau.focaliser("bloc:" + cible.id + ":nom");
          }
        }));
      }
      return morceaux;
    }
    morceaux.push(h("p", { classe: "ed-aide" }, resumeMessages(liste, boite)));
    /* La liste ne montre pas tout (200 par page) : on le DIT, avec où
       trouver le reste. Sans cette phrase, le 201e message n'était nulle
       part à l'écran (relecture du 3 octobre 2026). */
    const coupee = boite.tronquee;
    const peutCharger = coupee && boite.peutChargerPlusAnciens;
    if (coupee) morceaux.push(h("p", { classe: "ed-aide ed-aide--note" }, phraseListeCoupee({ affiches: liste.length, total: boite.total, peutCharger })));
    if (liste.length) {
      const ul = h("ul", { classe: "ed-messages", "aria-label": "Vos messages" });
      liste.forEach((m, i) => ul.append(ligne(m, liste[i + 1] || liste[i - 1] || null)));
      morceaux.push(ul);
    }
    if (peutCharger) {
      morceaux.push(outils(bouton({ libelle: LIBELLE_PLUS_ANCIENS, quand: plusAnciens, attributs: { "data-cle": "messages:plus-anciens" } })));
    }
    return morceaux;
  }

  function ligne(m, voisin) {
    const ouvert = boite.estOuvert(m.id);
    const cle = "message:" + m.id;
    const idCorps = idUnique("message");
    const nom = nomVisiteur(m.nom);
    const date = momentLisible(m.quand);
    const tete = h("button", {
      type: "button", classe: "ed-message__tete", "data-cle": cle,
      "aria-expanded": String(ouvert), "aria-controls": ouvert ? idCorps : null,
      quand: {
        click: async () => {
          ctx.viser(cle);
          if (boite.estOuvert(m.id)) { boite.fermer(m.id); return; }
          const r = await boite.ouvrir(m.id);
          if (r.introuvable) app.signaler("Ce message avait déjà été supprimé, depuis un autre appareil peut-être.", { genre: "info" });
          else if (!r.ok) direErreur(r.erreur, "Ce message n'a pas pu être marqué comme lu. ");
        }
      }
    },
    icone("chevron"),
    h("span", { classe: "ed-message__resume" },
      h("span", { classe: "ed-message__ligne" },
        // <bdi> : un nom écrit de droite à gauche (ou piégé pour l'être)
        // n'emporte pas la suite de la ligne avec lui.
        h("bdi", { classe: "ed-message__nom" }, nom),
        m.lu ? null : h("span", { classe: "ed-badge ed-badge--neutre" }, "Non lu")),
      date ? h("span", { classe: "ed-message__date" }, date) : null,
      ouvert ? null : h("span", { classe: "ed-message__apercu" }, apercuMessage(m.message))));

    const li = h("li", { classe: "ed-message" + (m.lu ? "" : " est-non-lu") + (ouvert ? " est-ouvert" : "") }, tete);
    if (ouvert) li.append(details(m, cle, idCorps, nom, voisin));
    return li;
  }

  function details(m, cle, idCorps, nom, voisin) {
    const repondre = lienRepondre(m.email, nomSite);
    const appel = lienAppel(m.telephone);
    const page = m.page && aEnPropre(contenu.pages, m.page) ? nomDePage(contenu, m.page) : "";
    const lignes = [
      h("dt", null, "E-mail"), h("dd", null, m.email ? h("bdi", null, m.email) : "Non indiquée")
    ];
    if (m.telephone) lignes.push(h("dt", null, "Téléphone"), h("dd", null, appel ? h("a", { href: appel }, h("bdi", null, m.telephone)) : h("bdi", null, m.telephone)));
    if (page) lignes.push(h("dt", null, "Envoyé depuis"), h("dd", null, "la page « " + page + " »"));

    const nonLu = bouton({
      libelle: "Marquer comme non lu", attributs: { "data-cle": cle + ":non-lu" },
      quand: async () => {
        ctx.viser(cle);
        const r = await boite.marquerNonLu(m.id);
        if (r.ok && !r.introuvable) app.annoncer("Message de « " + nom + " » marqué comme non lu.");
        else if (r.introuvable) app.signaler("Ce message avait déjà été supprimé, depuis un autre appareil peut-être.", { genre: "info" });
        else { ctx.viser(null); direErreur(r.erreur, "Le message n'a pas pu être marqué comme non lu. "); }
      }
    });
    const supprimer = bouton({
      libelle: "Supprimer", icone: "supprimer", classe: "ed-bouton--discret-danger",
      attributs: { "data-cle": cle + ":supprimer", "aria-label": "Supprimer le message de « " + nom + " »" },
      quand: async () => {
        const ok = await confirmer({
          titre: "Supprimer le message de « " + nom + " » ?",
          texte: "Il sera effacé pour de bon : on ne pourra pas le récupérer, ni ses coordonnées. Si vous devez encore répondre, faites-le avant.",
          oui: "Supprimer le message", danger: true
        });
        if (!ok) return;
        // Le focus ira au message voisin, ou au bouton « Actualiser ».
        ctx.viser(voisin ? "message:" + voisin.id : "messages:actualiser");
        const r = await boite.supprimer(m.id);
        if (r.ok) app.annoncer("Message supprimé.");
        else { ctx.viser(null); direErreur(r.erreur, "Le message n'a pas été supprimé. "); }
      }
    });

    return h("div", { classe: "ed-message__corps", id: idCorps },
      // `dir="auto"` : un message écrit de droite à gauche s'affiche dans son
      // sens, sans retourner ce qui l'entoure. `pre-wrap` (editeur.css) garde
      // ses retours à la ligne.
      h("p", { classe: "ed-message__texte", dir: "auto" }, m.message || "(Message vide)"),
      h("dl", { classe: "ed-message__coordonnees" }, ...lignes),
      outils(
        repondre ? h("a", { classe: "ed-bouton ed-bouton--principal", href: repondre, "data-cle": cle + ":repondre", "aria-label": "Répondre à « " + nom + " » par e-mail" }, icone("repondre"), "Répondre") : null,
        nonLu,
        supprimer),
      repondre ? null : aide(m.telephone
        ? "Cette adresse e-mail ne semble pas valable : répondez plutôt par téléphone."
        : "Cette adresse e-mail ne semble pas valable : il n'est pas possible d'y répondre d'ici."));
  }
}
