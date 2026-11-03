# Programmes 2027 — le comparateur

**Site : https://lingelo.github.io/programmes-2027/**

Site non partisan pour comparer les programmes des candidats à l'élection présidentielle 2027
(1er tour le 18 avril, 2nd tour le 2 mai 2027).

- **Mobile first**, thème jaune / noir inspiré de taxe-au-giga.fr
- Fiches candidats : photo, **biographie** (naissance, formation, métiers, parcours, intro Wikipédia), parti et couleur, bord politique, slogan, mesures phares, **programme détaillé par thème** avec la source de chaque mesure
- **Boussole politique et positions sur 40 propositions** (données ouvertes [France-Vote](https://www.france-vote.fr/donnees), CC BY 4.0), candidats les plus proches et les plus éloignés
- **Comparateur** jusqu'à 4 candidats : tableau « en un coup d'œil » + colonnes thème par thème (lien partageable)
- **Compteur des parrainages** (500 signatures) : jauge par candidat, nombre de départements, courbe d'évolution, classement — d'après les données ouvertes du Conseil constitutionnel
- Vue **par thème** : tous les candidats sur un même sujet, de la gauche à la droite
- Aucune dépendance côté site : HTML + CSS + JS, données dans `data/candidats.json`

## Lancer en local

Le site est fait de vraies pages HTML (une par candidat, thème, duel…) générées à partir
des données, pour le référencement :

```bash
npm install
npm run build                 # régénère index.html, candidat/, theme/, comparer/, sitemap.xml…
cd .. && python3 -m http.server 8080
# puis http://localhost:8080/programmes-2027/
```

`npm run og` régénère les images de partage (`img/og/`) et les icônes (nécessite Playwright).

## Référencement (SEO)

- Une page statique par contenu : 31 fiches, 10 thèmes, 66 duels (« X ou Y : comparatif des programmes 2027 »), signatures, méthodo
- Titre, description, adresse canonique, Open Graph et Twitter propres à chaque page, image de partage par candidat
- Données structurées schema.org : `WebSite`, `ProfilePage`/`Person`, `Event` (l'élection), `BreadcrumbList`, `FAQPage`
- `sitemap.xml`, `robots.txt`, `manifest.webmanifest`, liens internes (duels, pied de page)
- Pages régénérées automatiquement à chaque modification de `main` (`verifier.yml`) et à chaque synchro

## Mise à jour automatique

| Robot | Fréquence | Ce qu'il fait |
|---|---|---|
| `sync.yml` | 2 fois par jour | Lit Wikipédia et Wikidata : photos des nouveaux candidats, biographies, **parrainages** (Conseil constitutionnel, dès l'ouverture de la collecte début 2027), **liste officielle des candidats** (décision du Conseil constitutionnel, recherchée automatiquement de février à mai 2027), signale les nouveaux candidats déclarés repérés sur **Wikipédia et France-Vote** (`data/veille.json`, affiché sur le site), redéploie |
| Tâche programmée claude.ai | chaque lundi, 11 h 23 | Une session Claude cherche les nouvelles annonces de programme (sources 2027 uniquement) et **ouvre une Pull Request à relire** (rien n'est publié sans validation humaine) |
| `refresh-programmes.yml` | chaque lundi (optionnel) | Même travail via l'API Anthropic, seulement si le secret `ANTHROPIC_API_KEY` est configuré ; sinon il s'arrête sans rien faire |
| `verifier.yml` | à chaque modification et pull request | Vérifie les données et **régénère les pages statiques** ; GitHub Pages (mode « Deploy from a branch », `main`, racine) publie ensuite |

### Mise en route (une seule fois)

1. Fusionner sur la branche `main`.
2. **Settings → Pages → Source : Deploy from a branch → `main` / (root)**.
3. (Optionnel, pour la mise à jour des programmes) **Settings → Secrets → Actions** : ajouter `ANTHROPIC_API_KEY`.
   Sans ce secret, le robot hebdomadaire s'arrête proprement.
4. **Settings → Actions → General** : cocher « Allow GitHub Actions to create and approve pull requests ».

## Modifier les données

Tout est dans `data/candidats.json` :

```jsonc
{
  "id": "philippe", "prenom": "Édouard", "nom": "Philippe",
  "parti": "Horizons", "partiCourt": "HOR",
  "bord": "centre-droit",          // voir la liste "bords"
  "couleur": "#1D3E8F",            // couleur du parti
  "wiki": "Édouard_Philippe",      // titre fr.wikipedia -> photo automatique
  "programme": "partiel",          // complet | partiel | non publié
  "positions": { "retraite": "..." },          // tableau « en un coup d'œil »
  "propositions": { "travail": [ { "titre": "...", "detail": "...", "source": "https://..." } ] }
}
```

`npm run check` vérifie la cohérence avant publication.

## Avertissement

Les programmes 2027 sont encore en construction ; beaucoup de mesures proviennent de déclarations
et d'articles de presse. Chaque mesure renvoie vers sa source : en cas d'erreur, ouvrez une issue.
