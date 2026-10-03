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
   de `socle/public/` — les pages, `robots.txt`, `sitemap.xml`. */

import { rendrePage, normaliser, PAGE_ACCUEIL } from "./public/rendu/page.js";
import { identifiantValide } from "./public/rendu/outils.js";
import { lireContenu } from "./serveur/contenu.js";
import { reponseHtml, reponseTexte, reponseRedirection, reponseMethodeRefusee } from "./serveur/reponses.js";

/* L'adresse publique du site : le domaine de la fiche s'il est connu,
   sinon celle de la requête (développement local, sous-domaine de démo). */
function origineDe(client, url) {
  if (client.domaine && /^[a-z0-9.-]+$/i.test(client.domaine)) return "https://" + client.domaine;
  return url.origin;
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
   si rien ne reste, ce n'est pas une page : pas de redirection. */
function redirectionSansBarreFinale(url) {
  const nettoye = url.pathname.replace(/^[/\\]+/, "").replace(/\/+$/, "");
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

export function creerSite({ client, contenu: contenuLivre }) {
  const fiche = client && typeof client === "object" ? client : {};

  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const methode = request.method;
      if (methode !== "GET" && methode !== "HEAD") return reponseMethodeRefusee(fiche);

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
        // La page d'erreur garde l'habit du site : l'en-tête et le pied
        // permettent de repartir, au lieu d'une page blanche.
        // Une page d'erreur ne s'indexe jamais — sans pour autant se faire
        // passer pour une maquette : le bandeau de démonstration ne dépend
        // que de la fiche du client.
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

      /* Dernier filet : si le contenu PUBLIÉ fait lever le rendu (un cas que
         `normaliser` n'aurait pas prévu), on rend le contenu LIVRÉ ; et si
         même celui-ci échoue, une page de secours. Jamais une erreur brute. */
      try {
        return reponseHtml(rendrePage({ contenu, client: fiche, pageId, origine, chemin }), { client: fiche, methode });
      } catch (e) {
        console.error("Rendu du contenu publié impossible, repli sur le contenu livré :", e);
        try {
          const livre = normaliser(contenuLivre);
          const pageLivree = Object.prototype.hasOwnProperty.call(livre.pages, pageId) ? pageId : PAGE_ACCUEIL;
          return reponseHtml(rendrePage({ contenu: livre, client: fiche, pageId: pageLivree, origine, chemin }), { client: fiche, methode });
        } catch (e2) {
          console.error("Rendu du contenu livré impossible :", e2);
          return reponseHtml(PAGE_DE_SECOURS, { client: fiche, statut: 503, methode, indexable: false });
        }
      }
    }
  };
}
