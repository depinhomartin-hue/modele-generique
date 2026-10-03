/* =========================================================
   Le Worker du socle — commun à tous les clients
   =========================================================

   Chaque client a SON Worker, déployé depuis ce même fichier : son dossier
   `clients/<nom>/index.js` appelle `creerSite()` avec sa fiche et son
   contenu livré. Aucun code propre à un client n'existe ailleurs que dans
   ces deux fichiers de données — c'est la règle d'or de l'atelier.

   Les fichiers statiques (CSS, polices, illustrations, modules de rendu)
   sont servis par Cloudflare AVANT le Worker, gratuitement et sans compter
   dans les requêtes : le Worker ne reçoit que ce qui n'est pas un fichier
   de `socle/public/` — les pages, `robots.txt`, `sitemap.xml`, depuis la
   phase 2 l'administration (`/admin…`) et les photos (`/medias/…`), et
   depuis le socle 0.3.0 le formulaire de contact (`POST /contact`). */

import { rendrePage, normaliser, PAGE_ACCUEIL } from "./public/rendu/page.js";
import { identifiantValide } from "./public/rendu/outils.js";
import { lireContenu } from "./serveur/contenu.js";
import { reponseHtml, reponseTexte, reponseRedirection, reponseMethodeRefusee } from "./serveur/reponses.js";
import { estAdresseAdmin, routerAdmin } from "./serveur/admin.js";
import { servirPhoto } from "./serveur/medias.js";
import { recevoirMessage, formulaireDeLAdresse, CHEMIN_CONTACT } from "./serveur/contact.js";

/* Le domaine de la fiche, en minuscules (un nom d'hôte ne distingue pas
   la casse, et `URL` rend toujours `hostname` en minuscules) ; vide s'il
   n'est pas renseigné ou pas de la bonne forme. */
function domaineDe(client) {
  const d = typeof client.domaine === "string" ? client.domaine.trim().toLowerCase() : "";
  return /^[a-z0-9.-]+$/.test(d) ? d : "";
}

/* L'adresse publique du site : le domaine de la fiche s'il est connu,
   sinon celle de la requête (développement local, sous-domaine de démo). */
function origineDe(client, url) {
  const domaine = domaineDe(client);
  return domaine ? "https://" + domaine : url.origin;
}

/* `www.<domaine>` → `<domaine>`, en 301, avant TOUTE autre logique,
   administration comprise. Une page n'a qu'une adresse aux yeux des
   moteurs de recherche, et un cookie de session posé sur l'une ne vaut pas
   sur l'autre : sans cette redirection, la cliente qui ouvre son
   administration par « www » se reconnecterait sans comprendre pourquoi.
   Le chemin BRUT (`url.pathname`, encore encodé) suit tel quel : l'hôte
   de destination est écrit en toutes lettres, « //pirate.example » n'y
   devient qu'un chemin de notre propre domaine. */
function redirectionWww(client, url) {
  const domaine = domaineDe(client);
  if (!domaine || url.hostname !== "www." + domaine) return null;
  return reponseRedirection("https://" + domaine + url.pathname + url.search, 301);
}

/* « / » → l'accueil ; « /tarifs » → la page `tarifs` si elle existe.
   Une barre finale est retirée par redirection, pour qu'une page n'ait
   qu'une seule adresse aux yeux des moteurs de recherche. */
function pageDe(chemin, contenu) {
  if (chemin === "/") return PAGE_ACCUEIL;
  const nom = chemin.slice(1);
  // `hasOwnProperty` et non `contenu.pages[nom]` : « /constructor » trouvait
  // une fonction par le prototype et faisait tomber le Worker (relecture
  // du 3 octobre 2026). `identifiantValide` l'écarte aussi, par prudence.
  if (nom !== PAGE_ACCUEIL && identifiantValide(nom) && Object.prototype.hasOwnProperty.call(contenu.pages, nom)) return nom;
  return null;
}

