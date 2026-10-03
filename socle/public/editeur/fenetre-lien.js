/* =========================================================
   « Où mène ce bouton ? » — la destination d'un lien
   =========================================================

   Une seule fenêtre pour tout ce qui mène quelque part : un bouton, un
   lien du menu ou du pied, « Voir le plan », un mot mis en lien dans un
   texte. L'artisan choisit ce qu'il connaît (une section, une page, un
   numéro, une adresse e-mail, un autre site) ; la chaîne rangée dans le
   contenu (« #horaires », « /tarifs », « tel:… ») est fabriquée et VÉRIFIÉE
   par `composerDestination` (liens.js), qui s'en remet aux règles du site
   (`destination`, `adresseSure`). Il n'a jamais à écrire « # » ni « tel: ». */

import { h, idUnique } from "./dom.js";
import { ouvrirFenetre } from "./dialogues.js";
import { PAGE_ACCUEIL } from "/rendu/page.js";
import { lireChemin } from "/rendu/structure.js";
import { texteBrut } from "/rendu/outils.js";
import { analyserDestination, composerDestination, sectionsDe, listePages, Refus, genreDeLien, pageDuLien, lienGlobal } from "./liens.js";

const aEnPropre = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);

/* → `null` si l'artisan annule, sinon `{ vers, style }` (`style` :
   « plein » / « contour » pour un bouton qui a une apparence, sinon null). */
