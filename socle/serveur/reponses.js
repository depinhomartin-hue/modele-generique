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
