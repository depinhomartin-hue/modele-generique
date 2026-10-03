/* =========================================================
   Les modèles de pages
   =========================================================

   Une page que le socle sait proposer toute faite. La première : les
   MENTIONS LÉGALES, obligatoires pour tout site professionnel (loi pour la
   confiance dans l'économie numérique, article 6) et que chaque maquette
   oubliait jusqu'ici, faute de bloc pour les porter (3 octobre 2026).

   Ce module est ISOMORPHE : l'éditeur s'en sert (« Ajouter la page des
   mentions légales »), le script de création d'un client aussi. Une seule
   écriture du texte : deux copies finiraient par dire deux choses.

   ⚠️ Rien n'est écrit dans le contenu reçu : la fonction rend la page et
   ses sections, l'appelant décide de les ranger. Un modèle qui touche au
   contenu de l'éditrice dans son dos est le pire des deux maux.

   Ce qu'on ne peut pas savoir à la place du client (forme juridique,
   SIRET, adresse, médiateur, responsable de la publication…) est écrit
   « [À compléter …] » : `restesDuModele` (structure.js) signale tout texte
   qui en contient encore, et l'éditeur le dit avant de publier. Un trou
   visible vaut mieux qu'une mention inventée.

   ⚠️ Relecture du 3 octobre 2026 : la première version suivait à la lettre
   une spécification incomplète, et les contrôles la déclaraient conforme
   une fois ses trous remplis. Il y manquait :
   - l'IDENTITÉ légale : le nom du site est une enseigne, pas le nom de
     l'entrepreneur ni la dénomination d'une société (LCEN, article 6) ;
   - le MÉDIATEUR de la consommation, obligatoire sur le site de tout
     professionnel qui vend à des particuliers (Code de la consommation,
     articles L612-1, L616-1 et R616-1 ; amende administrative jusqu'à
     3 000 € pour une personne physique, 15 000 € pour une société) ;
   - le numéro de TVA intracommunautaire, ou la mention de la franchise ;
   - et elle demandait un numéro « au répertoire des métiers », registre
     remplacé par le registre national des entreprises (RNE) depuis le
     1er janvier 2023 : une artisane immatriculée depuis ne le trouverait
     nulle part.
   Le paragraphe « Données personnelles » ne disait pas non plus ce que
   l'article 13 du RGPD exige au moment où le formulaire collecte : base
   légale, destinataires, transfert hors de l'Union, tous les droits.
   Ce texte doit être relu par la personne qui tient la veille juridique
   avant le premier vrai client. */

import { nouvelIdBloc, PAGE_MENTIONS } from "./structure.js";
import { nouveauBloc } from "./registre.js";
import { texte } from "./outils.js";

/* L'adresse de la page : « /mentions-legales ». Elle n'est PAS réservée
   (`PAGES_RESERVEES`, structure.js) : c'est une page du client, qu'il
   modifie comme les autres. Le lien du bas de page la suit, tant qu'elle
   affiche quelque chose (`mentionsPresentes`, structure.js). La constante
   vit dans structure.js depuis le 3 octobre 2026 ; elle reste exportée
   ici, où l'éditeur et les outils la prennent. */
export { PAGE_MENTIONS };

const A_COMPLETER = "[À compléter]";
const NOM_A_COMPLETER = "[À compléter : nom de l'entreprise]";

/* Le texte riche du contenu est du HTML : un nom de site qui contient
   « & » ou « < » doit y entrer échappé. Seuls ces trois-là : une
   apostrophe reste une apostrophe, lisible telle quelle dans le contenu. */
const enHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* Les paragraphes, dans l'ordre que les mentions légales suivent
   d'habitude. `nom` : le nom de l'entreprise déjà prêt pour le HTML.

   L'éditeur du site : le nom du site n'est qu'un nom COMMERCIAL. Qui
   répond juridiquement du site — l'entrepreneur, ou la société — se dit
   dans la forme juridique, qui reste donc un trou même quand le nom est
   connu. « RCS de <ville> » est écrit échappé : c'est du texte riche.

   L'hébergeur a été vérifié le 3 octobre 2026 dans le rapport annuel
   (formulaire 10-K) de Cloudflare à l'autorité boursière américaine (SEC).
   Si le site change d'hébergeur, ce paragraphe change avec lui — et celui
   des données personnelles aussi, qui le nomme. */
function paragraphes(nom) {
  return [
    {
      titre: "Éditeur du site",
      texte: "Nom commercial : " + nom + "<br>" +
        "[À compléter : forme juridique, par exemple entreprise individuelle (EI) — dans ce cas, le nom et le prénom de l'entrepreneur —, " +
          "micro-entreprise, EURL, SARL ou SAS au capital de … € — dans ce cas, la dénomination sociale]<br>" +
        "Adresse du siège : " + A_COMPLETER + "<br>" +
        "SIREN ou SIRET : " + A_COMPLETER + "<br>" +
        "Immatriculation : [À compléter : Registre national des entreprises (RNE), et pour une société ou un commerçant « RCS de &lt;ville&gt; n° … »]<br>" +
        "TVA : [À compléter : numéro de TVA intracommunautaire FR…, ou « TVA non applicable, article 293 B du CGI »]<br>" +
        "Téléphone : " + A_COMPLETER + " — E-mail : " + A_COMPLETER
    },
    {
      titre: "Responsable de la publication",
      texte: "[À compléter : prénom et nom]"
    },
    {
      titre: "Hébergement",
      texte: "Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, États-Unis.<br>" +
        "Téléphone : +1 888 993 5273.<br>" +
        "www.cloudflare.com"
    },
    {
      titre: "Médiation de la consommation",
      texte: "Conformément à l'article L612-1 du Code de la consommation, vous pouvez recourir gratuitement à un médiateur de la consommation : " +
        "[À compléter : nom, adresse postale et site internet du médiateur]."
    },
    {
      titre: "Propriété intellectuelle",
      texte: "Les textes et les photos de ce site appartiennent à son éditeur, sauf mention contraire. " +
        "Toute reproduction, même partielle, demande son accord préalable."
    },
    {
      titre: "Données personnelles",
      texte: donneesPersonnelles("[À compléter : adresse e-mail]")
    }
  ];
}

