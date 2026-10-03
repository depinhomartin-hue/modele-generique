/* =========================================================
   Déployer le socle chez les clients, en vagues
   =========================================================

   npm run deployer -- [--vague demo|pilote|tous] [--client <id>] [--a-blanc]

   La mise à jour du socle se fait LE MÊME JOUR chez tout le monde, en
   trois vagues (PROCESSUS.md, § 5) : les maquettes (`"demo": true`), puis
   les clients pilotes (`"pilote": true` dans client.json), puis tous les
   autres. `--vague demo` s'arrête après la première, `--vague pilote`
   après la deuxième ; `tous` (par défaut) va jusqu'au bout. Entre deux
   vagues, c'est le moment de regarder les sites de ses propres yeux.
   `--client <id>` ne déploie que ce client-là, avec les mêmes garde-fous.

   Avant tout, trois refus (3 octobre 2026) :
   - le dépôt a des modifications non enregistrées : on ne déploie que ce
     qui est dans git, sinon « revenir à l'étiquette précédente » ne
     ramènerait pas ce qui était en ligne ;
   - `npm run verifier` échoue ;
   - `wrangler whoami` n'affiche pas le compte d'atelier.json. Le Mac a
     plusieurs comptes Cloudflare : un login pour un autre projet écrase
     celui de l'atelier, et un déploiement partirait sur le mauvais compte
     (leçon de Graine de Pensée). Le compte est REVÉRIFIÉ avant chaque
     client, et son identifiant est imposé à wrangler
     (`CLOUDFLARE_ACCOUNT_ID`) : même un login changé en cours de route ne
     peut pas déployer ailleurs.

   Puis TOUS les clients du plan sont contrôlés (controler.mjs, avec
   `--production` pour un client qui n'est pas une maquette) AVANT le
   premier déploiement : un ✗ chez le dernier client arrête tout sans
   qu'aucun site n'ait changé. Ce contrôle préalable refuse aussi tout ce
   qui ferait échouer un déploiement À COUP SÛR, même quand controler
   l'accepte (3 octobre 2026) :
   - un espace de contenu qui vaut encore « a-creer » : controler le
     tolère sur une maquette (son étape 2 passe avant la création du KV),
     mais `wrangler deploy` le refuse — la vague s'arrêtait en route, après
     avoir déployé les maquettes classées avant elle ;
   - deux clients de l'atelier (tous, pas seulement ceux du plan) qui
     partagent un espace de contenu, un espace photos ou un nom de Worker :
     la publication de l'un remplacerait le site de l'autre.

   Enfin, pour chaque client, dans l'ordre : `wrangler deploy`, puis le
   VRAI site — l'accueil et /robots.txt en 200 (et /robots.txt qui dit ce
   qu'il doit dire : fermé pour une maquette, ouvert pour un client), la
   redirection de www pour un domaine QUI DÉCLARE www dans ses routes. Un
   domaine sans www n'est qu'un ⚠ pour controler : l'exiger ici arrêtait,
   APRÈS son déploiement réussi, chaque vague au même client (3 octobre
   2026). Le succès de la commande ne prouve pas que le site marche. Le
   premier échec arrête tout et dit comment revenir en arrière.

   `--a-blanc` n'exécute RIEN — ni git, ni vérification, ni wrangler — et
   affiche le plan.

   Pour les tests seulement :
   - `ATELIER_WRANGLER` remplace le binaire wrangler (sinon `npx wrangler`) ;
   - `ATELIER_ORIGINE` remplace « https://<hôte> » dans la vérification du
     site (« {hote} » y est remplacé par l'hôte) ;
   - `ATELIER_PATIENCE_MS` : l'attente entre deux essais de cette
     vérification (3 000 ms par défaut — un site tout juste déployé peut
     mettre quelques secondes à répondre).
   `ATELIER_RACINE` (une copie de l'atelier) SANS `ATELIER_WRANGLER` est
   refusé : un test ne doit jamais pouvoir pousser une copie sur le vrai
   compte. */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { identifiantValide } from "../socle/public/rendu/outils.js";
import {
  racineAtelier, lireArguments, lireJson, lireToml, estLance, controler, lignesDuRapport, bilan, ERREUR, ATTENTION,
  espaceContenuManquant, routeDeclaree, ressourcesPartagees, phrasePartage
} from "./controler.mjs";

