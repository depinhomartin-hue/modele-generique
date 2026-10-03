/* =========================================================
   Onglets « Versions » et « Compte »
   =========================================================

   Versions : chaque publication est gardée, et chaque brouillon remplacé
   est d'abord mis de côté par le serveur (« sauvegarde »). On peut en
   regarder une, la reprendre (elle devient le brouillon, rien n'est publié)
   ou abandonner les modifications non publiées. Rien ne se perd : ce qui
   est remplacé part dans la liste.

   Compte : l'adresse connectée, la déconnexion (un vrai formulaire POST,
   qui fonctionne même si le script plantait), « Déconnecter tous mes
   appareils », la copie du contenu, et le journal des dernières
   opérations, en phrases. */

import { h, bouton } from "./dom.js";
import { groupe, aide } from "./panneau-commun.js";
import { phraseVersion, phraseJournal, detailJournal, messageErreur } from "./textes.js";

/* Une liste qui se charge : « Chargement… », puis la liste, ou l'erreur
   avec « Réessayer ». Jamais un écran vide sans explication.

   Seule la phrase d'ÉTAT est une région vivante (`role="status"`), jamais
   la liste. Relecture du 3 octobre 2026 : la liste entière était posée
   dans une zone `aria-live`, et chaque ouverture de l'onglet — chaque
   « Voir » aussi, qui le reconstruit — faisait lire d'affilée jusqu'à cent
   « Publiée le … par … » (vingt lignes pour le journal). La phrase dit
   « Chargement… » puis se tait : la liste est là, on la parcourt. Une
   erreur, elle, s'annonce (`role="alert"`). */
function chargement(app, charger, dessiner, libelle) {
  const etatChargement = aide("", { role: "status" });
  const zone = h("div", { classe: "ed-chargement-zone" });
  const lancer = () => {
    etatChargement.textContent = "Chargement " + libelle + "…";
    zone.replaceChildren();
    charger().then((d) => {
      zone.replaceChildren(...[].concat(dessiner(d)));
      etatChargement.textContent = "";
    }).catch((e) => {
      etatChargement.textContent = "";
      if (e && e.statut === 401) { app.connexionExpiree(); return; }
      zone.replaceChildren(
        h("p", { classe: "ed-erreur", role: "alert" }, messageErreur(e)),
        bouton({ libelle: "Réessayer", quand: lancer }));
    });
  };
  lancer();
  // Une seule enveloppe : la phrase vide ne prend aucune place.
  return h("div", null, etatChargement, zone);
}

export function construireVersions(app) {
  const corps = [h("h2", { classe: "ed-panneau__titre" }, "Versions")];
  const e = app.etat;
  const enLigne = e.publie.empreinte;
  const differe = app.file.enAttente() || !enLigne || e.brouillon.empreinte !== enLigne;

  if (e.mode === "version" && e.version) {
    corps.push(groupe(null,
      h("p", { classe: "ed-aide ed-aide--note" }, "Vous regardez une ancienne version. Elle ne se modifie pas."),
      h("div", { classe: "ed-outils ed-outils--colonne" },
        bouton({ libelle: "Reprendre cette version", classe: "ed-bouton--principal", quand: () => app.reprendreVersion(), attributs: { "data-cle": "version:reprendre" } }),
        bouton({ libelle: "Revenir au brouillon", quand: () => app.revenirAuBrouillon(), attributs: { "data-cle": "version:revenir" } }))));
  }

  corps.push(groupe("Votre brouillon",
    aide(!enLigne
      ? "Votre site n'a encore jamais été publié depuis l'éditeur : vos visiteurs voient le site livré par l'atelier."
      : differe ? "Votre brouillon contient des modifications qui ne sont pas encore en ligne." : "Votre brouillon est identique au site en ligne."),
    enLigne && differe
      ? bouton({ libelle: "Abandonner mes modifications non publiées", classe: "ed-bouton--discret-danger", quand: () => app.abandonner(), attributs: { "data-cle": "versions:abandonner" } })
      : null));

  corps.push(groupe("Versions enregistrées",
    chargement(app, () => app.api.versions(), (d) => {
      const versions = Array.isArray(d.versions) ? d.versions : [];
      if (!versions.length) return aide("Aucune version pour l'instant. Chaque publication en ajoutera une.");
      const ul = h("ul", { classe: "ed-versions" });
      for (const v of versions) {
        const vue = e.mode === "version" && e.version && e.version.id === v.id;
        ul.append(h("li", { classe: "ed-version" + (vue ? " est-choisie" : "") },
          h("span", { classe: "ed-version__texte" }, phraseVersion(v)),
          v.active ? h("span", { classe: "ed-badge ed-badge--succes" }, "En ligne") : null,
          vue
            ? h("span", { classe: "ed-badge ed-badge--neutre" }, "Affichée")
            : bouton({ libelle: "Voir", quand: () => app.voirVersion(v.id), attributs: { "data-cle": "version:" + v.id, "aria-label": "Voir la version : " + phraseVersion(v) } })));
      }
      return [ul, aide("Les 100 dernières versions sont gardées.")];
    }, "des versions")));
  return corps;
}

