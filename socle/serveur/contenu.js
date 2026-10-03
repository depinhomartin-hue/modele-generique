/* La lecture du contenu publié.

   Le contenu du client vit dans SON espace KV (`CONTENU`, clé `publie`),
   écrit par l'éditeur à chaque publication (phase 2). Tant que rien n'a été
   publié — ou si KV ne répond pas —, le site affiche le contenu livré avec
   le client (`clients/<nom>/contenu.json`, embarqué au déploiement).

   « Je ne sais pas lire » ne doit jamais devenir « il n'y a rien » : une
   panne de KV donne le site livré, pas une page blanche. */

import { normaliser } from "../public/rendu/page.js";

export const CLE_PUBLIE = "publie";

export async function lireContenu(env, contenuLivre) {
  if (env && env.CONTENU && typeof env.CONTENU.get === "function") {
    try {
      const publie = await env.CONTENU.get(CLE_PUBLIE, "json");
      if (publie && typeof publie === "object") return normaliser(publie);
    } catch (e) {
      console.error("Lecture du contenu publié impossible, repli sur le contenu livré :", e);
    }
  }
  return normaliser(contenuLivre);
}
