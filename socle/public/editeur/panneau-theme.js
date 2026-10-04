/* =========================================================
   Onglet « Thème » — couleurs, polices, taille des titres
   =========================================================

   L'artisan CHOISIT parmi des thèmes mesurés (themes.js) ; il ne compose
   pas ses couleurs. Pas de couleur libre : c'est le garde-fou de
   lisibilité, la leçon la plus utile de Graine de Pensée.

   Un thème, c'est une palette ET un duo de polices : choisir un thème
   prend aussi ses polices (on peut en changer ensuite, juste en dessous). */

import { h, idUnique } from "./dom.js";
import { groupe, aide } from "./panneau-commun.js";
import { THEMES, DUOS, CRANS_TITRES, themeDe } from "/rendu/themes.js";
import { chargerPolicesDesDuos } from "./mise-en-forme.js";

const NOMS_CRANS = ["Plus petits", "Normaux", "Plus grands"];
const PASTILLES = ["fond", "doux", "accent", "sombre", "texte"];

export function construireTheme(app, ctx) {
  chargerPolicesDesDuos();
  const c = app.etat.contenu;
  const resolu = themeDe(c);
  const corps = [h("h2", { classe: "ed-panneau__titre" }, "Thème")];

  function groupeRadio(legende, elements, actuel, surChoix, classe = "") {
    const nom = idUnique("radio");
    const fs = h("fieldset", { classe: "ed-options " + classe }, h("legend", { classe: "ed-cache" }, legende));
    for (const el of elements) {
      const id = idUnique("radio-choix");
      const radio = h("input", { type: "radio", name: nom, id, value: el.valeur, coche: el.valeur === actuel, "data-cle": "theme:" + legende + ":" + el.valeur });
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        ctx.viser("theme:" + legende + ":" + el.valeur);
        surChoix(el.valeur);
      });
      fs.append(h("label", { classe: "ed-option__choix ed-carte-choix", for: id }, radio, el.contenu));
    }
    return fs;
  }

  corps.push(groupe("Couleurs",
    groupeRadio("Couleurs", Object.entries(THEMES).map(([id, t]) => ({
      valeur: id,
      contenu: h("span", { classe: "ed-theme" },
        h("span", { classe: "ed-theme__nom" }, t.nom),
        h("span", { classe: "ed-theme__pastilles", "aria-hidden": "true" },
          ...PASTILLES.map((k) => {
            const p = h("span", { classe: "ed-pastille-couleur" });
            p.style.background = t.couleurs[k];
            return p;
          })))
    })), resolu.id, (id) => app.executer((x) => {
      x.theme = Object.assign({}, x.theme, { id, duo: THEMES[id].duo });
    }, { annonce: "Thème « " + THEMES[id].nom + " » appliqué, avec ses polices." })),
    aide("Chaque thème a été vérifié pour rester lisible par tous, sur tous les écrans.")));

  corps.push(groupe("Polices",
    groupeRadio("Polices", DUOS.map((d) => {
      const nom = h("span", { classe: "ed-duo__nom" }, d.nom);
      nom.style.fontFamily = d.display;
      return { valeur: d.id, contenu: h("span", { classe: "ed-duo" }, nom, h("span", { classe: "ed-duo__exemple" }, "Titres dans la police « " + d.nom + " »")) };
    }), resolu.duo.id, (id) => app.executer((x) => {
      x.theme = Object.assign({}, x.theme, { duo: id });
    })),
    aide("Chaque choix associe une police pour les titres et une autre, très lisible, pour le texte.")));

  corps.push(groupe("Taille des titres",
    groupeRadio("Taille des titres", CRANS_TITRES.map((v, i) => ({ valeur: v, contenu: h("span", null, NOMS_CRANS[i] || String(v)) })),
      resolu.echelle, (v) => app.executer((x) => {
        x.theme = Object.assign({}, x.theme, { echelleTitres: Number(v) });
      }), "ed-options--ligne"),
    aide("Le texte courant ne change pas de taille : il reste lisible sur un téléphone.")));

  // Les animations douces (socle.css, « Le mouvement ») : une case, pas un
  // choix d'effets. Elles se voient dans l'aperçu ; pendant l'édition, rien
  // ne bouge (cadre.css).
  const idAnim = idUnique("case");
  const caseAnim = h("input", { type: "checkbox", id: idAnim, coche: resolu.animations, "data-cle": "theme:animations" });
  caseAnim.addEventListener("change", () => {
    ctx.viser("theme:animations");
    app.executer((x) => {
      x.theme = Object.assign({}, x.theme, { animations: caseAnim.checked });
    }, { annonce: caseAnim.checked ? "Animations douces activées." : "Animations douces désactivées." });
  });
  corps.push(groupe("Mouvement",
    h("div", { classe: "ed-case" }, caseAnim, h("label", { for: idAnim }, "Animations douces")),
    aide("Le haut de la page apparaît en douceur, puis chaque section glisse légèrement quand on fait défiler. " +
      "Visible dans l'aperçu. Rien ne bouge pour les visiteurs qui ont demandé moins d'animations à leur téléphone ou à leur ordinateur.")));

  return corps;
}
