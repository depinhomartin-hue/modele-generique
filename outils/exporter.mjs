/* Exporter un site en fichiers statiques.

   npm run exporter -- <client> [dossier] [--depuis export.json] [--photos]
                       [--origine https://…] [--delai <ms>]

   Écrit chaque page en HTML (`index.html`, `<page>/index.html`) et recopie
   les fichiers du socle (CSS, illustrations, icône) à côté. Le résultat se
   pose à la RACINE de n'importe quel hébergement, sans Worker : les pages
   gardent leurs adresses `/medias/…`, `/css/…`, et elles y mènent.

   Deux usages :
   — la CLAUSE DE SORTIE : un client qui part reçoit son site en l'état,
     qui continue de fonctionner ailleurs (sans l'éditeur) ;
   — l'aperçu local, quand aucun serveur Cloudflare n'est disponible.

   Le contenu exporté est, au choix :
   — celui du fichier livré (`contenu.json`), par défaut ;
   — celui qui est EN LIGNE, avec `--depuis <fichier>` : l'export
     téléchargé depuis l'administration (onglet Compte), qui porte le
     contenu publié et les adresses absolues des photos. Pour un client en
     service, c'est le seul qui dise vrai : il a modifié son site depuis la
     livraison (3 octobre 2026 — l'export ne lisait jusque-là que le
     fichier livré, PROCESSUS.md § 6).

   `--photos` recopie aussi les photos de la médiathèque (`/medias/…`) dans
   `<dossier>/medias/…` : toutes celles de l'export, plus celles que cite
   le contenu (adresse complétée par `--origine`, ou par l'origine des
   photos de l'export). Une à une, avec un délai entre deux (`--delai`,
   300 ms par défaut) : on ne bombarde pas le site d'un client, même en
   partance. Un échec est dit, l'export continue, et le code de sortie
   vaut 1 à la fin — un site exporté avec un trou ne doit pas passer pour
   complet.

   On ne recopie QUE ce que le site sert vraiment (3 octobre 2026). Le
   fichier d'export vient du client qui part, il peut avoir été retouché :
   la première version téléchargeait toute adresse https, de n'importe quel
   hôte, suivait les redirections sans les revérifier (jusqu'au réseau
   local de l'atelier) et acceptait n'importe quelle extension — une page
   HTML avec du script finissait dans le dossier à publier. Désormais :
   - un seul site : `--origine`, ou à défaut celui de la première photo
     acceptée de l'export (une adresse d'administration n'en connaît
     qu'un) ; toute adresse d'un autre site est refusée ;
   - le chemin d'une VRAIE photo de la médiathèque, avec la règle même du
     serveur (`photosCitees`, medias.js) : `/medias/[vignettes/]<32
     caractères hexadécimaux>.jpg|png|webp`, rien d'autre ;
   - aucune redirection suivie : le site sert ses photos directement ;
   - des octets d'image JPEG, PNG ou WebP, sinon rien n'est écrit.

   Deux choses ne partent JAMAIS dans le dossier exporté :
   — le FORMULAIRE de contact : un site statique ne reçoit rien, et un
     formulaire qui répond « page introuvable » à qui écrit est pire que
     pas de formulaire. Il est retiré, le téléphone et l'e-mail restent ;
   — les MESSAGES reçus que porte l'export de l'administration : ce sont
     des données personnelles, et ce dossier est fait pour être publié. Ils
     restent dans le fichier d'export, que le client garde.

   Et une mention légale devient fausse en chemin : l'HÉBERGEUR (3 octobre
   2026). Le dossier est fait pour être posé ailleurs que chez Cloudflare,
   et la LCEN impose de nommer l'hébergeur réel. Le paragraphe
   « Hébergement » des mentions légales est donc remplacé par
   « [À compléter : nouvel hébergeur …] », visible exprès, et la sortie le
   dit ; `--hebergeur "<nom, adresse, téléphone>"` l'écrit directement. Une
   fausse mention passerait inaperçue ; un trou visible, non. */
