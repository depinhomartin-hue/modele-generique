/* =========================================================
   Petits outils DOM de l'éditeur, et ses icônes
   =========================================================

   Aucune bibliothèque, aucun gabarit HTML assemblé en chaîne avec des
   valeurs du contenu : les éléments sont créés un à un, et un texte venu
   du contenu n'entre JAMAIS par `innerHTML` (il passe par `textContent`).
   Les seules chaînes HTML posées telles quelles sont les icônes ci-dessous,
   écrites ici et nulle part ailleurs. */

/* h("button", { classe: "x", type: "button", quand: { click: f } }, "Texte")
   — `classe`, `texte`, `quand` (écouteurs), `valeur`, `coche` sont
   traités à part ; tout le reste devient un attribut (true = présent,
   false/null/undefined = absent). */
export function h(balise, props = null, ...enfants) {
  const el = document.createElement(balise);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "classe") el.className = v;
      else if (k === "texte") el.textContent = v;
      else if (k === "quand") for (const [ev, f] of Object.entries(v)) el.addEventListener(ev, f);
      else if (k === "valeur") el.value = v;
      else if (k === "coche") el.checked = !!v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  ajouterEnfants(el, enfants);
  return el;
}

export function ajouterEnfants(el, enfants) {
  for (const e of [enfants].flat(Infinity)) {
    if (e === null || e === undefined || e === false || e === "") continue;
    el.append(e instanceof Node ? e : String(e));
  }
  return el;
}

export function vider(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

let compteurIds = 0;
export function idUnique(prefixe = "ed") {
  compteurIds += 1;
  return prefixe + "-" + compteurIds;
}

/* ----- Icônes (24 × 24, trait de 2) ----- */
const TRACES = {
  annuler: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  retablir: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  ordinateur: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  tablette: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M11 18h2"/>',
  telephone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  oeil: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  oeilBarre: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.5 4.9-1.3"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  haut: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  bas: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  reglages: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  dupliquer: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  supprimer: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>',
  ajouter: '<path d="M12 5v14M5 12h14"/>',
  ajouterApres: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/>',
  lien: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  photo: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  fermer: '<path d="M6 6l12 12M18 6 6 18"/>',
  panneau: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  effacer: '<path d="M4 7V5h12v2M10 5v14M7 19h6"/><path d="m15 15 6 6M21 15l-6 6"/>',
  coche: '<path d="m5 12 5 5 9-10"/>',
  horsLigne: '<path d="M3 3l18 18"/><path d="M8.5 8.6A5 5 0 0 0 6 18h11"/><path d="M21 15.5A4 4 0 0 0 17 10h-.3A6 6 0 0 0 10.8 6"/>',
  alerte: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18h.01"/>',
  externe: '<path d="M14 4h6v6M20 4 10 14"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  envoyer: '<path d="M12 19V5M5 12l7-7 7 7"/><path d="M4 21h16"/>',
  actualiser: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
  repondre: '<path d="M10 9 5 13l5 4"/><path d="M5 13h9a5 5 0 0 1 5 5v1"/>'
};

export function icone(nom) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", "20");
  s.setAttribute("height", "20");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "2");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  s.classList.add("ed-icone");
  s.innerHTML = TRACES[nom] || "";
  return s;
}

/* Un bouton. Avec `seuleIcone`, le libellé reste lu par les lecteurs
   d'écran (texte caché) et s'affiche en bulle au survol ET au focus —
   une icône seule ne dit rien à un artisan qui la découvre. */
export function bouton({ libelle, icone: nomIcone = null, quand = null, classe = "", seuleIcone = false, bulle = null, desactive = false, presse = null, attributs = {} } = {}) {
  const b = h("button", Object.assign({
    type: "button",
    classe: "ed-bouton" + (classe ? " " + classe : "") + (seuleIcone ? " ed-bouton--icone" : ""),
    "data-bulle": seuleIcone ? (bulle || libelle) : null,
    disabled: desactive,
    "aria-pressed": presse === null ? null : String(!!presse)
  }, attributs));
  if (nomIcone) b.append(icone(nomIcone));
  b.append(h("span", { classe: seuleIcone ? "ed-cache" : "ed-bouton__texte" }, libelle));
  if (quand) b.addEventListener("click", quand);
  return b;
}

/* Le premier et le dernier élément atteignables au clavier d'un conteneur. */
export function focusables(racine) {
  return [...racine.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.closest("[hidden], [inert]") && el.getClientRects().length > 0);
}
