/* =========================================================
   La structure du contenu — ce que l'éditeur manipule
   =========================================================

   Les règles de FORME du contenu : où vit une liste et combien elle peut
   compter d'éléments, comment naît un identifiant de bloc ou l'adresse
   d'une page, où sont rangés les liens et les photos. L'éditeur s'en sert
   dans le navigateur, le serveur de l'administration peut s'en servir aussi :
   comme `outils.js`, ce module est ISOMORPHE — ni `document`, ni `window`.

   Aucune de ces règles n'est recopiée dans l'éditeur. Graine de Pensée a
   payé deux fois la copie d'une même liste (les pages de son éditeur) : la
   copie diverge toujours, et c'est l'éditrice qui voit l'écart.

   ⚠️ Le contenu reçu ici peut être ABÎMÉ — un objet à la place d'une
   liste, `null`, un objet piégé (`{"toString":1}`) qui fait lever `String()`.
   Aucune fonction de ce module ne lève : elle rend `null`, `undefined`, une
   liste vide ou un repli. Un éditeur qui plante sur un contenu abîmé
   empêcherait précisément de le réparer. */

import { BLOCS, typeConnu } from "./registre.js";
import { texteBrut, identifiantValide, motifBalise, attributsDe, adresseDeLien, adresseSure, echapper } from "./outils.js";

const aEnPropre = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const estObjet = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const copie = (v) => JSON.parse(JSON.stringify(v));

/* ----- Les listes -----

   Le menu et les liens du pied appartiennent au SITE, pas à un bloc : leur
   description vit ici. Celle des listes d'un bloc vit dans son module
   (`listes`, voir registre.js). */
export const LISTES_SITE = Object.freeze({
  "entete.liens": Object.freeze({ libelle: "un lien", max: 8, modele: Object.freeze({ texte: "Nouveau lien", vers: "" }) }),
  "pied.liens": Object.freeze({ libelle: "un lien", max: 8, modele: Object.freeze({ texte: "Nouveau lien", vers: "" }) })
});

/* `{ libelle, max, modele }` pour une liste, ou `null` si le chemin n'en
   désigne pas une.

   Le modèle est une COPIE, neuve à chaque appel : l'éditeur la range telle
   quelle dans le contenu, et deux éléments qui partageraient le même objet
   changeraient ensemble au premier mot réécrit. Pour un bloc, c'est le
   premier élément de la liste de son modèle — textes d'exemple compris :
   un élément ajouté naît complet, comme un bloc neuf. */
export function descripteurListe(contenu, chemin) {
  if (typeof chemin !== "string") return null;
  if (aEnPropre(LISTES_SITE, chemin)) {
    const d = LISTES_SITE[chemin];
    return { libelle: d.libelle, max: d.max, modele: copie(d.modele) };
  }
  const morceaux = chemin.split(".");
  if (morceaux.length !== 3 || morceaux[0] !== "blocs") return null;
  const [, id, nom] = morceaux;
  const blocs = estObjet(contenu) && estObjet(contenu.blocs) ? contenu.blocs : null;
  if (!blocs || !identifiantValide(id) || !aEnPropre(blocs, id)) return null;
  const bloc = blocs[id];
  if (!estObjet(bloc) || !typeConnu(bloc.type)) return null;
  const listes = BLOCS[bloc.type].listes;
  if (!aEnPropre(listes, nom)) return null;
  const premier = (BLOCS[bloc.type].modele()[nom] || [])[0];
  if (!estObjet(premier)) return null;
  return { libelle: listes[nom].libelle, max: listes[nom].max, modele: copie(premier) };
}

/* ----- Identifiants -----

   L'identifiant d'un bloc ne change jamais : c'est lui qui range ses textes
   (`blocs.faq-2.titre`). Le plus petit numéro libre : les identifiants
   restent courts. `null` pour un type que le socle ne connaît pas : un
   identifiant fabriqué pour lui serait écarté à la lecture, et le bloc
   avec. */
