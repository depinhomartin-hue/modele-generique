/* =========================================================
   Le point d'entrée de l'éditeur
   =========================================================

   Chargé par la coquille `/admin` (module ES, sans script en ligne : la
   politique de contenu l'interdit). Il ne fait que deux choses :

   1. VÉRIFIER LE CONTRAT des modules de rendu avant de démarrer. Leçon de
      Graine de Pensée, le 21 septembre 2026 : un navigateur a servi un
      module en cache pendant que l'éditeur était à jour ; une fonction
      manquait, le panneau s'est arrêté à moitié, SANS UN MESSAGE. On a
      cherché le défaut dans le code pendant qu'il était dans le cache. Un
      éditeur à moitié construit est pire qu'un éditeur qui refuse : il a
      l'air de marcher. Ici, un nom manquant donne un écran clair.

   2. Charger l'éditeur lui-même par un `import()` dynamique, dans un
      try/catch : une erreur de chargement (réseau, module absent) s'affiche
      en clair au lieu de laisser « Chargement de l'éditeur… » pour toujours.

   Les imports passent par l'adresse des modules sur le site (`/rendu/…`) :
   l'éditeur et la page partagent UNE copie de chaque module, celle du
   serveur. */

const CONTRAT = {
  "/rendu/page.js": ["normaliser", "rendrePage", "rendreCorps", "PAGE_ACCUEIL", "ancresDeLaPage"],
  "/rendu/registre.js": ["BLOCS", "CATALOGUE", "nouveauBloc", "typeConnu", "valeurReglage", "reglageActif"],
  "/rendu/themes.js": ["THEMES", "DUOS", "CRANS_TITRES", "POLICES", "themeDe"],
  "/rendu/outils.js": ["texteRiche", "texteBrut", "echapper", "estVide", "adresseSure", "destination", "identifiantValide", "imageSure", "lienTelephone"],
  // `liensDansLesTextes` et `reecrireLiensDansTexte` : les liens écrits dans
  // un texte, que renommer une ancre ou supprimer une page doit suivre
  // (operations.js, relecture du 3 octobre 2026).
  // `compterTrous` : le compte des « [À compléter … » de l'onglet « Site »
  // (socle 0.3.0), la règle même de l'avertissement de publication.
  // `mentionsPresentes` : la page des mentions légales affiche-t-elle
  // quelque chose ? La règle du bas de page, que l'onglet « Site » et la
  // publication redisent (relecture du 3 octobre 2026).
  "/rendu/structure.js": ["LISTES_SITE", "descripteurListe", "nouvelIdBloc", "idDePage", "cheminAlt", "nomDuBloc", "cheminsVers", "liensDansLesTextes", "reecrireLiensDansTexte", "lireChemin", "ecrireChemin", "mediasCites", "restesDuModele", "compterTrous", "mentionsPresentes"],
  // La page des mentions légales, que l'onglet « Site » crée toute faite
  // (socle 0.3.0). Un module de rendu resté en cache d'une version 0.2
  // n'existe pas : l'écran le dit au lieu d'un onglet « Site » vide.
  "/rendu/modeles-pages.js": ["PAGE_MENTIONS", "pageMentionsLegales"]
};

const racine = document.getElementById("editeur");

function panne(titre, texte, detail) {
  if (!racine) return;
  const boite = document.createElement("div");
  boite.className = "ed-panne";
  boite.setAttribute("role", "alert");
  const h1 = document.createElement("h1");
  h1.textContent = titre;
  const p = document.createElement("p");
  p.textContent = texte;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ed-bouton ed-bouton--principal";
  b.textContent = "Recharger la page";
  b.addEventListener("click", () => location.reload());
  boite.append(h1, p, b);
  if (detail) {
    const d = document.createElement("details");
    const s = document.createElement("summary");
    s.textContent = "Détail pour l'atelier";
    const pre = document.createElement("pre");
    pre.textContent = detail;
    d.append(s, pre);
    boite.append(d);
  }
  racine.replaceChildren(boite);
}

async function verifierContrat() {
  const manquants = [];
  for (const [chemin, noms] of Object.entries(CONTRAT)) {
    // Un import par espace de noms ne lève pas pour un nom absent : c'est
    // ce qui permet de le constater, puis de le dire.
    let module;
    try {
      module = await import(chemin);
    } catch (e) {
      // Un module tout entier absent (un fichier ajouté par une version
      // plus récente du socle, que le serveur n'a pas encore) : c'est le
      // même défaut, il reçoit le même écran.
      manquants.push(chemin + " : module introuvable (" + String((e && e.message) || e) + ")");
      continue;
    }
    for (const nom of noms) if (!(nom in module)) manquants.push(chemin + " : " + nom);
  }
  return manquants;
}

if (racine) {
  try {
    const manquants = await verifierContrat();
    if (manquants.length) {
      panne("L'éditeur n'est pas à jour",
        "Une partie de l'éditeur date d'une version précédente. Rechargez la page en forçant la mise à jour (Cmd + Maj + R sur Mac, Ctrl + Maj + R sur PC). Si le message revient, prévenez l'atelier.",
        "Absents : " + manquants.join(", "));
    } else {
      const { demarrer } = await import("./application.js");
      await demarrer(racine);
    }
  } catch (e) {
    console.error("Démarrage de l'éditeur :", e);
    panne("L'éditeur n'a pas pu démarrer",
      "Rechargez la page. Si cela se reproduit, prévenez l'atelier : votre site, lui, n'est pas touché.",
      String((e && (e.stack || e.message)) || e));
  }
}