/* La redirection qui retire la barre finale.

   ⚠️ Elle part de l'adresse BRUTE (`url.pathname`, encore encodée), jamais
   du chemin décodé, et elle est ABSOLUE vers notre propre origine. La
   première version renvoyait le chemin décodé tel quel dans `Location` :
   « /%2F%2Fpirate.example/ » devenait « ///pirate.example », que le
   navigateur lit comme un AUTRE site — une redirection ouverte, de quoi
   faire du hameçonnage avec le domaine d'un client. Un caractère hors
   Latin-1 y faisait aussi lever le Worker (relecture du 3 octobre 2026).

   Les barres et contre-obliques de tête sont réduites à une seule barre ;
   si rien ne reste, ce n'est pas une page : pas de redirection.

   ⚠️ Les barres FINALES se retirent par une boucle, jamais par
   `/\/+$/` : cette expression, non ancrée en tête, est essayée depuis
   chaque barre d'une longue suite et revient en arrière jusqu'au bout. Sur
   « /a » + 16 000 barres + « b/ », une seule requête anonyme coûtait
   150 ms de processeur au lieu d'une (relecture du 3 octobre 2026).
   L'expression de tête, ancrée, reste linéaire. */
function redirectionSansBarreFinale(url) {
  const sansTete = url.pathname.replace(/^[/\\]+/, "");
  let fin = sansTete.length;
  while (fin > 0 && sansTete.charCodeAt(fin - 1) === 47) fin--; // 47 = « / »
  const nettoye = sansTete.slice(0, fin);
  if (!nettoye) return null;
  return url.origin + "/" + nettoye + url.search;
}

/* Une page d'erreur minimale, quand même le contenu livré ne se rend pas :
   le site affiche quelque chose plutôt qu'une erreur brute de Cloudflare. */
const PAGE_DE_SECOURS = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  "<title>Site momentanément indisponible</title></head><body style=\"font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem\">" +
  "<h1>Le site est momentanément indisponible.</h1><p>Merci de réessayer dans quelques minutes.</p></body></html>";

function robots(client, origine) {
  if (client.demo) return "User-agent: *\nDisallow: /\n";
  return "User-agent: *\nAllow: /\n\nSitemap: " + origine + "/sitemap.xml\n";
}

function sitemap(contenu, origine) {
  const urls = Object.keys(contenu.pages).map((id) =>
    "  <url><loc>" + origine + (id === PAGE_ACCUEIL ? "/" : "/" + id) + "</loc></url>"
  );
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.join("\n") + "\n</urlset>\n";
}

/* La page d'erreur garde l'habit du site : l'en-tête et le pied permettent
   de repartir, au lieu d'une page blanche. Une page d'erreur ne s'indexe
   jamais — sans pour autant se faire passer pour une maquette : le bandeau
   de démonstration ne dépend que de la fiche du client. Le formulaire de
   contact la sert aussi, quand un envoi vise une section qui n'existe pas. */
function reponseIntrouvable(contenu, fiche, origine, chemin, methode) {
  const html = rendrePage({
    contenu: Object.assign({}, contenu, {
      pages: Object.assign({}, contenu.pages, { introuvable: { titre: "Page introuvable", ordre: [], interne: "introuvable" } })
    }),
    client: fiche,
    pageId: "introuvable",
    origine,
    chemin,
    indexable: false
  });
  return reponseHtml(html, { client: fiche, statut: 404, methode, indexable: false });
}