export function nouvelIdBloc(type, blocs) {
  if (!typeConnu(type)) return null;
  const pris = estObjet(blocs) ? blocs : {};
  for (let n = 1; ; n++) {
    const id = type + "-" + n;
    if (!aEnPropre(pris, id)) return id;
  }
}

/* Les adresses qu'une page ne peut pas prendre : celles du socle (`/admin`,
   `/medias`, les fichiers servis), celles que le Worker répond lui-même
   (`/robots.txt`, `/sitemap.xml`), la page introuvable, l'ancre du contenu
   principal, et l'accueil — dont l'adresse est « / », jamais « /accueil ». */
export const PAGES_RESERVEES = new Set([
  "accueil", "admin", "medias", "css", "rendu", "editeur", "illustrations", "js",
  "favicon", "robots", "sitemap", "introuvable", "contenu", "api"
]);

/* Les segments qu'un chemin ne traverse jamais : ils mènent au prototype
   des objets, c'est-à-dire à TOUS les objets du programme. */
const SEGMENTS_INTERDITS = new Set(["__proto__", "constructor", "prototype"]);

/* Les lettres que la décomposition Unicode ne sépare pas de leur accent :
   sans elles, « Nos œufs » donnait « nos-ufs ». */
const LIGATURES = { "œ": "oe", "æ": "ae", "ß": "ss", "ø": "o" };
const LONGUEUR_PAGE = 40;

/* L'adresse d'une page nouvelle, tirée de son nom : « Nos tarifs d'été »
   → `nos-tarifs-d-ete`. Toujours conforme à `IDENTIFIANT` (outils.js),
   jamais réservée ni déjà prise (`-2`, `-3`…), jamais plus de 40 caractères,
   suffixe compris. Un nom qui ne laisse rien (vide, émoticônes seules)
   donne « page ».

   « constructor » et « prototype » sont écartés aussi, bien qu'ils ne
   soient pas des adresses du socle : `ecrireChemin` refuse de les
   traverser, et l'éditeur ne pourrait plus rien écrire dans
   `pages.constructor` — une page créée qu'on ne pourrait pas remplir. */
export function idDePage(titre, pages) {
  const prises = estObjet(pages) ? pages : {};
  let base = texteBrut(titre).toLowerCase()
    .replace(/[œæßø]/g, (c) => LIGATURES[c])
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base && !/^[a-z]/.test(base)) base = "page-" + base;
  base = couper(base, LONGUEUR_PAGE) || "page";
  const libre = (id) => identifiantValide(id) && !PAGES_RESERVEES.has(id) && !SEGMENTS_INTERDITS.has(id) && !aEnPropre(prises, id);
  if (libre(base)) return base;
  for (let n = 2; ; n++) {
    const suffixe = "-" + n;
    const id = couper(base, LONGUEUR_PAGE - suffixe.length) + suffixe;
    if (libre(id)) return id;
  }
}

/* Coupe un identifiant sans le laisser finir par un tiret. */
function couper(id, max) {
  return id.slice(0, max).replace(/-+$/, "");
}

/* ----- Photos -----

   Où est rangée la description d'une photo, pour les personnes
   malvoyantes et pour Google : à côté de la photo. Le logo n'en a pas —
   c'est le nom du site qui lui sert de description. */
export function cheminAlt(cheminImage) {
  if (!cheminValide(cheminImage)) return null;
  if (cheminImage === "site.logo") return null;
  if (/^.+\.image$/.test(cheminImage)) return cheminImage + "Alt";
  if (/^.+\.src$/.test(cheminImage)) return cheminImage.slice(0, -"src".length) + "alt";
  return null;
}

/* ----- Noms -----

   Le nom d'une section tel que l'éditrice le lit dans le panneau : le genre,
   puis son titre sans mise en forme. Jamais l'identifiant technique
   (`prestations-1`) : elle n'a pas à le lire.

   La coupe se fait par caractère et non par unité de code : couper au
   milieu d'une émoticône laissait un demi-caractère, affiché « � ». */
