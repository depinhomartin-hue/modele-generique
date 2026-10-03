/* =========================================================
   Onglet « Site » — pages, menu, bouton, logo, pied de page
   =========================================================

   Ce qui est COMMUN à toutes les pages : la liste des pages, le menu de
   l'en-tête, son bouton, le logo, les liens du pied et la description du
   site pour Google. Le texte des liens et du bouton se modifie sur la page
   (en cliquant dessus, dans l'en-tête ou le pied) ; ici, leur ordre et
   leur destination. */

import { h, bouton, idUnique } from "./dom.js";
import { groupe, aide, champTexte, listeEditable } from "./panneau-commun.js";
import { PAGE_ACCUEIL } from "/rendu/page.js";
import { lireChemin } from "/rendu/structure.js";
import { texteBrut, imageSure } from "/rendu/outils.js";
import { listePages, decrireDestination } from "./liens.js";
import { boutonEnteteAffiche, MAX_PAGES } from "./operations.js";

export function construireSite(app, ctx) {
  const c = app.etat.contenu;
  const corps = [h("h2", { classe: "ed-panneau__titre" }, "Votre site")];

  /* ----- Les pages ----- */
  const pages = listePages(c);
  const ul = h("ul", { classe: "ed-elements" });
  for (const p of pages) {
    const affichee = p.id === app.etat.pageId;
    ul.append(h("li", { classe: "ed-element" + (affichee ? " est-choisie" : "") },
      h("div", { classe: "ed-element__ligne" },
        h("span", { classe: "ed-element__nom ed-element__nom--fixe" }, p.nom, h("span", { classe: "ed-adresse" }, p.adresse)),
        h("div", { classe: "ed-outils" },
          affichee
            ? h("span", { classe: "ed-badge ed-badge--neutre" }, "Affichée")
            : bouton({ libelle: "Afficher", quand: () => app.allerA(p.id), attributs: { "data-cle": "page:" + p.id + ":aller", "aria-label": "Afficher la page « " + p.nom + " »" } }),
          p.id === PAGE_ACCUEIL ? null : bouton({
            libelle: "Supprimer la page « " + p.nom + " »", bulle: "Supprimer", icone: "supprimer", seuleIcone: true, classe: "ed-bouton--discret-danger",
            // Clé oubliée si l'artisan renonce : voir panneau-page.js.
            quand: async () => {
              ctx.viser("page:" + PAGE_ACCUEIL + ":aller");
              if (!(await app.supprimerPage(p.id))) ctx.viser(null);
            },
            attributs: { "data-cle": "page:" + p.id + ":supprimer" }
          })))));
  }
  const idNom = idUnique("nouvelle-page");
  const idMenu = idUnique("au-menu");
  const nomPage = h("input", { id: idNom, type: "text", classe: "ed-champ", autocomplete: "off", placeholder: "Par exemple : Nos tarifs", "data-cle": "page:nouvelle" });
  const auMenu = h("input", { id: idMenu, type: "checkbox", coche: true });
  const complet = pages.length >= MAX_PAGES;
  const form = h("form", { classe: "ed-formulaire" },
    h("label", { for: idNom }, "Nom de la nouvelle page"),
    nomPage,
    h("div", { classe: "ed-case" }, auMenu, h("label", { for: idMenu }, "L'ajouter au menu")),
    h("button", { type: "submit", classe: "ed-bouton ed-bouton--principal", disabled: complet, "data-cle": "page:ajouter" }, "Ajouter la page"),
    complet ? aide("Votre site a déjà " + MAX_PAGES + " pages : c'est le maximum.") : null);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    app.ajouterPage(nomPage.value, { auMenu: auMenu.checked });
  });
  corps.push(groupe("Les pages", ul, form));

  /* ----- Le menu ----- */
  const descLien = (el) => aide(decrireDestination(c, el && typeof el.vers === "string" ? el.vers : "", PAGE_ACCUEIL) +
    (el && el.vers ? "" : " : ce lien n'apparaît pas sur le site."));
  const boutonLien = (chemin) => (el, i) => bouton({
    libelle: "Où mène « " + (texteBrut(el && el.texte) || "ce lien") + " » ?", bulle: "Destination", icone: "lien", seuleIcone: true,
    quand: () => app.ouvrirLien(chemin + "." + i + ".vers"), attributs: { "data-cle": "liste:" + chemin + ":" + i + ":lien" }
  });
  const nommerLien = (el, i) => texteBrut(el && el.texte) || "Lien " + (i + 1) + " (sans texte)";
  corps.push(groupe("Le menu",
    aide("Le texte de chaque lien se modifie directement dans le menu, sur la page."),
    listeEditable(app, ctx, "entete.liens", {
      titre: "Liens du menu", nommer: nommerLien, details: descLien, plus: boutonLien("entete.liens"),
      apresAjout: (i) => app.ouvrirLien("entete.liens." + i + ".vers")
    })));

  /* ----- Le bouton de l'en-tête ----- */
  const b = c.entete && c.entete.bouton && typeof c.entete.bouton === "object" ? c.entete.bouton : null;
  const affiche = boutonEnteteAffiche(c);
  // Masqué, le bouton garde son texte (`entete.bouton.masque`) : la case le
  // nomme encore, pour qu'on sache ce qu'elle fera revenir.
  const texteBouton = b ? texteBrut(b.texte) : "";
  const idBouton = idUnique("bouton-entete");
  const caseBouton = h("input", { id: idBouton, type: "checkbox", coche: affiche, "data-cle": "entete:bouton" });
  caseBouton.addEventListener("change", () => {
    ctx.viser("entete:bouton");
    app.afficherBoutonEntete(caseBouton.checked);
  });
  corps.push(groupe("Le bouton de l'en-tête",
    h("div", { classe: "ed-case" }, caseBouton, h("label", { for: idBouton }, texteBouton ? "Afficher le bouton « " + texteBouton + " »" : "Afficher un bouton dans l'en-tête")),
    !affiche && texteBouton ? aide("Il est masqué dans votre brouillon : une fois publié, vos visiteurs ne le verront plus. Son texte est gardé.") : null,
    affiche
      ? [aide(decrireDestination(c, b.vers, PAGE_ACCUEIL) + (b.vers ? "" : " : le bouton n'apparaît pas sur le site tant qu'il n'a pas de lien.")),
         texteBouton ? null : aide("Il n'a pas encore de texte : écrivez-le sur la page, dans l'en-tête. Sans texte, il n'apparaît pas sur le site."),
         bouton({ libelle: "Où mène ce bouton ?", icone: "lien", quand: () => app.ouvrirLien("entete.bouton.vers"), attributs: { "data-cle": "entete:bouton:lien" } }),
         aide("Son texte se modifie sur la page, dans l'en-tête.")]
      : aide("Un bouton bien visible en haut de chaque page : « Commander », « Prendre rendez-vous »…")));

  /* ----- Le logo ----- */
  const logo = imageSure(lireChemin(c, "site.logo"));
  corps.push(groupe("Le logo",
    logo
      ? h("div", { classe: "ed-logo" }, h("img", { src: logo, alt: "Votre logo actuel" }))
      : aide("Pas de logo : le nom du site s'affiche dans l'en-tête."),
    h("div", { classe: "ed-outils" },
      bouton({ libelle: logo ? "Changer le logo" : "Choisir un logo", icone: "photo", quand: () => app.ouvrirPhoto("site.logo"), attributs: { "data-cle": "logo:choisir" } }),
      logo ? bouton({ libelle: "Retirer le logo", classe: "ed-bouton--discret-danger", quand: () => { ctx.viser("logo:choisir"); app.retirerLogo(); }, attributs: { "data-cle": "logo:retirer" } }) : null),
    aide("Avec un logo, le nom du site n'apparaît plus dans l'en-tête ; il reste en bas de chaque page.")));

  /* ----- Le pied de page ----- */
  corps.push(groupe("Le bas de page",
    aide("Le texte de chaque lien se modifie directement en bas de la page."),
    listeEditable(app, ctx, "pied.liens", {
      titre: "Liens du bas de page", nommer: nommerLien, details: descLien, plus: boutonLien("pied.liens"),
      apresAjout: (i) => app.ouvrirLien("pied.liens." + i + ".vers")
    })));

  /* ----- Pour Google ----- */
  corps.push(groupe("Pour Google",
    champTexte(app, { libelle: "Description du site", chemin: "site.description", max: 160, multiligne: true, aide: "Utilisée pour les pages qui n'ont pas leur propre description." })));

  return corps;
}
