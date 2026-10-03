/* =========================================================
   Le cadre — la page du site, dans l'éditeur
   =========================================================

   La page est rendue DANS LE NAVIGATEUR par les modules mêmes du serveur
   (`/rendu/page.js`) et écrite dans une <iframe> chargée sur `/admin/cadre`
   (un document vide, de même origine). Ce que voit l'artisan est donc ce
   que verront ses visiteurs, au pixel près — y compris les règles pour
   téléphone, puisque les media queries suivent la largeur de l'iframe.

   Premier rendu : `document.open / write / close`. ⚠️ `document.open()`
   RETIRE tous les écouteurs du document et de sa fenêtre : ils sont posés
   APRÈS `close()`, jamais avant.

   Rendus suivants : le <body> est remplacé (`rendreCorps`) et le <head>
   mis à jour pièce par pièce (feuilles, polices, variables du thème) : la
   page ne se recharge pas, le défilement reste où il était.

   Un texte tapé ne redessine RIEN : seuls les AUTRES nœuds qui affichent
   le même chemin sont mis à jour (le nom du site est en haut et en bas),
   jamais celui qui a le focus — le curseur repartirait au début (leçon de
   Graine de Pensée). Et un redessin demandé pendant la frappe attend que
   le champ soit quitté. */

import { rendrePage, rendreCorps, PAGE_ACCUEIL } from "/rendu/page.js";
import { BLOCS } from "/rendu/registre.js";
import { POLICES } from "/rendu/themes.js";
import { texteRiche, texteBrut, echapper, estVide } from "/rendu/outils.js";

const riche = (html) => texteRiche(html, { polices: POLICES });

/* Le texte d'un champ, tel qu'on le range dans le contenu.

   Le navigateur écrit une espace insécable pour garder visible une espace
   tapée en fin de ligne : on la rend ordinaire quand elle touche une autre
   espace ou le bord, pour ne pas semer des « &nbsp; » dans le contenu. Une
   insécable voulue (« 14 h ») reste. */
export function valeurDuChamp(el) {
  if (el.hasAttribute("data-edit-riche")) {
    let html = riche(el.innerHTML)
      .replace(/&nbsp;(?=\s|$|<br>)/g, " ")
      .replace(/(^|\s|<br>)&nbsp;/g, "$1 ")
      .replace(/(<br>\s*)+$/, "");
    return estVide(html) ? "" : html;
  }
  return el.textContent
    .replace(/[\r\n]+/g, " ")
    .replace(/ (?=\s|$)/g, " ")
    .replace(/(^|\s) /g, "$1 ");
}

function marquerVide(el) {
  const vide = el.hasAttribute("data-edit-riche") ? estVide(el.innerHTML) : el.textContent.trim() === "";
  el.toggleAttribute("data-vide", vide);
}