/* Le paragraphe « Données personnelles », tel que l'article 13 du RGPD le
   demande au moment où le formulaire de contact collecte : qui est
   responsable, quelles données, pour quoi faire, sur quelle base légale,
   qui les reçoit (et où), combien de temps, quels droits, et à qui se
   plaindre.

   Ce qu'il ne dit PAS, exprès : aucune certification précise du transfert
   vers les États-Unis (« Data Privacy Framework » ou clauses types). Elle
   dépend du contrat de l'hébergeur et peut changer ; « les garanties
   prévues par le RGPD » reste vrai quelle qu'elle soit.

   ⚠️ La dernière phrase, sur Google Fonts, est vraie TANT QUE les polices
   viennent de chez Google (`lienPolices`, themes.js). Le jour où elles
   seront hébergées sur le site, elle devient fausse : la retirer dans le
   même geste, ici et dans les contenus déjà publiés. */
function donneesPersonnelles(adresse) {
  return "Le responsable du traitement de vos données est l'entreprise qui édite ce site, désignée ci-dessus.<br><br>" +
    "Quand vous écrivez par le formulaire de contact, nous recevons votre nom, votre adresse e-mail, votre téléphone si vous le donnez, et votre message. " +
    "Ils servent uniquement à répondre à votre demande. " +
    "Base légale : les mesures précontractuelles prises à votre demande, ou notre intérêt légitime à vous répondre.<br><br>" +
    "Ces données ne sont destinées qu'à l'entreprise. Notre hébergeur, Cloudflare, les conserve et nous les achemine pour notre compte, en tant que sous-traitant : " +
    "il peut les traiter hors de l'Union européenne, avec les garanties prévues par le RGPD. " +
    "Elles sont gardées un an au plus sur le site.<br><br>" +
    "Vous pouvez accéder à vos données, les faire rectifier ou effacer, vous opposer à leur traitement, en demander la limitation, " +
    "ou les recevoir pour les confier à quelqu'un d'autre (portabilité) : écrivez à " + adresse + ". " +
    "Si vous estimez que vos droits ne sont pas respectés, vous pouvez adresser une réclamation à la CNIL (www.cnil.fr).<br><br>" +
    "Ce site ne dépose aucun cookie et ne fait aucune mesure d'audience publicitaire. " +
    "Les polices de caractères sont fournies par Google Fonts : pour les afficher, votre navigateur transmet votre adresse IP à Google.";
}

/* La page des mentions légales, prête à ranger :
   → `{ pageId, page, blocs }`
     - `pageId` : « mentions-legales » ;
     - `page`   : `{ titre, description, ordre: [idBloc] }`, à ranger dans
                  `contenu.pages[pageId]` ;
     - `blocs`  : `{ [idBloc]: bloc }`, la section texte, à ranger dans
                  `contenu.blocs`.
   L'identifiant de la section est le premier libre (`texte-1`, sinon
   `texte-2`…), d'après `contenu.blocs`. Le nom du site, s'il est connu,
   remplace « [À compléter : nom de l'entreprise] ».

   N'écrit RIEN dans `contenu`, et ne lève jamais, même sur un contenu
   abîmé : il donne alors une page entièrement « à compléter ». */
export function pageMentionsLegales(contenu) {
  const c = contenu && typeof contenu === "object" && !Array.isArray(contenu) ? contenu : {};
  const site = c.site && typeof c.site === "object" && !Array.isArray(c.site) ? c.site : {};
  const blocsExistants = c.blocs && typeof c.blocs === "object" && !Array.isArray(c.blocs) ? c.blocs : {};
  // Le nom du site est du texte SIMPLE (il s'écrit sans mise en forme,
  // et s'affiche échappé dans l'en-tête) : « Pain & <Co> » reste tel quel.
  const nom = texte(site.nom).replace(/\s+/g, " ").trim();
  const idBloc = nouvelIdBloc("texte", blocsExistants);
  const bloc = Object.assign(nouveauBloc("texte"), {
    titre: "Mentions légales",
    paragraphes: paragraphes(nom ? enHtml(nom) : NOM_A_COMPLETER)
  });
  return {
    pageId: PAGE_MENTIONS,
    page: {
      titre: "Mentions légales",
      description: "Qui édite ce site, qui l'héberge, et ce que deviennent vos données.",
      ordre: [idBloc]
    },
    blocs: { [idBloc]: bloc }
  };
}
