/* =========================================================
   Les destinations des liens — lire, écrire, décrire
   =========================================================

   Module PUR, testé sous Node.

   Une destination est une chaîne du contenu (`vers`, `lienPlan`) :
     ""                  aucun lien (le bouton n'apparaît pas sur le site)
     "#horaires"         une section de la page où est le lien
     "/" "/#horaires"    l'accueil, ou une de ses sections
     "/tarifs#prix"      une autre page, et éventuellement une section
     "tel:+33…" "mailto:…" "https://…"

   ⚠️ Le sens de « #horaires » dépend de l'endroit où le lien est rangé.
   L'en-tête et le pied sont COMMUNS à toutes les pages : chez eux,
   « #horaires » vise l'accueil (page.js le réécrit « /#horaires » ailleurs).
   Dans une section, il vise la page qui contient cette section. Renommer une
   ancre ou supprimer une page sans tenir compte de ça réécrirait les liens
   d'une autre page. */

import { PAGE_ACCUEIL, ancresDeLaPage } from "/rendu/page.js";
import { adresseSure, destination, lienTelephone, identifiantValide, texteBrut } from "/rendu/outils.js";
import { nomDuBloc, lireChemin } from "/rendu/structure.js";

const aEnPropre = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);

/* Une erreur de saisie à montrer telle quelle à l'artisan. */
export class Refus extends Error {
  constructor(message) {
    super(message);
    this.name = "Refus";
  }
}

export const lienGlobal = (chemin) => /^(entete|pied)\./.test(String(chemin));

export function blocDuChemin(chemin) {
  const m = /^blocs\.([^.]+)\./.exec(String(chemin));
  return m ? m[1] : null;
}

/* La page dont « #ancre » parle, pour un lien rangé à `chemin`. */
export function pageDuLien(contenu, chemin, pageAffichee = PAGE_ACCUEIL) {
  if (lienGlobal(chemin)) return PAGE_ACCUEIL;
  const bloc = blocDuChemin(chemin);
  if (!bloc) return pageAffichee;
  const pages = contenu && contenu.pages ? contenu.pages : {};
  if (aEnPropre(pages, pageAffichee) && pages[pageAffichee].ordre.includes(bloc)) return pageAffichee;
  for (const [id, p] of Object.entries(pages)) if (p.ordre.includes(bloc)) return id;
  return pageAffichee;
}

/* « bouton » (il a une apparence, plein ou contour), « plan » (le lien
   « Voir le plan », qui n'accepte qu'une adresse web) ou « lien ». */
export function genreDeLien(contenu, chemin) {
  const c = String(chemin);
  if (/\.lienPlan$/.test(c)) return "plan";
  if (c === "entete.bouton.vers") return "bouton";
  const parent = lireChemin(contenu, c.replace(/\.[^.]+$/, ""));
  return parent && typeof parent === "object" && !Array.isArray(parent) && aEnPropre(parent, "style") ? "bouton" : "lien";
}

/* « +33199001234 » → « 01 99 00 12 34 » : on relit son propre numéro. */
export function telephoneLisible(numero) {
  const brut = String(numero || "").replace(/[^\d+]/g, "");
  const national = /^\+33\d{9}$/.test(brut) ? "0" + brut.slice(3) : brut;
  if (/^0\d{9}$/.test(national)) return national.replace(/(\d\d)(?=\d)/g, "$1 ");
  return String(numero || "");
}