export function construireCompte(app) {
  const corps = [h("h2", { classe: "ed-panneau__titre" }, "Compte")];
  const email = app.etat.utilisateur && app.etat.utilisateur.email ? app.etat.utilisateur.email : "";

  // Un vrai formulaire : la déconnexion marche même si l'éditeur plantait.
  // Avant de partir, on enregistre ce qui attend (voir application.js).
  const formulaire = h("form", { method: "post", action: "/admin/deconnexion", classe: "ed-formulaire" },
    h("button", { type: "submit", classe: "ed-bouton", "data-cle": "compte:deconnexion" }, "Se déconnecter"));
  formulaire.addEventListener("submit", (ev) => app.surDeconnexion(ev, formulaire));

  corps.push(groupe("Votre connexion",
    h("p", null, "Connecté avec : ", h("strong", null, email || "adresse inconnue")),
    formulaire,
    bouton({ libelle: "Déconnecter tous mes appareils", quand: () => app.deconnecterPartout(), attributs: { "data-cle": "compte:partout" } }),
    aide("Utile si vous vous êtes connecté sur un ordinateur qui n'est pas le vôtre, ou si vous avez perdu votre téléphone.")));

  corps.push(groupe("Une copie de votre site",
    h("a", { classe: "ed-bouton", href: "/admin/api/export", download: "", "data-cle": "compte:export" }, "Télécharger une copie de mon contenu"),
    // Depuis le socle 0.3.0, l'export porte aussi les messages reçus : ce
    // sont les données du client, elles partent avec lui. Et elles disent
    // qui a écrit quoi : « en lieu sûr » n'est pas une formule.
    // « Les 2 000 plus récents » : le serveur n'en exporte pas davantage
    // (atelier-coeur.js, MESSAGES_EXPORTES) ; promettre « les messages »
    // tout court aurait été faux au-delà (contrôle du 3 octobre 2026).
    aide("Un fichier avec les textes de votre site tel qu'il est en ligne, la liste de vos photos et les messages de vos visiteurs (les 2 000 plus récents). Il contient leurs coordonnées : gardez-le en lieu sûr.")));

  corps.push(groupe("Dernières opérations",
    chargement(app, () => app.api.journal(), (d) => {
      const evenements = (Array.isArray(d.evenements) ? d.evenements : []).slice(0, 20);
      if (!evenements.length) return aide("Rien pour l'instant.");
      // La cause d'un e-mail qui n'est pas parti, repliée : elle sert à
      // l'atelier (textes.js, `detailJournal`).
      return h("ul", { classe: "ed-journal" }, ...evenements.map((ev) => {
        const detail = detailJournal(ev);
        return h("li", null, phraseJournal(ev),
          detail ? h("details", { classe: "ed-journal__detail" }, h("summary", null, "Détail pour l'atelier"), h("p", null, detail)) : null);
      }));
    }, "du journal")));
  return corps;
}