const LONGUEUR_NOM = 40;
export function nomDuBloc(bloc) {
  if (!estObjet(bloc) || !typeConnu(bloc.type)) return "Section";
  const genre = BLOCS[bloc.type].nom;
  const lettres = Array.from(texteBrut(bloc.titre));
  if (!lettres.length) return genre;
  const titre = lettres.length > LONGUEUR_NOM
    ? lettres.slice(0, LONGUEUR_NOM - 1).join("").trimEnd() + "…"
    : lettres.join("");
  return genre + " — " + titre;
}

/* ----- Les liens -----

   Tous les chemins où le contenu range une destination de lien : pour
   renommer une ancre ou retirer une page PARTOUT, sans en oublier un.
   Seules les valeurs qui sont du texte comptent — un objet à la place d'une
   adresse n'en est pas une, et le réécrire écraserait autre chose.

   ⚠️ Les liens écrits DANS un texte mis en forme (`<a href>` d'un
   paragraphe) ne sont pas des chemins : ils n'y figurent pas. Ils ont
   leurs propres outils, plus bas : `liensDansLesTextes` pour les trouver,
   `reecrireLiensDansTexte` pour les suivre. Les deux ensemble, et non
   `cheminsVers` seul, font « tous les liens » (relecture du 3 octobre
   2026 : renommer une ancre annonçait « 3 liens suivis » et laissait mort
   le lien d'un paragraphe). */
const CLES_DESTINATION = new Set(["vers", "lienPlan"]);
const PROFONDEUR_MAX = 12;

export function cheminsVers(contenu) {
  const chemins = [];
  if (!estObjet(contenu)) return chemins;
  const liens = (zone) => {
    const liste = estObjet(contenu[zone]) && Array.isArray(contenu[zone].liens) ? contenu[zone].liens : [];
    liste.forEach((l, i) => {
      if (estObjet(l) && typeof l.vers === "string") chemins.push(zone + ".liens." + i + ".vers");
    });
  };
  liens("entete");
  if (estObjet(contenu.entete) && estObjet(contenu.entete.bouton) && typeof contenu.entete.bouton.vers === "string") {
    chemins.push("entete.bouton.vers");
  }
  liens("pied");
  const blocs = estObjet(contenu.blocs) ? contenu.blocs : {};
  for (const id of Object.keys(blocs)) {
    if (!identifiantValide(id) || !estObjet(blocs[id])) continue;
    parcourir(blocs[id], "blocs." + id, (valeur, chemin, cle) => {
      if (chemin !== null && CLES_DESTINATION.has(cle) && typeof valeur === "string") chemins.push(chemin);
    });
  }
  return chemins;
}

/* ----- Les liens écrits dans un texte -----

   La barre de mise en forme pose des liens DANS un texte (« Découvrez
   <a href="#nos-pains">nos pains</a> ») avec la même fenêtre que les
   boutons : vers une section, une page, un autre site. Renommer une ancre
   ou supprimer une page doit les suivre aussi — sans quoi un lien mène à
   une ancre disparue ou à une page introuvable, alors que la confirmation
   annonçait un compte exact (relecture du 3 octobre 2026).

   La lecture est CELLE du nettoyeur (`motifBalise`, `attributsDe`,
   `adresseDeLien`, outils.js) : on ne voit que les liens que la page
   affiche vraiment — une balise <a> dont l'adresse est sûre. Un <a> sans
   adresse, ou avec une adresse refusée (`javascript:`), n'est pas un lien
   sur le site : ni compté, ni réécrit. Le texte reçu est celui que
   `texteRiche` écrit ; un texte écrit autrement est lu de la même façon,
   au plus près, sans jamais lever.

   Chaque balise de lien est rendue avec sa place dans le texte : l'adresse
   (`vers`, décodée de « &amp; » comme le fait le nettoyeur) et l'attribut
   `href` qui la porte (`attribut.debut`, `attribut.fin`). Les fermetures
   `</a>` sont rendues aussi : il faut les connaître pour défaire un lien. */
