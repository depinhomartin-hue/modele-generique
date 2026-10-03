/* Le Worker de ce client : le socle commun, sa fiche et son contenu livré.
   Ce fichier est identique pour tous les clients — rien d'autre ne doit
   s'y écrire. */
import { creerSite } from "../../socle/worker.js";
import client from "./client.json";
import contenu from "./contenu.json";

export default creerSite({ client, contenu });