function decoder(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/* La destination, lue pour pré-remplir la fenêtre « Où mène ce lien ? ». */
export function analyserDestination(vers) {
  const s = typeof vers === "string" ? vers.trim() : "";
  if (!s || s === "#") return { genre: "aucun" };
  if (s.startsWith("#")) return { genre: "section", ancre: s.slice(1) };
  if (/^tel:/i.test(s)) return { genre: "telephone", valeur: telephoneLisible(decoder(s.slice(4))) };
  if (/^mailto:/i.test(s)) return { genre: "email", valeur: decoder(s.slice(7)).split("?")[0] };
  if (/^https?:\/\//i.test(s)) return { genre: "web", valeur: s };
  const m = /^\/([a-z][a-z0-9-]{0,47})?(?:#(.*))?$/.exec(s);
  if (m) return { genre: "page", page: m[1] || PAGE_ACCUEIL, ancre: m[2] || "" };
  return { genre: "autre", valeur: s };
}

/* Où mène un lien INTERNE : `{ page, ancre }`, ou `null` pour un lien qui
   sort du site (téléphone, e-mail, autre site) ou qui ne mène nulle part. */
export function cibleInterne(vers, pageContexte) {
  const a = analyserDestination(vers);
  if (a.genre === "section") return { page: pageContexte, ancre: a.ancre };
  if (a.genre === "page") return { page: a.page, ancre: a.ancre || "" };
  return null;
}

const EMAIL = /^[^\s@<>()"',;:\\]+@[^\s@<>()"',;:\\]+\.[a-z]{2,}$/i;
const WEB = /^https?:\/\/[^\s/?#]+\.[^\s/?#]{2,}/i;

/* « Voir le plan » ne s'affiche sur le site qu'avec une adresse en
   « https:// » (horaires.js). La fenêtre acceptait « http:// » : le lien
   paraissait en édition, le panneau le décrivait, et il manquait sur le
   site publié, sans un mot (relecture du 3 octobre 2026). La fenêtre et le
   rendu appliquent désormais la même règle : une adresse « http:// »
   collée est réécrite en « https:// » (tous les services de plans y
   répondent), et une adresse déjà rangée qui ne passe pas se signale. */
export const planAffiche = (vers) => typeof vers === "string" && /^https:\/\//i.test(vers.trim());

/* Le choix de la fenêtre → la chaîne à ranger dans le contenu, ou un
   `Refus` qui dit quoi corriger. `pageContexte` : la page dont parle
   « #ancre » à l'endroit où le lien est rangé (voir `pageDuLien`). */
export function composerDestination(choix, { pageContexte = PAGE_ACCUEIL, plan = false } = {}) {
  const c = choix && typeof choix === "object" ? choix : {};
  let vers = "";
  switch (c.genre) {
    case "aucun":
      return "";
    case "section": {
      if (!identifiantValide(c.ancre)) throw new Refus("Choisissez la section vers laquelle mène ce lien.");
      vers = "#" + c.ancre;
      break;
    }
    case "page": {
      const page = c.page || PAGE_ACCUEIL;
      if (page !== PAGE_ACCUEIL && !identifiantValide(page)) throw new Refus("Choisissez la page vers laquelle mène ce lien.");
      const ancre = c.ancre && identifiantValide(c.ancre) ? c.ancre : "";
      // Une section de la page même où est le lien : « #ancre », la forme
      // que le site sait réécrire partout (et que le menu emploie déjà).
      if (ancre && page === pageContexte) vers = "#" + ancre;
      else vers = (page === PAGE_ACCUEIL ? "/" : "/" + page) + (ancre ? "#" + ancre : "");
      break;
    }
    case "telephone": {
      const t = lienTelephone(c.valeur);
      if (!t) throw new Refus("Ce numéro ne semble pas complet. Écrivez ses dix chiffres, par exemple 03 89 12 34 56.");
      vers = t;
      break;
    }
    case "email": {
      const e = String(c.valeur || "").trim().replace(/^mailto:/i, "");
      if (!EMAIL.test(e)) throw new Refus("Cette adresse e-mail ne semble pas complète. Exemple : bonjour@votre-entreprise.fr");
      vers = "mailto:" + e;
      break;
    }
    case "web": {
      let w = String(c.valeur || "").trim();
      // « www.exemple.fr » tapé sans « https:// » : on le complète plutôt
      // que de refuser ce que tout le monde écrit.
      if (w && !/^[a-z][a-z0-9+.-]*:/i.test(w) && !w.startsWith("/")) w = "https://" + w.replace(/^\/+/, "");
      if (plan) w = w.replace(/^http:\/\//i, "https://");
      if (!WEB.test(w)) throw new Refus("Cette adresse web ne semble pas valable. Exemple : https://www.exemple.fr");
      if (plan && !planAffiche(w)) throw new Refus("L'adresse d'un plan doit commencer par « https:// ». Copiez-la depuis la page du plan, puis collez-la ici.");
      vers = w;
      break;
    }
    default:
      throw new Refus("Choisissez où mène ce lien.");
  }
  // Le dernier mot revient aux règles du site : ce que `destination`
  // refuserait ne s'afficherait pas, autant le dire maintenant.
  if (destination(vers) !== vers || adresseSure(vers) !== vers) throw new Refus("Cette adresse n'est pas acceptée. Vérifiez-la, puis réessayez.");
  return vers;
}

/* ----- Ce que la fenêtre propose ----- */

/* Les pages, l'accueil d'abord, sous le nom que l'artisan leur connaît. */
export function nomDePage(contenu, pageId) {
  if (pageId === PAGE_ACCUEIL) return "Accueil";
  const vise = "/" + pageId;
  const liens = [].concat(
    contenu && contenu.entete && Array.isArray(contenu.entete.liens) ? contenu.entete.liens : [],
    contenu && contenu.pied && Array.isArray(contenu.pied.liens) ? contenu.pied.liens : []
  );
  for (const l of liens) {
    if (l && typeof l === "object" && typeof l.vers === "string" && l.vers.trim() === vise) {
      const t = texteBrut(l.texte);
      if (t) return t;
    }
  }
  const page = contenu && contenu.pages && aEnPropre(contenu.pages, pageId) ? contenu.pages[pageId] : null;
  return (page && texteBrut(page.titre)) || pageId;
}

export function listePages(contenu) {
  const ids = Object.keys(contenu && contenu.pages ? contenu.pages : {});
  ids.sort((a, b) => (a === PAGE_ACCUEIL ? -1 : b === PAGE_ACCUEIL ? 1 : 0));
  return ids.map((id) => ({ id, nom: nomDePage(contenu, id), adresse: id === PAGE_ACCUEIL ? "/" : "/" + id }));
}

/* Les sections d'une page qu'un lien peut viser, dans l'ordre de la page,
   avec l'ancre que le SITE leur donne (celle de `ancresDeLaPage`, la même
   fonction que le rendu : deux sections qui demanderaient la même ancre
   n'en auraient pas deux). */
export function sectionsDe(contenu, pageId) {
  if (!contenu || !contenu.pages || !aEnPropre(contenu.pages, pageId)) return [];
  const page = contenu.pages[pageId];
  const ancres = ancresDeLaPage(contenu, page);
  return page.ordre.map((id) => ({
    id,
    ancre: ancres[id] || id,
    nom: nomDuBloc(contenu.blocs[id]),
    masque: !!(contenu.blocs[id] && contenu.blocs[id].masque === true)
  }));
}

/* La destination en une phrase, pour le panneau : « Section « Horaires
   et accès » », « Page « Tarifs » », « Téléphone 01 99 00 12 34 »… */
export function decrireDestination(contenu, vers, pageContexte) {
  const a = analyserDestination(vers);
  switch (a.genre) {
    case "aucun": return "Aucun lien";
    case "telephone": return "Téléphone " + a.valeur;
    case "email": return "E-mail " + a.valeur;
    case "web": return "Site web " + a.valeur.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    case "section":
    case "page": {
      const cible = cibleInterne(vers, pageContexte);
      const pages = contenu && contenu.pages ? contenu.pages : {};
      if (!aEnPropre(pages, cible.page)) return "Page introuvable (" + vers + ")";
      const nomPage = nomDePage(contenu, cible.page);
      if (!cible.ancre) return "Page « " + nomPage + " »";
      const section = sectionsDe(contenu, cible.page).find((s) => s.ancre === cible.ancre);
      const nomSection = section ? section.nom : "#" + cible.ancre + " (introuvable)";
      // Une section masquée n'a pas d'ancre sur le site : le lien y est
      // affiché, mais ne mène nulle part. On le dit là où on lit la
      // destination (relecture du 3 octobre 2026), sans rien changer au site.
      const masquee = section && section.masque ? " — section masquée : sur le site, ce lien ne mène nulle part tant qu'elle l'est" : "";
      return (cible.page === pageContexte && a.genre === "section"
        ? "Section « " + nomSection + " »"
        : "Page « " + nomPage + " », section « " + nomSection + " »") + masquee;
    }
    default: return "Adresse " + vers;
  }
}
