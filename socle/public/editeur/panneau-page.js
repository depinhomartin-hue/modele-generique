/* =========================================================
   Onglet « Page » — les sections de la page affichée
   =========================================================

   La liste des sections DE LA PAGE OÙ L'ON EST (leçon de Graine de
   Pensée : un panneau qui proposait de masquer une section absente de la
   page regardée). Chacune : Monter, Descendre, Masquer, Supprimer ; un clic
   sur son nom la choisit et fait défiler la page jusqu'à elle. La section
   choisie déplie ce qui se règle chez elle : réglages, listes, liens,
   photos, adresse de lien direct.

   Tout ce qu'on lit ici vient du rendu : le nom et la phrase de chaque
   genre (`CATALOGUE`, `BLOCS[type].description`), ses réglages et ses
   listes (`reglages`, `listes`), son nom (`nomDuBloc`). Rien n'est recopié. */

import { h, bouton, icone, idUnique } from "./dom.js";
import { groupe, aide, champTexte, listeEditable, outils } from "./panneau-commun.js";
import * as Registre from "/rendu/registre.js";
import { ancresDeLaPage } from "/rendu/page.js";
import { nomDuBloc, lireChemin, cheminAlt, descripteurListe } from "/rendu/structure.js";
import { texteBrut, imageSure } from "/rendu/outils.js";
import { cheminsImages, cheminsLiensDuBloc, liensVersBloc, nomElement, MAX_SECTIONS_PAGE } from "./operations.js";
import { decrireDestination, nomDePage, pageDuLien, planAffiche } from "./liens.js";
import { compte, conseilsGooglePage } from "./textes.js";

// La valeur affichée d'un réglage et sa pertinence viennent du registre,
// la règle même du rendu : le panneau dit ce que la page montre.
const { BLOCS, CATALOGUE, valeurReglage, reglageActif } = Registre;

/* La note d'un avis, telle que le rendu la lit (`etoiles`, avis.js) : un
   nombre de 1 à 5, sinon pas de note. Elle n'a aucun point de clic sur la
   page : sans ce choix, chaque avis ajouté partait en ligne avec la note
   du modèle, cinq étoiles qu'aucun client n'avait données, et aucune note
   ne se corrigeait (relecture du 3 octobre 2026). */
const NOTES = [{ valeur: "", libelle: "Pas de note" }]
  .concat([1, 2, 3, 4, 5].map((n) => ({ valeur: String(n), libelle: n + (n > 1 ? " étoiles" : " étoile") })));
export function noteLue(note) {
  if ((typeof note !== "number" && typeof note !== "string") || note === "") return "";
  const n = Math.round(Number(note));
  return Number.isFinite(n) && n >= 1 && n <= 5 ? String(n) : "";
}
const aEnPropre = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);

/* Une section « Contact » qui affiche le formulaire : on dit où arrivent
   les messages (socle 0.3.0). Sans cette phrase, la case cochée laissait
   croire qu'ils partiraient vers une boîte e-mail. La case se lit par
   `valeurReglage`, comme le rendu la lit. */
export function aideFormulaire(bloc) {
  if (!bloc || typeof bloc !== "object" || bloc.type !== "contact") return null;
  return valeurReglage(bloc, "formulaire") === true ? "Les messages reçus arrivent dans l'onglet « Messages »." : null;
}