export const VAGUES = Object.freeze([
  Object.freeze({ cle: "demo", nom: "les maquettes" }),
  Object.freeze({ cle: "pilote", nom: "les clients pilotes" }),
  Object.freeze({ cle: "tous", nom: "tous les autres" })
]);
const ESSAIS = 4;
const ATTENTE_REPONSE = 15_000;

/* ----- Les clients ----- */
export function vagueDe(fiche) {
  if (fiche.demo === true) return "demo";
  if (fiche.pilote === true) return "pilote";
  return "tous";
}

/* Tous les clients de l'atelier, dans l'ordre du déploiement : par vague,
   puis par identifiant. Une fiche ou un wrangler.toml illisible LÈVE : on
   ne déploie pas un atelier dont on ne sait pas lire un client. */
export function listerClients(racine) {
  const dossier = join(racine, "clients");
  const clients = [];
  for (const d of readdirSync(dossier, { withFileTypes: true })) {
    if (!d.isDirectory() || !identifiantValide(d.name) || !existsSync(join(dossier, d.name, "client.json"))) continue;
    const fiche = lireJson(join(dossier, d.name, "client.json"));
    let toml;
    try {
      toml = lireToml(readFileSync(join(dossier, d.name, "wrangler.toml"), "utf8"));
    } catch (e) {
      throw new Error(`clients/${d.name}/wrangler.toml illisible : ${e.message}`);
    }
    clients.push({ id: d.name, fiche, toml, vague: vagueDe(fiche) });
  }
  const rang = (v) => VAGUES.findIndex((x) => x.cle === v);
  return clients.sort((a, b) => rang(a.vague) - rang(b.vague) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function planifier(clients, { vague = "tous", client = null } = {}) {
  const jusque = VAGUES.findIndex((v) => v.cle === vague);
  if (jusque < 0) throw new Error(`vague inconnue « ${vague} » : demo, pilote ou tous.`);
  let plan = clients.filter((c) => VAGUES.findIndex((v) => v.cle === c.vague) <= jusque);
  if (client !== null) {
    const trouve = clients.find((c) => c.id === client);
    if (!trouve) throw new Error(`aucun client « ${client} » dans clients/.`);
    plan = plan.filter((c) => c.id === client);
    if (!plan.length) throw new Error(`« ${client} » est dans la vague « ${trouve.vague} », après la vague « ${vague} » demandée.`);
  }
  return plan;
}

/* L'hôte où vérifier le site : son domaine, sinon son adresse workers.dev.
   `www` : vrai si le domaine déclare aussi www dans ses routes — c'est
   seulement alors qu'on vérifie sa redirection. */
export function hoteDe(c, sousDomaine) {
  const domaine = typeof c.fiche.domaine === "string" ? c.fiche.domaine.trim() : "";
  if (domaine) return { hote: domaine, domaine, www: routeDeclaree(c.toml, "www." + domaine) };
  if (c.toml.workers_dev === false) return null;
  return { hote: (c.toml.name || "vitrine-" + c.id) + "." + sousDomaine + ".workers.dev", domaine: "", www: false };
}

/* Ce qui ferait échouer le déploiement de ce client À COUP SÛR, même si
   controler l'accepte : → "" ou la raison. Lu par le contrôle préalable ET
   par le plan à blanc — une seule règle. */
export function refusPrealable(c, sousDomaine) {
  if (!hoteDe(c, sousDomaine)) return "aucune adresse où vérifier le site (ni domaine, ni workers.dev)";
  const kv = espaceContenuManquant(c.toml);
  if (kv) return "wrangler.toml : " + kv;
  return "";
}

function urlDe(hote, chemin) {
  const modele = process.env.ATELIER_ORIGINE;
  return (modele ? modele.split("{hote}").join(hote) : "https://" + hote) + chemin;
}

/* ----- Les commandes ----- */
const sansCouleurs = (s) => String(s || "").replace(/\x1b\[[0-9;]*m/g, "");

function wrangler(args, { racine, compte, voir = false }) {
  const [cmd, debut] = process.env.ATELIER_WRANGLER ? [process.env.ATELIER_WRANGLER, []] : ["npx", ["wrangler"]];
  return spawnSync(cmd, debut.concat(args), {
    cwd: racine,
    env: Object.assign({}, process.env, { CLOUDFLARE_ACCOUNT_ID: compte.id }),
    encoding: "utf8",
    stdio: voir ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"]
  });
}

function git(args, racine) {
  return spawnSync("git", args, { cwd: racine, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/* `wrangler whoami` dit-il le compte d'atelier.json ? → "" ou la raison. */
export function compteReconnu(sortie, compte) {
  const texte = sansCouleurs(sortie);
  const m = /associated with the email\s+(\S+?)\.?\s*$/im.exec(texte);
  if (!m) return "wrangler whoami ne dit pas avec quel compte vous êtes connecté (pas connecté, ou connecté par un jeton d'API). Lancez npx wrangler login.";
  if (m[1].toLowerCase() !== compte.email.toLowerCase()) return `wrangler est connecté avec ${m[1]}, pas avec ${compte.email} (atelier.json). Lancez npx wrangler logout puis npx wrangler login.`;
  if (!texte.includes(compte.id)) return `le compte ${compte.id} (atelier.json) n'apparaît pas dans wrangler whoami.`;
  return "";
}

function verifierCompte(racine, compte) {
  const r = wrangler(["whoami"], { racine, compte });
  if (r.error) return "wrangler n'a pas pu être lancé : " + r.error.message;
  if (r.status !== 0) return "wrangler whoami a échoué : " + sansCouleurs(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ");
  return compteReconnu(r.stdout + "\n" + r.stderr, compte);
}

/* ----- Le vrai site ----- */
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function lire(url) {
  const rep = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(ATTENTE_REPONSE), headers: { "Cache-Control": "no-cache" } });
  return { statut: rep.status, location: rep.headers.get("location") || "", corps: await rep.text() };
}

/* Chaque contrôle est essayé jusqu'à `ESSAIS` fois. → "" ou la raison. */
async function verifierSite(c, sousDomaine, ecrire) {
  const adresse = hoteDe(c, sousDomaine);
  if (!adresse) return "ce site n'a aucune adresse (ni domaine, ni workers.dev)";
  const maquette = c.fiche.demo === true;
  const controles = [
    {
      quoi: "https://" + adresse.hote + "/",
      url: urlDe(adresse.hote, "/"),
      juger: (r) => (r.statut !== 200 ? "répond " + r.statut : /<html[\s>]/i.test(r.corps) ? "" : "ne renvoie pas une page")
    },
    {
      quoi: "/robots.txt",
      url: urlDe(adresse.hote, "/robots.txt"),
      juger: (r) => {
        if (r.statut !== 200) return "répond " + r.statut;
        const ferme = /^Disallow:\s*\/\s*$/m.test(r.corps);
        if (maquette && !ferme) return "n'interdit pas l'indexation, alors que c'est une maquette";
        if (!maquette && (ferme || !/^Allow:\s*\//m.test(r.corps))) return "n'autorise pas l'indexation";
        return "";
      }
    }
  ];
  // www n'est vérifié que s'il est déclaré : un domaine sans www (un
  // sous-domaine, un choix du client) n'a rien à rediriger. controler en
  // fait un ⚠ ; l'exiger ici arrêtait la vague APRÈS un déploiement réussi.
  if (adresse.domaine && adresse.www) {
    controles.push({
      quoi: "https://www." + adresse.domaine + "/",
      url: urlDe("www." + adresse.domaine, "/"),
      juger: (r) => (r.statut === 301 && r.location === "https://" + adresse.domaine + "/" ? "" : `ne renvoie pas vers https://${adresse.domaine}/ (${r.statut}${r.location ? " → " + r.location : ""})`)
    });
  } else if (adresse.domaine) {
    ecrire(`    ⚠ www.${adresse.domaine} n'est pas déclaré dans wrangler.toml : non vérifié`);
  }
  const patience = Number(process.env.ATELIER_PATIENCE_MS ?? 3000);
  for (const ctl of controles) {
    let raison = "";
    for (let essai = 1; essai <= ESSAIS; essai++) {
      try {
        raison = ctl.juger(await lire(ctl.url));
      } catch (e) {
        raison = e && e.name === "TimeoutError" ? "pas de réponse en " + ATTENTE_REPONSE / 1000 + " s" : "injoignable (" + ((e && e.cause && e.cause.code) || (e && e.message) || e) + ")";
      }
      if (!raison) break;
      if (essai < ESSAIS) await pause(patience);
    }
    if (raison) return ctl.quoi + " " + raison;
    ecrire(`    ✓ ${ctl.quoi} ` + (ctl.quoi === "/robots.txt" ? (maquette ? "ferme l'indexation (maquette)" : "ouvre l'indexation") : ctl.quoi.includes("://www.") ? "renvoie vers le domaine" : "répond"));
  }
  return "";
}

/* ----- Revenir en arrière ----- */
function etiquettes(racine) {
  const lignes = (r) => (r.status === 0 ? r.stdout.split("\n").map((l) => l.trim()).filter(Boolean) : []);
  const toutes = lignes(git(["tag", "--list", "socle-*", "--sort=-v:refname"], racine));
  const ici = lignes(git(["tag", "--points-at", "HEAD"], racine));
  return { courante: toutes.find((t) => ici.includes(t)) || "", precedente: toutes.find((t) => !ici.includes(t)) || "" };
}

/* Le conseil de retour en arrière, à recopier tel quel, au moment où l'on
   veut réparer vite. Pièges vus le 3 octobre 2026 :
   - une maquette s'enregistre APRÈS la dernière étiquette (PROCESSUS § 2) :
     à l'étiquette précédente, son dossier n'existe pas, et « redéployer
     l'étiquette précédente » échouait sur un fichier introuvable. Il n'y a
     rien à y remettre — mais ce n'est pas forcément sa PREMIÈRE mise en
     ligne : déployée par `--client` depuis un commit sans étiquette, elle
     était en ligne avant aujourd'hui. Le conseil ne tranche donc pas à sa
     place, et ne propose de retirer le site que pour une première fois ;
   - de même, un client dont l'espace de contenu valait encore « a-creer »
     à l'étiquette : `wrangler deploy` refuserait cette version-là ;
   - un client dont la CONFIGURATION a changé depuis l'étiquette (passé de
     maquette à production, domaine, routes, adresses, espaces) : la
     redéployer remettrait aussi l'ancienne — une maquette fermée à Google,
     avec sa mention, sur le domaine d'un client. Ce n'est pas toujours
     faux, c'est à regarder : un ⚠ le dit, avec la commande qui compare ;
   - le Mac porte plusieurs comptes Cloudflare : une commande recopiée à la
     main doit imposer le compte, comme l'outil le fait (CLOUDFLARE_ACCOUNT_ID),
     et commencer par vérifier le login. */
const aLEtiquette = (racine, etiquette, chemin) => {
  const r = git(["show", `${etiquette}:${chemin}`], racine);
  return r.status === 0 ? r.stdout : null;
};
/* Ce qui fait ce qu'un site EST, hors de ce que change toute montée du
   socle : `socle` (dans chaque client.json) et la date de compatibilité. */
function configurationDe(toml, fiche) {
  const t = Object.assign({}, toml);
  delete t.compatibility_date;
  const f = Object.assign({}, fiche);
  delete f.socle;
  return JSON.stringify([t, f]);
}
function retourEnArriere({ touches, epargnes, precedente, racine, compte }) {
  const l = [];
  if (!touches.length) {
    l.push("Aucun site n'a reçu la nouvelle version.");
  } else {
    l.push("Ont reçu la nouvelle version : " + touches.join(", ") + ".");
    const aRemettre = [];
    const sansVersion = [];      // { id, raison } : rien à remettre à l'étiquette
    const changes = [];          // configuration différente à l'étiquette
    for (const id of touches) {
      if (!precedente) { aRemettre.push(id); continue; }
      const ancien = aLEtiquette(racine, precedente, `clients/${id}/wrangler.toml`);
      if (ancien === null) { sansVersion.push({ id, raison: "il n'y existait pas" }); continue; }
      let tomlAncien = null;
      try { tomlAncien = lireToml(ancien); } catch { /* illisible : voir plus bas */ }
      if (!tomlAncien) { sansVersion.push({ id, raison: "son wrangler.toml y est illisible" }); continue; }
      if (espaceContenuManquant(tomlAncien)) { sansVersion.push({ id, raison: "son espace de contenu y valait encore « a-creer », et wrangler deploy refuserait cette version" }); continue; }
      aRemettre.push(id);
      try {
        const ficheAncienne = JSON.parse(aLEtiquette(racine, precedente, `clients/${id}/client.json`) || "null");
        const actuel = lireToml(readFileSync(join(racine, "clients", id, "wrangler.toml"), "utf8"));
        const ficheActuelle = lireJson(join(racine, "clients", id, "client.json"));
        if (configurationDe(tomlAncien, ficheAncienne) !== configurationDe(actuel, ficheActuelle)) changes.push(id);
      } catch {
        changes.push(id);         // impossible de comparer : à regarder, par prudence
      }
    }
    const wr = `CLOUDFLARE_ACCOUNT_ID=${compte.id} npx wrangler`;
    const whoami = `  npx wrangler whoami   # doit afficher ${compte.email}`;
    if (aRemettre.length) {
      l.push(precedente
        ? `Pour revenir en arrière chez ${aRemettre.length > 1 ? "eux" : aRemettre[0]}, redéployer l'étiquette précédente (${precedente}) :`
        : "Aucune étiquette socle-* antérieure : retrouvez le commit précédent (git log --oneline) et redéployez-le chez eux :");
      l.push(whoami);
      l.push("  git switch --detach " + (precedente || "<commit précédent>"));
      for (const id of aRemettre) l.push(`  ${wr} deploy -c clients/${id}/wrangler.toml`);
      l.push("  git switch -");
      for (const id of changes) {
        l.push(`⚠ ${id} : sa configuration a changé depuis ${precedente} (maquette ou production, domaine, routes, adresses, espaces…) — ` +
          `redéployer l'étiquette remettrait aussi l'ancienne. Comparez avant : git diff ${precedente} HEAD -- clients/${id}/client.json clients/${id}/wrangler.toml`);
      }
    }
    for (const [i, { id, raison }] of sansVersion.entries()) {
      l.push(`${id} : rien à remettre à l'étiquette ${precedente} — ${raison}.`);
      l.push(`  Si c'était sa première mise en ligne : corrigez puis relancez npm run deployer -- --client ${id}, ou retirez le site :`);
      if (i === 0 && !aRemettre.length) l.push(whoami);
      l.push(`  ${wr} delete -c clients/${id}/wrangler.toml`);
      l.push(`  S'il était déjà en ligne, il venait d'un commit postérieur à ${precedente} : retrouvez-le (git log --oneline ${precedente}..HEAD -- clients/${id}) ` +
        "et redéployez-le chez lui de la même façon (git switch --detach <ce commit>, wrangler deploy, git switch -).");
    }
  }
  if (epargnes.length) l.push("Pas touchés : " + epargnes.join(", ") + ".");
  return l;
}

/* ----- Le déploiement ----- */
export async function deployer({ racine = racineAtelier(), vague = "tous", client = null, aBlanc = false, ecrire = console.log, erreur = console.error } = {}) {
  if (process.env.ATELIER_RACINE && !process.env.ATELIER_WRANGLER) {
    erreur("✗ ATELIER_RACINE désigne une copie de l'atelier, sans faux wrangler (ATELIER_WRANGLER) : refusé, pour qu'une copie de test ne parte jamais sur le vrai compte.");
    return 1;
  }
  let atelier, clients, plan;
  try {
    atelier = lireJson(join(racine, "atelier.json"));
    const compte = atelier && atelier.compteCloudflare;
    if (!compte || typeof compte.email !== "string" || !/^[0-9a-f]{32}$/.test(String(compte.id)) || typeof atelier.sousDomaineWorkers !== "string") {
      throw new Error("atelier.json : compteCloudflare.email, compteCloudflare.id (32 caractères hexadécimaux) et sousDomaineWorkers sont attendus.");
    }
    clients = listerClients(racine);
    plan = planifier(clients, { vague, client });
  } catch (e) {
    erreur("✗ " + e.message);
    return 1;
  }
  if (!plan.length) {
    erreur("✗ Aucun client à déployer.");
    return 1;
  }
  const compte = atelier.compteCloudflare;
  const sous = atelier.sousDomaineWorkers;
  const vagues = VAGUES.map((v) => ({ v, clients: plan.filter((c) => c.vague === v.cle) })).filter((x) => x.clients.length);
  // TOUS les clients de l'atelier, pas seulement ceux du plan : deux sites
  // qui écrivent dans le même espace se détruisent l'un l'autre, quelle que
  // soit la vague qu'on pousse aujourd'hui.
  const partages = ressourcesPartagees(clients);

  if (aBlanc) {
    ecrire("Plan du déploiement — à blanc : rien n'est exécuté.\n");
    for (const p of partages) ecrire("✗ " + phrasePartage(p) + " : le déploiement serait refusé.");
    ecrire(`Avant tout : dépôt sans modification (git status), npm run verifier, wrangler whoami = ${compte.email} (${compte.id}),`);
    ecrire(`puis le contrôle de ${plan.length > 1 ? "chacun des " + plan.length + " clients" : "ce client"} (controler.mjs).`);
    for (const { v, clients: cs } of vagues) {
      ecrire(`\nVague « ${v.cle} » — ${v.nom} :`);
      for (const c of cs) {
        const adresse = hoteDe(c, sous);
        const refus = refusPrealable(c, sous);
        ecrire(`  ${c.id} (${c.fiche.demo === true ? "maquette" : "production"})`);
        ecrire(`    npm run controler -- ${c.id}${c.fiche.demo === true ? "" : " --production"}`);
        if (refus) { ecrire(`    ✗ ${refus} : il serait refusé`); continue; }
        ecrire(`    wrangler deploy -c clients/${c.id}/wrangler.toml`);
        ecrire(`    vérifier https://${adresse.hote}/ et /robots.txt` +
          (adresse.www ? `, et https://www.${adresse.domaine}/ → https://${adresse.domaine}/` : adresse.domaine ? ` (www.${adresse.domaine} n'est pas déclaré : non vérifié)` : ""));
      }
    }
    const apres = VAGUES.slice(VAGUES.findIndex((v) => v.cle === vague) + 1).map((v) => v.cle);
    if (apres.length && client === null) ecrire(`\nS'arrête après la vague « ${vague} » : ${apres.map((v) => "« " + v + " »").join(" et ")} attendront.`);
    return 0;
  }

  // 0. Deux clients qui partagent un espace : rien ne part, avant même git.
  if (partages.length) {
    for (const p of partages) erreur("✗ Arrêt avant tout déploiement : " + phrasePartage(p) + ".");
    erreur("Aucun site n'a changé. Créez à chaque client ses propres espaces (PROCESSUS.md, § 2, étape 6), reportez-les dans son wrangler.toml, puis relancez.");
    return 1;
  }

  // 1. Le dépôt. Les fichiers NON SUIVIS comptent aussi, quel que soit le
  // réglage de git : un client créé mais pas enregistré serait déployé.
  const statut = git(["status", "--porcelain", "--untracked-files=normal"], racine);
  if (statut.status !== 0) {
    erreur("✗ Refusé : " + racine + " n'est pas un dépôt git lisible (" + sansCouleurs(statut.stderr).trim() + ").");
    return 1;
  }
  if (statut.stdout.trim()) {
    const lignes = statut.stdout.trimEnd().split("\n");
    erreur("✗ Refusé : le dépôt a des modifications non enregistrées. On ne déploie que ce qui est dans git :");
    for (const l of lignes.slice(0, 10)) erreur("    " + l);
    if (lignes.length > 10) erreur(`    … et ${lignes.length - 10} de plus.`);
    return 1;
  }
  ecrire("✓ Dépôt sans modification.");

  // 2. Les vérifications du socle.
  ecrire("npm run verifier …");
  const v = spawnSync("npm", ["run", "verifier"], { cwd: racine, stdio: ["ignore", "inherit", "inherit"] });
  if (v.status !== 0) {
    erreur("✗ Refusé : npm run verifier a échoué" + (v.error ? " (" + v.error.message + ")" : "") + ".");
    return 1;
  }
  ecrire("✓ npm run verifier.");

  // 3. Le compte.
  const raisonCompte = verifierCompte(racine, compte);
  if (raisonCompte) {
    erreur("✗ Refusé : " + raisonCompte);
    return 1;
  }
  ecrire(`✓ wrangler est connecté au compte de l'atelier (${compte.email}).`);
  const { courante, precedente } = etiquettes(racine);
  if (!courante) ecrire("⚠ Ce commit ne porte pas d'étiquette socle-* : posez-la (git tag socle-x.y.z) pour pouvoir y revenir.");

  // 4. Tous les contrôles, avant le premier déploiement.
  for (const c of plan) {
    const rapport = controler({ racine, id: c.id, production: c.fiche.demo !== true });
    const b = bilan(rapport);
    ecrire(`\nContrôle de « ${c.id} » (${rapport.mode}) :`);
    for (const l of lignesDuRapport(rapport)) if (l) ecrire("  " + l);
    if (b[ERREUR]) {
      erreur(`✗ Arrêt avant tout déploiement : « ${c.id} » a ${b[ERREUR]} point${b[ERREUR] > 1 ? "s" : ""} à corriger. Aucun site n'a changé.`);
      return 1;
    }
    const refus = refusPrealable(c, sous);
    if (refus) {
      erreur(`✗ Arrêt avant tout déploiement : « ${c.id} » — ${refus}. Aucun site n'a changé.`);
      return 1;
    }
    if (b[ATTENTION]) ecrire(`  (${b[ATTENTION]} point${b[ATTENTION] > 1 ? "s" : ""} à regarder, rien de bloquant)`);
  }

  // 5. Les vagues.
  const touches = [];
  const arreter = (raison, cause) => {
    erreur("\n✗ Arrêt : " + raison);
    const epargnes = plan.map((c) => c.id).filter((id) => !touches.includes(id) && id !== cause);
    for (const l of retourEnArriere({ touches, epargnes, precedente, racine, compte })) erreur(l);
    return 1;
  };
  for (const { v, clients: cs } of vagues) {
    ecrire(`\n=== Vague « ${v.cle} » — ${v.nom} ===`);
    for (const c of cs) {
      ecrire(`\n${c.id} :`);
      const raison = verifierCompte(racine, compte);
      if (raison) return arreter(raison, null);
      const d = wrangler(["deploy", "-c", join("clients", c.id, "wrangler.toml")], { racine, compte, voir: true });
      if (d.status !== 0) {
        return arreter(`wrangler deploy a échoué chez « ${c.id} »` + (d.error ? " (" + d.error.message + ")" : "") +
          ". Cloudflare garde en principe la version qui était en ligne chez lui : vérifiez-le sur le site.", c.id);
      }
      touches.push(c.id);
      const site = await verifierSite(c, sous, ecrire);
      if (site) return arreter(`le site de « ${c.id} » ne répond pas comme il faut : ${site}.`, c.id);
      ecrire(`  ✓ ${c.id} déployé et vérifié.`);
    }
    ecrire(`\n✓ Vague « ${v.cle} » terminée.`);
  }
  const reste = VAGUES.slice(VAGUES.findIndex((x) => x.cle === vague) + 1).map((x) => x.cle);
  ecrire(`\n✓ ${touches.length} site${touches.length > 1 ? "s déployés et vérifiés" : " déployé et vérifié"}.` +
    (reste.length && client === null ? ` Regardez-les, puis : npm run deployer -- --vague ${reste[0]}` : ""));
  return 0;
}

/* ----- En ligne de commande ----- */
if (estLance(import.meta.url)) {
  const usage = "Usage : npm run deployer -- [--vague demo|pilote|tous] [--client <id>] [--a-blanc]";
  let args;
  try {
    args = lireArguments(process.argv.slice(2), { drapeaux: ["--a-blanc"], options: ["--vague", "--client"] });
  } catch (e) {
    console.error("✗ " + e.message + "\n" + usage);
    process.exit(2);
  }
  if (args.positions.length) { console.error(usage); process.exit(2); }
  const code = await deployer({
    vague: args.options.get("--vague") || "tous",
    client: args.options.get("--client") ?? null,
    aBlanc: args.drapeaux.has("--a-blanc")
  });
  process.exit(code);
}
