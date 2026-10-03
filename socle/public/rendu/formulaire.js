/* =========================================================
   Le formulaire de contact — UNE seule règle
   =========================================================

   Ce module est ISOMORPHE : le rendu l'importe pour écrire les champs
   (bornes, champs obligatoires), le serveur pour contrôler ce qu'il reçoit
   (`socle/serveur/contact.js`). Une règle écrite deux fois finit toujours
   par diverger : la page accepterait ce que le serveur refuse, et la
   visiteuse perdrait son message sans comprendre pourquoi (même leçon que
   les listes recopiées de Graine de Pensée).

   Les messages d'ERREUR sont figés ici, dans le code, et non dans
   `contenu.libelles` : on ne les voit qu'après un envoi raté. Un réglage
   qu'on ne peut pas vérifier à l'écran n'est pas un réglage (décision du
   3 octobre 2026, la même que les phrases du code promotionnel de Graine
   de Pensée). Les libellés des champs, eux, se voient : ils sont dans
   `LIBELLES` (libelles.js) et se modifient en cliquant dessus.

   Ni `document`, ni `window`, et aucune fonction ne lève : le serveur
   appelle `validerMessage` sur ce que n'importe qui peut envoyer. */

/* Les champs, dans l'ordre de la page. Ce sont les NOMS des champs du
   formulaire (`name="…"`), tels que le serveur les lit dans le corps
   envoyé. */
export const CHAMPS_CONTACT = Object.freeze(["nom", "email", "telephone", "message"]);

/* Le piège à robots : un champ que personne ne voit ni n'atteint au
   clavier. Un robot qui remplit tout le remplit ; une personne, jamais.
   Rempli, le serveur répond « envoyé » sans rien enregistrer. */
export const CHAMP_PIEGE = "site_web";

/* Les bornes. Le rendu en tire `required`, `minlength` et `maxlength`, le
   serveur les mêmes contrôles : le navigateur arrête la plupart des
   erreurs avant l'envoi, le serveur reste l'arbitre (un formulaire se
   contourne, et un robot n'a pas de navigateur).

   Les longueurs se comptent comme le navigateur compte `maxlength` (en
   unités UTF-16, sauts de ligne ramenés à un caractère) : rien de ce que
   `maxlength` laisse passer n'est refusé pour sa longueur.

   ⚠️ Mais le serveur compte APRÈS nettoyage : blancs en tête et en fin
   retirés, blancs répétés réduits à un. `minlength` et `required`, eux,
   comptent les blancs. Pour le nom, un motif rattrape `required`
   (`MOTIF_NOM`, plus bas) ; pour le message, rien ne le peut — un
   <textarea> ne connaît pas `pattern` : « Bonjour !   » entouré
   d'espaces passe le navigateur et revient refusé (« 10 caractères au
   moins », sans compter les espaces). Rien n'est perdu pour autant : la
   page revient avec ce qui avait été écrit. Cette phrase disait autrefois
   « tout ce que la page laisse partir, le serveur l'accepte » : c'était
   faux, et une fausse garantie trompe le prochain qui touche à ces règles
   (relecture du 3 octobre 2026). */
export const REGLES_CONTACT = Object.freeze({
  nom: Object.freeze({ requis: true, min: 1, max: 100 }),
  email: Object.freeze({ requis: true, min: 1, max: 254 }),
  telephone: Object.freeze({ requis: false, min: 0, max: 30 }),
  message: Object.freeze({ requis: true, min: 10, max: 4000 })
});

/* Les messages d'erreur, un par champ, plus deux qui ne viennent pas de la
   visiteuse : trop d'envois récents (`limite`), service en panne
   (`indisponible`). Toujours une phrase qui dit QUOI FAIRE. */
export const ERREURS_CONTACT = Object.freeze({
  nom: "Indiquez votre nom.",
  email: "Indiquez une adresse e-mail complète, par exemple nom@exemple.fr.",
  telephone: "Ce numéro de téléphone ne semble pas valide.",
  message: "Écrivez votre message (10 caractères au moins).",
  limite: "Trop de messages sont partis d'ici récemment. Réessayez plus tard, ou appelez-nous.",
  indisponible: "Votre message n'a pas pu partir. Réessayez dans quelques minutes, ou appelez-nous."
});

/* ----- Le nettoyage -----

   Une valeur qui n'est pas du texte (un tableau, un objet piégé) devient
   vide : `String()` sur `{"toString":1}` lèverait. Les caractères de
   contrôle disparaissent — ils n'ont rien à faire dans un e-mail, et un
   saut de ligne glissé dans un nom ou une adresse e-mail irait jusqu'aux
   en-têtes du message envoyé au client.

   Le nom, l'e-mail et le téléphone tiennent sur une ligne : toute suite de
   blancs (sauts de ligne compris) devient une espace. Le message garde ses
   sauts de ligne, ramenés à « \n » (le navigateur envoie « \r\n »). */
const CONTROLE_LIGNE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;
const CONTROLE_MESSAGE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

function brut(v) {
  return typeof v === "string" ? v : "";
}