function balisesDeLien(html) {
  const balises = [];
  const re = motifBalise();
  let m;
  while ((m = re.exec(html))) {
    if (m[2].toLowerCase() !== "a") continue;
    const fin = re.lastIndex;
    if (m[1] === "/") { balises.push({ fermante: true, debut: m.index, fin }); continue; }
    // Où commencent les attributs : juste avant le « > » final, à rebours.
    const decalage = fin - 1 - m[3].length;
    let href = null;
    for (const a of attributsDe(m[3])) if (a.nom === "href") href = a;   // le dernier compte, comme dans le nettoyeur
    if (!href) continue;
    const vers = adresseDeLien(href.valeur);
    if (!adresseSure(vers)) continue;
    balises.push({ fermante: false, debut: m.index, fin, vers, attribut: { debut: decalage + href.debut, fin: decalage + href.fin } });
  }
  return balises;
}

/* Chaque lien écrit dans un texte, sous `entete`, `pied` ou `blocs` :
   `[{ chemin, vers }]`, un élément par lien, dans l'ordre du texte. Un même
   chemin revient autant de fois que son texte porte de liens.

   Les clés de destination (`vers`, `lienPlan`) ne sont pas lues ici : ce
   sont des adresses, pas des textes, et `cheminsVers` les donne déjà. Ne
   lève jamais, même sur un contenu abîmé (un objet piégé, une boucle). */
export function liensDansLesTextes(contenu) {
  const liens = [];
  if (!estObjet(contenu)) return liens;
  const visiter = (valeur, chemin, cle) => {
    if (chemin === null || typeof valeur !== "string" || CLES_DESTINATION.has(cle) || !/<a\b/i.test(valeur)) return;
    for (const b of balisesDeLien(valeur)) if (!b.fermante) liens.push({ chemin, vers: b.vers });
  };
  for (const zone of ["entete", "pied"]) {
    if (estObjet(contenu[zone])) parcourir(contenu[zone], zone, visiter);
  }
  const blocs = estObjet(contenu.blocs) ? contenu.blocs : {};
  for (const id of Object.keys(blocs)) {
    if (!identifiantValide(id) || !estObjet(blocs[id])) continue;
    parcourir(blocs[id], "blocs." + id, visiter);
  }
  return liens;
}

/* Le texte où chaque lien est passé par `transformer(vers)` :
   - une adresse différente remplace l'ancienne (réencodée comme le fait le
     nettoyeur) ;
   - "" DÉFAIT le lien : ses balises <a> et </a> disparaissent, ses mots
     restent — « nos tarifs » redevient du texte simple quand la page
     « Tarifs » est supprimée ;
   - la même adresse, ou autre chose qu'un texte, ne touche à rien.
   Tout le reste du texte est rendu OCTET POUR OCTET : seul l'attribut
   `href` d'un lien réécrit change, seules les deux balises d'un lien défait
   disparaissent. La fermeture d'un lien défait est celle que le nettoyeur
   lui associerait : la prochaine `</a>` quand il est le lien ouvert le plus
   récent. Un texte qui n'est pas une chaîne est rendu tel quel. */
