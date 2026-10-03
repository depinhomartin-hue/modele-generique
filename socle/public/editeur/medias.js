/* =========================================================
   La médiathèque — choisir, ajouter, décrire une photo
   =========================================================

   Un clic sur une photo de la page (ou « Changer la photo » dans le
   panneau) ouvre cette fenêtre : la grille des photos déjà envoyées,
   « Ajouter des photos » (plusieurs, glisser-déposer aussi), la
   description de la photo pour les personnes malvoyantes et pour Google,
   « Retirer la photo » (le champ est vidé) et « Retirer de la
   médiathèque ».

   Les photos sont RÉDUITES dans le navigateur avant l'envoi (images.js),
   trois à la fois au plus — un ordinateur modeste n'aime pas décoder trois
   photos de douze mégapixels de front (Graine de Pensée) —, avec leur
   progression à l'écran.

   Retirer de la médiathèque ne supprime pas le fichier (le serveur le
   garde : une ancienne version le cite peut-être). On le dit. */

import { h, bouton, icone, vider, idUnique } from "./dom.js";
import { ouvrirFenetre, confirmer, annoncer } from "./dialogues.js";
import { cheminAlt, lireChemin, ecrireChemin, mediasCites } from "/rendu/structure.js";
import { imageSure } from "/rendu/outils.js";
import { preparerPhoto, PhotoIllisible } from "./images.js";
import { messageErreur, dateLongue } from "./textes.js";

const ENVOIS_SIMULTANES = 3;

/* La liste est gardée d'une ouverture à l'autre : rouvrir la médiathèque
   montre aussitôt les photos, la liste fraîche arrive derrière. */
let memoire = null;

