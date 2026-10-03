/* =========================================================
   Le registre des blocs
   =========================================================

   La SEULE liste des genres de blocs que le socle sait dessiner. Ajouter
   un bloc au catalogue, c'est un fichier dans `blocs/`, sa feuille dans
   `css/blocs/`, et une ligne ici. Un type absent de ce registre est écarté
   à la lecture du contenu (voir `normaliser`, page.js) : un contenu venu
   d'une version plus récente du socle ne fait jamais planter la page.

   Chaque module de bloc décrit aussi ce que l'éditeur peut en régler
   (`reglages`), les listes qu'on y allonge (`listes`) et une phrase qui dit
   à quoi il sert (`description`). L'éditeur lit ces descriptions ; il n'en
   recopie aucune : deux copies d'une même règle finissent toujours par
   diverger (Graine de Pensée l'a payé avec la liste des pages de son
   éditeur). */

import accroche from "./blocs/accroche.js";
import presentation from "./blocs/presentation.js";
import prestations from "./blocs/prestations.js";
import galerie from "./blocs/galerie.js";
import avis from "./blocs/avis.js";
import horaires from "./blocs/horaires.js";
import faq from "./blocs/faq.js";
import appel from "./blocs/appel.js";
import contact from "./blocs/contact.js";

/* L'ordre de cette liste est celui du choix « Ajouter une section » : de
   l'entrée de la page vers le contact, comme on lit un site vitrine. */
const ORDRE = [accroche, presentation, prestations, galerie, avis, horaires, faq, appel, contact];

/* Les descriptions sont FIGÉES : l'éditeur les reçoit par référence, et un
   `choix.sort()` ou un `push` distrait de sa part changerait les règles du
   rendu pour toute la page, sans un mot. Un objet figé refuse la
   modification — dans un module, il lève : on le verrait.
   (Les modèles, eux, ne sont pas figés : `modele()` fabrique un objet neuf
   à chaque appel, que l'éditeur peut remplir.) */
function figer(v, vus = new Set()) {
  if (v && typeof v === "object" && !vus.has(v)) {
    vus.add(v);
    Object.freeze(v);
    for (const x of Object.values(v)) figer(x, vus);
  }
  return v;
}
for (const b of ORDRE) figer(b);

export const BLOCS = Object.freeze(Object.fromEntries(ORDRE.map((b) => [b.type, b])));

export function typeConnu(type) {
  return typeof type === "string" && Object.prototype.hasOwnProperty.call(BLOCS, type);
}

/* Un bloc neuf naît COMPLET : tous ses champs écrits, depuis son modèle. */
export function nouveauBloc(type) {
  return typeConnu(type) ? BLOCS[type].modele() : null;
}

/* Ce que propose « Ajouter une section » : le nom et la phrase de chaque
   genre, dans l'ordre de `ORDRE`. */
export const CATALOGUE = Object.freeze(ORDRE.map((b) => Object.freeze({ type: b.type, nom: b.nom, description: b.description })));

/* ----- La valeur d'un réglage -----

   La règle est UNE, et le rendu comme l'éditeur la suivent : la valeur du
   bloc si elle fait partie des choix ; sinon celle du modèle si elle en
   fait partie ; sinon le premier choix. Une case n'est cochée que par un
   vrai `true`.

   Sans elle, un fond inconnu (un contenu abîmé, ou un choix retiré du socle
   après la mise en ligne d'un client) était dessiné « clair » pendant que
   l'éditeur, en suivant le modèle, affichait « Foncé » : l'écran disait
   une chose et la page en montrait une autre.

   `reglage` est un descripteur, ou sa clé (« fond ») cherchée parmi ceux
   du bloc. Un réglage inconnu rend `undefined`. */
/* Un réglage peut ne valoir que dans un cas (`seulementSi`, par exemple le
   fond de l'accroche, sans effet quand la photo est en fond) : l'éditeur ne
   le propose alors que dans ce cas. La condition se lit par `valeurReglage`,
   pour suivre exactement ce que le rendu dessine. */
export function reglageActif(bloc, reglage) {
  const r = reglage && typeof reglage === "object" ? reglage : null;
  if (!r || !r.seulementSi || typeof r.seulementSi !== "object") return true;
  return Object.entries(r.seulementSi).every(([cle, attendu]) => valeurReglage(bloc, cle) === attendu);
}

export function valeurReglage(bloc, reglage) {
  const b = bloc && typeof bloc === "object" && !Array.isArray(bloc) ? bloc : {};
  const aEnPropre = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const descripteur = typeof reglage === "string"
    ? (typeConnu(b.type) ? BLOCS[b.type].reglages.find((r) => r.cle === reglage) : undefined)
    : reglage;
  if (!descripteur || typeof descripteur !== "object" || typeof descripteur.cle !== "string") return undefined;
  const cle = descripteur.cle;
  const propre = aEnPropre(b, cle) ? b[cle] : undefined;
  if (descripteur.type === "case") return propre === true;
  const choix = Array.isArray(descripteur.choix) ? descripteur.choix : [];
  if (!choix.length) return undefined;
  const valide = (v) => choix.some((c) => c && c.valeur === v);
  if (valide(propre)) return propre;
  const modele = typeConnu(b.type) ? BLOCS[b.type].modele() : {};
  if (valide(modele[cle])) return modele[cle];
  return choix[0].valeur;
}
