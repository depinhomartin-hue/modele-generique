/* =========================================================
   Le registre des blocs
   =========================================================

   La SEULE liste des genres de blocs que le socle sait dessiner. Ajouter
   un bloc au catalogue, c'est un fichier dans `blocs/`, sa feuille dans
   `css/blocs/`, et une ligne ici. Un type absent de ce registre est écarté
   à la lecture du contenu (voir `normaliser`, page.js) : un contenu venu
   d'une version plus récente du socle ne fait jamais planter la page. */

import accroche from "./blocs/accroche.js";
import presentation from "./blocs/presentation.js";
import prestations from "./blocs/prestations.js";
import galerie from "./blocs/galerie.js";
import avis from "./blocs/avis.js";
import horaires from "./blocs/horaires.js";
import faq from "./blocs/faq.js";
import appel from "./blocs/appel.js";
import contact from "./blocs/contact.js";

export const BLOCS = Object.freeze(
  Object.fromEntries([accroche, presentation, prestations, galerie, avis, horaires, faq, appel, contact]
    .map((b) => [b.type, b]))
);

export function typeConnu(type) {
  return typeof type === "string" && Object.prototype.hasOwnProperty.call(BLOCS, type);
}

/* Un bloc neuf naît COMPLET : tous ses champs écrits, depuis son modèle. */
export function nouveauBloc(type) {
  return typeConnu(type) ? BLOCS[type].modele() : null;
}