export function creerCadre(app, conteneur) {
  const iframe = document.createElement("iframe");
  iframe.className = "ed-cadre";
  iframe.title = "Votre page, telle que la verront vos visiteurs";
  let doc = null;
  let win = null;
  let ecrit = false;
  let renduEnAttente = false;
  let tete = null;           // minuterie de la mise à jour du <head>
  // Le dernier geste : clavier ou pointeur (souris, doigt). Seul un focus
  // venu du clavier mérite l'astuce d'Alt+F10, et une fois par séance.
  let geste = "pointeur";
  let astuceDite = false;
  const noterGeste = (e) => { geste = e.type === "keydown" ? "clavier" : "pointeur"; };
  document.addEventListener("keydown", noterGeste, true);
  document.addEventListener("pointerdown", noterGeste, true);
  const socle = (document.getElementById("editeur") || document.body).dataset.socle || "";
  const versionCss = socle ? "?v=" + encodeURIComponent(socle) : "";

  const champActif = () => {
    if (!doc || !doc.hasFocus()) return null;
    const a = doc.activeElement;
    return a && a.closest ? a.closest("[data-edit]") : null;
  };

  /* En édition, TOUTES les feuilles de blocs sont chargées d'avance : une
     section ajoutée s'affiche aussitôt mise en forme, au lieu d'apparaître
     une seconde en vrac le temps que sa feuille arrive. Plus la feuille de
     l'éditeur, qui ne sert que dans le cadre. */
  function feuillesEdition() {
    if (app.etat.mode !== "edition") return [];
    return Object.keys(BLOCS).map((t) => "/css/blocs/" + t + ".css").concat("/editeur/cadre.css" + versionCss);
  }

  function rendre() {
    const contenu = app.etat.contenuAffiche();
    const pageId = app.etat.pageId;
    return {
      page: rendrePage({
        contenu, client: app.etat.site, pageId,
        edition: app.etat.mode === "edition",
        origine: "", chemin: pageId === PAGE_ACCUEIL ? "/" : "/" + pageId
      }),
      contenu, pageId
    };
  }

  function premierRendu() {
    try {
      doc = iframe.contentDocument;
      win = iframe.contentWindow;
      if (!doc) throw new Error("document du cadre inaccessible");
    } catch (e) {
      app.cadreEnPanne(e);
      return;
    }
    const { page } = rendre();
    const extras = feuillesEdition()
      .filter((href) => !page.includes('href="' + href + '"'))
      .map((href) => '<link rel="stylesheet" href="' + echapper(href) + '" data-ed>').join("");
    ecrit = true;
    doc.open();
    // Une fonction de remplacement, pas une chaîne : « $& » ou « $' » dans
    // une adresse y seraient interprétés.
    doc.write(page.replace("</head>", () => extras + "</head>"));
    doc.close();
    brancher();
    preparer();
    // La page est écrite AVANT que ses feuilles de style n'arrivent : sans
    // ce voile, elle s'affichait une seconde en HTML brut (liste à puces,
    // liens bleus) — de quoi croire le site cassé (essai du 3 octobre 2026).
    // Le voile tombe quand toutes les feuilles ont répondu, ou au bout de
    // quatre secondes : une police lente ne doit pas cacher la page.
    iframe.classList.add("est-en-chargement");
    const feuilles = [...doc.querySelectorAll('link[rel="stylesheet"]')].filter((l) => !l.sheet);
    Promise.race([
      Promise.all(feuilles.map((l) => new Promise((ok) => {
        l.addEventListener("load", ok, { once: true });
        l.addEventListener("error", ok, { once: true });
      }))),
      new Promise((ok) => setTimeout(ok, 4000))
    ]).then(() => iframe.classList.remove("est-en-chargement"));
  }

  /* `forcer` : redessiner même pendant la frappe (annuler / rétablir au
     clavier depuis un champ) — le focus est alors rendu au même champ. */
  function rafraichir({ forcer = false, enHaut = false } = {}) {
    if (!doc || !ecrit) return;
    const actif = champActif();
    if (actif && !forcer) { renduEnAttente = true; return; }
    renduEnAttente = false;
    const cheminActif = actif ? actif.getAttribute("data-edit") : null;
    // Une photo qui avait le focus le retrouve, elle aussi : « Utiliser
    // cette photo » redessine la page, et le focus rendu à la photo par la
    // médiathèque partait avec l'ancienne image (relecture du 3 octobre
    // 2026). On la retrouve par son chemin, pas par l'élément remplacé.
    const photoActive = !actif && doc.hasFocus() && doc.activeElement && doc.activeElement.closest
      ? doc.activeElement.closest("[data-edit-img]") : null;
    const cheminPhoto = photoActive ? photoActive.getAttribute("data-edit-img") : null;
    const { page, contenu, pageId } = rendre();
    synchroniserTete(new DOMParser().parseFromString(page, "text/html"));
    const y = win.scrollY;
    doc.body.innerHTML = rendreCorps({ contenu, client: app.etat.site, pageId, edition: app.etat.mode === "edition" });
    // « instant » : la page du site défile en douceur (scroll-behavior),
    // et un redessin ne doit pas la faire glisser sous les yeux.
    win.scrollTo({ top: enHaut ? 0 : y, behavior: "instant" });
    preparer();
    if (cheminActif) {
      const el = [...doc.querySelectorAll("[data-edit]")].find((n) => n.getAttribute("data-edit") === cheminActif);
      if (el) {
        el.focus({ preventScroll: true });
        const sel = doc.getSelection();
        sel.selectAllChildren(el);
        sel.collapseToEnd();
      }
    } else if (cheminPhoto && app.etat.mode === "edition") {
      const el = [...doc.querySelectorAll("[data-edit-img]")].find((n) => n.getAttribute("data-edit-img") === cheminPhoto);
      if (el) el.focus({ preventScroll: true });
    }
  }

  function synchroniserTete(neuf) {
    if (doc.title !== neuf.title) doc.title = neuf.title;
    const styleNeuf = neuf.head.querySelector("style");
    let style = doc.head.querySelector("style");
    if (styleNeuf) {
      if (!style) {
        style = doc.createElement("style");
        doc.head.append(style);
      }
      if (style.textContent !== styleNeuf.textContent) style.textContent = styleNeuf.textContent;
    }
    const voulus = [...neuf.head.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute("href")).concat(feuillesEdition());
    const presents = new Map([...doc.head.querySelectorAll('link[rel="stylesheet"]')].map((l) => [l.getAttribute("href"), l]));
    for (const [href, l] of presents) if (!voulus.includes(href)) l.remove();
    for (const href of voulus) {
      if (presents.has(href)) continue;
      const l = doc.createElement("link");
      l.rel = "stylesheet";
      l.href = href;
      if (href.startsWith("/editeur/")) l.dataset.ed = "";
      // La feuille de l'éditeur reste la dernière : elle complète les autres.
      const cadreCss = doc.head.querySelector('link[href^="/editeur/"]');
      doc.head.insertBefore(l, href.startsWith("/editeur/") ? null : cadreCss);
      presents.set(href, l);
    }
  }

  /* Le <head> seul (titre de l'onglet, thème) : quelques centaines de
     millisecondes après la dernière frappe, pas à chaque lettre. */
  function majTete() {
    if (!doc || !ecrit) return;
    clearTimeout(tete);
    tete = setTimeout(() => synchroniserTete(new DOMParser().parseFromString(rendre().page, "text/html")), 250);
  }

  /* Après chaque rendu : les champs deviennent modifiables, les photos
     atteignables au clavier.

     Un texte riche annonce son raccourci (`aria-keyshortcuts`) : Taille,
     Police et Effacer n'ont pas d'autre chemin au clavier qu'Alt+F10, et
     rien ne le disait (relecture du 3 octobre 2026). */
  function preparer() {
    if (app.etat.mode === "edition") {
      for (const el of doc.querySelectorAll("[data-edit]")) {
        if (el.hasAttribute("data-edit-riche")) {
          el.contentEditable = "true";
          el.setAttribute("aria-keyshortcuts", "Alt+F10");
        } else {
          // `plaintext-only` : le navigateur n'y insère aucune balise. Un
          // navigateur qui ne le connaît pas lève : repli sur `true`, et
          // c'est `textContent` qui fait le ménage à la lecture.
          try { el.contentEditable = "plaintext-only"; } catch { el.contentEditable = "true"; }
          if (el.contentEditable !== "plaintext-only") el.dataset.edRepli = "";
        }
        el.spellcheck = true;
        marquerVide(el);
      }
      for (const el of doc.querySelectorAll("[data-edit-img]")) {
        el.setAttribute("tabindex", "0");
        el.setAttribute("role", "button");
        const alt = el.getAttribute("alt");
        el.setAttribute("aria-label", alt ? "Changer la photo : " + alt : "Choisir une photo");
      }
    }
    marquerChoix(app.etat.blocChoisi);
    app.apresRenduCadre();
  }

  function marquerChoix(id) {
    if (!doc) return;
    for (const s of doc.querySelectorAll("section[data-ed-choisi]")) s.removeAttribute("data-ed-choisi");
    const s = id ? sectionDe(id) : null;
    if (s && app.etat.mode === "edition") s.setAttribute("data-ed-choisi", "");
  }

  function sectionDe(id) {
    if (!doc) return null;
    return [...doc.querySelectorAll("section[data-bloc]")].find((s) => s.getAttribute("data-bloc") === id) || null;
  }

  /* Un texte modifié ailleurs (ou dans un autre nœud du même chemin). */
  function texteModifie(chemin, valeur, origine) {
    if (!doc || !ecrit) return 0;
    let n = 0;
    for (const el of doc.querySelectorAll("[data-edit]")) {
      if (el.getAttribute("data-edit") !== chemin) continue;
      n++;
      if (el === origine || el === doc.activeElement) continue;
      if (el.hasAttribute("data-edit-riche")) el.innerHTML = riche(valeur);
      else el.textContent = typeof valeur === "string" ? valeur : "";
      marquerVide(el);
    }
    if (/^(site|pages|theme)\./.test(chemin)) majTete();
    return n;
  }

  /* Lit un champ et écrit sa valeur dans l'état. `fusion` : un même pas
     d'annulation pour toute la frappe dans ce champ. */
  function enregistrerChamp(el, { fusion = null } = {}) {
    if (!el || app.etat.mode !== "edition") return;
    const chemin = el.getAttribute("data-edit");
    if (!chemin) return;
    marquerVide(el);
    app.etat.modifier(chemin, valeurDuChamp(el), { fusion: fusion || "texte:" + chemin, origine: el });
  }

  /* ----- Les gestes dans la page ----- */

  /* Un <br> là où le curseur est. `insertLineBreak` n'existe pas partout :
     repli sur l'insertion d'un <br> (un navigateur ancien a pu lever pour
     une commande inconnue, d'où le try). */
  function sautDeLigne() {
    let fait = false;
    try { fait = doc.execCommand("insertLineBreak"); } catch { fait = false; }
    if (!fait) doc.execCommand("insertHTML", false, "<br>");
  }

  function coller(e, champ) {
    e.preventDefault();
    const brut = ((e.clipboardData && e.clipboardData.getData("text/plain")) || "").replace(/\r\n?/g, "\n");
    if (!brut) return;
    if (!champ.hasAttribute("data-edit-riche")) {
      doc.execCommand("insertText", false, brut.replace(/\s*\n\s*/g, " "));
      return;
    }
    // Texte brut seulement : la mise en forme d'un traitement de texte ou
    // d'une page web n'entre pas. Les retours à la ligne deviennent des
    // <br> là où le champ en accepte, des espaces ailleurs.
    const lignes = champ.hasAttribute("data-edit-lignes");
    doc.execCommand("insertHTML", false, brut.split("\n").map((l) => echapper(l)).join(lignes ? "<br>" : " "));
  }

  function surTouche(e) {
    const champ = e.target && e.target.closest ? e.target.closest("[data-edit]") : null;
    const mod = e.metaKey || e.ctrlKey;
    const cle = typeof e.key === "string" ? e.key.toLowerCase() : "";
    if (mod && !e.altKey && cle === "s") {
      e.preventDefault();
      app.enregistrerMaintenant();
      return;
    }
    if (e.altKey && e.key === "F10") {
      e.preventDefault();
      app.allerAuxOutils();
      return;
    }
    if (champ && app.etat.mode === "edition") {
      if (e.isComposing) return;
      // Entrée, avec ou sans touche de modification : jamais le <div> que le
      // navigateur insérerait de lui-même.
      if (e.key === "Enter") {
        e.preventDefault();
        if (champ.hasAttribute("data-edit-lignes")) {
          sautDeLigne();
        } else {
          champ.blur();
          app.annoncer("Texte enregistré.");
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        champ.blur();
        return;
      }
      // Une espace dans une question de la FAQ (dans un <summary>) ouvrait
      // ou fermait la question au lieu de s'écrire.
      if (e.key === " " && champ.closest("summary")) {
        e.preventDefault();
        doc.execCommand("insertText", false, " ");
        return;
      }
      if (mod && !e.altKey && ["b", "i", "u"].includes(cle) && !champ.hasAttribute("data-edit-riche")) {
        e.preventDefault();   // un champ simple n'a pas de mise en forme
        return;
      }
      if (mod && cle === "k" && champ.hasAttribute("data-edit-riche")) {
        e.preventDefault();
        app.forme.lien();
        return;
      }
      // Annuler DANS un champ : celle du navigateur — sauf juste après une
      // mise en forme faite par l'éditeur, que le navigateur ne connaît pas.
      if (mod && cle === "z" && champ.hasAttribute("data-ed-forme")) {
        e.preventDefault();
        if (e.shiftKey) app.retablir(); else app.annuler();
      }
      return;
    }
    // Hors d'un champ : l'annulation de l'éditeur.
    if (mod && !e.altKey && (cle === "z" || cle === "y")) {
      e.preventDefault();
      if (cle === "y" || e.shiftKey) app.retablir(); else app.annuler();
      return;
    }
    const photo = e.target && e.target.closest ? e.target.closest("[data-edit-img]") : null;
    if (photo && app.etat.mode === "edition" && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      app.ouvrirPhoto(photo.getAttribute("data-edit-img"));
    }
  }

  function surClic(e) {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    const lien = t.closest("a[href]");
    if (app.etat.mode !== "edition") {
      // Aperçu et version : les liens fonctionnent, sans quitter l'éditeur.
      if (!lien) return;
      const href = lien.getAttribute("href") || "";
      if (/^(tel|mailto):/i.test(href)) return;
      e.preventDefault();
      app.suivreLienApercu(href);
      return;
    }
    // ⚠️ preventDefault, JAMAIS stopPropagation : on annule l'action du
    // lien sans priver la page (ni l'éditeur) de l'événement.
    if (lien) e.preventDefault();
    const resume = t.closest("summary");
    if (resume) {
      // Le bouton « Menu » du téléphone reste ouvrable (hors de son mot) :
      // sans lui, les liens du menu seraient inatteignables en largeur
      // téléphone. Les questions de la FAQ, elles, restent ouvertes.
      const tiroir = resume.closest(".entete__tiroir");
      if (!(tiroir && !t.closest("[data-edit]"))) e.preventDefault();
    }
    const photo = t.closest("[data-edit-img]");
    if (photo) {
      e.preventDefault();
      app.ouvrirPhoto(photo.getAttribute("data-edit-img"));
      return;
    }
    const section = t.closest("section[data-bloc]");
    app.choisirBloc(section ? section.getAttribute("data-bloc") : null, { depuis: "cadre" });
  }

  function brancher() {
    // Rien ne se dépose dans la page : un fichier lâché par mégarde ferait
    // naviguer le cadre vers lui, et un texte glissé emporterait sa mise
    // en forme d'ailleurs.
    for (const ev of ["dragover", "drop", "dragstart"]) {
      doc.addEventListener(ev, (e) => {
        if (ev === "dragover" && e.dataTransfer) e.dataTransfer.dropEffect = "none";
        e.preventDefault();
      });
    }
    doc.addEventListener("click", surClic);
    doc.addEventListener("auxclick", (e) => { if (e.target.closest && e.target.closest("a[href]")) e.preventDefault(); });
    doc.addEventListener("keydown", surTouche);
    doc.addEventListener("input", (e) => {
      const champ = e.target && e.target.closest ? e.target.closest("[data-edit]") : null;
      if (champ) enregistrerChamp(champ);
    });
    doc.addEventListener("paste", (e) => {
      const champ = e.target && e.target.closest ? e.target.closest("[data-edit]") : null;
      if (champ && app.etat.mode === "edition") coller(e, champ);
    });
    doc.addEventListener("keydown", noterGeste, true);
    doc.addEventListener("pointerdown", noterGeste, true);
    doc.addEventListener("focusin", (e) => {
      app.surFocusCadre(e.target);
      direAstuce(e.target);
    });
    doc.addEventListener("focusout", (e) => {
      const champ = e.target && e.target.closest ? e.target.closest("[data-edit]") : null;
      if (champ) {
        app.etat.couperFusion();
        champ.removeAttribute("data-ed-forme");
      }
      setTimeout(() => {
        app.surSortieCadre();
        if (renduEnAttente && !champActif()) rafraichir();
      }, 0);
    });
    doc.addEventListener("mouseover", (e) => app.surSurvolCadre(e.target));
    doc.addEventListener("selectionchange", () => app.surSelectionCadre());
    win.addEventListener("scroll", () => app.repositionner(), { passive: true });
    win.addEventListener("resize", () => app.repositionner());
    // L'observateur de la fenêtre du CADRE, pour un élément du cadre.
    const Observateur = win.ResizeObserver || window.ResizeObserver;
    if (typeof Observateur === "function") new Observateur(() => app.repositionner()).observe(doc.documentElement);
  }

  /* La première fois que le CLAVIER entre dans un texte riche, on dit
     comment atteindre la mise en forme : Tab sort du texte, et la barre se
     cache avec lui. Sur un Mac, F10 demande aussi la touche fn. Une fois par
     séance : une astuce répétée à chaque champ deviendrait du bruit. */
  function direAstuce(cible) {
    if (astuceDite || geste !== "clavier" || app.etat.mode !== "edition") return;
    if (!cible || !cible.closest || !cible.closest("[data-edit-riche]")) return;
    astuceDite = true;
    app.annoncer("Astuce : Alt + F10 ouvre la barre de mise en forme (gras, taille, police…). Sur Mac : fn + Option + F10.");
  }

  /* Le cadre ne doit jamais quitter la page écrite par l'éditeur : si une
     navigation passait malgré tout (un lien oublié), on recharge le cadre
     vide et on réécrit la page, plutôt que d'afficher le site public.

     ⚠️ On compare le DOCUMENT, pas l'adresse. `document.open()` appelé
     depuis l'éditeur donne au document du cadre l'adresse de l'éditeur
     (`/admin`, c'est la règle du HTML) : un contrôle sur « /admin/cadre »
     aurait pris l'écriture elle-même pour une navigation, et rechargé le
     cadre sans fin. Une vraie navigation, elle, crée un AUTRE document. */
  iframe.addEventListener("load", () => {
    if (!ecrit) { premierRendu(); return; }
    let ailleurs = false;
    try { ailleurs = iframe.contentDocument !== doc; } catch { ailleurs = true; }
    if (ailleurs) {
      ecrit = false;
      doc = null;
      iframe.src = "/admin/cadre";
    }
  });
  iframe.addEventListener("mouseleave", () => app.quitterCadre());
  iframe.src = "/admin/cadre";
  conteneur.append(iframe);

  return {
    element: iframe,
    document: () => doc,
    fenetre: () => win,
    pret: () => ecrit && !!doc,
    rafraichir,
    majTete,
    texteModifie,
    enregistrerChamp,
    champActif,
    sectionDe,
    marquerChoix,
    /* Le rectangle d'un élément du cadre, dans les coordonnées de l'éditeur. */
    rect(el) {
      const ri = iframe.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const x = ri.left + iframe.clientLeft;
      const y = ri.top + iframe.clientTop;
      return { left: x + r.left, top: y + r.top, right: x + r.right, bottom: y + r.bottom, width: r.width, height: r.height };
    },
    /* La partie visible du cadre, dans les coordonnées de l'éditeur. */
    zone() {
      const ri = iframe.getBoundingClientRect();
      return { left: ri.left + iframe.clientLeft, top: ri.top + iframe.clientTop, right: ri.left + iframe.clientLeft + iframe.clientWidth, bottom: ri.top + iframe.clientTop + iframe.clientHeight };
    },
    defilerVersBloc(id) {
      const s = sectionDe(id);
      if (!s) return;
      const doux = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      s.scrollIntoView({ behavior: doux ? "smooth" : "auto", block: "start" });
    },
    defilerVersAncre(ancre) {
      if (!doc) return false;
      const cible = ancre ? doc.getElementById(ancre) : null;
      if (cible) cible.scrollIntoView({ block: "start" });
      else if (!ancre) win.scrollTo(0, 0);
      return !!cible || !ancre;
    },
    texteBrutDe: (el) => texteBrut(el ? el.innerHTML : "")
  };
}