export function construirePage(app, ctx) {
  const c = app.etat.contenu;
  const pageId = app.etat.pageId;
  const page = c.pages[pageId];
  const n = page.ordre.length;
  const corps = [];

  corps.push(h("h2", { classe: "ed-panneau__titre" }, "Page « " + nomDePage(c, pageId) + " »"));

  const ol = h("ol", { classe: "ed-sections", "aria-label": "Les sections de la page" });
  page.ordre.forEach((id, i) => ol.append(ligneSection(id, i)));

  function ligneSection(id, i) {
    const bloc = c.blocs[id];
    const nom = nomDuBloc(bloc);
    const choisi = app.etat.blocChoisi === id;
    const masque = bloc.masque === true;
    const cle = (a) => "bloc:" + id + ":" + a;
    const li = h("li", { classe: "ed-section" + (choisi ? " est-choisie" : "") + (masque ? " est-masquee" : "") });
    li.append(h("div", { classe: "ed-section__ligne" },
      h("button", {
        type: "button", classe: "ed-section__nom", "aria-expanded": String(choisi), "data-cle": cle("nom"),
        quand: { click: () => app.choisirBloc(choisi ? null : id, { defiler: !choisi, depuis: "panneau" }) }
      },
      icone("chevron"),
      h("span", { "data-libelle-bloc": id }, nom),
      masque ? h("span", { classe: "ed-badge" }, "Masquée") : null),
      outils(
        bouton({ libelle: "Monter « " + nom + " »", bulle: "Monter", icone: "haut", seuleIcone: true, desactive: i === 0, quand: () => { ctx.viser(cle("monter")); app.actionBloc("monter", id); }, attributs: { "data-cle": cle("monter") } }),
        bouton({ libelle: "Descendre « " + nom + " »", bulle: "Descendre", icone: "bas", seuleIcone: true, desactive: i === n - 1, quand: () => { ctx.viser(cle("descendre")); app.actionBloc("descendre", id); }, attributs: { "data-cle": cle("descendre") } }),
        bouton({ libelle: (masque ? "Afficher « " : "Masquer « ") + nom + " »", bulle: masque ? "Afficher" : "Masquer", icone: masque ? "oeil" : "oeilBarre", seuleIcone: true, quand: () => { ctx.viser(cle("masquer")); app.actionBloc("masquer", id); }, attributs: { "data-cle": cle("masquer") } }),
        bouton({
          libelle: "Supprimer « " + nom + " »", bulle: "Supprimer", icone: "supprimer", seuleIcone: true, classe: "ed-bouton--discret-danger",
          // La clé est visée AVANT la confirmation (la reconstruction a lieu
          // dans le geste même), et OUBLIÉE si l'artisan renonce : restée en
          // place, elle envoyait le focus sur une autre section au geste
          // suivant (relecture du 3 octobre 2026).
          quand: async () => {
            const voisin = page.ordre[i + 1] || page.ordre[i - 1];
            ctx.viser(voisin ? "bloc:" + voisin + ":nom" : "ajouter-section");
            if (!(await app.actionBloc("supprimer", id))) ctx.viser(null);
          },
          attributs: { "data-cle": cle("supprimer") }
        })
      )));
    if (choisi) li.append(details(id, bloc));
    return li;
  }

  function details(id, bloc) {
    const def = BLOCS[bloc.type];
    const d = h("div", { classe: "ed-section__details" });
    d.append(aide(def.description));
    if (bloc.masque === true) {
      // « vos visiteurs ne la voient pas » était faux tant que rien n'était
      // publié : le masquage ne touche que le brouillon (relecture du
      // 3 octobre 2026). Et les liens qui la visent ne mèneront nulle part.
      const liens = liensVersBloc(c, pageId, id).length;
      d.append(aide("Cette section est masquée dans votre brouillon : une fois publiée, vos visiteurs ne la verront plus. Elle reste ici pour que vous puissiez la préparer." +
        (liens ? " Attention : " + compte(liens, "lien du site mène", "liens du site mènent") + " à cette section ; sur le site, " +
          (liens > 1 ? "ils ne mèneront" : "il ne mènera") + " nulle part tant qu'elle est masquée." : ""), { classe: "ed-aide ed-aide--note" }));
    }
    d.append(outils(
      bouton({ libelle: "Voir sur la page", icone: "oeil", quand: () => app.voirBloc(id), attributs: { "data-cle": "bloc:" + id + ":voir" } }),
      bouton({ libelle: "Dupliquer", icone: "dupliquer", quand: () => app.actionBloc("dupliquer", id), attributs: { "data-cle": "bloc:" + id + ":dupliquer" } })));

    // Les réglages : un groupe de choix, ou une case.
    for (const r of def.reglages || []) {
      if (!reglageActif(bloc, r)) continue;
      if (r.type === "case") {
        const idCase = idUnique("case");
        const caseR = h("input", { type: "checkbox", id: idCase, coche: valeurReglage(bloc, r), "data-cle": "bloc:" + id + ":reglage:" + r.cle });
        caseR.addEventListener("change", () => {
          ctx.viser("bloc:" + id + ":reglage:" + r.cle);
          app.executer((x) => { x.blocs[id][r.cle] = caseR.checked; });
        });
        d.append(h("div", { classe: "ed-case" }, caseR, h("label", { for: idCase }, r.libelle)));
      } else {
        const nomGroupe = idUnique("reglage");
        const actuelle = valeurReglage(bloc, r);
        const fs = h("fieldset", { classe: "ed-options ed-options--compactes" }, h("legend", null, r.libelle));
        for (const ch of r.choix) {
          const idRadio = idUnique("choix");
          const radio = h("input", { type: "radio", name: nomGroupe, id: idRadio, value: ch.valeur, coche: ch.valeur === actuelle, "data-cle": "bloc:" + id + ":reglage:" + r.cle + ":" + ch.valeur });
          radio.addEventListener("change", () => {
            if (!radio.checked) return;
            ctx.viser("bloc:" + id + ":reglage:" + r.cle + ":" + ch.valeur);
            app.executer((x) => { x.blocs[id][r.cle] = ch.valeur; });
          });
          fs.append(h("label", { classe: "ed-option__choix", for: idRadio }, radio, h("span", null, ch.libelle)));
        }
        d.append(fs);
      }
    }
    const aideMessages = aideFormulaire(bloc);
    if (aideMessages) {
      d.append(h("div", { classe: "ed-ligne-aide" },
        aide(aideMessages),
        bouton({ libelle: "Voir les messages", quand: () => app.panneau.montrer("messages"), attributs: { "data-cle": "bloc:" + id + ":messages" } })));
    }

    // Les listes de la section. Une liste dont les éléments portent une
    // note (les avis) la propose sous chacun : c'est le seul endroit où elle
    // se règle.
    for (const nomListe of Object.keys(def.listes || {})) {
      const cheminListe = "blocs." + id + "." + nomListe;
      const desc = descripteurListe(c, cheminListe);
      const elements = Array.isArray(bloc[nomListe]) ? bloc[nomListe] : [];
      const aNote = !!desc && (aEnPropre(desc.modele, "note") || elements.some((el) => aEnPropre(el, "note")));
      const l = listeEditable(app, ctx, cheminListe, aNote ? { details: (el, i) => choixNote(cheminListe, el, i, nomElement(el, desc.libelle, i)) } : {});
      if (l) d.append(l);
    }

    // Les liens et boutons de la section (aussi modifiables sur la page,
    // par leur pastille « Lien »).
    const liens = cheminsLiensDuBloc(c, id);
    if (liens.length) {
      const ul = h("ul", { classe: "ed-elements" });
      for (const chemin of liens) {
        const estPlan = /\.lienPlan$/.test(chemin);
        const texte = estPlan ? "Voir le plan" : texteBrut(lireChemin(c, chemin.replace(/\.vers$/, ".texte"))) || "Bouton sans texte";
        const vers = lireChemin(c, chemin);
        // Un plan rangé en « http:// » n'apparaît pas sur le site (horaires.js) :
        // le dire ici, où l'on lit la destination.
        const absent = !vers ? " : il n'apparaît pas sur le site."
          : estPlan && !planAffiche(vers) ? " : il n'apparaît pas sur le site, car son adresse ne commence pas par « https:// ». Choisissez-le de nouveau avec « Lien… »." : "";
        ul.append(h("li", { classe: "ed-element" },
          h("div", { classe: "ed-element__ligne" },
            h("span", { classe: "ed-element__nom ed-element__nom--fixe" }, texte),
            bouton({ libelle: "Lien…", icone: "lien", quand: () => app.ouvrirLien(chemin), attributs: { "data-cle": "lien:" + chemin, "aria-label": "Où mène « " + texte + " » ?" } })),
          aide(decrireDestination(c, vers, pageDuLien(c, chemin, pageId)) + absent)));
      }
      d.append(h("h4", { classe: "ed-liste__titre" }, "Liens et boutons"), ul);
    }

    // Les photos de la section.
    const photos = cheminsImages(c, id);
    if (photos.length) {
      const ul = h("ul", { classe: "ed-photos" });
      photos.forEach((chemin, i) => {
        const src = imageSure(lireChemin(c, chemin));
        const cAlt = cheminAlt(chemin);
        const alt = cAlt ? texteBrut(lireChemin(c, cAlt)) : "";
        ul.append(h("li", { classe: "ed-photo" },
          src ? h("img", { src, alt: "", loading: "lazy" }) : h("span", { classe: "ed-photo__vide", "aria-hidden": "true" }, icone("photo")),
          h("span", { classe: "ed-photo__nom" }, alt || (src ? "Photo " + (i + 1) + " (sans description)" : "Pas encore de photo")),
          bouton({ libelle: src ? "Changer" : "Choisir", icone: "photo", quand: () => app.ouvrirPhoto(chemin), attributs: { "data-cle": "photo:" + chemin, "aria-label": (src ? "Changer la photo " : "Choisir la photo ") + (i + 1) } })));
      });
      d.append(h("h4", { classe: "ed-liste__titre" }, "Photos"), ul);
    }

    // L'adresse de lien direct (#ancre).
    const ancre = ancresDeLaPage(c, page)[id] || id;
    const idAncre = idUnique("ancre");
    const champ = h("input", { id: idAncre, type: "text", classe: "ed-champ", spellcheck: "false", "data-cle": "bloc:" + id + ":ancre", autocomplete: "off" });
    champ.value = ancre;
    const form = h("form", { classe: "ed-ancre" },
      h("label", { for: idAncre }, "Lien direct vers cette section"),
      h("div", { classe: "ed-ancre__ligne" }, h("span", { classe: "ed-ancre__diese", "aria-hidden": "true" }, "#"), champ,
        h("button", { type: "submit", classe: "ed-bouton", "data-cle": "bloc:" + id + ":ancre-ok" }, "Renommer")),
      aide("Le mot qui suit « # » dans l'adresse d'un lien vers cette section. Les liens du site qui y mènent déjà suivront."));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      ctx.viser("bloc:" + id + ":ancre");
      app.renommerAncre(id, champ.value);
    });
    d.append(form);
    return d;
  }

  function choixNote(cheminListe, el, i, nomAvis) {
    const idSel = idUnique("note");
    const cleNote = "liste:" + cheminListe + ":" + i + ":note";
    const sel = h("select", { id: idSel, classe: "ed-champ", "data-cle": cleNote });
    for (const o of NOTES) sel.append(h("option", { value: o.valeur }, o.libelle));
    sel.value = noteLue(el && el.note);
    sel.addEventListener("change", () => {
      ctx.viser(cleNote);
      const valeur = sel.value ? Number(sel.value) : "";
      app.executer((x) => {
        const e = lireChemin(x, cheminListe + "." + i);
        if (e && typeof e === "object" && !Array.isArray(e)) e.note = valeur;
      }, { annonce: valeur ? "Note : " + NOTES[valeur].libelle + "." : "Note retirée." });
    });
    // Un « Note » par avis : le lecteur d'écran entend aussi lequel.
    return h("div", { classe: "ed-ligne-champ" }, h("label", { for: idSel }, "Note", h("span", { classe: "ed-cache" }, " de « " + nomAvis + " »")), sel);
  }

  corps.push(groupe(null, n ? ol : aide("Cette page n'a pas encore de section. Ajoutez-en une ci-dessous.")));
  const pagePleine = n >= MAX_SECTIONS_PAGE;

  // Ajouter une section : le catalogue du rendu, nom et phrase.
  const apres = app.etat.blocChoisi && page.ordre.includes(app.etat.blocChoisi) ? app.etat.blocChoisi : null;
  const ouvert = ctx.etat.catalogue === true;
  const catalogue = h("div", { classe: "ed-catalogue", id: "ed-catalogue", hidden: !ouvert },
    aide(apres ? "Elle sera ajoutée après « " + nomDuBloc(c.blocs[apres]) + " »." : "Elle sera ajoutée à la fin de la page."),
    h("ul", { classe: "ed-catalogue__liste" }, ...CATALOGUE.map((g) => h("li", null,
      h("button", {
        type: "button", classe: "ed-catalogue__choix", "data-cle": "catalogue:" + g.type,
        quand: { click: () => { ctx.etat.catalogue = false; app.ajouterSection(g.type, apres); } }
      }, h("strong", null, g.nom), h("span", null, g.description))))));
  corps.push(h("div", { classe: "ed-ajout-section" },
    bouton({
      libelle: ouvert ? "Fermer la liste des sections" : "Ajouter une section", icone: ouvert ? "fermer" : "ajouter",
      classe: "ed-bouton--plein-large", desactive: pagePleine && !ouvert,
      attributs: { "aria-expanded": String(ouvert), "aria-controls": "ed-catalogue", "data-cle": "ajouter-section" },
      quand: () => { ctx.etat.catalogue = !ouvert; ctx.viser(ouvert ? "ajouter-section" : "catalogue:" + CATALOGUE[0].type); ctx.reconstruire(); }
    }),
    pagePleine ? aide("Cette page a déjà " + MAX_SECTIONS_PAGE + " sections : c'est le maximum. Supprimez-en une, ou créez une autre page.") : null,
    catalogue));

  // Ce que les deux champs deviennent quand on les laisse vides, et ce que
  // le site ajoute au titre : la règle vient du rendu (`conseilsGooglePage`).
  // `vide` et `ajout` sont lus par le compteur du champ.
  const google = conseilsGooglePage(c, pageId);
  corps.push(groupe("Pour Google",
    champTexte(app, {
      libelle: "Titre dans Google", chemin: "pages." + pageId + ".titre", max: 60, vide: google.titre.vide, ajout: google.titre.ajout,
      aide: "Le titre en bleu dans les résultats de recherche, et le nom de l'onglet." +
        (google.titre.suffixe ? " Le nom du site est ajouté à la suite : « …" + google.titre.suffixe + " »." : "")
    }),
    champTexte(app, {
      libelle: "Description dans Google", chemin: "pages." + pageId + ".description", max: 160, multiligne: true, vide: google.description.vide, ajout: google.description.ajout,
      aide: "Les deux lignes sous le titre, dans les résultats de recherche."
    })));

  // La barre de mise en forme d'un texte n'est pas sur le chemin de Tab :
  // son raccourci n'était écrit nulle part (relecture du 3 octobre 2026).
  corps.push(groupe("Au clavier",
    aide("Alt+F10 dans un texte ouvre la mise en forme (gras, taille, police…) ; Échap ramène au texte. Sur Mac : fn + Option + F10.")));

  return corps;
}
