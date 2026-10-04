/* Le Worker de ce client : le socle commun, sa fiche et son contenu livré.
   Ce fichier est identique pour tous les clients — rien d'autre ne doit
   s'y écrire.

   La classe `Atelier` (le Durable Object de l'administration) doit être
   exportée par le point d'entrée du Worker : c'est là que Cloudflare la
   cherche, sous le nom donné dans wrangler.toml. */
import { creerSite } from "../../socle/worker.js";
import client from "./client.json";
import contenu from "./contenu.json";

export { Atelier } from "../../socle/serveur/atelier.js";

export default creerSite({ client, contenu });
