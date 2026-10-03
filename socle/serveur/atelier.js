/* Le Durable Object de l'atelier — un par client, nom fixe « site ».

   Ce fichier est la SEULE porte vers `cloudflare:workers` : toute la
   logique vit dans atelier-coeur.js, testable sous Node. Chaque méthode
   ci-dessous est appelable par le Worker (RPC) ; la liste est exactement
   `METHODES_RPC`, et `npm test` vérifie qu'elle n'a pas divergé.

   Le Durable Object reçoit le même `env` que le Worker (KV, R2, variables) :
   c'est lui qui écrit KV à la publication, pour que le contrôle de révision
   et l'écriture ne fassent qu'un. */

import { DurableObject } from "cloudflare:workers";
import { CoeurAtelier } from "./atelier-coeur.js";

export class Atelier extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.coeur = new CoeurAtelier(ctx.storage, env);
  }

  api(demande) { return this.coeur.api(demande); }
  session(demande) { return this.coeur.session(demande); }
  demanderLien(demande) { return this.coeur.demanderLien(demande); }
  verifierLien(demande) { return this.coeur.verifierLien(demande); }
  entrer(demande) { return this.coeur.entrer(demande); }
  entrerParLienDemo(demande) { return this.coeur.entrerParLienDemo(demande); }
  deconnecter(demande) { return this.coeur.deconnecter(demande); }
  signalerEchecEnvoi(demande) { return this.coeur.signalerEchecEnvoi(demande); }
  deposerMessage(demande) { return this.coeur.deposerMessage(demande); }

  /* L'alarme : c'est la PLATEFORME qui l'appelle, à l'heure posée par le
     cœur (`armerAlarme`), et non le Worker — elle n'est pas dans
     `METHODES_RPC`. Elle purge les messages de plus d'un an même quand plus
     rien ne réveille le Durable Object (atelier-coeur.js, GARDE_MESSAGES). */
  alarm() { return this.coeur.alarme(); }
}