function uneLigne(v) {
  return brut(v).normalize("NFC").replace(CONTROLE_LIGNE, " ").replace(/\s+/g, " ").trim();
}

function plusieursLignes(v) {
  return brut(v).normalize("NFC")
    .replace(/\r\n?|[\u2028\u2029]/g, "\n")
    .replace(/\t/g, " ")
    .replace(CONTROLE_MESSAGE, "")
    .trim();
}

/* Volontairement proche de celle des adresses de l'administration
   (validation.js), sans les minuscules forcées : on écrit à la visiteuse
   avec l'adresse telle qu'elle l'a tapée. La longueur est bornée AVANT
   l'expression. */
const ADRESSE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/* ----- Les motifs que le navigateur applique AVANT l'envoi -----

   Le rendu les écrit en attribut `pattern` (blocs/contact.js). Sans eux,
   « 06/12/34/56/78 » ou « jeanne@exemple » partaient, et revenaient
   refusés par le serveur (relecture du 3 octobre 2026).

   ⚠️ Un `pattern` est compilé par les navigateurs récents avec le drapeau
   `v`, plus strict que `u` : dans une classe, « ( ) . - » doivent y être
   échappés. `[0-9 +().-]`, recopié tel quel, y est INVALIDE — et un motif
   invalide est ignoré sans un mot, le champ redevenant libre. Chaque motif
   ci-dessous compile dans les deux modes ; `tester.mjs` le vérifie, et
   compare ce qu'il accepte à ce qu'accepte `validerMessage`.

   Un motif s'applique à TOUTE la valeur (le navigateur l'encadre de
   `^(?:` … `)$`), et jamais à un champ resté vide : le téléphone reste
   facultatif.

   - le TÉLÉPHONE : des chiffres, des espaces, « + ( ) . - », et au moins
     six chiffres — « + » ou « ( ) » seuls ne rappellent personne. C'est
     la règle même du serveur, qui l'emploie telle quelle : une seule
     écriture.
   - l'E-MAIL : un point dans le nom de domaine. Le contrôle propre au
     champ `type="email"` accepte « jeanne@exemple » ; les deux ensemble
     acceptent exactement ce qu'accepte `ADRESSE`. Ne pas recopier
     `ADRESSE` en motif : sa classe (« / { | } - ») est invalide en `v`.
   - le NOM : au moins un caractère qui ne soit ni un blanc ni un
     caractère de contrôle — `required` se contente d'espaces, le serveur
     non (il les retire, voir `uneLigne`). */
export const MOTIF_TELEPHONE = "[ +\\(\\)\\.\\-]*(?:[0-9][ +\\(\\)\\.\\-]*){6,}";
export const MOTIF_EMAIL = "[^@]+@[^@]+\\.[^@]+";
export const MOTIF_NOM = "[\\s\\S]*[^\\s\\u0000-\\u001F\\u007F-\\u009F][\\s\\S]*";

const TELEPHONE = new RegExp("^(?:" + MOTIF_TELEPHONE + ")$");

/* Ce que la visiteuse a envoyé → `{ ok, valeurs, erreurs }`.

   `valeurs` : les quatre champs nettoyés, toujours des chaînes — ce qu'on
   enregistre, et ce qu'on lui réaffiche si l'envoi est refusé (sans
   JavaScript, c'est la seule façon de ne pas perdre ce qu'elle a écrit).
   `erreurs` : `{ champ: message }`, vide si tout va bien.

   `entree` peut être un objet ordinaire ou ce que donne la lecture d'un
   formulaire (`URLSearchParams`, `FormData` : tout ce qui a un `get`).
   Seuls les quatre champs sont lus ; le reste est ignoré. Ne lève
   jamais. */
export function validerMessage(entree) {
  const lire = (cle) => {
    try {
      if (!entree || typeof entree !== "object") return "";
      if (typeof entree.get === "function") return entree.get(cle);
      return Object.prototype.hasOwnProperty.call(entree, cle) ? entree[cle] : "";
    } catch {
      return "";
    }
  };
  const valeurs = {
    nom: uneLigne(lire("nom")),
    email: uneLigne(lire("email")),
    telephone: uneLigne(lire("telephone")),
    message: plusieursLignes(lire("message"))
  };
  const R = REGLES_CONTACT;
  const erreurs = {};
  if (valeurs.nom.length < R.nom.min || valeurs.nom.length > R.nom.max) erreurs.nom = ERREURS_CONTACT.nom;
  if (!valeurs.email || valeurs.email.length > R.email.max || !ADRESSE.test(valeurs.email)) erreurs.email = ERREURS_CONTACT.email;
  if (valeurs.telephone && (valeurs.telephone.length > R.telephone.max || !TELEPHONE.test(valeurs.telephone))) {
    erreurs.telephone = ERREURS_CONTACT.telephone;
  }
  if (valeurs.message.length < R.message.min || valeurs.message.length > R.message.max) erreurs.message = ERREURS_CONTACT.message;
  return { ok: Object.keys(erreurs).length === 0, valeurs, erreurs };
}
