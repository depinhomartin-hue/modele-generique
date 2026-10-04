/* Tests des outils de l'atelier — `npm test` (après tester-editeur.mjs).

   nouveau-client, controler, exporter et deployer, lancés comme Martin les
   lance (un processus Node, des arguments), mais TOUJOURS sur une copie de
   l'atelier dans un dossier temporaire (`ATELIER_RACINE`) : aucun vrai
   client n'est touché, et rien ne part sur Internet.

   - Les photos et les « vrais sites » à vérifier après un déploiement sont
     servis par un petit serveur HTTP local, refermé à la fin.
   - wrangler est remplacé par un FAUX (`ATELIER_WRANGLER`) qui note chaque
     appel. Et un PIÈGE est posé devant le PATH : un `npx` et un `wrangler`
     qui notent qu'on les a appelés et échouent. Le dernier test vérifie
     qu'ils n'ont jamais servi — le vrai wrangler n'est jamais appelé.
   - Le fichier `.acces-demo` de la démo n'est jamais lu ni recopié : il
     contient un vrai secret. Les copies sont faites fichier par fichier.

   Chaque cas rejoue une règle de la spécification du socle 0.3.0 : un test
   qui casse le jour où quelqu'un « simplifie », c'est son rôle. */
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, chmodSync, readdirSync, statSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { lireToml, controler, lirePageRendue, bilan, ERREUR, ATTENTION, liensRefusesDansUnTexte, ressourcesPartagees, texteAffiche } from "./controler.mjs";
import { contenuDepuis, contenuGenerique, ecrireToutOuRien, identifiantClientValide } from "./nouveau-client.mjs";
import { photosAExporter, dossierDeSortieSur, estPhotoDuSite, changerHebergeur, HEBERGEUR_A_COMPLETER } from "./exporter.mjs";
import { planifier, vagueDe, compteReconnu, hoteDe } from "./deployer.mjs";
import { rendrePage, normaliser } from "../socle/public/rendu/page.js";
import { restesDuModele } from "../socle/public/rendu/structure.js";
import { pageMentionsLegales, PAGE_MENTIONS } from "../socle/public/rendu/modeles-pages.js";
import { nouveauBloc } from "../socle/public/rendu/registre.js";
import { validerContenu } from "../socle/serveur/validation.js";

const RACINE = fileURLToPath(new URL("..", import.meta.url));
const DEMO = "demo-boulangerie";
const FICHIERS_DEMO = ["client.json", "contenu.json", "index.js", "wrangler.toml", ".dev.vars.exemple"];   // jamais .acces-demo
const COMPTE = JSON.parse(readFileSync(join(RACINE, "atelier.json"), "utf8")).compteCloudflare;
/* La version du socle est LUE, jamais recopiée ici (3 octobre 2026) :
   écrite « 0.3.0 » en dur, elle faisait échouer `verifier` — donc refuser
   tout déploiement — à la première montée de version faite comme le dit
   PROCESSUS.md § 5, sans le moindre défaut réel. tester-admin.mjs avait
   payé la même leçon le même jour. */
const VERSION = JSON.parse(readFileSync(join(RACINE, "package.json"), "utf8")).version;
/* Un identifiant d'espace de contenu propre à chaque client de test :
   deux clients qui en partagent un sont REFUSÉS (controler, deployer). */
const kvDe = (id) => createHash("md5").update(id).digest("hex");

let ok = 0;
const echecs = [];
function verifier(nom, condition, detail = "") {
  if (condition) ok++;
  else echecs.push(nom + (detail ? " — " + detail : ""));
}
async function groupe(nom, fn) {
  try {
    await fn();
  } catch (e) {
    echecs.push("le groupe « " + nom + " » s'est interrompu : " + (e && e.stack ? e.stack : e));
  }
}

