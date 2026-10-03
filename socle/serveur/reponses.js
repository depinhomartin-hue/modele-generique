/* Les réponses HTTP du socle, et leurs en-têtes de sécurité.

   La politique de contenu (CSP) n'autorise aucun script en ligne et aucun
   script d'un autre site : une visiteuse n'exécute que les fichiers du
   socle. Les styles en ligne restent permis pour une seule raison, la
   feuille <style> des variables du thème — elle est fabriquée depuis
   themes.js, jamais depuis le contenu. */

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join("; ");

export function enTetesCommuns(client, { indexable = !(client && client.demo) } = {}) {
  const h = new Headers({
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "X-Frame-Options": "DENY"
  });
  // Une maquette n'est JAMAIS indexée : la page le dit, l'en-tête aussi
  // (il couvre ce que la balise <meta> ne couvre pas, comme le sitemap).
  if (!indexable) h.set("X-Robots-Tag", "noindex, nofollow");
  return h;
}

export function reponseHtml(html, { client, statut = 200, methode = "GET", indexable } = {}) {
  const h = enTetesCommuns(client, indexable === undefined ? {} : { indexable });
  h.set("Content-Type", "text/html; charset=utf-8");
  // Le contenu peut changer à tout moment depuis l'administration : le
  // navigateur revalide à chaque visite. (Une mise en cache au bord, avec
  // purge à la publication, viendra avec l'éditeur.)
  h.set("Cache-Control", "no-cache");
  return new Response(methode === "HEAD" ? null : html, { status: statut, headers: h });
}

export function reponseTexte(texte, { client, type = "text/plain; charset=utf-8", statut = 200, methode = "GET" } = {}) {
  const h = enTetesCommuns(client);
  h.set("Content-Type", type);
  h.set("Cache-Control", "public, max-age=3600");
  return new Response(methode === "HEAD" ? null : texte, { status: statut, headers: h });
}

export function reponseRedirection(vers, statut = 301) {
  return new Response(null, { status: statut, headers: { Location: vers } });
}

export function reponseMethodeRefusee(client) {
  const h = enTetesCommuns(client);
  h.set("Allow", "GET, HEAD");
  return new Response("Méthode non autorisée", { status: 405, headers: h });
}

/* ----- L'administration -----

   Toutes ses réponses partagent les mêmes en-têtes :
   — `no-store` : une page d'administration ne reste dans aucun cache, ni
     celui du navigateur ni celui d'un proxy ;
   — `noindex` : elle n'a rien à faire dans un moteur de recherche ;
   — `Referrer-Policy: no-referrer` : le jeton de connexion est DANS
     l'adresse de `/admin/entrer`, il ne doit partir chez personne.
     Conséquence à connaître : un formulaire envoyé depuis ces pages porte
     `Origin: null` (règle du standard Fetch). Le contrôle d'origine
     d'admin.js s'appuie alors sur `Sec-Fetch-Site`.

   La CSP ajoute à celle du site ce dont l'éditeur a besoin : les photos
   déposées (`blob:`, aperçus avant envoi) et l'iframe de l'aperçu
   (`frame-src 'self'`). `/admin/cadre` est le seul document qui accepte
   d'être encadré, et seulement par le site lui-même. */
function cspAdmin(cadre) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
    "frame-src 'self'",
    cadre ? "frame-ancestors 'self'" : "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
  ].join("; ");
}

export function enTetesAdmin({ cadre = false } = {}) {
  return new Headers({
    "Content-Security-Policy": cspAdmin(cadre),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "X-Frame-Options": cadre ? "SAMEORIGIN" : "DENY",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow"
  });
}

function poserCookie(h, cookie) {
  if (cookie) h.append("Set-Cookie", cookie);
}

export function reponseHtmlAdmin(html, { statut = 200, methode = "GET", cadre = false, cookie = "" } = {}) {
  const h = enTetesAdmin({ cadre });
  h.set("Content-Type", "text/html; charset=utf-8");
  poserCookie(h, cookie);
  return new Response(methode === "HEAD" ? null : html, { status: statut, headers: h });
}

/* Toute réponse de l'API, erreurs comprises : `{ erreur, message }` en
   JSON, jamais une page HTML que l'éditeur ne saurait pas lire. */
export function reponseJsonAdmin(corps, { statut = 200, cookie = "", entetes = {} } = {}) {
  const h = enTetesAdmin();
  h.set("Content-Type", "application/json; charset=utf-8");
  for (const [k, v] of Object.entries(entetes)) h.set(k, v);
  poserCookie(h, cookie);
  return new Response(JSON.stringify(corps), { status: statut, headers: h });
}

/* 303 après un formulaire : le navigateur suit en GET, et « Actualiser »
   ne renvoie pas le formulaire. */
export function reponseRedirectionAdmin(vers, { statut = 303, cookie = "" } = {}) {
  const h = enTetesAdmin();
  h.set("Location", vers);
  poserCookie(h, cookie);
  return new Response(null, { status: statut, headers: h });
}