import { readFileSync, mkdirSync, writeFileSync, cpSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { homedir } from "node:os";
import { normaliser, rendrePage, PAGE_ACCUEIL } from "../socle/public/rendu/page.js";
import { mediasCites } from "../socle/public/rendu/structure.js";
import { identifiantValide, texteBrut } from "../socle/public/rendu/outils.js";
import { PAGE_MENTIONS } from "../socle/public/rendu/modeles-pages.js";
import { photosCitees } from "../socle/serveur/medias.js";
import { racineAtelier, RACINE_CODE, lireArguments, lireJson, estLance } from "./controler.mjs";

const DELAI_PAR_DEFAUT = 300;
const PHOTO_MAX = 25 * 1024 * 1024;
const ATTENTE_MAX = 30_000;
const HEBERGEUR_MAX = 500;
export const HEBERGEUR_A_COMPLETER = "[À compléter : nouvel hébergeur — son nom, son adresse et son téléphone]";

/* Le chemin d'une photo de la médiathèque, avec la règle du SERVEUR : une
   adresse que `photosCitees` (medias.js) reconnaît, entière, est une
   photo que le site sert ; rien d'autre. Pas de copie du motif ici : le
   jour où le serveur sert un nouveau format, l'export le suit. Le motif ne
   laisse passer ni « .. » ni autre chose que des chiffres hexadécimaux :
   aucune adresse venue d'un fichier ne peut écrire hors du dossier. */
export function estPhotoDuSite(chemin) {
  const vus = photosCitees(JSON.stringify(String(chemin)));
  return vus.length === 1 && vus[0] === chemin;
}
const BOUCLE_LOCALE = new Set(["localhost", "127.0.0.1", "[::1]"]);

/* Une origine d'où l'on accepte de télécharger : https, ou http sur la
   machine elle-même (les tests, un `wrangler dev`). */
export function origineAcceptee(u) {
  return u.protocol === "https:" || (u.protocol === "http:" && BOUCLE_LOCALE.has(u.hostname));
}

/* Les photos à recopier : `[{ url, chemin }]`, sans doublon (par chemin),
   et la liste de celles qu'on refuse, avec la raison. UN seul site :
   `origine` (`--origine`), ou à défaut celui de la première photo
   acceptée de l'export — voir l'en-tête. */
export function photosAExporter({ contenu, adressesExport = [], origine = "" }) {
  const photos = new Map();
  const refus = [];
  let site = origine ? new URL(origine).origin : "";
  // → vrai si l'adresse est acceptée (sinon le refus est noté).
  const ajouter = (adresse) => {
    let u;
    try { u = new URL(adresse); } catch { refus.push({ chemin: String(adresse), raison: "adresse illisible" }); return false; }
    if (!origineAcceptee(u)) { refus.push({ chemin: String(adresse), raison: "adresse refusée (https seulement)" }); return false; }
    let chemin;
    try { chemin = decodeURIComponent(u.pathname); } catch { chemin = ""; }
    if (!estPhotoDuSite(chemin)) {
      refus.push({ chemin: String(adresse), raison: "ce n'est pas une photo de la médiathèque" });
      return false;
    }
    if (site && u.origin !== site) {
      refus.push({ chemin: String(adresse), raison: `autre site que celui du client (${site})` });
      return false;
    }
    site = site || u.origin;
    // L'adresse est REFAITE depuis le site et le chemin vérifiés : rien de
    // ce qu'elle portait d'autre (identifiants, paramètres) ne part.
    if (!photos.has(chemin)) photos.set(chemin, { url: site + chemin, chemin });
    return true;
  };
  for (const a of Array.isArray(adressesExport) ? adressesExport : []) {
    if (typeof a === "string") ajouter(a);
  }
  // Les photos citées sans adresse complète prennent le site retenu —
  // jamais celui d'une adresse refusée.
  const base = site;
  const cites = [...mediasCites(contenu)].filter((c) => !photos.has(c));
  if (cites.length && !base) {
    for (const c of cites) refus.push({ chemin: c, raison: "adresse du site inconnue : précisez --origine https://…" });
  } else {
    for (const c of cites) ajouter(base.replace(/\/$/, "") + c);
  }
  return { photos: [...photos.values()], refus };
}

/* Les octets ressemblent-ils à l'image annoncée par l'extension ? Une page
   d'erreur servie en 200 ne doit pas finir en « photo.jpg ». Une extension
   que la médiathèque n'accepte pas n'est JAMAIS une photo : la première
   version laissait passer tout fichier non vide (3 octobre 2026). */
function ressemble(octets, chemin) {
  const ext = chemin.split(".").pop().toLowerCase();
  const egal = (attendu, decalage = 0) => attendu.every((o, i) => octets[decalage + i] === o);
  if (ext === "jpg") return egal([0xff, 0xd8, 0xff]);
  if (ext === "png") return egal([0x89, 0x50, 0x4e, 0x47]);
  if (ext === "webp") return egal([0x52, 0x49, 0x46, 0x46]) && egal([0x57, 0x45, 0x42, 0x50], 8);
  return false;
}

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const enKo = (n) => (n < 1024 ? n + " o" : Math.round(n / 1024).toLocaleString("fr-FR") + " Ko");

export async function telechargerPhotos({ photos, sortie, delai = DELAI_PAR_DEFAUT, ecrire = console.log }) {
  const echecs = [];
  let reussies = 0;
  for (let i = 0; i < photos.length; i++) {
    const { url, chemin } = photos[i];
    if (i > 0 && delai > 0) await pause(delai);
    try {
      // Aucune redirection suivie : elle mènerait hors des règles
      // vérifiées sur l'adresse (autre hôte, http, réseau local).
      const rep = await fetch(url, { signal: AbortSignal.timeout(ATTENTE_MAX), redirect: "manual" });
      if (rep.status >= 300 && rep.status < 400) {
        await rep.body?.cancel();
        throw new Error("redirection refusée (HTTP " + rep.status + (rep.headers.get("location") ? " vers " + rep.headers.get("location") : "") + ")");
      }
      if (rep.status !== 200) throw new Error("HTTP " + rep.status);
      const annoncee = Number(rep.headers.get("content-length") || 0);
      if (annoncee > PHOTO_MAX) throw new Error("trop lourde (" + enKo(annoncee) + ")");
      const octets = new Uint8Array(await rep.arrayBuffer());
      if (octets.length > PHOTO_MAX) throw new Error("trop lourde (" + enKo(octets.length) + ")");
      if (!ressemble(octets, chemin)) throw new Error("le fichier reçu n'est pas une image " + chemin.split(".").pop().toUpperCase());
      const fichier = join(sortie, ...chemin.split("/").filter(Boolean));
      const rel = relative(sortie, fichier);
      if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("chemin refusé");
      mkdirSync(dirname(fichier), { recursive: true });
      writeFileSync(fichier, octets);
      reussies++;
      ecrire(`  ✓ ${chemin} (${enKo(octets.length)})`);
    } catch (e) {
      const raison = e && e.name === "TimeoutError" ? "pas de réponse en " + ATTENTE_MAX / 1000 + " s" : (e && e.message) || String(e);
      echecs.push({ chemin, raison });
      ecrire(`  ✗ ${chemin} : ${raison}`);
    }
  }
  return { reussies, echecs };
}

/* Le contenu sans formulaire de contact (une COPIE ; voir l'en-tête). */
export function sansFormulaire(contenu) {
  const copie = JSON.parse(JSON.stringify(contenu));
  let retires = 0;
  for (const bloc of Object.values(copie.blocs || {})) {
    if (bloc && bloc.type === "contact" && bloc.formulaire === true) { bloc.formulaire = false; retires++; }
  }
  return { contenu: copie, retires };
}

/* Les mentions légales d'un site posé AILLEURS (voir l'en-tête) : chaque
   paragraphe dont le titre parle d'hébergement reçoit `hebergeur` (texte
   simple, échappé ici) ou le trou HEBERGEUR_A_COMPLETER. Agit sur le
   contenu REÇU — une copie, celle de `sansFormulaire`. Rend ce qu'il faut
   dire : la page existe-t-elle, combien de paragraphes ont changé, et
   lesquels citent encore Cloudflare ou le formulaire de contact. */
const enHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function changerHebergeur(contenu, hebergeur = "") {
  const etat = { page: false, remplaces: 0, cloudflare: [], formulaire: [] };
  const pages = contenu && contenu.pages;
  const page = pages && Object.prototype.hasOwnProperty.call(pages, PAGE_MENTIONS) ? pages[PAGE_MENTIONS] : null;
  if (!page || !Array.isArray(page.ordre)) return etat;
  etat.page = true;
  const nouveau = hebergeur ? enHtml(hebergeur.trim()).replace(/\r?\n/g, "<br>") : HEBERGEUR_A_COMPLETER;
  const noter = (titre, texte) => {
    const t = texteBrut(texte);
    if (/cloudflare/i.test(t)) etat.cloudflare.push(titre);
    if (/formulaire/i.test(t)) etat.formulaire.push(titre);
  };
  for (const id of page.ordre) {
    const bloc = contenu.blocs && contenu.blocs[id];
    if (!bloc || typeof bloc !== "object") continue;
    if (typeof bloc.intro === "string") noter("l'introduction", bloc.intro);
    for (const p of Array.isArray(bloc.paragraphes) ? bloc.paragraphes : []) {
      if (!p || typeof p !== "object") continue;
      const titre = texteBrut(p.titre) || "un paragraphe sans titre";
      if (/h[ée]berg/i.test(titre)) { p.texte = nouveau; etat.remplaces++; continue; }
      noter("« " + titre + " »", p.texte);
    }
  }
  return etat;
}

/* Le dossier d'export est VIDÉ avant d'écrire : on refuse donc tout
   dossier qui n'est pas vide et ne ressemble pas à un export précédent.
   La première version vidait sans regarder — `npm run exporter -- x ~`
   aurait effacé tout le dossier personnel. */
export function dossierDeSortieSur(sortie, racine) {
  const s = resolve(sortie);
  const interdits = [resolve("/"), resolve(homedir()), resolve(racine), resolve(RACINE_CODE)];
  for (const d of interdits) {
    const rel = relative(s, d);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return `${s} contient ${d} : il ne peut pas servir de dossier d'export.`;
  }
  if (!existsSync(s)) return "";
  let elements;
  try { elements = readdirSync(s); } catch { return `${s} n'est pas un dossier lisible.`; }
  if (!elements.length) return "";
  if (existsSync(join(s, "index.html")) && existsSync(join(s, "css", "socle.css"))) return "";
  return `${s} n'est pas vide et ne ressemble pas à un export précédent : choisissez un dossier vide.`;
}

export async function exporter({ racine = racineAtelier(), id, sortie, depuis = null, photos = false, origine = "", hebergeur = "", delai = DELAI_PAR_DEFAUT, ecrire = console.log }) {
  if (!identifiantValide(id)) throw new Error(`« ${id} » n'est pas un identifiant de client.`);
  hebergeur = typeof hebergeur === "string" ? hebergeur.trim() : "";
  if (hebergeur && (Array.from(hebergeur).length > HEBERGEUR_MAX || /[\u0000-\u0009\u000B-\u001F\u007F]/.test(hebergeur))) {
    throw new Error(`--hebergeur : un texte de ${HEBERGEUR_MAX} caractères au plus (nom, adresse et téléphone de l'hébergeur).`);
  }
  const dossierClient = join(racine, "clients", id);
  const client = lireJson(join(dossierClient, "client.json"));
  let brut;
  let adressesExport = [];
  if (depuis) {
    const exp = lireJson(resolve(depuis));
    if (!exp || typeof exp !== "object" || !exp.contenu || typeof exp.contenu !== "object") {
      throw new Error("ce fichier n'est pas un export de l'administration (il n'a pas de « contenu »).");
    }
    if (exp.site !== id) throw new Error(`cet export est celui du site « ${exp.site} », pas de « ${id} ».`);
    brut = exp.contenu;
    adressesExport = Array.isArray(exp.medias) ? exp.medias : [];
    if (Array.isArray(exp.messages) && exp.messages.length) {
      ecrire(`ⓘ L'export porte ${exp.messages.length} message${exp.messages.length > 1 ? "s" : ""} du formulaire : ils restent dans le fichier d'export, jamais dans le site exporté (ce sont des données personnelles).`);
    }
    /* L'administration n'exporte que les 2 000 messages les plus récents
       et dit combien elle en laisse (`messages_tronques`, atelier-coeur.js).
       Le taire ici, c'était laisser un client partir en croyant tout
       emporter (contrôle du 3 octobre 2026). */
    if (Number.isSafeInteger(exp.messages_tronques) && exp.messages_tronques > 0) {
      const n = exp.messages_tronques;
      ecrire(`⚠ L'export ne porte que les messages les plus récents : ${n} plus ancien${n > 1 ? "s sont restés" : " est resté"} dans l'administration du site (onglet Messages, « Afficher les messages plus anciens »). Relevez-les avant de retirer le Worker : ils disparaîtront avec lui.`);
    }
  } else {
    brut = lireJson(join(dossierClient, "contenu.json"));
  }
  if (origine) {
    let u;
    try { u = new URL(origine); } catch { throw new Error(`--origine « ${origine} » n'est pas une adresse.`); }
    if (!origineAcceptee(u)) throw new Error("--origine doit commencer par https://");
    origine = u.origin;
  }

  const destination = resolve(sortie || join(racine, ".apercu", id));
  const refus = dossierDeSortieSur(destination, racine);
  if (refus) throw new Error(refus);

  const { contenu, retires } = sansFormulaire(normaliser(brut));
  const mentions = changerHebergeur(contenu, hebergeur);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  // Les fichiers publics du socle, sauf les modules de rendu et l'éditeur :
  // un site statique n'en a pas besoin.
  for (const sous of ["css", "illustrations", "favicon.svg"]) {
    cpSync(join(RACINE_CODE, "socle", "public", sous), join(destination, sous), { recursive: true });
  }
  let pages = 0;
  for (const pageId of Object.keys(contenu.pages)) {
    const chemin = pageId === PAGE_ACCUEIL ? "/" : "/" + pageId;
    const html = rendrePage({ contenu, client, pageId, origine: "", chemin });
    const dossier = pageId === PAGE_ACCUEIL ? destination : join(destination, pageId);
    mkdirSync(dossier, { recursive: true });
    writeFileSync(join(dossier, "index.html"), html);
    pages++;
  }
  ecrire(`✓ ${id} : ${pages} page${pages > 1 ? "s exportées" : " exportée"} dans ${destination}` + (depuis ? " (contenu en ligne, d'après l'export)" : " (contenu livré)"));
  if (retires) {
    ecrire("ⓘ Le formulaire de contact est retiré du site exporté : un site statique ne reçoit pas de messages. Le téléphone et l'e-mail restent.");
  }
  const fichierMentions = PAGE_MENTIONS + "/index.html";
  if (!mentions.page) {
    ecrire("⚠ Le site exporté n'a pas de page des mentions légales : elle reste obligatoire chez le nouvel hébergeur, avec son nom, son adresse et son téléphone.");
  } else if (!mentions.remplaces) {
    ecrire(`⚠ Mentions légales : aucun paragraphe « Hébergement » trouvé — ajoutez le nom, l'adresse et le téléphone du nouvel hébergeur à ${fichierMentions} avant la mise en ligne (obligation légale).`);
  } else if (hebergeur) {
    ecrire("✓ Mentions légales : l'hébergeur est celui que vous avez indiqué (--hebergeur).");
  } else {
    ecrire(`⚠ Mentions légales : l'hébergeur (Cloudflare) est remplacé par « ${HEBERGEUR_A_COMPLETER} » — le site exporté ne sera plus chez Cloudflare. ` +
      `Écrivez le nom, l'adresse et le téléphone du nouvel hébergeur dans ${fichierMentions} avant la mise en ligne (obligation légale), ou relancez avec --hebergeur "…".`);
  }
  for (const ou of mentions.cloudflare) ecrire(`⚠ Mentions légales : ${ou} cite encore Cloudflare — relisez-le avant la mise en ligne.`);
  if (retires) for (const ou of mentions.formulaire) ecrire(`⚠ Mentions légales : ${ou} parle encore du formulaire de contact, retiré du site exporté — relisez-le.`);

  const liste = photosAExporter({ contenu, adressesExport, origine });
  const resultat = { pages, destination, reussies: 0, echecs: [] };
  if (!photos) {
    const n = liste.photos.length + liste.refus.length;
    if (n) ecrire(`⚠ ${n} photo${n > 1 ? "s" : ""} de la médiathèque ${n > 1 ? "ne sont" : "n'est"} pas recopiée${n > 1 ? "s" : ""} : relancez avec --photos.`);
    return resultat;
  }
  ecrire(`Photos de la médiathèque : ${liste.photos.length} à recopier` + (delai ? `, une toutes les ${delai} ms` : "") + ".");
  for (const r of liste.refus) {
    resultat.echecs.push(r);
    ecrire(`  ✗ ${r.chemin} : ${r.raison}`);
  }
  const t = await telechargerPhotos({ photos: liste.photos, sortie: destination, delai, ecrire });
  resultat.reussies = t.reussies;
  resultat.echecs.push(...t.echecs);
  ecrire(resultat.echecs.length
    ? `✗ Photos : ${t.reussies} recopiée${t.reussies > 1 ? "s" : ""}, ${resultat.echecs.length} en échec — le site exporté a des trous.`
    : `✓ Photos : ${t.reussies} recopiée${t.reussies > 1 ? "s" : ""}.`);
  return resultat;
}

/* ----- En ligne de commande ----- */
if (estLance(import.meta.url)) {
  const usage = "Usage : npm run exporter -- <client> [dossier] [--depuis export.json] [--photos] [--origine https://…] [--hebergeur \"nom, adresse, téléphone\"] [--delai <ms>]";
  let args;
  try {
    args = lireArguments(process.argv.slice(2), { drapeaux: ["--photos"], options: ["--depuis", "--origine", "--hebergeur", "--delai"] });
  } catch (e) {
    console.error("✗ " + e.message + "\n" + usage);
    process.exit(2);
  }
  const [id, sortie] = args.positions;
  const delai = args.options.has("--delai") ? Number(args.options.get("--delai")) : DELAI_PAR_DEFAUT;
  if (!id || args.positions.length > 2 || !Number.isInteger(delai) || delai < 0) { console.error(usage); process.exit(2); }
  try {
    const r = await exporter({
      id, sortie, depuis: args.options.get("--depuis") || null, photos: args.drapeaux.has("--photos"),
      origine: args.options.get("--origine") || "", hebergeur: args.options.get("--hebergeur") || "", delai
    });
    process.exit(r.echecs.length ? 1 : 0);
  } catch (e) {
    console.error("✗ " + e.message);
    process.exit(1);
  }
}