export function creerSite({ client, contenu: contenuLivre }) {
  const fiche = client && typeof client === "object" ? client : {};

  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      const methode = request.method;

      const versDomaine = redirectionWww(fiche, url);
      if (versDomaine) return versDomaine;

      /* L'administration et les photos passent AVANT la logique publique :
         elles ont leurs propres méthodes (POST, PUT) et leurs propres
         en-têtes. On aiguille sur l'adresse BRUTE (`url.pathname`, encore
         encodée) : « /%61dmin » n'est pas l'administration, c'est une page
         publique qui n'existe pas. Une visite publique, elle, ne touche
         jamais au Durable Object — seulement à KV. */
      if (estAdresseAdmin(url.pathname)) {
        return routerAdmin(request, env, ctx, { client: fiche, contenuLivre, origine: origineDe(fiche, url) });
      }
      if (url.pathname.startsWith("/medias/")) return servirPhoto(request, env, ctx);

      /* Le formulaire de contact : la seule écriture publique. Il réveille
         le Durable Object — c'est l'exception à « une visite ne le réveille
         jamais », et elle ne concerne qu'un envoi, pas une visite. */
      if (url.pathname === CHEMIN_CONTACT && methode === "POST") {
        const origineSite = origineDe(fiche, url);
        return recevoirMessage(request, env, ctx, {
          client: fiche, contenuLivre, origine: origineSite,
          introuvable: (contenu) => reponseIntrouvable(contenu, fiche, origineSite, CHEMIN_CONTACT, methode)
        });
      }

      if (methode !== "GET" && methode !== "HEAD") {
        const refus = reponseMethodeRefusee(fiche);
        if (url.pathname === CHEMIN_CONTACT) refus.headers.set("Allow", "GET, HEAD, POST");
        return refus;
      }

      const origine = origineDe(fiche, url);
      if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
        const vers = redirectionSansBarreFinale(url);
        if (vers) return reponseRedirection(vers);
      }
      // Une adresse mal encodée (« %E0%A4 ») fait lever decodeURIComponent :
      // ce n'est pas une panne du site, c'est une page qui n'existe pas.
      let chemin;
      try { chemin = decodeURIComponent(url.pathname); } catch { chemin = "/\u0000"; }

      // Les navigateurs demandent /favicon.ico d'office : on les renvoie vers
      // l'icône du socle au lieu de leur fabriquer une page d'erreur.
      if (chemin === "/favicon.ico") return reponseRedirection("/favicon.svg");

      const contenu = await lireContenu(env, contenuLivre);

      if (chemin === "/robots.txt") return reponseTexte(robots(fiche, origine), { client: fiche, methode });
      if (chemin === "/sitemap.xml") {
        return reponseTexte(sitemap(contenu, origine), { client: fiche, type: "application/xml; charset=utf-8", methode });
      }

      const pageId = pageDe(chemin, contenu);
      if (!pageId) {
        /* « /contact » est l'adresse où part le formulaire. Ouverte en GET
           (un favori, un robot, un « Précédent »), elle ramène à l'accueil
           plutôt qu'à une erreur — SAUF si le client a une page « contact » :
           elle passe alors par `pageDe` ci-dessus et s'affiche normalement.
           Le formulaire n'envoie qu'en POST, les deux ne se gênent pas. */
        if (url.pathname === CHEMIN_CONTACT) return reponseRedirection("/", 303);
        return reponseIntrouvable(contenu, fiche, origine, chemin, methode);
      }

      /* Dernier filet : si le contenu PUBLIÉ fait lever le rendu (un cas que
         `normaliser` n'aurait pas prévu), on rend le contenu LIVRÉ ; et si
         même celui-ci échoue, une page de secours. Jamais une erreur brute.
         `formulaire` : la page qui suit un message envoyé dit « merci »
         (`?contact=envoye&bloc=<id>`, voir serveur/contact.js). */
      try {
        const formulaire = formulaireDeLAdresse(url, contenu, pageId);
        return reponseHtml(rendrePage({ contenu, client: fiche, pageId, origine, chemin, formulaire }), { client: fiche, methode });
      } catch (e) {
        console.error("Rendu du contenu publié impossible, repli sur le contenu livré :", e);
        try {
          const livre = normaliser(contenuLivre);
          const pageLivree = Object.prototype.hasOwnProperty.call(livre.pages, pageId) ? pageId : PAGE_ACCUEIL;
          const formulaire = formulaireDeLAdresse(url, livre, pageLivree);
          return reponseHtml(rendrePage({ contenu: livre, client: fiche, pageId: pageLivree, origine, chemin, formulaire }), { client: fiche, methode });
        } catch (e2) {
          console.error("Rendu du contenu livré impossible :", e2);
          return reponseHtml(PAGE_DE_SECOURS, { client: fiche, statut: 503, methode, indexable: false });
        }
      }
    }
  };
}