export async function ouvrirFenetreLien(app, { chemin = null, valeur = null, genre = null, pageContexte = null } = {}) {
  const contenu = app.etat.contenu;
  const g = genre || genreDeLien(contenu, chemin);
  const versActuel = valeur !== null ? String(valeur) : (typeof lireChemin(contenu, chemin) === "string" ? lireChemin(contenu, chemin) : "");
  const ctx = pageContexte || pageDuLien(contenu, chemin, app.etat.pageId);
  const global = chemin ? lienGlobal(chemin) : false;
  const parent = chemin ? lireChemin(contenu, chemin.replace(/\.[^.]+$/, "")) : null;
  const avecStyle = g === "bouton" && parent && typeof parent === "object" && aEnPropre(parent, "style");
  const texteDuLien = chemin && /\.vers$/.test(chemin) ? texteBrut(lireChemin(contenu, chemin.replace(/\.vers$/, ".texte"))) : "";

  const titre = g === "bouton" ? "Où mène ce bouton ?" : g === "plan" ? "Où mène « Voir le plan » ?" : "Où mène ce lien ?";
  const nom = idUnique("destination");
  const erreur = h("p", { classe: "ed-erreur", role: "alert", hidden: true });
  const options = [];

  /* `impossible` : une phrase qui dit pourquoi ce choix n'est pas offert
     (pas d'autre page…) ; le bouton est alors grisé, la phrase visible. */
  function option(genreOption, libelle, champs = null, note = null, impossible = null) {
    const id = idUnique("dest-option");
    const radio = h("input", { type: "radio", name: nom, id, value: genreOption, disabled: !!impossible });
    const details = champs || note ? h("div", { classe: "ed-option__details", hidden: true }, champs, note ? h("p", { classe: "ed-aide" }, note) : null) : null;
    const bloc = h("div", { classe: "ed-option" }, h("label", { classe: "ed-option__choix", for: id }, radio, h("span", null, libelle)),
      impossible ? h("p", { classe: "ed-aide ed-option__details" }, impossible) : null, details);
    options.push({ genre: genreOption, radio, details });
    return bloc;
  }

  function select(libelle, valeurs, choisie) {
    const id = idUnique("dest-select");
    const s = h("select", { id, classe: "ed-champ" });
    for (const v of valeurs) s.append(h("option", { value: v.valeur }, v.libelle));
    if (choisie !== undefined && valeurs.some((v) => v.valeur === choisie)) s.value = choisie;
    return { element: h("div", { classe: "ed-ligne-champ" }, h("label", { for: id }, libelle), s), select: s };
  }
  function saisie(libelle, type, valeurInitiale, indication, autocomplete = null) {
    const id = idUnique("dest-saisie");
    const i = h("input", { id, type, classe: "ed-champ", placeholder: indication, autocomplete, spellcheck: "false" });
    i.value = valeurInitiale || "";
    return { element: h("div", { classe: "ed-ligne-champ" }, h("label", { for: id }, libelle), i), input: i };
  }

  const a = analyserDestination(versActuel);
  const sectionsCtx = sectionsDe(contenu, ctx);
  // Une section masquée reste proposée (on la prépare peut-être pour
  // demain), mais on dit ce que le lien fera sur le site en attendant.
  const nomSection = (s) => s.nom + (s.masque ? " (masquée : sur le site, le lien ne mènera nulle part)" : "");

  // Une section de cette page (ou de l'accueil, pour l'en-tête et le pied).
  let ancreInitiale = a.genre === "section" ? a.ancre : a.genre === "page" && a.page === ctx ? a.ancre : "";
  const valeursSections = sectionsCtx.map((s) => ({ valeur: s.ancre, libelle: nomSection(s) }));
  if (ancreInitiale && !valeursSections.some((v) => v.valeur === ancreInitiale)) {
    valeursSections.unshift({ valeur: ancreInitiale, libelle: "#" + ancreInitiale + " (section introuvable)" });
  }
  const champSection = select("Section", valeursSections, ancreInitiale || undefined);

  // Une autre page, et éventuellement une de ses sections.
  const pages = listePages(contenu).filter((p) => global || p.id !== ctx);
  const pageInitiale = a.genre === "page" && pages.some((p) => p.id === a.page) ? a.page : pages.length ? pages[0].id : PAGE_ACCUEIL;
  const champPage = select("Page", pages.map((p) => ({ valeur: p.id, libelle: p.nom })), pageInitiale);
  const champSectionPage = select("Endroit de la page", [], undefined);
  function remplirSectionsPage(ancre = "") {
    const s = champSectionPage.select;
    s.replaceChildren(h("option", { value: "" }, "Le haut de la page"));
    for (const x of sectionsDe(contenu, champPage.select.value)) s.append(h("option", { value: x.ancre }, nomSection(x)));
    s.value = [...s.options].some((o) => o.value === ancre) ? ancre : "";
  }
  remplirSectionsPage(a.genre === "page" && a.page !== ctx ? a.ancre : "");
  champPage.select.addEventListener("change", () => remplirSectionsPage(""));

  const champTel = saisie("Numéro", "tel", a.genre === "telephone" ? a.valeur : "", "03 89 12 34 56", "tel");
  const champEmail = saisie("Adresse e-mail", "email", a.genre === "email" ? a.valeur : "", "bonjour@votre-entreprise.fr", "email");
  const champWeb = saisie(g === "plan" ? "Adresse du plan" : "Adresse du site", "url", a.genre === "web" || a.genre === "autre" ? a.valeur : "", "https://www.exemple.fr");

  const noteAucun = g === "bouton"
    ? "Le bouton n'apparaîtra plus sur le site tant qu'il n'a pas de lien. Il reste visible ici, pour que vous puissiez lui en redonner un."
    : g === "texte" ? "Les mots choisis redeviennent du texte simple."
      : g === "plan" ? "« Voir le plan » n'apparaîtra plus sur le site."
        : "Ce lien n'apparaîtra plus sur le site tant qu'il n'a pas de destination.";

  const liste = h("fieldset", { classe: "ed-options" }, h("legend", null, "Ce lien mène vers…"));
  if (g !== "plan") {
    liste.append(
      option("section", global ? "Une section de l'accueil" : "Une section de cette page", champSection.element, null,
        sectionsCtx.length || ancreInitiale ? null : "Cette page n'a encore aucune section."),
      option("page", global ? "Une page du site" : "Une autre page du site", [champPage.element, champSectionPage.element], null,
        pages.length ? null : "Votre site n'a pas d'autre page pour l'instant : ajoutez-en une dans l'onglet « Site »."),
      option("telephone", "Un numéro de téléphone", champTel.element, "Sur un téléphone, un appui lance l'appel."),
      option("email", "Une adresse e-mail", champEmail.element, "Un clic ouvre la messagerie de votre visiteur."),
      option("web", "Un autre site", champWeb.element, "Il s'ouvrira dans un nouvel onglet.")
    );
  } else {
    liste.append(option("web", "Un plan en ligne (Google Maps, par exemple)", champWeb.element, "Copiez l'adresse de la page du plan, puis collez-la ici."));
  }
  liste.append(option("aucun", "Aucun lien", null, noteAucun));

  // L'option de départ : celle de la destination actuelle.
  let depart = a.genre;
  if (a.genre === "page" && a.page === ctx && a.ancre) depart = "section";
  if (a.genre === "autre") depart = "web";
  if (g === "plan" && depart !== "aucun") depart = "web";
  if (g === "plan" && !versActuel) depart = "web";
  if (!options.some((o) => o.genre === depart && !o.radio.disabled)) depart = "aucun";
  function majOptions() {
    for (const o of options) if (o.details) o.details.hidden = !o.radio.checked;
    erreur.hidden = true;
  }
  for (const o of options) {
    o.radio.checked = o.genre === depart;
    o.radio.addEventListener("change", majOptions);
  }
  majOptions();

  // L'apparence d'un bouton.
  let apparence = null;
  if (avecStyle) {
    const n2 = idUnique("apparence");
    const plein = h("input", { type: "radio", name: n2, value: "plein", id: n2 + "-plein" });
    const contour = h("input", { type: "radio", name: n2, value: "contour", id: n2 + "-contour" });
    (parent.style === "contour" ? contour : plein).checked = true;
    apparence = { plein, contour };
  }

  const corps = h("div", { classe: "ed-fenetre-lien" },
    texteDuLien ? h("p", { classe: "ed-fenetre-lien__quoi" }, "« " + texteDuLien + " »") : null,
    liste,
    apparence
      ? h("fieldset", { classe: "ed-options ed-options--ligne" }, h("legend", null, "Apparence du bouton"),
          h("label", { classe: "ed-option__choix", for: apparence.plein.id }, apparence.plein, h("span", null, "Plein")),
          h("label", { classe: "ed-option__choix", for: apparence.contour.id }, apparence.contour, h("span", null, "Contour")))
      : null,
    erreur);

  let resultat = null;
  const f = ouvrirFenetre({
    titre, corps, echap: null, large: false,
    actions: [
      { libelle: "Annuler", valeur: null, style: "secondaire" },
      {
        libelle: "Valider", valeur: "ok", style: "principal",
        quand: () => {
          const choisi = options.find((o) => o.radio.checked);
          const genreChoisi = choisi ? choisi.genre : "aucun";
          const choix = { genre: genreChoisi };
          let champFautif = null;
          if (genreChoisi === "section") { choix.ancre = champSection.select.value; champFautif = champSection.select; }
          if (genreChoisi === "page") { choix.page = champPage.select.value; choix.ancre = champSectionPage.select.value; champFautif = champPage.select; }
          if (genreChoisi === "telephone") { choix.valeur = champTel.input.value; champFautif = champTel.input; }
          if (genreChoisi === "email") { choix.valeur = champEmail.input.value; champFautif = champEmail.input; }
          if (genreChoisi === "web") { choix.valeur = champWeb.input.value; champFautif = champWeb.input; }
          try {
            const vers = composerDestination(choix, { pageContexte: ctx, plan: g === "plan" });
            resultat = { vers, style: apparence ? (apparence.contour.checked ? "contour" : "plein") : null };
            return true;
          } catch (e) {
            if (!(e instanceof Refus)) throw e;
            erreur.textContent = e.message;
            erreur.hidden = false;
            if (champFautif) champFautif.focus();
            return false;
          }
        }
      }
    ],
    focus: (boite) => boite.querySelector('input[type="radio"]:checked')
  });
  const fin = await f.promesse;
  return fin === "ok" ? resultat : null;
}