export function reecrireLiensDansTexte(html, transformer) {
  if (typeof html !== "string" || typeof transformer !== "function") return html;
  const morceaux = [];
  let dernier = 0;
  const ouverts = [];   // pour chaque lien encore ouvert : sa fermeture doit-elle disparaître ?
  for (const b of balisesDeLien(html)) {
    if (b.fermante) {
      if (!ouverts.length) continue;                 // fermeture orpheline : le nettoyeur l'ignore, on n'y touche pas
      if (ouverts.pop()) { morceaux.push(html.slice(dernier, b.debut)); dernier = b.fin; }
      continue;
    }
    const nouveau = transformer(b.vers);
    if (nouveau === "") {
      morceaux.push(html.slice(dernier, b.debut));
      dernier = b.fin;
      ouverts.push(true);
      continue;
    }
    ouverts.push(false);
    if (typeof nouveau !== "string" || nouveau === b.vers) continue;
    morceaux.push(html.slice(dernier, b.attribut.debut), 'href="' + echapper(nouveau) + '"');
    dernier = b.attribut.fin;
  }
  if (dernier === 0) return html;
  morceaux.push(html.slice(dernier));
  return morceaux.join("");
}

/* Le parcours commun : chaque valeur, avec son chemin et sa clé.

   Une clé qui ne ferait pas un chemin lisible (un point, un segment
   interdit) est quand même PARCOURUE, avec un chemin `null` pour elle et
   tout ce qu'elle contient : la recherche des photos citées doit tout voir,
   celle des liens ne garde que ce qu'on peut réécrire.

   La profondeur est bornée, et un objet qui se cite lui-même (possible en
   mémoire, jamais en JSON) n'est pas redescendu. Ce sont les ANCÊTRES qui
   sont retenus, pas tout ce qui a été vu : un même objet rangé à deux
   endroits est parcouru aux deux, sans quoi le second chemin manquerait. */
function parcourir(valeur, chemin, visiter, cle = "", profondeur = 0, ancetres = new Set()) {
  visiter(valeur, chemin, cle);
  if (!valeur || typeof valeur !== "object" || profondeur >= PROFONDEUR_MAX || ancetres.has(valeur)) return;
  ancetres.add(valeur);
  const suite = (k) => (chemin === null || !segmentValide(k) ? null : chemin ? chemin + "." + k : k);
  if (Array.isArray(valeur)) {
    valeur.forEach((v, i) => parcourir(v, suite(String(i)), visiter, String(i), profondeur + 1, ancetres));
  } else {
    for (const k of Object.keys(valeur)) parcourir(valeur[k], suite(k), visiter, k, profondeur + 1, ancetres);
  }
  ancetres.delete(valeur);
}

/* ----- Lire et écrire à un chemin -----

   `blocs.faq-1.questions.2.reponse` : découpé sur le point, un indice
   numérique pour un tableau. C'est pour ça qu'un identifiant ne contient
   JAMAIS de point (outils.js, `IDENTIFIANT`).

   Les segments `__proto__`, `constructor` et `prototype` sont refusés :
   écrire à `__proto__.x` poserait `x` sur TOUS les objets du programme. Et
   seules les propriétés PROPRES comptent : `blocs.toString` n'existe pas,
   même si tout objet en hérite une. */
const PROFONDEUR_CHEMIN = 16;

function segmentValide(s) {
  return typeof s === "string" && s !== "" && !s.includes(".") && !SEGMENTS_INTERDITS.has(s);
}

function cheminValide(chemin) {
  if (typeof chemin !== "string" || !chemin) return false;
  const morceaux = chemin.split(".");
  return morceaux.length <= PROFONDEUR_CHEMIN && morceaux.every(segmentValide);
}

const INDICE = /^(0|[1-9]\d{0,5})$/;

export function lireChemin(objet, chemin) {
  if (!cheminValide(chemin)) return undefined;
  let courant = objet;
  for (const s of chemin.split(".")) {
    if (Array.isArray(courant)) {
      if (!INDICE.test(s)) return undefined;
      courant = courant[Number(s)];
    } else if (courant && typeof courant === "object") {
      if (!aEnPropre(courant, s)) return undefined;
      courant = courant[s];
    } else {
      return undefined;
    }
  }
  return courant;
}