function nomDeBase(nom) {
  const b = String(nom || "photo").replace(/\.[^.]*$/, "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60);
  return b || "photo";
}

export async function ouvrirMediatheque(app, { chemin }) {
  const contenu = app.etat.contenu;
  const lu = lireChemin(contenu, chemin);
  const actuelle = typeof lu === "string" ? lu.trim() : "";
  const cheminDesc = cheminAlt(chemin);
  const descLue = cheminDesc ? lireChemin(contenu, cheminDesc) : "";
  const estLogo = chemin === "site.logo";
  let medias = memoire ? memoire.slice() : [];
  let choisie = actuelle;
  let chargee = !!memoire;          // la liste du serveur est-elle arrivée ?
  let erreurChargement = "";
  const ajoutees = [];              // envoyées pendant que la fenêtre est ouverte

  /* ----- Ajouter ----- */
  const entree = h("input", { type: "file", multiple: true, accept: "image/*", classe: "ed-cache", tabindex: "-1" });
  const envois = h("ul", { classe: "ed-envois", "aria-label": "Photos en cours d'envoi" });
  const zoneDepot = h("div", { classe: "ed-depot" },
    h("p", null, "Glissez vos photos ici, ou"),
    bouton({ libelle: "Ajouter des photos", icone: "envoyer", classe: "ed-bouton--principal", quand: () => entree.click() }),
    h("p", { classe: "ed-aide" }, "Elles sont réduites avant l'envoi : inutile de les retoucher. Les informations de lieu enregistrées par le téléphone sont retirées."),
    entree);
  entree.addEventListener("change", () => {
    if (entree.files && entree.files.length) ajouterFichiers(entree.files);
    entree.value = "";
  });
  for (const ev of ["dragenter", "dragover"]) {
    zoneDepot.addEventListener(ev, (e) => { e.preventDefault(); zoneDepot.classList.add("est-survolee"); });
  }
  zoneDepot.addEventListener("dragleave", () => zoneDepot.classList.remove("est-survolee"));
  zoneDepot.addEventListener("drop", (e) => {
    e.preventDefault();
    zoneDepot.classList.remove("est-survolee");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) ajouterFichiers(e.dataTransfer.files);
  });

  function ligneEnvoi(fichier) {
    const etat = h("span", { classe: "ed-envoi__etat" }, "En attente…");
    const barre = h("progress", { max: "100", value: "0", "aria-hidden": "true" });
    const li = h("li", { classe: "ed-envoi" }, h("span", { classe: "ed-envoi__nom" }, fichier.name || "Photo"), etat, barre);
    envois.append(li);
    return {
      etat(texte, part = null) {
        etat.textContent = texte;
        if (part !== null) barre.value = Math.round(part * 100);
      },
      fini(texte) {
        etat.textContent = texte;
        barre.value = 100;
        li.classList.add("est-fini");
      },
      erreur(texte) {
        etat.textContent = texte;
        li.classList.add("est-en-erreur");
        barre.remove();
      }
    };
  }

  async function ajouterFichiers(liste) {
    const fichiers = [...liste];
    const attente = fichiers.map((f) => ({ f, ligne: ligneEnvoi(f) }));
    const reussies = [];
    let arrete = false;
    annoncer(fichiers.length > 1 ? fichiers.length + " photos en cours d'envoi." : "Photo en cours d'envoi.");
    const travailleur = async () => {
      while (attente.length && !arrete) {
        const { f, ligne } = attente.shift();
        try {
          if (f.type && !/^image\//i.test(f.type)) throw new PhotoIllisible("Ce fichier n'est pas une photo.");
          ligne.etat("Réduction…");
          const p = await preparerPhoto(f);
          const form = new FormData();
          const base = nomDeBase(f.name);
          form.append("image", p.image, base + "." + p.extension);
          form.append("vignette", p.vignette, base + "-vignette." + p.extension);
          form.append("nom", String(f.name || "photo").slice(0, 120));
          ligne.etat("Envoi…", 0);
          const rep = await app.api.envoyerMedia(form, { progression: (x) => ligne.etat("Envoi… " + Math.round(x * 100) + " %", x) });
          const m = rep && rep.media;
          if (!m || typeof m.url !== "string") throw new Error("réponse inattendue");
          medias = [m].concat(medias.filter((x) => x.id !== m.id));
          memoire = medias.slice();
          ajoutees.push(m);
          reussies.push(m);
          ligne.fini("Ajoutée");
          dessinerGrille();
        } catch (e) {
          if (e && e.statut === 401) {
            arrete = true;
            ligne.erreur("Connexion expirée.");
            app.connexionExpiree();
            return;
          }
          ligne.erreur(e instanceof PhotoIllisible ? e.message : messageErreur(e));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(ENVOIS_SIMULTANES, fichiers.length) }, travailleur));
    // Une seule photo ajoutée : c'est sûrement celle qu'on voulait.
    if (reussies.length === 1) choisir(reussies[0].url, { focus: true });
    const ratees = fichiers.length - reussies.length;
    annoncer(ratees
      ? reussies.length + " photo(s) ajoutée(s), " + ratees + " en erreur : le détail est dans la liste."
      : reussies.length > 1 ? reussies.length + " photos ajoutées." : "Photo ajoutée.", { urgent: ratees > 0 });
  }

  /* ----- La grille ----- */
  const etatGrille = h("p", { classe: "ed-aide", role: "status" }, medias.length ? "" : "Chargement de vos photos…");
  const grille = h("div", { classe: "ed-grille-photos", role: "radiogroup", "aria-label": estLogo ? "Choisissez votre logo" : "Choisissez une photo" });
  const outilsChoix = h("div", { classe: "ed-mediatheque__outils" });

  function tuile({ url, vignette, nom, legende, media }) {
    const coche = url === choisie;
    const b = h("button", {
      type: "button", role: "radio", classe: "ed-tuile", "aria-checked": String(coche), tabindex: coche ? "0" : "-1",
      "data-url": url, title: nom || null
    },
    h("img", { src: vignette || url, alt: "", loading: "lazy", decoding: "async" }),
    h("span", { classe: "ed-tuile__nom" }, legende || nom || "Photo"));
    b.setAttribute("aria-label", (legende ? legende + " — " : "") + (nom || "Photo") + (media && media.quand ? ", ajoutée le " + dateLongue(media.quand) : ""));
    b.addEventListener("click", () => choisir(url));
    b.addEventListener("dblclick", () => { choisir(url); valider.click(); });
    return b;
  }

  function dessinerGrille() {
    const focusDedans = grille.contains(document.activeElement);
    vider(grille);
    const sures = medias.filter((m) => m && typeof m.url === "string" && imageSure(m.url));
    // La photo actuelle n'est pas forcément dans la médiathèque (une
    // illustration livrée avec le site) : elle reste choisissable.
    if (actuelle && imageSure(actuelle) && !sures.some((m) => m.url === actuelle)) {
      grille.append(tuile({ url: actuelle, vignette: null, nom: "Photo actuelle", legende: "Photo actuelle" }));
    }
    for (const m of sures) grille.append(tuile({ url: m.url, vignette: m.vignette && imageSure(m.vignette) ? m.vignette : null, nom: m.nom, media: m }));
    if (!grille.querySelector('[tabindex="0"]') && grille.firstChild) grille.firstChild.tabIndex = 0;
    // On ne dit pas « aucune photo » tant que la liste n'est pas arrivée.
    etatGrille.textContent = erreurChargement
      ? erreurChargement
      : !chargee ? "Chargement de vos photos…"
        : !sures.length ? "Aucune photo dans votre médiathèque pour l'instant : ajoutez-en avec le bouton ci-dessus."
          : "";
    if (focusDedans) (grille.querySelector('[aria-checked="true"]') || grille.firstChild)?.focus();
    majOutils();
  }

  /* La description suit la PHOTO, pas l'emplacement : choisir une autre
     photo gardait celle de l'ancienne (« Une miche de pain… » sous une
     photo de tarte — essai du 3 octobre 2026), et une description fausse
     est pire qu'aucune pour qui ne voit pas l'image. Chaque photo de la
     séance garde ce qu'on a écrit pour elle ; une photo neuve part vide. */
  const descParPhoto = new Map([[actuelle, typeof descLue === "string" ? descLue : ""]]);
  function choisir(url, { focus = false } = {}) {
    if (champDesc && url !== choisie) {
      descParPhoto.set(choisie, champDesc.value);
      champDesc.value = descParPhoto.get(url) ?? "";
    }
    choisie = url;
    for (const t of grille.querySelectorAll(".ed-tuile")) {
      const oui = t.dataset.url === url;
      t.setAttribute("aria-checked", String(oui));
      t.tabIndex = oui ? 0 : -1;
      if (oui && focus) t.focus();
    }
    majOutils();
  }

  // Les flèches déplacent le choix, comme dans tout groupe de boutons radio.
  grille.addEventListener("keydown", (e) => {
    const tuiles = [...grille.querySelectorAll(".ed-tuile")];
    const i = tuiles.indexOf(document.activeElement);
    if (i < 0) return;
    let j = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % tuiles.length;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + tuiles.length) % tuiles.length;
    if (e.key === "Home") j = 0;
    if (e.key === "End") j = tuiles.length - 1;
    if (j === null) return;
    e.preventDefault();
    choisir(tuiles[j].dataset.url, { focus: true });
  });

  function majOutils() {
    vider(outilsChoix);
    const m = medias.find((x) => x.url === choisie);
    if (m) {
      outilsChoix.append(bouton({
        libelle: "Retirer de la médiathèque", icone: "supprimer", classe: "ed-bouton--discret-danger",
        quand: () => retirer(m)
      }));
    }
  }

  async function retirer(m) {
    const cites = mediasCites(app.etat.contenu);
    const utilisee = cites.has(m.url) || (m.vignette && cites.has(m.vignette));
    const ok = await confirmer({
      titre: "Retirer cette photo de la médiathèque ?",
      texte: utilisee
        ? "Cette photo est utilisée sur votre site. Elle y restera affichée, mais vous ne pourrez plus la choisir ici."
        : "Vous ne pourrez plus la choisir ici. Les anciennes versions de votre site qui l'utilisent la garderont.",
      oui: "Retirer de la médiathèque", danger: true
    });
    if (!ok) return;
    try {
      await app.api.retirerMedia(m.id);
      medias = medias.filter((x) => x.id !== m.id);
      memoire = medias.slice();
      if (choisie === m.url && choisie !== actuelle) choisir(actuelle);
      dessinerGrille();
      annoncer("Photo retirée de la médiathèque.");
    } catch (e) {
      if (e && e.statut === 401) { app.connexionExpiree(); return; }
      app.signaler(messageErreur(e), { genre: "erreur" });
    }
  }

  /* ----- La description ----- */
  let champDesc = null;
  let blocDesc = null;
  if (cheminDesc) {
    const id = idUnique("desc-photo");
    const aide = idUnique("desc-aide");
    champDesc = h("input", { id, type: "text", classe: "ed-champ", "aria-describedby": aide, maxlength: "300" });
    champDesc.value = typeof descLue === "string" ? descLue : "";
    blocDesc = h("div", { classe: "ed-ligne-champ ed-mediatheque__desc" },
      h("label", { for: id }, "Description de la photo"),
      champDesc,
      h("p", { classe: "ed-aide", id: aide }, "Pour les personnes malvoyantes et pour Google. Décrivez ce qu'on voit, par exemple : « Une miche de pain de campagne posée sur une planche »."));
  }

  const corps = h("div", { classe: "ed-mediatheque" }, zoneDepot, envois, etatGrille, grille, outilsChoix, blocDesc);
  const actions = [];
  if (actuelle) actions.push({ libelle: estLogo ? "Retirer le logo" : "Retirer la photo", valeur: "retirer", style: "secondaire-danger" });
  actions.push({ libelle: "Annuler", valeur: null, style: "secondaire" });
  actions.push({ libelle: estLogo ? "Utiliser ce logo" : "Utiliser cette photo", valeur: "utiliser", style: "principal" });
  const f = ouvrirFenetre({
    titre: estLogo ? "Votre logo" : "Choisir une photo",
    corps, actions, echap: null, large: true,
    focus: (boite) => boite.querySelector(".ed-depot .ed-bouton")
  });
  const valider = f.element.querySelector('.ed-fenetre__actions .ed-bouton--principal');

  dessinerGrille();
  app.api.medias().then((rep) => {
    const recues = Array.isArray(rep.medias) ? rep.medias : [];
    // Une photo envoyée pendant le chargement est déjà dans `medias` : on
    // la garde en tête si le serveur ne la liste pas encore.
    medias = ajoutees.filter((m) => !recues.some((x) => x.id === m.id)).concat(recues);
    memoire = medias.slice();
    chargee = true;
    if (f.voile.isConnected) dessinerGrille();
  }).catch((e) => {
    if (e && e.statut === 401) { app.connexionExpiree(); return; }
    erreurChargement = "Vos photos n'ont pas pu être chargées. " + messageErreur(e) + " Vous pouvez quand même en ajouter.";
    if (f.voile.isConnected) dessinerGrille();
  });

  const fin = await f.promesse;
  if (fin === "utiliser") {
    const desc = champDesc ? champDesc.value.replace(/\s+/g, " ").trim() : null;
    app.executer((c) => {
      ecrireChemin(c, chemin, choisie);
      if (cheminDesc) ecrireChemin(c, cheminDesc, desc);
    });
    if (choisie !== actuelle) annoncer(estLogo ? "Logo changé." : "Photo changée.");
  } else if (fin === "retirer") {
    app.executer((c) => {
      ecrireChemin(c, chemin, "");
      if (cheminDesc) ecrireChemin(c, cheminDesc, "");
    });
    annoncer(estLogo ? "Logo retiré : le nom du site s'affiche à sa place." : "Photo retirée de la page.");
  }
}
