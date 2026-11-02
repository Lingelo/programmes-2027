# Programmes 2027 — le comparateur

Site non partisan pour comparer les programmes des candidats à l'élection présidentielle 2027
(1er tour le 18 avril, 2nd tour le 2 mai 2027).

- **Mobile first**, thème jaune / noir inspiré de taxe-au-giga.fr
- Fiches candidats : photo, **biographie** (naissance, formation, métiers, parcours, intro Wikipédia), parti et couleur, bord politique, slogan, mesures phares, **programme détaillé par thème** avec la source de chaque mesure
- **Comparateur** jusqu'à 4 candidats : tableau « en un coup d'œil » + colonnes thème par thème (lien partageable)
- Vue **par thème** : tous les candidats sur un même sujet, de la gauche à la droite
- Aucune dépendance côté site : HTML + CSS + JS, données dans `data/candidats.json`

## Lancer en local

```bash
python3 -m http.server 8080   # ou : npm run dev
# puis http://localhost:8080
```

## Mise à jour automatique

| Robot | Fréquence | Ce qu'il fait |
|---|---|---|
| `sync.yml` | tous les jours | Lit Wikipédia et Wikidata : photos des nouveaux candidats, biographies, signale les nouveaux candidats déclarés (`data/veille.json`, affiché sur le site), redéploie |
| `refresh-programmes.yml` | chaque lundi | Claude + recherche web cherche les nouvelles annonces de chaque candidat et **ouvre une Pull Request à relire** (rien n'est publié sans validation humaine) |
| `deploy.yml` | à chaque push sur `main` | Vérifie les données (`scripts/check-data.mjs`) et publie sur GitHub Pages |

### Mise en route (une seule fois)

1. Fusionner sur la branche `main`.
2. **Settings → Pages → Source : GitHub Actions**.
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