/* Écrit `valeur` au chemin et rend `true`, ou ne fait RIEN et rend `false`.

   Un intermédiaire absent (ou `null`) est créé : un tableau si le segment
   suivant est un indice, un objet sinon — un objet `{ "0": … }` à la place
   d'une liste ne serait plus lu comme une liste, et l'élément écrit
   disparaîtrait de la page. Un intermédiaire qui existe mais n'est pas un
   objet (un texte, un nombre) n'est jamais remplacé : ce serait effacer ce
   qu'il contient, sans un mot.

   Dans un tableau, on n'écrit qu'à un indice existant ou juste après le
   dernier : `liens.999999` aurait fabriqué un tableau d'un million de
   trous.

   Le chemin entier est vérifié AVANT la première écriture : un refus à mi-
   chemin ne laisse pas derrière lui des objets intermédiaires créés pour
   rien. Un objet figé (un modèle partagé, par exemple) refuse l'écriture
   en levant dans un module : on rend `false` plutôt que de lever. */
export function ecrireChemin(objet, chemin, valeur) {
  if (!objet || typeof objet !== "object" || !cheminValide(chemin)) return false;
  const morceaux = chemin.split(".");
  // Premier passage : lecture seule, on s'assure que tout le chemin est praticable.
  let courant = objet;
  for (let i = 0; i < morceaux.length; i++) {
    if (courant === undefined || courant === null) {
      // La suite sera créée : un indice y désigne un tableau NEUF, donc vide,
      // où seul « 0 » est juste après le dernier.
      if (morceaux.slice(i).some((s) => INDICE.test(s) && s !== "0")) return false;
      break;
    }
    if (typeof courant !== "object") return false;
    const s = morceaux[i];
    if (Array.isArray(courant)) {
      if (!INDICE.test(s) || Number(s) > courant.length) return false;
      courant = courant[Number(s)];
    } else {
      courant = aEnPropre(courant, s) ? courant[s] : undefined;
    }
  }
  // Second passage : l'écriture.
  try {
    courant = objet;
    for (let i = 0; i < morceaux.length; i++) {
      const cle = Array.isArray(courant) ? Number(morceaux[i]) : morceaux[i];
      if (i === morceaux.length - 1) {
        courant[cle] = valeur;
        return true;
      }
      const existe = Array.isArray(courant) ? cle < courant.length : aEnPropre(courant, cle);
      let suivant = existe ? courant[cle] : undefined;
      if (suivant === undefined || suivant === null) {
        suivant = INDICE.test(morceaux[i + 1]) ? [] : {};
        courant[cle] = suivant;
      }
      courant = suivant;
    }
  } catch {
    return false;
  }
  return false;
}

/* ----- Les photos citées -----

   Toutes les adresses de la médiathèque (`/medias/…`) que le contenu
   emploie, où qu'elles soient rangées. Avant de retirer une photo de la
   médiathèque, l'éditeur demande confirmation si elle y figure.

   Une valeur est comparée APRÈS `trim()` : « /medias/x.jpg » précédé d'une
   espace s'affiche quand même sur le site (`imageSure` la retire). Le
   contrôle doit voir au moins aussi large que l'affichage — l'inverse
   retirerait sans prévenir une photo encore en ligne. */
export function mediasCites(contenu) {
  const cites = new Set();
  parcourir(contenu, "", (valeur) => {
    if (typeof valeur !== "string") return;
    const v = valeur.trim();
    if (v.startsWith("/medias/")) cites.add(v);
  });
  return cites;
}