/* ----- Le bac à sable ----- */
const BASE = mkdtempSync(join(tmpdir(), "atelier-outils-"));
const PIEGE = join(BASE, "piege");
const PIEGE_JOURNAL = join(BASE, "piege.log");
const FAUX = join(BASE, "faux-wrangler.mjs");
const FAUX_JOURNAL = join(BASE, "faux-wrangler.log");
mkdirSync(PIEGE);
for (const nom of ["npx", "wrangler"]) {
  writeFileSync(join(PIEGE, nom), "#!/bin/sh\necho \"$0 $*\" >> '" + PIEGE_JOURNAL + "'\nexit 97\n");
  chmodSync(join(PIEGE, nom), 0o755);
  // Sous Windows, cmd.exe ne lance que les .cmd (et .exe…) : le même
  // piège, dans sa langue (4 octobre 2026).
  if (process.platform === "win32") writeFileSync(join(PIEGE, nom + ".cmd"), "@echo %~nx0 %* >> \"" + PIEGE_JOURNAL + "\"\r\n@exit /b 97\r\n");
}
writeFileSync(FAUX, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.FAUX_JOURNAL, JSON.stringify({ args, compte: process.env.CLOUDFLARE_ACCOUNT_ID || "", cwd: process.cwd() }) + "\\n");
if (args[0] === "whoami") {
  const email = process.env.FAUX_EMAIL || "${COMPTE.email}";
  console.log(" ⛅️ wrangler (faux)\\n-------------------\\nGetting User settings...\\n👋 You are logged in with an OAuth Token, associated with the email " + email + ".\\n" +
    "│ Account Name │ Account ID │\\n│ " + email + "'s Account │ " + (process.env.FAUX_COMPTE || "${COMPTE.id}") + " │");
  process.exit(0);
}
if (args[0] === "deploy") {
  const fichier = args[args.indexOf("-c") + 1] || "";
  if (process.env.FAUX_ECHEC_DEPLOY && fichier.split(/[\\\\/]/).includes(process.env.FAUX_ECHEC_DEPLOY)) { console.error("✘ [ERROR] faux échec"); process.exit(1); }
  console.log("Faux déploiement de " + fichier);
  process.exit(0);
}
console.error("commande inattendue : " + args.join(" "));
process.exit(3);
`);
chmodSync(FAUX, 0o755);

/* Une copie de l'atelier : la démo (sans son secret), atelier.json, et un
   package.json dont le « verifier » ne fait que réussir (ou échouer si
   FAUX_VERIFIER_ECHEC est posé) — le vrai lancerait ces tests-ci. */
function fabriquerRacine(nom) {
  const r = join(BASE, nom);
  mkdirSync(join(r, "clients", DEMO), { recursive: true });
  for (const f of FICHIERS_DEMO) copyFileSync(join(RACINE, "clients", DEMO, f), join(r, "clients", DEMO, f));
  copyFileSync(join(RACINE, "atelier.json"), join(r, "atelier.json"));
  writeFileSync(join(r, "package.json"), JSON.stringify({
    name: "copie-atelier", private: true,
    scripts: { verifier: "node -e \"process.exit(Number(process.env.FAUX_VERIFIER_ECHEC || 0))\"" }
  }, null, 2));
  return r;
}

/* Un outil, lancé comme en vrai — de façon ASYNCHRONE : le serveur local
   doit pouvoir répondre pendant que l'outil tourne. */
function lancer(outil, args, { racine = null, env = {} } = {}) {
  return new Promise((resolu) => {
    const environnement = Object.assign({}, process.env, {
      NO_UPDATE_NOTIFIER: "1",
      npm_config_update_notifier: "false",
      FAUX_JOURNAL
    }, env);
    // Sous Windows, la variable s'appelle souvent « Path », et le
    // séparateur est « ; » : on pose le piège devant CELLE qui existe.
    const clePath = Object.keys(environnement).find((k) => k.toUpperCase() === "PATH") || "PATH";
    environnement[clePath] = PIEGE + delimiter + (environnement[clePath] || "");
    delete environnement.ATELIER_RACINE;
    if (racine) environnement.ATELIER_RACINE = racine;
    for (const [k, v] of Object.entries(env)) if (v === null) delete environnement[k];
    const p = spawn(process.execPath, [join(RACINE, "outils", outil), ...args], { cwd: RACINE, env: environnement });
    let sortie = "";
    let erreur = "";
    p.stdout.on("data", (d) => { sortie += d; });
    p.stderr.on("data", (d) => { erreur += d; });
    p.on("close", (code) => resolu({ code, sortie, erreur, tout: sortie + erreur }));
  });
}

const lireJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const ecrireJson = (f, v) => writeFileSync(f, JSON.stringify(v, null, 2) + "\n");
const appelsFaux = () => (existsSync(FAUX_JOURNAL) ? readFileSync(FAUX_JOURNAL, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const viderFaux = () => rmSync(FAUX_JOURNAL, { force: true });
const deploiements = () => appelsFaux().filter((a) => a.args[0] === "deploy").map((a) => a.args[a.args.indexOf("-c") + 1].split(/[\\/]/)[1]);

/* ----- Le serveur local : photos et faux sites ----- */
const OCTETS_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3, 4, 5]);
const OCTETS_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7]);
const PHOTO_A = "/medias/" + "a".repeat(32) + ".jpg";
const PHOTO_B = "/medias/" + "b".repeat(32) + ".png";
const PHOTO_MANQUANTE = "/medias/" + "c".repeat(32) + ".jpg";
const PHOTO_HTML = "/medias/" + "d".repeat(32) + ".jpg";
const PHOTO_REDIRIGEE = "/medias/" + "e".repeat(32) + ".jpg";     // répond 302…
const PHOTO_CIBLE = "/medias/" + "f".repeat(32) + ".jpg";         // … vers celle-ci, qui est une vraie image
const PAGE_PIEGEE = "/medias/page.html";                           // pas une photo : jamais demandée
const demandesPhotos = [];
const sites = new Map();          // hôte → { accueil, robots, www }
const demandesSites = [];
const serveur = createServer((req, res) => {
  const chemin = decodeURIComponent(req.url.split("?")[0]);
  if (chemin.startsWith("/medias/")) {
    demandesPhotos.push({ chemin, quand: performance.now() });
    if (chemin === PHOTO_A) { res.writeHead(200, { "Content-Type": "image/jpeg" }); return res.end(OCTETS_JPEG); }
    if (chemin === PHOTO_B) { res.writeHead(200, { "Content-Type": "image/png" }); return res.end(OCTETS_PNG); }
    if (chemin === PHOTO_HTML) { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<!doctype html><p>Oups</p>"); }
    if (chemin === PHOTO_REDIRIGEE) { res.writeHead(302, { Location: "http://" + req.headers.host + PHOTO_CIBLE }); return res.end(); }
    if (chemin === PHOTO_CIBLE) { res.writeHead(200, { "Content-Type": "image/jpeg" }); return res.end(OCTETS_JPEG); }
    if (chemin === PAGE_PIEGEE) { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<script>alert(document.domain)</script>"); }
    res.writeHead(404); return res.end("introuvable");
  }
  const [, hote, ...reste] = chemin.split("/");
  const suite = "/" + reste.join("/");
  demandesSites.push(hote + suite);
  const site = sites.get(hote);
  if (hote.startsWith("www.") && sites.has(hote.slice(4))) {
    const www = sites.get(hote.slice(4)).www || { statut: 301, location: "https://" + hote.slice(4) + "/" };
    res.writeHead(www.statut, www.location ? { Location: www.location } : {});
    return res.end();
  }
  if (!site) { res.writeHead(404); return res.end(); }
  if (suite === "/robots.txt") {
    res.writeHead(site.robotsStatut || 200, { "Content-Type": "text/plain" });
    return res.end(site.robots);
  }
  if (suite === "/") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<!doctype html><html lang=\"fr\"><body>ok</body></html>"); }
  res.writeHead(404); res.end();
});
await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
const LOCAL = "http://127.0.0.1:" + serveur.address().port;
const ROBOTS_FERME = "User-agent: *\nDisallow: /\n";
const ROBOTS_OUVERT = (d) => "User-agent: *\nAllow: /\n\nSitemap: https://" + d + "/sitemap.xml\n";

try {
  /* =========================================================
     La lecture de wrangler.toml
     ========================================================= */
  await groupe("lireToml", () => {
    const demo = lireToml(readFileSync(join(RACINE, "clients", DEMO, "wrangler.toml"), "utf8"));
    verifier("toml : le nom du Worker de la démo", demo.name === "vitrine-demo-boulangerie", demo.name);
    verifier("toml : workers_dev est un vrai booléen", demo.workers_dev === true);
    verifier("toml : [assets]", demo.assets && demo.assets.directory === "../../socle/public");
    verifier("toml : [[kv_namespaces]]", Array.isArray(demo.kv_namespaces) && demo.kv_namespaces[0].binding === "CONTENU" && /^[0-9a-f]{32}$/.test(demo.kv_namespaces[0].id));
    verifier("toml : [[durable_objects.bindings]] (clé pointée)", demo.durable_objects.bindings[0].class_name === "Atelier");
    verifier("toml : un tableau de chaînes", JSON.stringify(demo.migrations[0].new_sqlite_classes) === '["Atelier"]');
    verifier("toml : [vars] et leurs chaînes vides", demo.vars.COURRIEL_EXPEDITEUR === "" && demo.vars.ADRESSES_ATELIER === "");
    const routes = lireToml('name = "x" # un commentaire\nroutes = [\n  { pattern = "a.fr", custom_domain = true }, # le domaine\n  { pattern = "www.a.fr", custom_domain = true },\n]\nid = "un#dièse"\nmot = "\\u00e9t\\u00e9"\n');
    verifier("toml : routes en tables en ligne, sur plusieurs lignes, virgule finale", routes.routes.length === 2 && routes.routes[1].pattern === "www.a.fr" && routes.routes[0].custom_domain === true);
    verifier("toml : un « # » dans une chaîne n'est pas un commentaire", routes.id === "un#dièse");
    verifier("toml : les échappements \\u", routes.mot === "été");
    const leve = (t) => { try { lireToml(t); return false; } catch { return true; } };
    verifier("toml : une clé en double est refusée", leve('a = 1\na = 2\n'));
    verifier("toml : une chaîne sur plusieurs lignes est refusée, pas lue de travers", leve('a = """x\ny"""\n'));
    verifier("toml : une chaîne non fermée est refusée", leve('a = "x\n'));
    verifier("toml : une date nue est refusée", leve("a = 2025-09-01\n"));
    verifier("toml : « __proto__ » est refusé", leve('__proto__ = 1\n') && leve('[__proto__]\na = 1\n'));
  });

  /* =========================================================
     nouveau-client
     ========================================================= */
  const atelier1 = fabriquerRacine("atelier-1");
  const dossierMuller = join(atelier1, "clients", "boulangerie-muller");
  await groupe("nouveau-client : création", async () => {
    const r = await lancer("nouveau-client.mjs", ["boulangerie-muller", "Boulangerie Muller & Fils", "--theme", "atelier"], { racine: atelier1 });
    verifier("nouveau-client : code 0", r.code === 0, r.tout);
    for (const f of ["client.json", "wrangler.toml", "index.js", ".dev.vars.exemple", "contenu.json", ".acces-demo"]) {
      verifier("nouveau-client : " + f + " écrit", existsSync(join(dossierMuller, f)));
    }
    verifier("nouveau-client : aucun dossier temporaire ne reste", !readdirSync(join(atelier1, "clients")).some((n) => n.startsWith(".nouveau-")));
    // Les droits Unix (0755, 0600) n'existent pas sous Windows : Node y
    // répond toujours 666 ou 777. Là-bas, c'est le dossier personnel de
    // l'utilisateur qui protège le fichier (4 octobre 2026).
    const droitsUnix = process.platform !== "win32";
    if (droitsUnix) verifier("nouveau-client : le dossier est un dossier ordinaire (pas 0700)", (statSync(dossierMuller).mode & 0o777) === 0o755, (statSync(dossierMuller).mode & 0o777).toString(8));

    const fiche = lireJson(join(dossierMuller, "client.json"));
    const ficheDemo = lireJson(join(atelier1, "clients", DEMO, "client.json"));
    verifier("client.json : id, maquette, domaine vide, aucune adresse", fiche.id === "boulangerie-muller" && fiche.demo === true &&
      fiche.domaine === "" && Array.isArray(fiche.administration.adresses) && fiche.administration.adresses.length === 0, JSON.stringify(fiche));
    verifier("client.json : la mention de maquette", fiche.mentionDemo === "Maquette : ce site est une proposition pour Boulangerie Muller & Fils. Il n'est pas encore en ligne.", fiche.mentionDemo);
    verifier("client.json : le socle de la démo", fiche.socle === ficheDemo.socle && fiche.socle === VERSION, fiche.socle);

    verifier("index.js : identique à celui de la démo", readFileSync(join(dossierMuller, "index.js"), "utf8") === readFileSync(join(RACINE, "clients", DEMO, "index.js"), "utf8"));
    const devVars = readFileSync(join(dossierMuller, ".dev.vars.exemple"), "utf8");
    const devVarsDemo = readFileSync(join(RACINE, "clients", DEMO, ".dev.vars.exemple"), "utf8");
    verifier(".dev.vars.exemple : celui de la démo, ses chemins pointés sur le nouveau client",
      devVars === devVarsDemo.split("clients/" + DEMO + "/").join("clients/boulangerie-muller/") && !devVars.includes(DEMO));

    // wrangler.toml : FABRIQUÉ, avec les mêmes liaisons que la démo.
    const texteToml = readFileSync(join(dossierMuller, "wrangler.toml"), "utf8");
    const t = lireToml(texteToml);
    const d = lireToml(readFileSync(join(RACINE, "clients", DEMO, "wrangler.toml"), "utf8"));
    verifier("wrangler.toml : name et bucket propres au client", t.name === "vitrine-boulangerie-muller" && t.r2_buckets[0].bucket_name === "vitrine-boulangerie-muller-medias");
    verifier("wrangler.toml : l'espace de contenu reste à créer (pas celui de la démo)", t.kv_namespaces[0].id === "a-creer" && !texteToml.includes(d.kv_namespaces[0].id));
    verifier("wrangler.toml : workers_dev = true (une maquette)", t.workers_dev === true);
    const forme = (x) => JSON.stringify({
      main: x.main, compat: x.compatibility_date, assets: x.assets,
      kv: x.kv_namespaces.map((k) => k.binding), r2: x.r2_buckets.map((k) => k.binding),
      do: x.durable_objects, migrations: x.migrations, mail: x.send_email, vars: x.vars
    });
    verifier("wrangler.toml : mêmes liaisons, migrations et variables que la démo", forme(t) === forme(d), forme(t) + " ≠ " + forme(d));
    // L'espace de contenu porte un nom PROPRE au client : wrangler 4 nomme
    // l'espace d'après ce seul nom, unique sur le compte (« CONTENU » pour
    // tous échouait dès le deuxième client).
    verifier("wrangler.toml : les commandes de ses commentaires visent ce client",
      texteToml.includes("kv namespace create vitrine-boulangerie-muller-contenu -c clients/boulangerie-muller/wrangler.toml") &&
      texteToml.includes("r2 bucket create vitrine-boulangerie-muller-medias") && !texteToml.includes(DEMO) && !texteToml.includes("namespace create CONTENU"), texteToml);
    verifier("wrangler.toml : l'avertissement sur le tag « v1 » est gardé", texteToml.includes("Ne jamais") && texteToml.includes("« v1 »"));

    // Le contenu.
    const c = lireJson(join(dossierMuller, "contenu.json"));
    const types = c.pages.accueil.ordre.map((id) => c.blocs[id].type);
    verifier("contenu : la recette générique, dans l'ordre", JSON.stringify(types) === JSON.stringify(["accroche", "presentation", "prestations", "avis", "horaires", "faq", "contact"]), JSON.stringify(types));
    verifier("contenu : l'accroche porte le nom (échappé dans le texte riche)", c.blocs["accroche-1"].titre === "Boulangerie Muller &amp; Fils", c.blocs["accroche-1"].titre);
    verifier("contenu : le nom du site en texte simple", c.site.nom === "Boulangerie Muller & Fils");
    verifier("contenu : le thème demandé, avec son duo", c.theme.id === "atelier" && c.theme.duo === "epure");
    verifier("contenu : le contact avec formulaire", c.blocs["contact-1"].formulaire === true);
    const ancres = new Set(Object.values(c.blocs).map((b) => b.ancre).filter(Boolean));
    const versMenu = c.entete.liens.map((l) => l.vers).concat([c.entete.bouton.vers], c.pied.liens.map((l) => l.vers), c.blocs["accroche-1"].boutons.map((b) => b.vers));
    verifier("contenu : menu, bouton, pied et boutons de l'accroche visent des ancres existantes",
      versMenu.length >= 8 && versMenu.every((v) => v.startsWith("#") && ancres.has(v.slice(1))), JSON.stringify(versMenu));
    verifier("contenu : la page des mentions légales, au nom du client", !!c.pages["mentions-legales"] &&
      JSON.stringify(c.blocs[c.pages["mentions-legales"].ordre[0]]).includes("Boulangerie Muller &amp; Fils"));
    verifier("contenu : accepté par l'administration", validerContenu(c).ok);
    const restes = restesDuModele(c);
    verifier("contenu : l'éditeur signale les textes d'exemple ET les « [À compléter »", restes.length >= 6 && restes.some((x) => x.aCompleter), JSON.stringify(restes.map((x) => x.id)));

    // Le lien d'accès.
    const acces = readFileSync(join(dossierMuller, ".acces-demo"), "utf8").split("\n");
    if (droitsUnix) verifier(".acces-demo : lisible par son seul propriétaire", (statSync(join(dossierMuller, ".acces-demo")).mode & 0o777) === 0o600);
    verifier(".acces-demo : un secret sûr de 43 caractères", /^[A-Za-z0-9_-]{43}$/.test(acces[0]));
    verifier(".acces-demo : le lien sur l'adresse workers.dev du client", acces[1] === "https://vitrine-boulangerie-muller.depinhomartin.workers.dev/admin/demo?cle=" + acces[0], acces[1]);
    verifier("nouveau-client : le secret n'est jamais affiché", !r.tout.includes(acces[0]));

    // Les prochaines étapes, exactes.
    for (const attendu of [
      "npm run controler -- boulangerie-muller",
      "npx wrangler dev -c ",
      "npx wrangler kv namespace create vitrine-boulangerie-muller-contenu -c ",
      "npx wrangler r2 bucket create vitrine-boulangerie-muller-medias",
      "à la place de « a-creer »",
      "npm run deployer -- --client boulangerie-muller",
      "| tr -d '\\n' | npx wrangler secret put ACCES_DEMO -c ",
      "doit afficher " + COMPTE.email
    ]) verifier("nouveau-client : l'étape « " + attendu + " »", r.sortie.includes(attendu), r.sortie);
  });

  await groupe("nouveau-client : refus", async () => {
    const avant = readFileSync(join(dossierMuller, ".acces-demo"), "utf8");
    const deux = await lancer("nouveau-client.mjs", ["boulangerie-muller", "Autre nom"], { racine: atelier1 });
    verifier("un client qui existe déjà : refusé", deux.code === 1 && deux.erreur.includes("existe déjà"), deux.tout);
    verifier("un client qui existe déjà : rien n'est réécrit", readFileSync(join(dossierMuller, ".acces-demo"), "utf8") === avant);
    for (const id of ["Boulangerie", "a.b", "fin-", "1chiffre", "x".repeat(49)]) {
      const r = await lancer("nouveau-client.mjs", [id, "Nom"], { racine: atelier1 });
      verifier("identifiant refusé : « " + id + " »", r.code === 1 && !existsSync(join(atelier1, "clients", id)), r.tout);
    }
    verifier("identifiant : 48 caractères acceptés, pas de tiret final", identifiantClientValide("x".repeat(48)) && !identifiantClientValide("abc-"));
    const theme = await lancer("nouveau-client.mjs", ["essai-theme", "Essai", "--theme", "rose"], { racine: atelier1 });
    verifier("thème inconnu : refusé, rien de créé", theme.code === 1 && theme.erreur.includes("thème inconnu") && !existsSync(join(atelier1, "clients", "essai-theme")), theme.tout);
    const source = await lancer("nouveau-client.mjs", ["essai-source", "Essai", "--depuis", "personne"], { racine: atelier1 });
    verifier("--depuis inconnu : refusé, rien de créé", source.code === 1 && source.erreur.includes(DEMO) && !existsSync(join(atelier1, "clients", "essai-source")), source.tout);
    const option = await lancer("nouveau-client.mjs", ["essai-option", "Essai", "--theeme", "atelier"], { racine: atelier1 });
    verifier("option mal tapée : refusée, pas ignorée", option.code === 2 && !existsSync(join(atelier1, "clients", "essai-option")), option.tout);
    const nom = await lancer("nouveau-client.mjs", ["essai-nom", "  "], { racine: atelier1 });
    verifier("nom vide : refusé", nom.code === 1 && !existsSync(join(atelier1, "clients", "essai-nom")), nom.tout);
    verifier("nouveau-client : aucun dossier temporaire après les refus", !readdirSync(join(atelier1, "clients")).some((n) => n.startsWith(".nouveau-")));

    // Tout ou rien : une écriture qui échoue en route ne laisse rien.
    const dest = join(atelier1, "clients", "essai-partiel");
    let leve = false;
    try { ecrireToutOuRien(dest, { "client.json": "{}", "sous/dossier.txt": "x" }); } catch { leve = true; }
    verifier("tout ou rien : l'erreur remonte", leve);
    verifier("tout ou rien : ni le client ni le dossier temporaire ne restent", !existsSync(dest) && !readdirSync(join(atelier1, "clients")).some((n) => n.startsWith(".nouveau-")));
  });

  await groupe("nouveau-client --depuis", async () => {
    const r = await lancer("nouveau-client.mjs", ["pain-de-mie", "Pain de Mie", "--depuis", DEMO], { racine: atelier1 });
    verifier("--depuis : code 0", r.code === 0, r.tout);
    const c = lireJson(join(atelier1, "clients", "pain-de-mie", "contenu.json"));
    const demo = lireJson(join(RACINE, "clients", DEMO, "contenu.json"));
    const texte = JSON.stringify(c);
    verifier("--depuis : le nom de l'autre client n'apparaît plus nulle part", !texte.includes("Au Pétrin d'Ernestine") && c.site.nom === "Pain de Mie");
    verifier("--depuis : il est remplacé dans les titres", c.pages.accueil.titre === "Pain de Mie — Boulangerie artisanale", c.pages.accueil.titre);
    verifier("--depuis : ses textes et ses sections sont repris", c.blocs["prestations-1"].elements[0].titre === demo.blocs["prestations-1"].elements[0].titre &&
      JSON.stringify(c.pages.accueil.ordre) === JSON.stringify(demo.pages.accueil.ordre));
    verifier("--depuis : son thème est gardé", c.theme.id === demo.theme.id);
    verifier("--depuis : ni son téléphone ni son e-mail", c.blocs["horaires-1"].telephone === "" && c.blocs["contact-1"].email === "" && !texte.includes("01 99 00 12 34"));
    verifier("--depuis : ses avis repartent du modèle (un avis recopié est un faux avis)", c.blocs["avis-1"].avis.length === 1 && /Recopiez ici/.test(c.blocs["avis-1"].avis[0].texte));
    verifier("--depuis : ses horaires et son adresse repartent du modèle", c.blocs["horaires-1"].jours[1].heures === "9 h – 18 h" &&
      demo.blocs["horaires-1"].jours[1].heures !== "9 h – 18 h" && c.blocs["horaires-1"].adresse.startsWith("Numéro et rue"));
    verifier("--depuis : son lien d'appel est retiré", c.blocs["appel-1"].bouton.vers === "");
    const mentions = JSON.stringify(c.blocs[c.pages["mentions-legales"].ordre[0]]);
    verifier("--depuis : des mentions légales neuves, pas les siennes", mentions.includes("[À compléter") && !mentions.includes("000 000 000") && mentions.includes("Pain de Mie"));
    verifier("--depuis : les sections de ses mentions ne traînent pas", Object.values(c.blocs).filter((b) => b.type === "texte").length === 1);
    verifier("--depuis : accepté par l'administration", validerContenu(c).ok);
    verifier("--depuis : la sortie dit ce qui a été remis au modèle", r.sortie.includes("Remis au modèle") && r.sortie.includes("avis"));

    // Les photos de la médiathèque de l'autre et ses liens écrits dans un texte.
    const source = JSON.parse(JSON.stringify(demo));
    source.blocs["accroche-1"].image = PHOTO_A;
    source.blocs["galerie-1"].images[0].src = PHOTO_B;
    source.blocs["presentation-1"].texte = 'Appelez <a href="tel:+33199001234">le fournil</a> ou <a href="#nos-pains">voyez</a>.';
    const { contenu: d } = contenuDepuis(source, { nom: "Autre", theme: "verger" });
    verifier("contenuDepuis : ses photos /medias/ deviennent l'illustration neutre", d.blocs["accroche-1"].image === "/illustrations/neutre.svg" &&
      d.blocs["galerie-1"].images[0].src === "/illustrations/neutre.svg" && d.blocs["galerie-1"].images[0].alt === "");
    verifier("contenuDepuis : un lien tel: écrit dans un texte est défait, les autres restent",
      d.blocs["presentation-1"].texte === 'Appelez le fournil ou <a href="#nos-pains">voyez</a>.', d.blocs["presentation-1"].texte);
    verifier("contenuDepuis : --theme l'emporte", d.theme.id === "verger" && d.theme.duo === "doux");
    verifier("contenuDepuis : ne touche pas à la source", source.blocs["accroche-1"].image === PHOTO_A);

    // Ses liens vers d'autres sites (réservation, réseaux) sont à LUI aussi
    // (3 octobre 2026 : une maquette gardait la page de réservation et le
    // Facebook de l'autre entreprise, sans un mot).
    const externe = JSON.parse(JSON.stringify(demo));
    externe.blocs["appel-1"].bouton.vers = "https://www.planity.com/x";
    externe.pied.liens.push({ texte: "Facebook", vers: "https://www.facebook.com/x" });
    externe.blocs["presentation-1"].texte = 'Suivez <a href="https://www.instagram.com/x">Instagram</a> et <a href="#nos-pains">nos pains</a>.';
    const { contenu: e, notes } = contenuDepuis(externe, { nom: "Salon B" });
    verifier("contenuDepuis : le bouton vers sa page de réservation perd sa destination", e.blocs["appel-1"].bouton.vers === "", e.blocs["appel-1"].bouton.vers);
    verifier("contenuDepuis : son lien Facebook du pied de page aussi", e.pied.liens.find((l) => l.texte === "Facebook").vers === "", JSON.stringify(e.pied.liens));
    verifier("contenuDepuis : un lien vers un autre site écrit dans un texte est défait, ses mots et les ancres restent",
      e.blocs["presentation-1"].texte === 'Suivez Instagram et <a href="#nos-pains">nos pains</a>.', e.blocs["presentation-1"].texte);
    verifier("contenuDepuis : aucune adresse de l'autre entreprise ne reste", !/planity|facebook|instagram/.test(JSON.stringify(e)));
    verifier("contenuDepuis : la note compte les liens vers d'autres sites", notes.some((n) => n.includes("3 liens vers d'autres sites")), JSON.stringify(notes));
    const g = contenuGenerique({ nom: "A < B" });
    verifier("contenuGenerique : thème par défaut fournil, nom échappé dans l'accroche", g.theme.id === "fournil" && g.blocs["accroche-1"].titre === "A &lt; B");
  });

  /* =========================================================
     controler
     ========================================================= */
  await groupe("controler : la démo", async () => {
    const r = await lancer("controler.mjs", [DEMO]);
    verifier("controler démo : code 0", r.code === 0, r.tout);
    verifier("controler démo : aucun ✗ ni ⚠", !/^[✗⚠]/m.test(r.sortie), r.sortie);
    for (const attendu of ["un seul <h1>", "Données structurées pour Google", "Liens :", "Mentions légales : /mentions-legales", "Moyen de contact : téléphone et e-mail", "Bilan : 10 ✓, 0 ⚠, 0 ✗"]) {
      verifier("controler démo : « " + attendu + " »", r.sortie.includes(attendu), r.sortie);
    }
    const p = await lancer("controler.mjs", [DEMO, "--production"]);
    verifier("controler démo --production : code 1", p.code === 1, p.tout);
    for (const attendu of ["« demo » doit valoir false", "« accesLibre » doit disparaître", "« domaine » est vide", "workers_dev doit valoir false", "aucune adresse valide"]) {
      verifier("controler démo --production : « " + attendu + " »", p.sortie.includes("✗") && p.sortie.includes(attendu), p.sortie);
    }
    const u = await lancer("controler.mjs", [DEMO, "--prodution"]);
    verifier("controler : une option mal tapée est refusée", u.code === 2, u.tout);
  });

  await groupe("controler : un contenu fautif", async () => {
    const dossier = join(atelier1, "clients", "fautif");
    mkdirSync(dossier);
    for (const f of FICHIERS_DEMO) copyFileSync(join(RACINE, "clients", DEMO, f), join(dossier, f));
    const fiche = lireJson(join(dossier, "client.json"));
    ecrireJson(join(dossier, "client.json"), Object.assign(fiche, { id: "fautif" }));
    writeFileSync(join(dossier, "wrangler.toml"), readFileSync(join(dossier, "wrangler.toml"), "utf8").replace('name = "vitrine-demo-boulangerie"', 'name = "vitrine-fautif"'));
    const c = lireJson(join(dossier, "contenu.json"));
    c.entete.liens.push({ texte: "Fantôme", vers: "#n-existe-pas" }, { texte: "Tarifs", vers: "/tarifs" });
    c.entete.bouton = { texte: "Commander", vers: "www.exemple.fr" };
    c.blocs["appel-1"].bouton.vers = "";
    c.blocs["horaires-1"].lienPlan = "http://plan.example.org/x";
    c.blocs["faq-1"].masque = true;                                         // son ancre disparaît du site…
    c.blocs["appel-2"] = { type: "appel", masque: true, titre: "Caché", texte: "", bouton: { texte: "Bouton invisible", vers: "", style: "plein" } };
    c.pages.accueil.ordre.push("appel-2");
    c.pied.liens = [{ texte: "Questions", vers: "#faq-1" }, { texte: "Ailleurs", vers: "https://exemple" }, { texte: "Écrire", vers: "mailto:pasuneadresse" }];
    c.blocs["accroche-1"].imageAlt = "";
    c.blocs["galerie-1"].images[0].src = "/illustrations/inexistante.svg";
    c.blocs["avis-1"].avis[0].texte = "Recopiez ici un vrai avis laissé par un client.";
    c.pages.accueil.titre = "Un titre pour Google beaucoup trop long, qui dépasse largement les soixante caractères";
    c.pages.accueil.description = "x".repeat(170);
    c.blocs["contact-1"].telephone = ""; c.blocs["contact-1"].email = "";
    c.blocs["horaires-1"].telephone = ""; c.blocs["horaires-1"].email = "";
    // Des liens écrits DANS un texte, que le rendu défait sans un mot.
    c.blocs["presentation-1"].texte = 'Voir <a href="www.exemple.fr">notre site</a>.';
    c.pied.texte = 'Suivez-nous <a href="javascript:alert(1)">ici</a>, ou <a>là</a>.';
    delete c.pages["mentions-legales"];
    delete c.blocs["texte-1"];
    // Une seconde page : un lien cassé du menu est sur les deux.
    c.pages.infos = { titre: "Infos", description: "Des informations.", ordre: ["texte-9"] };
    c.blocs["texte-9"] = { type: "texte", surtitre: "", titre: "Infos", intro: "", paragraphes: [{ titre: "Un point", texte: "Un texte." }] };
    ecrireJson(join(dossier, "contenu.json"), c);

    const r = await lancer("controler.mjs", ["fautif"], { racine: atelier1 });
    verifier("controler fautif : code 1", r.code === 1, r.tout);
    const ligne = (niveau, morceau) => r.sortie.split("\n").some((l) => l.startsWith(niveau) && l.includes(morceau));
    verifier("✗ ancre absente", ligne("✗", "#n-existe-pas") && ligne("✗", "aucune section « n-existe-pas »"), r.sortie);
    verifier("✗ ancre d'une section MASQUÉE (absente du site)", ligne("✗", "#faq-1") && ligne("✗", "masquée"), r.sortie);
    verifier("✗ page inexistante", ligne("✗", "aucune page à l'adresse /tarifs"), r.sortie);
    verifier("✗ adresse refusée (le bouton disparaît du site)", ligne("✗", "« www.exemple.fr » est refusée"), r.sortie);
    verifier("✗ lien du plan sans https", ligne("✗", "http://plan.example.org/x") && ligne("✗", "https://"), r.sortie);
    verifier("✗ adresse externe incomplète", ligne("✗", "« exemple » n'est pas un nom de site complet"), r.sortie);
    verifier("✗ adresse e-mail incomplète", ligne("✗", "« pasuneadresse » n'est pas une adresse e-mail complète"), r.sortie);
    verifier("✗ photo introuvable", ligne("✗", "Photo introuvable : /illustrations/inexistante.svg"), r.sortie);
    verifier("⚠ bouton sans destination", ligne("⚠", "« Appeler la boulangerie » n'a pas de destination"), r.sortie);
    verifier("un bouton d'une section MASQUÉE n'est pas réclamé : personne ne le voit", !r.sortie.includes("Bouton invisible"), r.sortie);
    verifier("⚠ photo sans description", ligne("⚠", "Photo sans description : /illustrations/pain.svg"), r.sortie);
    verifier("⚠ titre trop long", ligne("⚠", "Titre pour Google trop long"), r.sortie);
    verifier("⚠ description trop longue", ligne("⚠", "Description pour Google trop longue (170 caractères"), r.sortie);
    verifier("⚠ texte d'exemple (maquette)", ligne("⚠", "« Avis — Ce que disent nos clients » : des textes d'exemple"), r.sortie);
    verifier("⚠ pas de mentions légales (maquette)", ligne("⚠", "Pas de page des mentions légales"), r.sortie);
    verifier("⚠ aucun moyen de contact (maquette)", ligne("⚠", "Aucun moyen de contact"), r.sortie);
    verifier("un même défaut sur deux pages n'est écrit qu'une fois, avec les deux pages",
      r.sortie.split("aucune page à l'adresse /tarifs").length === 2 && ligne("✗", "/tarifs — l'accueil, la page « Infos »"), r.sortie);
    verifier("une ancre du menu, vue depuis une autre page, vise l'accueil", ligne("✗", "→ /#n-existe-pas : aucune section « n-existe-pas » sur l'accueil"), r.sortie);
    const ligneAvec = (niveau, ...morceaux) => r.sortie.split("\n").some((l) => l.startsWith(niveau) && morceaux.every((m) => l.includes(m)));
    verifier("✗ adresse refusée écrite dans un texte (le lien disparaît du site)",
      ligneAvec("✗", "« notre site » : l'adresse « www.exemple.fr » écrite dans un texte est refusée", "— « Présentation", "l'accueil"), r.sortie);
    verifier("✗ adresse javascript: écrite dans le pied de page", ligneAvec("✗", "« ici » : l'adresse « javascript:alert(1) » écrite dans un texte est refusée", "— le pied de page"), r.sortie);
    verifier("✗ lien sans adresse écrit dans un texte", ligne("✗", "« là » : un lien écrit dans un texte n'a pas d'adresse"), r.sortie);
    verifier("liensRefusesDansUnTexte : la lecture du nettoyeur (le dernier href compte, &amp; décodé)",
      liensRefusesDansUnTexte('<a href="www.x.fr" href="https://x.fr/?a=1&amp;b=2">bon</a> <a href="https://y.fr">ok</a>').length === 0 &&
      JSON.stringify(liensRefusesDansUnTexte('<a href="https://x.fr" href="data:x">mal</a>')) === '[{"mots":"mal","vers":"data:x"}]');
    // Une copie de la démo garde SES espaces : deux sites dans le même
    // contenu, la publication de l'un remplacerait l'autre.
    verifier("✗ un espace de contenu partagé avec un autre client", ligne("✗", "« demo-boulangerie » et « fautif » partagent l'espace de contenu (KV)"), r.sortie);
    verifier("✗ un espace photos partagé avec un autre client", ligne("✗", "« demo-boulangerie » et « fautif » partagent l'espace photos (R2) « vitrine-demo-boulangerie-medias »"), r.sortie);
    verifier("ressourcesPartagees : « a-creer » n'est pas un espace, les noms différents ne se gênent pas",
      ressourcesPartagees([{ id: "a", toml: { name: "vitrine-a", kv_namespaces: [{ binding: "CONTENU", id: "a-creer" }] } }, { id: "b", toml: { name: "vitrine-b", kv_namespaces: [{ binding: "CONTENU", id: "a-creer" }] } }]).length === 0 &&
      ressourcesPartagees([{ id: "a", toml: { name: "vitrine-x" } }, { id: "b", toml: { name: "vitrine-x" } }])[0].quoi === "le Worker");

    // En production, ce qui manque devient bloquant.
    const p = controler({ racine: atelier1, id: "fautif", production: true });
    const messages = (niveau) => p.points.filter((x) => x.niveau === niveau).map((x) => x.message).join("\n");
    verifier("--production : textes d'exemple, mentions et contact deviennent des ✗",
      /Ce que disent nos clients/.test(messages(ERREUR)) && /mentions légales/.test(messages(ERREUR)) && /Aucun moyen de contact/.test(messages(ERREUR)), messages(ERREUR));
    verifier("--production : un titre trop long reste un ⚠", /Titre pour Google trop long/.test(messages(ATTENTION)));

    // Le contrôle des pages rendues.
    const lu = lirePageRendue('<h1>a</h1><h1>b</h1><script>alert(1)</script><script type="application/ld+json">{"x":</script><p data-edit="t">');
    verifier("page rendue : deux <h1>, un script, un JSON-LD illisible, une marque d'édition",
      lu.defauts.length === 4 && /2 titres/.test(lu.defauts[0]) && /Un script/.test(lu.defauts[1]) && /illisibles/.test(lu.defauts[2]) && /marques d'édition/.test(lu.defauts[3]), JSON.stringify(lu.defauts));
    const deguise = lirePageRendue('<h1>a</h1><script type="application/ld+json" src="/x.js">{}</script>').defauts;
    verifier("page rendue : un script externe déguisé en données est refusé", deguise.length === 1 && /Un script/.test(deguise[0]), JSON.stringify(deguise));
    const bon = lirePageRendue('<h1>a</h1><script type="application/ld+json">{"@type":"Bakery"}</script>');
    verifier("page rendue : le JSON-LD seul est toléré et lu", bon.defauts.length === 0 && bon.donnees["@type"] === "Bakery");
  });

  await groupe("controler --depuis", async () => {
    const demo = lireJson(join(RACINE, "clients", DEMO, "contenu.json"));
    const casse = JSON.parse(JSON.stringify(demo));
    casse.entete.liens[0].vers = "#disparue";
    const fichier = join(BASE, "export-casse.json");
    ecrireJson(fichier, { site: DEMO, exporte_le: Date.now(), contenu: casse, medias: [] });
    const r = await lancer("controler.mjs", [DEMO, "--depuis", fichier], { racine: atelier1 });
    verifier("--depuis : c'est le contenu de l'export qui est contrôlé", r.code === 1 && r.sortie.includes("#disparue") && r.sortie.includes("export "), r.tout);
    ecrireJson(fichier, { site: "un-autre", contenu: demo });
    const autre = await lancer("controler.mjs", [DEMO, "--depuis", fichier], { racine: atelier1 });
    verifier("--depuis : l'export d'un autre site est refusé", autre.code === 1 && autre.sortie.includes("celui du site « un-autre »"), autre.tout);
  });

  await groupe("controler : un client en production bien réglé", async () => {
    const dossier = join(atelier1, "clients", "client-pret");
    mkdirSync(dossier);
    for (const f of FICHIERS_DEMO) copyFileSync(join(RACINE, "clients", DEMO, f), join(dossier, f));
    ecrireJson(join(dossier, "client.json"), { id: "client-pret", demo: false, domaine: "client-pret.example", socle: VERSION, administration: { adresses: ["patron@example.com"] } });
    writeFileSync(join(dossier, "wrangler.toml"), tomlDeProduction("client-pret", "client-pret.example"));
    const r = controler({ racine: atelier1, id: "client-pret", production: true });
    verifier("production bien réglée : aucun ✗", bilan(r)[ERREUR] === 0, r.points.filter((p) => p.niveau !== "✓").map((p) => p.message).join(" | "));
    // L'alerte d'un message ne part qu'aux 5 premières adresses (contact.js) :
    // au-delà, le contrôle le dit (3 octobre 2026).
    const alerteLimitee = (n) => {
      const adresses = Array.from({ length: n }, (_, i) => "personne" + i + "@example.com");
      ecrireJson(join(dossier, "client.json"), { id: "client-pret", demo: false, domaine: "client-pret.example", socle: VERSION, administration: { adresses: adresses.concat(adresses[0].toUpperCase()) } });
      return controler({ racine: atelier1, id: "client-pret", production: true }).points.filter((p) => p.niveau === ATTENTION && p.message.includes("reçoivent l'alerte")).map((p) => p.message);
    };
    const six = alerteLimitee(6);
    verifier("production : 6 adresses → ⚠ seules les 5 premières reçoivent l'alerte", six.length === 1 && six[0].startsWith("client.json : 6 adresses") &&
      six[0].includes("personne4@example.com)") && !six[0].includes("personne5"), six.join(" | "));
    verifier("production : 5 adresses (et un doublon) → rien à signaler", alerteLimitee(5).length === 0, alerteLimitee(5).join(" | "));
    ecrireJson(join(dossier, "client.json"), { id: "client-pret", demo: false, domaine: "client-pret.example", socle: VERSION, administration: { adresses: ["patron@example.com"] } });
    ecrireJson(join(dossier, "client.json"), { id: "client-pret", demo: false, domaine: "www.client-pret.example", socle: VERSION, administration: { adresses: ["patron@example.com"] } });
    writeFileSync(join(dossier, ".acces-demo"), "secret-de-test\n");
    const m = controler({ racine: atelier1, id: "client-pret", production: true });
    const erreurs = m.points.filter((p) => p.niveau === ERREUR).map((p) => p.message).join("\n");
    verifier("production : un domaine en www est mal écrit", erreurs.includes("mal écrit"), erreurs);
    verifier("production : un lien de maquette oublié est refusé", erreurs.includes(".acces-demo"), erreurs);
    rmSync(join(dossier, ".acces-demo"));
    ecrireJson(join(dossier, "client.json"), { id: "client-pret", demo: false, domaine: "client-pret.example", socle: "0.2.0", administration: { adresses: ["patron@example.com"] } });
    const v = controler({ racine: atelier1, id: "client-pret", production: true });
    verifier("un client resté sur un ancien socle : ⚠", v.points.some((p) => p.niveau === ATTENTION && p.message.includes("0.2.0")));
  });

  /* Masquer la section des mentions légales faisait taire l'éditeur ET le
     contrôle, pendant que le lien du bas de page menait à une page vide
     (3 octobre 2026). Présentes, AFFICHÉES, et sans trou — même masqué. */
  await groupe("controler : des mentions légales masquées ou vides", async () => {
    const dossier = join(atelier1, "clients", "prod-masque");
    mkdirSync(dossier);
    for (const f of FICHIERS_DEMO) copyFileSync(join(RACINE, "clients", DEMO, f), join(dossier, f));
    ecrireJson(join(dossier, "client.json"), { id: "prod-masque", demo: false, domaine: "prod-masque.example", socle: VERSION, administration: { adresses: ["patron@example.com"] } });
    writeFileSync(join(dossier, "wrangler.toml"), tomlDeProduction("prod-masque", "prod-masque.example"));
    const demo = lireJson(join(RACINE, "clients", DEMO, "contenu.json"));
    const sain = controler({ racine: atelier1, id: "prod-masque", production: true });
    verifier("mentions affichées et remplies : rien à redire", sain.points.some((p) => p.niveau === "✓" && p.message.startsWith("Mentions légales : /mentions-legales, affichées")) && bilan(sain)[ERREUR] === 0,
      sain.points.filter((p) => p.niveau !== "✓").map((p) => p.message).join(" | "));

    const masque = JSON.parse(JSON.stringify(demo));
    for (const id of masque.pages[PAGE_MENTIONS].ordre) masque.blocs[id].masque = true;
    ecrireJson(join(dossier, "contenu.json"), masque);
    const r = await lancer("controler.mjs", ["prod-masque", "--production"], { racine: atelier1 });
    verifier("mentions masquées --production : code 1", r.code === 1, r.tout);
    verifier("mentions masquées --production : ✗ la page n'affiche rien", /^✗ La page des mentions légales n'affiche rien/m.test(r.sortie), r.sortie);
    verifier("mentions masquées --production : plus de ✓ « Mentions légales »", !/^✓ Mentions légales/m.test(r.sortie), r.sortie);
    const maquette = controler({ racine: atelier1, id: "prod-masque", production: false });
    verifier("mentions masquées sur une maquette : un ⚠, pas un ✗", maquette.points.some((p) => p.niveau === ATTENTION && p.message.startsWith("La page des mentions légales n'affiche rien")) &&
      !maquette.points.some((p) => p.niveau === ERREUR && p.message.includes("mentions légales")));

    // Le modèle neuf, ses « [À compléter » encore là, masqué : ses trous comptent.
    const trous = JSON.parse(JSON.stringify(demo));
    for (const id of trous.pages[PAGE_MENTIONS].ordre) delete trous.blocs[id];
    delete trous.pages[PAGE_MENTIONS];
    const m = pageMentionsLegales(trous);
    trous.pages[m.pageId] = m.page;
    Object.assign(trous.blocs, m.blocs);
    for (const id of m.page.ordre) trous.blocs[id].masque = true;
    ecrireJson(join(dossier, "contenu.json"), trous);
    const t = controler({ racine: atelier1, id: "prod-masque", production: true });
    const erreurs = t.points.filter((p) => p.niveau === ERREUR).map((p) => p.message).join("\n");
    verifier("modèle masqué --production : ✗ ses « [À compléter » comptent", /\[À compléter … » dans une section masquée/.test(erreurs), erreurs);

    // Une page sans aucune section.
    const vide = JSON.parse(JSON.stringify(demo));
    vide.pages[PAGE_MENTIONS].ordre = [];
    ecrireJson(join(dossier, "contenu.json"), vide);
    const v = controler({ racine: atelier1, id: "prod-masque", production: true });
    verifier("page des mentions sans section : ✗", v.points.some((p) => p.niveau === ERREUR && p.message.startsWith("La page des mentions légales n'affiche rien")));
    verifier("texteAffiche : le <h1> réservé aux lecteurs d'écran ne compte pas",
      !texteAffiche('<main id="contenu"><h1 class="visuellement-cache">Mentions légales</h1></main>') && texteAffiche('<main><h1 class="visuellement-cache">x</h1><p>Éditeur</p></main>'));
    rmSync(dossier, { recursive: true });
  });

  /* Une seule ligne d'horaires illisible, et aucun horaire ne part chez
     Google (un jour absent s'y lirait « fermé ») : le contrôle répondait
     ✓ « sans horaires lisibles » sans dire laquelle (3 octobre 2026). */
  await groupe("controler : des horaires que Google ne lit pas", async () => {
    const dossier = join(atelier1, "clients", "horaires-illisibles");
    mkdirSync(dossier);
    for (const f of FICHIERS_DEMO) copyFileSync(join(RACINE, "clients", DEMO, f), join(dossier, f));
    ecrireJson(join(dossier, "client.json"), Object.assign(lireJson(join(RACINE, "clients", DEMO, "client.json")), { id: "horaires-illisibles" }));
    const avertissements = (jours) => {
      const c = lireJson(join(RACINE, "clients", DEMO, "contenu.json"));
      c.blocs["horaires-1"].jours = jours;
      ecrireJson(join(dossier, "contenu.json"), c);
      return controler({ racine: atelier1, id: "horaires-illisibles" }).points.filter((p) => p.niveau === ATTENTION && p.message.startsWith("Horaires non transmis à Google")).map((p) => p.message);
    };
    const plage = avertissements([{ jour: "Lundi", heures: "Fermé" }, { jour: "Du mardi au vendredi", heures: "6 h 30 – 13 h" }, { jour: "Samedi", heures: "6 h – 18 h" }]);
    verifier("horaires : la ligne illisible est nommée", plage.length === 1 && plage[0].includes("la ligne « Du mardi au vendredi : 6 h 30 – 13 h » ne se lit pas"), plage.join(" | "));
    const suite = avertissements([{ jour: "Mardi", heures: "9 h – 12 h" }, { jour: "", heures: "14 h – 18 h" }]);
    verifier("horaires : une ligne sans jour aussi", suite.length === 1 && suite[0].includes("une ligne sans jour (« 14 h – 18 h ») ne se lit pas"), suite.join(" | "));
    verifier("horaires : la démo, le modèle et une ligne vide ne disent rien",
      avertissements(lireJson(join(RACINE, "clients", DEMO, "contenu.json")).blocs["horaires-1"].jours).length === 0 &&
      avertissements(nouveauBloc("horaires").jours).length === 0 &&
      avertissements([{ jour: "Lundi", heures: "9 h – 12 h" }, { jour: "", heures: "" }]).length === 0);
    rmSync(dossier, { recursive: true });
  });

  await groupe("controler : un client tout neuf", async () => {
    const r = await lancer("controler.mjs", ["boulangerie-muller"], { racine: atelier1 });
    verifier("client neuf (maquette) : rien de cassé, code 0", r.code === 0 && !/^✗/m.test(r.sortie), r.tout);
    verifier("client neuf (maquette) : les manques sont dits", /^⚠ .*\[À compléter/m.test(r.sortie), r.sortie);
    const p = await lancer("controler.mjs", ["boulangerie-muller", "--production"], { racine: atelier1 });
    verifier("client neuf --production : refusé (a-creer, [À compléter…)", p.code === 1 && p.sortie.includes("a-creer") && /✗ .*\[À compléter/.test(p.sortie), p.sortie);
  });

  /* =========================================================
     exporter
     ========================================================= */
  await groupe("exporter : le contenu livré", async () => {
    const r = await lancer("exporter.mjs", [DEMO], { racine: atelier1 });
    const sortie = join(atelier1, ".apercu", DEMO);
    verifier("exporter : code 0", r.code === 0, r.tout);
    verifier("exporter : l'accueil, les mentions légales, les feuilles et les illustrations",
      existsSync(join(sortie, "index.html")) && existsSync(join(sortie, "mentions-legales", "index.html")) &&
      existsSync(join(sortie, "css", "socle.css")) && existsSync(join(sortie, "illustrations", "pain.svg")));
    const html = readFileSync(join(sortie, "index.html"), "utf8");
    const enLigne = rendrePage({ contenu: normaliser(lireJson(join(RACINE, "clients", DEMO, "contenu.json"))), client: lireJson(join(RACINE, "clients", DEMO, "client.json")) });
    verifier("exporter : le site en ligne a un formulaire…", enLigne.includes("<form"));
    verifier("exporter : … le site exporté non (un site statique ne reçoit rien)", !html.includes("<form") && r.sortie.includes("formulaire de contact est retiré"), r.sortie);
    verifier("exporter : le téléphone reste", html.includes("01 99 00 12 34"));
    verifier("exporter : le lien des mentions légales", html.includes('href="/mentions-legales"'));

    // L'hébergeur des mentions légales : le site exporté ne sera plus chez
    // Cloudflare, la mention deviendrait fausse (3 octobre 2026).
    const mentions = readFileSync(join(sortie, "mentions-legales", "index.html"), "utf8");
    verifier("exporter : l'hébergeur Cloudflare n'est plus nommé dans les mentions exportées", !mentions.includes("Cloudflare, Inc.") && mentions.includes(HEBERGEUR_A_COMPLETER), mentions);
    verifier("exporter : la sortie le dit", /^⚠ Mentions légales : l'hébergeur \(Cloudflare\) est remplacé par « \[À compléter : nouvel hébergeur/m.test(r.sortie) && r.sortie.includes("--hebergeur"), r.sortie);
    verifier("exporter : le contenu du client n'est pas touché", readFileSync(join(atelier1, "clients", DEMO, "contenu.json"), "utf8").includes("Cloudflare, Inc."));
    const heb = await lancer("exporter.mjs", [DEMO, join(BASE, "export-hebergeur"), "--hebergeur", "Hébergeur & Fils <SAS>, 1 rue du Test, 67000 Strasbourg. Téléphone : 03 00 00 00 00"], { racine: atelier1 });
    const mentionsHeb = readFileSync(join(BASE, "export-hebergeur", "mentions-legales", "index.html"), "utf8");
    verifier("exporter --hebergeur : le nouvel hébergeur est écrit (échappé), sans trou", heb.code === 0 && mentionsHeb.includes("Hébergeur &amp; Fils &lt;SAS&gt;, 1 rue du Test") &&
      !mentionsHeb.includes("[À compléter") && !mentionsHeb.includes("Cloudflare, Inc.") && heb.sortie.includes("✓ Mentions légales : l'hébergeur est celui que vous avez indiqué"), heb.tout);
    const etat = changerHebergeur({
      pages: { [PAGE_MENTIONS]: { ordre: ["texte-1"] } },
      blocs: { "texte-1": { type: "texte", intro: "", paragraphes: [
        { titre: "Hébergeur", texte: "Cloudflare, Inc." },
        { titre: "Données personnelles", texte: "Les messages du formulaire de contact passent par Cloudflare." }
      ] } }
    });
    verifier("changerHebergeur : le paragraphe d'hébergement remplacé, les autres mentions de Cloudflare et du formulaire signalées",
      etat.remplaces === 1 && JSON.stringify(etat.cloudflare) === '["« Données personnelles »"]' && JSON.stringify(etat.formulaire) === '["« Données personnelles »"]', JSON.stringify(etat));
    verifier("changerHebergeur : sans page des mentions, rien n'est inventé", changerHebergeur({ pages: { accueil: { ordre: [] } }, blocs: {} }).page === false);

    const deux = await lancer("exporter.mjs", [DEMO], { racine: atelier1 });
    verifier("exporter : un export précédent se remplace", deux.code === 0, deux.tout);

    const occupe = join(BASE, "dossier-occupe");
    mkdirSync(occupe);
    writeFileSync(join(occupe, "precieux.txt"), "à garder");
    const refus = await lancer("exporter.mjs", [DEMO, occupe], { racine: atelier1 });
    verifier("exporter : un dossier occupé qui n'est pas un export est refusé, intact",
      refus.code === 1 && readFileSync(join(occupe, "precieux.txt"), "utf8") === "à garder" && refus.erreur.includes("ne ressemble pas"), refus.tout);
    verifier("exporter : la racine de l'atelier est refusée", dossierDeSortieSur(atelier1, atelier1) !== "" && dossierDeSortieSur(join(atelier1, ".."), atelier1) !== "");
    verifier("exporter : un dossier neuf est accepté", dossierDeSortieSur(join(BASE, "neuf"), atelier1) === "");
  });

  await groupe("exporter --depuis --photos", async () => {
    const demo = lireJson(join(RACINE, "clients", DEMO, "contenu.json"));
    const publie = JSON.parse(JSON.stringify(demo));
    publie.blocs["galerie-1"].images[0].src = PHOTO_A;
    publie.blocs["accroche-1"].titre = "Le titre <em>publié</em> depuis l'éditeur";
    const fichier = join(BASE, "export.json");
    ecrireJson(fichier, {
      site: DEMO, exporte_le: Date.now(), contenu: publie,
      medias: [LOCAL + PHOTO_A, LOCAL + PHOTO_B, LOCAL + PHOTO_MANQUANTE, LOCAL + PHOTO_HTML, LOCAL + "/medias/%2e%2e/%2e%2e/secret.jpg"],
      messages: [{ id: 1, nom: "Visiteuse Secrète", email: "secrete@example.com", message: "Un message très personnel" }]
    });
    const sortie = join(BASE, "export-photos");
    demandesPhotos.length = 0;
    const r = await lancer("exporter.mjs", [DEMO, sortie, "--depuis", fichier, "--photos", "--delai", "60"], { racine: atelier1 });
    verifier("--photos avec un échec : code 1 à la fin", r.code === 1, r.tout);
    verifier("--depuis : c'est le contenu publié qui est exporté", readFileSync(join(sortie, "index.html"), "utf8").includes("<em>publié</em>"));
    verifier("--photos : la photo citée, octet pour octet", existsSync(join(sortie, PHOTO_A)) && readFileSync(join(sortie, PHOTO_A)).equals(OCTETS_JPEG));
    verifier("--photos : la photo de la médiathèque non citée aussi", existsSync(join(sortie, PHOTO_B)) && readFileSync(join(sortie, PHOTO_B)).equals(OCTETS_PNG));
    verifier("--photos : l'échec est dit, l'export continue", r.sortie.includes("✗ " + PHOTO_MANQUANTE + " : HTTP 404") && existsSync(join(sortie, PHOTO_B)), r.sortie);
    verifier("--photos : une page d'erreur servie en 200 n'est pas enregistrée comme photo",
      !existsSync(join(sortie, PHOTO_HTML)) && r.sortie.includes(PHOTO_HTML + " : le fichier reçu n'est pas une image"), r.sortie);
    verifier("--photos : une adresse qui remonte hors de /medias est refusée", r.sortie.includes("n'est pas une photo de la médiathèque") &&
      !existsSync(join(BASE, "secret.jpg")) && !existsSync(join(sortie, "secret.jpg")), r.sortie);
    verifier("--photos : le compte rendu", r.sortie.includes("2 recopiées, 3 en échec"), r.sortie);
    verifier("--photos : les pages gardent les adresses /medias/…", readFileSync(join(sortie, "index.html"), "utf8").includes('src="' + PHOTO_A + '"'));
    const ecarts = demandesPhotos.slice(1).map((d, i) => d.quand - demandesPhotos[i].quand);
    verifier("--photos : un délai entre deux photos", demandesPhotos.length === 4 && ecarts.every((e) => e >= 50), JSON.stringify(ecarts));
    // Cherché par Node et non par grep, absent d'un terminal Windows ordinaire.
    const fuites = readdirSync(sortie, { recursive: true }).map(String).filter((f) => statSync(join(sortie, f)).isFile() &&
      readFileSync(join(sortie, f), "utf8").includes("Visiteuse Secrète"));
    verifier("--depuis : les messages reçus ne partent jamais dans le site exporté", fuites.length === 0 && r.sortie.includes("1 message"), fuites.join(", "));
    verifier("--depuis : un export complet ne parle pas de messages laissés", !r.sortie.includes("plus récents"), r.sortie);

    // L'administration n'exporte que les 2 000 plus récents et dit combien
    // elle en laisse : l'outil doit le redire (contrôle du 3 octobre 2026).
    const fichierTronque = join(BASE, "export-tronque.json");
    ecrireJson(fichierTronque, { site: DEMO, exporte_le: Date.now(), contenu: publie, medias: [], messages: [{ id: 4, nom: "Robot", email: "r@example.com", message: "Message en série." }], messages_tronques: 3 });
    const tronque = await lancer("exporter.mjs", [DEMO, join(BASE, "export-tronque"), "--depuis", fichierTronque], { racine: atelier1 });
    verifier("--depuis : des messages laissés dans l'administration sont signalés", tronque.code === 0 &&
      /^⚠ L'export ne porte que les messages les plus récents : 3 plus anciens sont restés dans l'administration/m.test(tronque.sortie), tronque.tout);

    const autre = await lancer("exporter.mjs", [DEMO, join(BASE, "export-autre"), "--depuis", join(BASE, "export-casse.json")], { racine: atelier1 });
    verifier("--depuis : l'export d'un autre site est refusé", autre.code === 1 && autre.erreur.includes("un-autre"), autre.tout);

    // Sans export : le contenu livré, et l'adresse du site donnée par --origine.
    const dossier = join(atelier1, "clients", "avec-photo");
    mkdirSync(dossier);
    for (const f of FICHIERS_DEMO) copyFileSync(join(RACINE, "clients", DEMO, f), join(dossier, f));
    ecrireJson(join(dossier, "client.json"), Object.assign(lireJson(join(dossier, "client.json")), { id: "avec-photo" }));
    ecrireJson(join(dossier, "contenu.json"), publie);
    const sans = await lancer("exporter.mjs", ["avec-photo", join(BASE, "export-sans-origine"), "--photos", "--delai", "0"], { racine: atelier1 });
    verifier("--photos sans export ni --origine : l'adresse manque, c'est dit", sans.code === 1 && sans.sortie.includes("précisez --origine"), sans.tout);
    const avec = await lancer("exporter.mjs", ["avec-photo", join(BASE, "export-origine"), "--photos", "--origine", LOCAL, "--delai", "0"], { racine: atelier1 });
    verifier("--photos --origine : la photo citée est recopiée", avec.code === 0 && existsSync(join(BASE, "export-origine", PHOTO_A)), avec.tout);
    const sansPhotos = await lancer("exporter.mjs", ["avec-photo", join(BASE, "export-rappel")], { racine: atelier1 });
    verifier("sans --photos : un rappel que les photos ne sont pas recopiées", sansPhotos.code === 0 && sansPhotos.sortie.includes("relancez avec --photos"), sansPhotos.tout);
    const http = photosAExporter({ contenu: normaliser(publie), adressesExport: ["http://exemple.fr" + PHOTO_A] });
    verifier("photosAExporter : http hors de la machine est refusé", http.photos.length === 0 && http.refus.length === 2 &&
      http.refus[1].raison.includes("précisez --origine"), JSON.stringify(http.refus));

    // Le fichier d'export vient du client qui part : on n'en recopie que ce
    // que le site sert vraiment (3 octobre 2026). Un seul site, de vraies
    // photos de la médiathèque, aucune redirection suivie.
    const etranger = photosAExporter({ contenu: normaliser(publie), adressesExport: [LOCAL + PHOTO_A, "https://ailleurs.example" + PHOTO_B] });
    verifier("photosAExporter : une photo d'un autre site que celui de l'export est refusée",
      etranger.photos.length === 1 && etranger.photos[0].chemin === PHOTO_A && etranger.refus.some((x) => x.chemin.includes("ailleurs.example") && x.raison.includes("autre site")), JSON.stringify(etranger));
    const impose = photosAExporter({ contenu: normaliser(publie), adressesExport: [LOCAL + PHOTO_A], origine: "https://site-du-client.example" });
    verifier("photosAExporter : --origine fixe le site, l'export ne le change pas",
      impose.photos.length === 1 && impose.photos[0].url === "https://site-du-client.example" + PHOTO_A && impose.refus.length === 1 && impose.refus[0].raison.includes("autre site"), JSON.stringify(impose));
    verifier("estPhotoDuSite : la règle du serveur, rien d'autre",
      estPhotoDuSite(PHOTO_A) && estPhotoDuSite("/medias/vignettes/" + "0".repeat(32) + ".webp") && !estPhotoDuSite(PAGE_PIEGEE) &&
      !estPhotoDuSite("/medias/" + "a".repeat(32) + ".svg") && !estPhotoDuSite("/medias/x/" + "a".repeat(32) + ".jpg") && !estPhotoDuSite("/medias/" + "A".repeat(32) + ".jpg"));
    const fichierPiege = join(BASE, "export-piege.json");
    ecrireJson(fichierPiege, {
      site: DEMO, exporte_le: Date.now(), contenu: publie,
      medias: [LOCAL + PHOTO_A, LOCAL + PHOTO_REDIRIGEE, LOCAL + PAGE_PIEGEE, LOCAL + "/medias/x/" + "a".repeat(32) + ".jpg",
        "http://localhost:" + serveur.address().port + PHOTO_B]
    });
    const piege = join(BASE, "export-piege");
    demandesPhotos.length = 0;
    const p = await lancer("exporter.mjs", [DEMO, piege, "--depuis", fichierPiege, "--photos", "--delai", "0"], { racine: atelier1 });
    verifier("--photos piégé : code 1", p.code === 1, p.tout);
    verifier("--photos piégé : la vraie photo est recopiée", existsSync(join(piege, PHOTO_A)), p.sortie);
    verifier("--photos piégé : une redirection est un échec, rien n'est écrit, la cible n'est jamais demandée",
      p.sortie.includes("✗ " + PHOTO_REDIRIGEE + " : redirection refusée (HTTP 302") && !existsSync(join(piege, PHOTO_REDIRIGEE)) && !existsSync(join(piege, PHOTO_CIBLE)) &&
      !demandesPhotos.some((d) => d.chemin === PHOTO_CIBLE), p.sortie);
    verifier("--photos piégé : une page HTML n'est ni demandée ni écrite", p.sortie.includes(PAGE_PIEGEE + " : ce n'est pas une photo de la médiathèque") &&
      !existsSync(join(piege, "medias", "page.html")) && !demandesPhotos.some((d) => d.chemin === PAGE_PIEGEE), p.sortie);
    verifier("--photos piégé : un chemin qui n'est pas celui d'une photo est refusé", p.sortie.includes("/medias/x/" + "a".repeat(32) + ".jpg : ce n'est pas une photo de la médiathèque"), p.sortie);
    verifier("--photos piégé : un autre site que celui de l'export est refusé, jamais demandé", p.sortie.includes("autre site que celui du client (" + LOCAL + ")") &&
      !demandesPhotos.some((d) => d.chemin === PHOTO_B), p.sortie);
    verifier("--photos piégé : le compte rendu", p.sortie.includes("1 recopiée, 4 en échec"), p.sortie);
  });

  /* =========================================================
     deployer
     ========================================================= */
  const atelier2 = fabriquerRacine("atelier-2");
  const sous = JSON.parse(readFileSync(join(RACINE, "atelier.json"), "utf8")).sousDomaineWorkers;
  const ajouterClient = (id, fiche, toml) => {
    const dossier = join(atelier2, "clients", id);
    mkdirSync(dossier, { recursive: true });
    for (const f of FICHIERS_DEMO) copyFileSync(join(RACINE, "clients", DEMO, f), join(dossier, f));
    ecrireJson(join(dossier, "client.json"), Object.assign({ id, socle: VERSION, administration: { adresses: ["patron@example.com"] } }, fiche));
    writeFileSync(join(dossier, "wrangler.toml"), toml);
  };
  const tomlDemo = readFileSync(join(RACINE, "clients", DEMO, "wrangler.toml"), "utf8");
  ajouterClient("maquette-z", { demo: true, mentionDemo: "Maquette Z", domaine: "" }, tomlDeMaquette("maquette-z"));
  ajouterClient("pilote-a", { demo: false, pilote: true, domaine: "pilote-a.example" }, tomlDeProduction("pilote-a", "pilote-a.example"));
  ajouterClient("client-b", { demo: false, domaine: "client-b.example" }, tomlDeProduction("client-b", "client-b.example"));
  sites.set("vitrine-demo-boulangerie." + sous + ".workers.dev", { robots: ROBOTS_FERME });
  sites.set("vitrine-maquette-z." + sous + ".workers.dev", { robots: ROBOTS_FERME });
  sites.set("pilote-a.example", { robots: ROBOTS_OUVERT("pilote-a.example") });
  sites.set("client-b.example", { robots: ROBOTS_OUVERT("client-b.example") });
  const git = (...args) => spawnSync("git", ["-c", "user.name=Essai", "-c", "user.email=essai@example.com", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: atelier2, encoding: "utf8" });
  git("init", "-q");
  // Un réglage de git qui cache les fichiers non suivis ne doit pas cacher
  // au déploiement un client créé mais pas enregistré.
  git("config", "status.showUntrackedFiles", "no");
  git("add", "-A");
  git("commit", "-qm", "socle 0.2.0");
  git("tag", "socle-0.2.0");
  writeFileSync(join(atelier2, "LISEZ-MOI.txt"), "socle 0.3.0\n");
  git("add", "-A");
  git("commit", "-qm", "socle 0.3.0");
  git("tag", "socle-0.3.0");
  const avecFaux = (env = {}) => Object.assign({ ATELIER_WRANGLER: FAUX, ATELIER_ORIGINE: LOCAL + "/{hote}", ATELIER_PATIENCE_MS: "0" }, env);

  await groupe("deployer : le plan", async () => {
    const clients = [
      { id: "z", fiche: { demo: false }, vague: "tous" }, { id: "p", fiche: { pilote: true }, vague: "pilote" }, { id: "d", fiche: { demo: true }, vague: "demo" }
    ];
    verifier("vagues : maquette, puis pilote, puis les autres", vagueDe({ demo: true, pilote: true }) === "demo" && vagueDe({ pilote: true }) === "pilote" && vagueDe({}) === "tous");
    verifier("planifier : --vague demo s'arrête après les maquettes", JSON.stringify(planifier(clients, { vague: "demo" }).map((c) => c.id)) === '["d"]');
    let leve = false;
    try { planifier(clients, { vague: "toutes" }); } catch { leve = true; }
    verifier("planifier : une vague inconnue est refusée", leve);
    verifier("hoteDe : le domaine, sinon workers.dev, sinon rien", hoteDe({ id: "x", fiche: { domaine: "x.fr" }, toml: {} }, "s").hote === "x.fr" &&
      hoteDe({ id: "x", fiche: {}, toml: { name: "vitrine-x" } }, "s").hote === "vitrine-x.s.workers.dev" && hoteDe({ id: "x", fiche: {}, toml: { workers_dev: false } }, "s") === null);

    writeFileSync(join(atelier2, "brouillon.txt"), "pas enregistré");      // à blanc ne regarde même pas git
    viderFaux();
    const r = await lancer("deployer.mjs", ["--a-blanc"], { racine: atelier2, env: avecFaux() });
    verifier("--a-blanc : code 0", r.code === 0, r.tout);
    verifier("--a-blanc : rien n'est exécuté (ni git, ni verifier, ni wrangler)", appelsFaux().length === 0 && r.sortie.includes("rien n'est exécuté"), r.tout);
    const pos = ["demo-boulangerie", "maquette-z", "pilote-a", "client-b"].map((id) => r.sortie.indexOf("  " + id + " ("));
    verifier("--a-blanc : l'ordre des vagues", pos.every((p) => p > 0) && pos[0] < pos[1] && pos[1] < pos[2] && pos[2] < pos[3], JSON.stringify(pos));
    verifier("--a-blanc : la maquette contrôlée en maquette, le client en production",
      r.sortie.includes("npm run controler -- maquette-z\n") && r.sortie.includes("npm run controler -- client-b --production"), r.sortie);
    verifier("--a-blanc : les adresses vérifiées", r.sortie.includes("https://vitrine-maquette-z." + sous + ".workers.dev/") && r.sortie.includes("https://www.client-b.example/ → https://client-b.example/"), r.sortie);
    const d = await lancer("deployer.mjs", ["--a-blanc", "--vague", "demo"], { racine: atelier2, env: avecFaux() });
    verifier("--a-blanc --vague demo : seulement les maquettes", d.code === 0 && d.sortie.includes("maquette-z") && !d.sortie.includes("pilote-a (") && d.sortie.includes("S'arrête après la vague « demo »"), d.sortie);
    const inconnu = await lancer("deployer.mjs", ["--a-blanc", "--client", "personne"], { racine: atelier2, env: avecFaux() });
    verifier("--client inconnu : refusé", inconnu.code === 1 && inconnu.erreur.includes("personne"), inconnu.tout);
    const trop = await lancer("deployer.mjs", ["--a-blanc", "--client", "client-b", "--vague", "pilote"], { racine: atelier2, env: avecFaux() });
    verifier("--client hors des vagues demandées : refusé", trop.code === 1 && trop.erreur.includes("après la vague"), trop.tout);
    rmSync(join(atelier2, "brouillon.txt"));
  });

  await groupe("deployer : les refus préalables", async () => {
    viderFaux();
    const sansFaux = await lancer("deployer.mjs", [], { racine: atelier2, env: { ATELIER_WRANGLER: null } });
    verifier("une copie de l'atelier sans faux wrangler : refusé d'emblée", sansFaux.code === 1 && sansFaux.erreur.includes("ATELIER_WRANGLER"), sansFaux.tout);

    writeFileSync(join(atelier2, "brouillon.txt"), "pas enregistré");
    const sale = await lancer("deployer.mjs", [], { racine: atelier2, env: avecFaux() });
    verifier("dépôt modifié : refusé", sale.code === 1 && sale.erreur.includes("modifications non enregistrées") && sale.erreur.includes("brouillon.txt"), sale.tout);
    rmSync(join(atelier2, "brouillon.txt"));
    verifier("dépôt modifié : wrangler n'a pas été appelé", appelsFaux().length === 0);

    const verif = await lancer("deployer.mjs", [], { racine: atelier2, env: avecFaux({ FAUX_VERIFIER_ECHEC: "1" }) });
    verifier("npm run verifier en échec : refusé", verif.code === 1 && verif.erreur.includes("npm run verifier a échoué"), verif.tout);
    verifier("npm run verifier en échec : wrangler n'a pas été appelé", appelsFaux().length === 0);

    const autre = await lancer("deployer.mjs", [], { racine: atelier2, env: avecFaux({ FAUX_EMAIL: "graine@example.com" }) });
    verifier("mauvais compte wrangler : refusé", autre.code === 1 && autre.erreur.includes("connecté avec graine@example.com"), autre.tout);
    const id = await lancer("deployer.mjs", [], { racine: atelier2, env: avecFaux({ FAUX_COMPTE: "0".repeat(32) }) });
    verifier("compte d'atelier.json absent de whoami : refusé", id.code === 1 && id.erreur.includes(COMPTE.id), id.tout);
    verifier("mauvais compte : aucun déploiement", deploiements().length === 0, JSON.stringify(appelsFaux()));
    verifier("compteReconnu : un jeton d'API (sans e-mail) n'est pas reconnu", compteReconnu("You are logged in with an API Token.\n" + COMPTE.id, COMPTE) !== "");
    verifier("compteReconnu : la bonne réponse", compteReconnu("\x1b[1mYou are logged in with an OAuth Token, associated with the email " + COMPTE.email + ".\x1b[0m\n│ x │ " + COMPTE.id + " │", COMPTE) === "");

    // Un ✗ chez le DERNIER client arrête tout AVANT le premier déploiement.
    const fichier = join(atelier2, "clients", "client-b", "contenu.json");
    const bon = readFileSync(fichier, "utf8");
    const c = JSON.parse(bon);
    c.entete.liens[0].vers = "#disparue";
    ecrireJson(fichier, c);
    git("commit", "-qam", "client-b cassé");
    viderFaux();
    const casse = await lancer("deployer.mjs", [], { racine: atelier2, env: avecFaux() });
    verifier("un ✗ au contrôle : arrêt avant tout déploiement", casse.code === 1 && casse.erreur.includes("Arrêt avant tout déploiement : « client-b »") && casse.sortie.includes("#disparue"), casse.tout);
    verifier("un ✗ au contrôle : aucun site n'a changé", deploiements().length === 0, JSON.stringify(deploiements()));
    writeFileSync(fichier, bon);
    git("commit", "-qam", "client-b réparé");

    // Deux clients qui partagent un espace : refusé avant tout, même quand
    // aucun des deux n'est dans le plan (3 octobre 2026). « copie-kv »
    // reprend l'identifiant de maquette-z, comme le ferait quelqu'un qui
    // recopie la sortie de `wrangler kv namespace list`.
    ajouterClient("copie-kv", { demo: true, mentionDemo: "C", domaine: "" }, tomlDeMaquette("copie-kv", { kv: kvDe("maquette-z") }));
    git("add", "-A"); git("commit", "-qm", "copie-kv");
    viderFaux();
    const kv = await lancer("deployer.mjs", ["--client", "client-b"], { racine: atelier2, env: avecFaux() });
    verifier("un espace de contenu partagé : arrêt avant tout déploiement", kv.code === 1 &&
      kv.erreur.includes("Arrêt avant tout déploiement : « copie-kv » et « maquette-z » partagent l'espace de contenu (KV) « " + kvDe("maquette-z") + " »"), kv.tout);
    verifier("un espace de contenu partagé : aucun site n'a changé, wrangler jamais appelé", appelsFaux().length === 0, JSON.stringify(appelsFaux()));
    const kvBlanc = await lancer("deployer.mjs", ["--a-blanc"], { racine: atelier2, env: avecFaux() });
    verifier("un espace de contenu partagé : le plan à blanc le dit", kvBlanc.sortie.includes("✗ « copie-kv » et « maquette-z » partagent l'espace de contenu (KV)"), kvBlanc.sortie);
    writeFileSync(join(atelier2, "clients", "copie-kv", "wrangler.toml"),
      tomlDeMaquette("copie-kv").replace('bucket_name = "vitrine-copie-kv-medias"', 'bucket_name = "vitrine-maquette-z-medias"'));
    git("commit", "-qam", "copie-kv, son propre KV, l'espace photos de maquette-z");
    const r2 = await lancer("deployer.mjs", ["--vague", "demo"], { racine: atelier2, env: avecFaux() });
    verifier("un espace photos partagé : arrêt avant tout déploiement", r2.code === 1 &&
      r2.erreur.includes("« copie-kv » et « maquette-z » partagent l'espace photos (R2) « vitrine-maquette-z-medias »") && deploiements().length === 0, r2.tout);
    rmSync(join(atelier2, "clients", "copie-kv"), { recursive: true });
    git("add", "-A"); git("commit", "-qm", "sans copie-kv");

    // Une maquette dont l'espace de contenu vaut encore « a-creer » passe
    // controler, mais son wrangler deploy échoue à coup sûr : elle est
    // refusée AVANT le premier déploiement, pas au milieu de la vague
    // (3 octobre 2026). Classée après demo-boulangerie, exprès.
    ajouterClient("maquette-neuve", { demo: true, mentionDemo: "M", domaine: "" }, tomlDeMaquette("maquette-neuve", { kv: "a-creer" }));
    git("add", "-A"); git("commit", "-qm", "maquette-neuve");
    viderFaux();
    const neuve = await lancer("deployer.mjs", ["--vague", "demo"], { racine: atelier2, env: avecFaux() });
    verifier("une maquette en « a-creer » : arrêt avant tout déploiement", neuve.code === 1 &&
      neuve.erreur.includes("Arrêt avant tout déploiement : « maquette-neuve »") && neuve.erreur.includes("a-creer"), neuve.tout);
    verifier("une maquette en « a-creer » : aucun site n'a changé (demo-boulangerie non plus)", deploiements().length === 0, JSON.stringify(deploiements()));
    const neuveBlanc = await lancer("deployer.mjs", ["--a-blanc", "--vague", "demo"], { racine: atelier2, env: avecFaux() });
    verifier("une maquette en « a-creer » : le plan à blanc le dit", neuveBlanc.sortie.includes("✗ wrangler.toml : l'espace de contenu vaut encore « a-creer »"), neuveBlanc.sortie);
    rmSync(join(atelier2, "clients", "maquette-neuve"), { recursive: true });
    git("add", "-A"); git("commit", "-qm", "sans maquette-neuve");
    git("tag", "-f", "socle-0.3.0");                                      // l'étiquette suit le commit déployé
  });

  await groupe("deployer : en vagues, jusqu'au bout", async () => {
    viderFaux();
    demandesSites.length = 0;
    const r = await lancer("deployer.mjs", [], { racine: atelier2, env: avecFaux() });
    verifier("tous : code 0", r.code === 0, r.tout);
    verifier("tous : l'ordre des vagues", JSON.stringify(deploiements()) === JSON.stringify(["demo-boulangerie", "maquette-z", "pilote-a", "client-b"]), JSON.stringify(deploiements()));
    const appels = appelsFaux();
    verifier("tous : le compte d'atelier.json est imposé à wrangler", appels.length > 0 && appels.every((a) => a.compte === COMPTE.id));
    verifier("tous : whoami juste avant chaque déploiement", appels.every((a, i) => a.args[0] !== "deploy" || (i > 0 && appels[i - 1].args[0] === "whoami")));
    verifier("tous : wrangler lancé depuis la racine, avec le wrangler.toml du client", appels.filter((a) => a.args[0] === "deploy").every((a) => a.args[1] === "-c" && /^clients[\\/][a-z-]+[\\/]wrangler\.toml$/.test(a.args[2]) && a.cwd.endsWith("atelier-2")));
    for (const attendu of ["vitrine-maquette-z." + sous + ".workers.dev/", "vitrine-maquette-z." + sous + ".workers.dev/robots.txt", "client-b.example/", "client-b.example/robots.txt", "www.client-b.example/"]) {
      verifier("tous : le vrai site est vérifié — " + attendu, demandesSites.includes(attendu), JSON.stringify(demandesSites));
    }
    verifier("tous : le bilan", r.sortie.includes("4 sites déployés et vérifiés") && r.sortie.includes("Vague « pilote » terminée"), r.sortie);
    const ordreControles = ["demo-boulangerie", "maquette-z", "pilote-a", "client-b"].map((id) => r.sortie.indexOf("Contrôle de « " + id + " »"));
    verifier("tous : les contrôles, dans l'ordre des vagues, tous avant le premier déploiement",
      ordreControles.every((p, i) => p > 0 && (i === 0 || p > ordreControles[i - 1])) && ordreControles[3] < r.sortie.indexOf("=== Vague"), JSON.stringify(ordreControles));

    viderFaux();
    const demo = await lancer("deployer.mjs", ["--vague", "demo"], { racine: atelier2, env: avecFaux() });
    verifier("--vague demo : seulement les maquettes", demo.code === 0 && JSON.stringify(deploiements()) === '["demo-boulangerie","maquette-z"]', JSON.stringify(deploiements()));
    verifier("--vague demo : dit la suite", demo.sortie.includes("npm run deployer -- --vague pilote"), demo.sortie);
    viderFaux();
    const un = await lancer("deployer.mjs", ["--client", "pilote-a"], { racine: atelier2, env: avecFaux() });
    verifier("--client : un seul client", un.code === 0 && JSON.stringify(deploiements()) === '["pilote-a"]', JSON.stringify(deploiements()));
  });

  await groupe("deployer : le premier échec arrête tout", async () => {
    viderFaux();
    const r = await lancer("deployer.mjs", [], { racine: atelier2, env: avecFaux({ FAUX_ECHEC_DEPLOY: "pilote-a" }) });
    verifier("échec de wrangler deploy : code 1", r.code === 1, r.tout);
    verifier("échec de wrangler deploy : rien après", JSON.stringify(deploiements()) === JSON.stringify(["demo-boulangerie", "maquette-z", "pilote-a"]), JSON.stringify(deploiements()));
    verifier("échec : qui a reçu la nouvelle version", r.erreur.includes("Ont reçu la nouvelle version : demo-boulangerie, maquette-z."), r.erreur);
    verifier("échec : comment revenir en arrière (l'étiquette précédente)", r.erreur.includes("git switch --detach socle-0.2.0") &&
      r.erreur.includes("npx wrangler deploy -c clients/demo-boulangerie/wrangler.toml") && r.erreur.includes("npx wrangler deploy -c clients/maquette-z/wrangler.toml") &&
      !r.erreur.includes("-c clients/pilote-a/wrangler.toml"), r.erreur);
    verifier("échec : qui n'a pas été touché", r.erreur.includes("Pas touchés : client-b."), r.erreur);

    sites.get("client-b.example").robotsStatut = 500;
    viderFaux();
    const site = await lancer("deployer.mjs", ["--client", "client-b"], { racine: atelier2, env: avecFaux() });
    verifier("site qui répond mal après le déploiement : arrêt", site.code === 1 && site.erreur.includes("/robots.txt répond 500"), site.tout);
    verifier("site qui répond mal : il est dans la liste à remettre en arrière", site.erreur.includes("npx wrangler deploy -c clients/client-b/wrangler.toml"), site.erreur);
    verifier("retour en arrière : le compte est imposé et vérifié, comme par l'outil",
      site.erreur.includes(`CLOUDFLARE_ACCOUNT_ID=${COMPTE.id} npx wrangler deploy -c clients/client-b/wrangler.toml`) &&
      site.erreur.includes("npx wrangler whoami   # doit afficher " + COMPTE.email), site.erreur);
    delete sites.get("client-b.example").robotsStatut;

    sites.get("pilote-a.example").robots = ROBOTS_FERME;
    const ferme = await lancer("deployer.mjs", ["--client", "pilote-a"], { racine: atelier2, env: avecFaux() });
    verifier("un client en production dont robots.txt ferme l'indexation : arrêt", ferme.code === 1 && ferme.erreur.includes("n'autorise pas l'indexation"), ferme.tout);
    sites.get("pilote-a.example").robots = ROBOTS_OUVERT("pilote-a.example");
    sites.get("vitrine-maquette-z." + sous + ".workers.dev").robots = ROBOTS_OUVERT("x");
    const ouvert = await lancer("deployer.mjs", ["--client", "maquette-z"], { racine: atelier2, env: avecFaux() });
    verifier("une maquette dont robots.txt ouvre l'indexation : arrêt", ouvert.code === 1 && ouvert.erreur.includes("alors que c'est une maquette"), ouvert.tout);
    sites.get("vitrine-maquette-z." + sous + ".workers.dev").robots = ROBOTS_FERME;
    sites.get("client-b.example").www = { statut: 200 };
    const www = await lancer("deployer.mjs", ["--client", "client-b"], { racine: atelier2, env: avecFaux() });
    verifier("www qui ne renvoie pas vers le domaine : arrêt", www.code === 1 && www.erreur.includes("ne renvoie pas vers https://client-b.example/"), www.tout);
    delete sites.get("client-b.example").www;
  });

  /* Un domaine qui ne déclare pas www (un sous-domaine, un choix du
     client) : controler n'en fait qu'un ⚠, deployer ne doit pas l'exiger
     APRÈS avoir déployé (3 octobre 2026 : la vague s'arrêtait à lui, à
     chaque mise à jour du socle). */
  await groupe("deployer : un domaine sans www", async () => {
    ajouterClient("sans-www", { demo: false, domaine: "sans-www.example" }, tomlDeProduction("sans-www", "sans-www.example", { www: false }));
    sites.set("sans-www.example", { robots: ROBOTS_OUVERT("sans-www.example"), www: { statut: 404 } });   // www n'existe pas
    git("add", "-A"); git("commit", "-qm", "sans-www");
    viderFaux();
    demandesSites.length = 0;
    const r = await lancer("deployer.mjs", ["--client", "sans-www"], { racine: atelier2, env: avecFaux() });
    verifier("sans www : déployé et vérifié, code 0", r.code === 0 && JSON.stringify(deploiements()) === '["sans-www"]', r.tout);
    verifier("sans www : www n'est jamais demandé", demandesSites.includes("sans-www.example/") && !demandesSites.some((d) => d.startsWith("www.sans-www.example")), JSON.stringify(demandesSites));
    verifier("sans www : un ⚠ le dit", r.sortie.includes("⚠ www.sans-www.example n'est pas déclaré dans wrangler.toml : non vérifié"), r.sortie);
    const blanc = await lancer("deployer.mjs", ["--a-blanc", "--client", "sans-www"], { racine: atelier2, env: avecFaux() });
    verifier("sans www : le plan à blanc ne promet pas de vérifier www", blanc.sortie.includes("(www.sans-www.example n'est pas déclaré : non vérifié)") &&
      !blanc.sortie.includes("https://www.sans-www.example/ →"), blanc.sortie);
    rmSync(join(atelier2, "clients", "sans-www"), { recursive: true });
    git("add", "-A"); git("commit", "-qm", "sans sans-www");
    git("tag", "-f", "socle-0.3.0");
  });

  /* La première mise en ligne d'une maquette, enregistrée APRÈS la
     dernière étiquette comme le veut PROCESSUS § 2 : à l'étiquette
     précédente, son dossier n'existe pas. Le conseil « redéployer
     l'étiquette précédente » échouait sur un fichier introuvable
     (3 octobre 2026). */
  await groupe("deployer : le retour en arrière d'une première mise en ligne", async () => {
    const n = await lancer("nouveau-client.mjs", ["zz-essai", "Essai ZZ"], { racine: atelier2 });
    verifier("première mise en ligne : la maquette est créée", n.code === 0, n.tout);
    const fichierToml = join(atelier2, "clients", "zz-essai", "wrangler.toml");
    writeFileSync(fichierToml, readFileSync(fichierToml, "utf8").replace('id = "a-creer"', 'id = "' + kvDe("zz-essai") + '"'));
    git("add", "-A"); git("commit", "-qm", "Maquette Essai ZZ");          // sans étiquette : c'est le parcours normal
    viderFaux();
    const r = await lancer("deployer.mjs", ["--client", "zz-essai"], { racine: atelier2, env: avecFaux() });   // son site ne répond pas (404)
    verifier("première mise en ligne qui échoue : arrêt", r.code === 1 && JSON.stringify(deploiements()) === '["zz-essai"]' && r.erreur.includes("répond 404"), r.tout);
    verifier("première mise en ligne : le conseil le dit, sans redéployer un dossier qui n'existait pas",
      r.erreur.includes("zz-essai : rien à remettre à l'étiquette socle-0.3.0 — il n'y existait pas.") &&
      !/^\s*CLOUDFLARE_ACCOUNT_ID=\S+ npx wrangler deploy -c clients\/zz-essai\//m.test(r.erreur) && !r.erreur.includes("git switch --detach socle-"), r.erreur);
    verifier("première mise en ligne : la commande pour retirer le site impose le compte",
      r.erreur.includes(`CLOUDFLARE_ACCOUNT_ID=${COMPTE.id} npx wrangler delete -c clients/zz-essai/wrangler.toml`) && r.erreur.includes("npx wrangler whoami   # doit afficher " + COMPTE.email), r.erreur);
    // Absente de l'étiquette ne veut pas dire « jamais en ligne » : déployée
    // par --client depuis un commit sans étiquette, elle l'était déjà. Le
    // conseil ne doit pas affirmer une première fois (contrôle du 3 octobre
    // 2026) : « retirez le site » n'y vaut que pour une première fois.
    verifier("absente de l'étiquette : le retrait n'est proposé que pour une première mise en ligne, et le commit d'où elle venait se retrouve",
      !r.erreur.includes("première mise en ligne, il n'existait pas") && r.erreur.includes("Si c'était sa première mise en ligne") &&
      r.erreur.includes("git log --oneline socle-0.3.0..HEAD -- clients/zz-essai"), r.erreur);
  });

  /* Un client qui EXISTAIT à l'étiquette précédente, mais pas dans la même
     configuration : l'espace de contenu y valait encore « a-creer » (cette
     version ne se redéploie pas), ou il est passé de maquette à production
     depuis (la redéployer remettrait une maquette fermée à Google sur son
     domaine). Contrôle du 3 octobre 2026 : le conseil proposait les deux
     sans un mot. */
  await groupe("deployer : le retour en arrière d'un client qui a changé depuis l'étiquette", async () => {
    ajouterClient("zz-attente", { demo: true, mentionDemo: "A", domaine: "" }, tomlDeMaquette("zz-attente", { kv: "a-creer" }));
    ajouterClient("zz-prod", { demo: true, mentionDemo: "P", domaine: "" }, tomlDeMaquette("zz-prod"));
    git("add", "-A"); git("commit", "-qm", "socle suivant"); git("tag", "socle-0.3.1");
    ajouterClient("zz-attente", { demo: true, mentionDemo: "A", domaine: "" }, tomlDeMaquette("zz-attente"));
    ajouterClient("zz-prod", { demo: false, domaine: "zz-prod.example" }, tomlDeProduction("zz-prod", "zz-prod.example"));
    const ficheZ = join(atelier2, "clients", "maquette-z", "client.json");
    ecrireJson(ficheZ, Object.assign(lireJson(ficheZ), { socle: "9.9.9" }));     // une montée de version : rien à signaler
    git("add", "-A"); git("commit", "-qm", "zz-attente a son espace, zz-prod en production");
    const attente = await lancer("deployer.mjs", ["--client", "zz-attente"], { racine: atelier2, env: avecFaux() });
    verifier("« a-creer » à l'étiquette : rien à y remettre, pas de redéploiement voué à l'échec",
      attente.code === 1 && attente.erreur.includes("zz-attente : rien à remettre à l'étiquette socle-0.3.1 — son espace de contenu y valait encore « a-creer »") &&
      !/^\s*CLOUDFLARE_ACCOUNT_ID=\S+ npx wrangler deploy -c clients\/zz-attente\//m.test(attente.erreur), attente.erreur);
    const prod = await lancer("deployer.mjs", ["--client", "zz-prod"], { racine: atelier2, env: avecFaux() });
    verifier("passé en production depuis l'étiquette : le redéploiement est proposé, avec un ⚠ et la commande qui compare",
      prod.code === 1 && prod.erreur.includes(`CLOUDFLARE_ACCOUNT_ID=${COMPTE.id} npx wrangler deploy -c clients/zz-prod/wrangler.toml`) &&
      prod.erreur.includes("⚠ zz-prod : sa configuration a changé depuis socle-0.3.1") &&
      prod.erreur.includes("git diff socle-0.3.1 HEAD -- clients/zz-prod/client.json clients/zz-prod/wrangler.toml"), prod.erreur);
    sites.get("vitrine-maquette-z." + sous + ".workers.dev").robotsStatut = 500;
    const z = await lancer("deployer.mjs", ["--client", "maquette-z"], { racine: atelier2, env: avecFaux() });
    delete sites.get("vitrine-maquette-z." + sous + ".workers.dev").robotsStatut;
    verifier("seule la version du socle a changé : redéploiement proposé, aucun ⚠",
      z.code === 1 && z.erreur.includes("npx wrangler deploy -c clients/maquette-z/wrangler.toml") && !z.erreur.includes("⚠ maquette-z"), z.erreur);
  });

  /* =========================================================
     Le dépôt
     ========================================================= */
  await groupe("le dépôt", () => {
    const attr = spawnSync("git", ["check-attr", "text", "eol", "binary", "--", "x.png", "x.jpg", "x.webp", "x.woff2", "x.svg", "outils/x.mjs"], { cwd: RACINE, encoding: "utf8" }).stdout;
    verifier(".gitattributes : images et polices en binaire", /x\.png: binary: set/.test(attr) && /x\.jpg: binary: set/.test(attr) && /x\.webp: binary: set/.test(attr) && /x\.woff2: binary: set/.test(attr), attr);
    verifier(".gitattributes : le reste en texte, fins de ligne Unix", /outils\/x\.mjs: text: auto/.test(attr) && /outils\/x\.mjs: eol: lf/.test(attr) && /x\.svg: text: auto/.test(attr), attr);
    const ignore = (chemin) => spawnSync("git", ["check-ignore", "-q", "--no-index", "--", chemin], { cwd: RACINE }).status === 0;
    verifier(".gitignore : le dossier de travail d'un nouveau-client interrompu n'est pas suivi",
      ignore("clients/.nouveau-boulangerie-muller-aB3xYz/client.json") && !ignore("clients/boulangerie-muller/client.json") && ignore("clients/boulangerie-muller/.acces-demo"));
    const paquet = lireJson(join(RACINE, "package.json"));
    verifier("package.json : les scripts des outils", ["nouveau-client", "controler", "deployer", "exporter"].every((s) => paquet.scripts[s] === "node outils/" + s + ".mjs"));
    verifier("package.json : test et verifier lancent ces tests-ci", paquet.scripts.test.includes("outils/tester-outils.mjs") && paquet.scripts.verifier.includes("outils/tester-outils.mjs"));
    verifier("le socle de la démo est celui du dépôt", lireJson(join(RACINE, "clients", DEMO, "client.json")).socle === paquet.version, paquet.version);
    const atelier = lireJson(join(RACINE, "atelier.json"));
    verifier("atelier.json : le compte et le sous-domaine", /^[0-9a-f]{32}$/.test(atelier.compteCloudflare.id) && atelier.compteCloudflare.email.includes("@") && atelier.sousDomaineWorkers === "depinhomartin");
    // La version du socle n'est écrite en dur nulle part dans ces tests :
    // la montée de version de PROCESSUS § 5 ne doit rien casser ici.
    const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
    verifier("tester-outils : la version du socle n'y est jamais écrite en dur", !source.includes('"' + VERSION + '"') && !source.includes("'" + VERSION + "'"));
    // La commande qui crée l'espace de contenu donne un nom PROPRE au client,
    // partout où elle est écrite : « CONTENU » échoue dès le deuxième client.
    // Le wrangler.toml de la démo compte aussi : c'est lui qu'on ouvre pour
    // voir comment un client est réglé (contrôle du 3 octobre 2026).
    const avecLaVieilleCommande = ["README.md", "PROCESSUS.md", join("outils", "nouveau-client.mjs"), join("clients", DEMO, "wrangler.toml")]
      .filter((f) => /kv namespace create CONTENU\b/.test(readFileSync(join(RACINE, f), "utf8")));
    verifier("la commande de création du KV nomme l'espace d'après le client, partout", avecLaVieilleCommande.length === 0, avecLaVieilleCommande.join(", "));
  });

  /* Le dernier, exprès : le piège n'a jamais servi. */
  verifier("le vrai wrangler (npx, wrangler) n'a JAMAIS été appelé", !existsSync(PIEGE_JOURNAL), existsSync(PIEGE_JOURNAL) ? readFileSync(PIEGE_JOURNAL, "utf8") : "");
} finally {
  serveur.closeAllConnections();
  serveur.close();
  rmSync(BASE, { recursive: true, force: true });
}

/* Le wrangler.toml d'un client en production, tiré de celui de la démo :
   ses propres noms, son propre espace de contenu, et ses routes (`www`
   à false : le domaine seul). */
function tomlDeProduction(id, domaine, { www = true } = {}) {
  return readFileSync(join(RACINE, "clients", DEMO, "wrangler.toml"), "utf8")
    .replace(/vitrine-demo-boulangerie/g, "vitrine-" + id)
    .replace("workers_dev = true", 'workers_dev = false\nroutes = [\n  { pattern = "' + domaine + '", custom_domain = true },\n' +
      (www ? '  { pattern = "www.' + domaine + '", custom_domain = true },\n' : "") + ']')
    .replace(/^id = "[0-9a-f]{32}"/m, 'id = "' + kvDe(id) + '"');
}

/* Celui d'une maquette : ses propres noms, son propre espace de contenu
   (`kv` : « a-creer » pour une maquette dont l'espace reste à créer). */
function tomlDeMaquette(id, { kv = kvDe(id) } = {}) {
  return readFileSync(join(RACINE, "clients", DEMO, "wrangler.toml"), "utf8")
    .replace(/vitrine-demo-boulangerie/g, "vitrine-" + id)
    .replace(/^id = "[0-9a-f]{32}"/m, 'id = "' + kv + '"');
}

/* ----- Bilan ----- */
if (echecs.length) {
  for (const e of echecs) console.error("✗ " + e);
  console.error(`\n${echecs.length} échec(s), ${ok} réussite(s).`);
  process.exit(1);
}
console.log(`✓ ${ok} vérifications réussies`);