/* ----- Ce qui reste du modèle -----

   Une section neuve naît COMPLÈTE, textes et photo d'exemple compris : il
   faut bien quelque chose à cliquer pour écrire. Le revers : « Une phrase
   qui dit ce que vous faites » ou des horaires inventés partiraient en
   ligne tels quels si on oublie de les remplacer — et un avis inventé n'est
   pas seulement maladroit, c'est une pratique commerciale trompeuse.
   L'éditeur s'en sert pour PRÉVENIR avant de publier, sans rien bloquer.

   Seuls comptent les champs que chaque bloc déclare dans `exemples` : un
   titre générique (« Ce que disent nos clients », « Horaires et accès »)
   est un vrai choix, le signaler à chaque publication apprendrait à ne
   plus lire l'avertissement (première version, essai du 3 octobre 2026).
   `*` vaut « chaque élément de la liste » ; un chemin qui désigne une liste
   entière (`jours`) ne compte que si la liste est restée TOUT ENTIÈRE celle
   du modèle — chaque case est banale, l'ensemble est inventé. Une valeur
   compte si elle est égale à celle du modèle pour ce chemin, quel que soit
   l'élément : une carte ajoutée naît du premier élément du modèle.
   Les sections masquées ne comptent pas : personne ne les voit.

   Et toute section VISIBLE dont un texte contient encore « [À compléter »
   est signalée aussi (`texte: true`, plus `aCompleter: true` pour qui veut
   le dire autrement). Ce sont les trous que laisse la page des mentions
   légales (modeles-pages.js) — une obligation légale à moitié remplie
   partirait en ligne sans un mot (3 octobre 2026). Ici, PAS de liste
   déclarée : un trou est un trou, quel que soit le champ ou le genre de
   section, y compris ceux qui n'ont aucun texte d'exemple (le contact).
   La recherche voit plus large que la forme écrite par le modèle (casse,
   accent, espace insécable) : le contrôle doit voir au moins aussi large
   que ce qu'on y a posé, jamais l'inverse. */
const TROU = /\[\s*(?:à|a|&agrave;)\s*compl(?:é|e|&eacute;)ter/i;

export function contientUnTrou(valeur) {
  let trouve = false;
  parcourir(valeur, "", (v) => {
    if (!trouve && typeof v === "string" && v.length && TROU.test(texteBrut(v))) trouve = true;
  });
  return trouve;
}

/* Les mêmes trous, COMPTÉS : l'onglet « Site » de l'éditeur dit combien
   il en reste sur la page des mentions légales. Même motif, même parcours
   que `contientUnTrou`. L'éditeur en tenait une copie, presque identique
   (motif écrit autrement, profondeur de 8 au lieu de 12) : un compte qui
   voit moins large que l'avertissement de publication dirait « plus rien
   à remplir » pendant que la publication prévient du contraire. Une seule
   écriture depuis le 3 octobre 2026. */
const TROUS = new RegExp(TROU.source, "gi");

export function compterTrous(valeur) {
  let n = 0;
  parcourir(valeur, "", (v) => {
    if (typeof v === "string" && v.length) n += (texteBrut(v).match(TROUS) || []).length;
  });
  return n;
}

function valeursAuMotif(objet, motif) {
  let courants = [objet];
  for (const seg of motif.split(".")) {
    const suivants = [];
    for (const c of courants) {
      if (seg === "*") { if (Array.isArray(c)) suivants.push(...c); }
      else if (c && typeof c === "object" && !Array.isArray(c) && aEnPropre(c, seg)) suivants.push(c[seg]);
    }
    courants = suivants;
  }
  return courants;
}

const empreinte = (v) => { try { return JSON.stringify(v); } catch { return null; } };

export function restesDuModele(contenu) {
  const restes = [];
  if (!estObjet(contenu) || !estObjet(contenu.pages) || !estObjet(contenu.blocs)) return restes;
  const vus = new Set();
  for (const [pageId, page] of Object.entries(contenu.pages)) {
    if (!estObjet(page) || !Array.isArray(page.ordre)) continue;
    for (const id of page.ordre) {
      if (typeof id !== "string" || vus.has(id) || !aEnPropre(contenu.blocs, id)) continue;
      vus.add(id);
      const bloc = contenu.blocs[id];
      if (!estObjet(bloc) || !typeConnu(bloc.type) || bloc.masque === true) continue;
      const def = BLOCS[bloc.type];
      const motifs = Array.isArray(def.exemples) ? def.exemples : [];
      const aCompleter = contientUnTrou(bloc);
      let modele = {};
      if (motifs.length) {
        try { modele = def.modele(); } catch { modele = {}; }
      }
      let texte = aCompleter;
      let photo = false;
      for (const motif of motifs) {
        const attendues = valeursAuMotif(modele, motif);
        const actuelles = valeursAuMotif(bloc, motif);
        for (const a of attendues) {
          if (Array.isArray(a)) {
            const e = empreinte(a);
            if (actuelles.some((v) => Array.isArray(v) && empreinte(v) === e)) texte = true;
          } else if (typeof a === "string" && a.trim()) {
            if (!actuelles.some((v) => typeof v === "string" && v.trim() === a.trim())) continue;
            if (a.startsWith("/illustrations/")) photo = true; else texte = true;
          }
        }
      }
      if (texte || photo) {
        const reste = { id, pageId, nom: nomDuBloc(bloc), texte, photo };
        if (aCompleter) reste.aCompleter = true;
        restes.push(reste);
      }
    }
  }
  return restes;
}

/* ----- La page des mentions légales -----

   Son adresse vit ICI, et non plus dans modeles-pages.js (qui la
   réexporte) : modeles-pages.js importe déjà ce module, et c'est ce
   module que liront le rendu, le contrôle qualité et l'éditeur pour
   savoir si la page est réellement là. L'importation inverse ferait une
   boucle (3 octobre 2026). */
export const PAGE_MENTIONS = "mentions-legales";

/* Ce que le rendu n'écrit PAS comme du texte : les réglages (même écrits
   en texte par un contenu abîmé, « true »), les adresses et les
   descriptions de photos. Une section qui n'a que cela n'affiche aucun
   mot à lire. */
const SANS_TEXTE = new Set([
  "type", "ancre", "masque", "fond", "disposition", "style", "inverse", "formulaire",
  "image", "imageAlt", "src", "alt", "vers", "lienPlan", "note"
]);

function afficheDuTexte(bloc) {
  let trouve = false;
  parcourir(bloc, "", (v, chemin, cle) => {
    if (!trouve && typeof v === "string" && !SANS_TEXTE.has(cle) && texteBrut(v) !== "") trouve = true;
  });
  return trouve;
}

/* La page des mentions légales est-elle réellement LÀ pour une visiteuse ?
   Elle doit exister ET avoir au moins une section visible (d'un genre que
   le socle sait dessiner, non masquée) qui affiche du texte.

   Relecture du 3 octobre 2026 : on ne regardait que l'existence de la
   page. Une éditrice qui masquait la section pour faire taire
   l'avertissement des « [À compléter » gardait le lien « Mentions
   légales » en bas de chaque page — vers une page vide —, et le contrôle
   de production répondait ✓. Une obligation légale qui PARAÎT tenue est
   pire qu'une obligation absente : personne ne la cherche plus.

   C'est la seule règle : le bas de page et la notice du formulaire
   (page.js), le contrôle qualité et l'éditeur la lisent ici. Accepte le
   contenu brut comme le contenu normalisé, et ne lève jamais. */
export function mentionsPresentes(contenu) {
  if (!estObjet(contenu) || !estObjet(contenu.pages) || !estObjet(contenu.blocs)) return false;
  if (!aEnPropre(contenu.pages, PAGE_MENTIONS)) return false;
  const page = contenu.pages[PAGE_MENTIONS];
  if (!estObjet(page) || !Array.isArray(page.ordre)) return false;
  return page.ordre.some((id) => {
    if (typeof id !== "string" || !aEnPropre(contenu.blocs, id)) return false;
    const bloc = contenu.blocs[id];
    return estObjet(bloc) && typeConnu(bloc.type) && bloc.masque !== true && afficheDuTexte(bloc);
  });
}
