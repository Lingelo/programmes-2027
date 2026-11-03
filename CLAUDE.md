# Programmes 2027 — règles du projet

Comparateur **non partisan** des programmes de l'élection présidentielle française 2027
(1er tour 18 avril 2027, 2nd tour 2 mai 2027). Site statique publié par GitHub Pages
(mode « Deploy from a branch », branche `main`, racine) : https://lingelo.github.io/programmes-2027/

Langue : tout (code, commentaires, commits, PR, textes du site) est en **français**.

## Règles de contenu (non négociables)

1. **Uniquement la campagne 2027.** Une mesure, une position ou une case du tableau comparatif n'entre
   dans le site que si une source **datée de 2025 ou 2026** l'attribue explicitement au candidat **pour 2027**.
   Jamais de programme 2012 / 2017 / 2022, ni du programme NFP 2024 non repris pour 2027.
   Les signatures (parrainages) antérieures au 1er décembre 2026 sont rejetées par le script.
2. **Une source précise par élément** : URL d'un article ou d'une fiche, jamais une page d'accueil
   (`scripts/check-data.mjs` le refuse, comme les URL d'élections passées).
3. **Vérifier en lisant la source** (WebFetch), pas seulement un résumé de recherche. Les sites de synthèse
   (ÉlyséeScope notamment) se contredisent : préférer site de campagne et presse nationale.
4. **Neutralité** : reprendre les mots du candidat, aucun adjectif évaluatif.
5. **« Non évalué » plutôt qu'une interprétation.** Pas de déduction depuis la ligne historique d'un parti.
6. **France-Vote** : seules leurs **données ouvertes** (`data/francevote.json`, CC BY 4.0, créditées) sont
   réutilisables. Ne jamais recopier les textes rédigés de leurs fiches (« tous droits réservés »).
7. **Photos** : uniquement libres de droits (Wikimedia Commons), créditées. Attention aux homonymes
   (`photoRecherche: false`, `photoExclus` dans `data/candidats.json`).
8. Typographie : élision (« d'Édouard Philippe »), espaces avant `:` `?` `!`, guillemets « ».

## Fichiers

| Fichier | Rôle | Qui le modifie |
|---|---|---|
| `data/candidats.json` | candidats, programmes, positions « en un coup d'œil », bios | humain / tâche du lundi ; bios et photos par la synchro |
| `data/positions-complementaires.json` | positions sur les 40 propositions pour les candidats absents de France-Vote | humain / tâche du lundi |
| `data/francevote.json` | données ouvertes France-Vote | **automatique** (`sync-francevote.mjs`), ne pas éditer |
| `data/parrainages.json`, `data/liste-officielle.json`, `data/veille.json` | Conseil constitutionnel, veille | **automatique**, ne pas éditer |
| `index.html`, `candidat/`, `candidats/`, `theme/`, `themes/`, `comparer/`, `signatures/`, `methodo/`, `404.html`, `sitemap.xml`, `robots.txt`, `manifest.webmanifest` | **pages générées** | **jamais à la main** : `node scripts/build-site.mjs` |
| `js/app.js`, `css/style.css`, `templates/page.html` | application (rendu navigateur + génération) | code |

## Commandes

```bash
npm install                          # une fois (jsdom pour la génération)
node scripts/check-data.mjs          # valide les données — obligatoire avant tout commit (un hook le fait)
node scripts/build-site.mjs          # régénère les 126 pages statiques
node scripts/verifier-rendu.mjs      # contrôle de rendu (chevauchements, débordements, erreurs JS) ; --rapide
node scripts/og-images.mjs           # images de partage et icônes (Playwright), après ajout de candidat
```

Aperçu local : `cd .. && python3 -m http.server 8080` puis http://localhost:8080/programmes-2027/

## Circuit de modification

Toujours : **branche → commit → pull request → robot « Construction du site » vert → fusion (squash)**.
Ne jamais pousser directement sur `main`. Après fusion, réaligner la branche de travail sur `origin/main`.
Les PR de la tâche hebdomadaire (programmes) attendent la relecture du propriétaire avant fusion.

## Pièges connus

- Depuis l'environnement Claude Code distant, `fr.wikipedia.org` et Wikimedia renvoient souvent 429 ;
  `fr.m.wikipedia.org`, `en.wikipedia.org` et `www.wikidata.org` passent mieux. Les robots GitHub n'ont pas ce problème.
- Un remplacement de texte qui ne trouve pas sa cible échoue en silence : vérifier avec `assert` / relire.
- Un bug JavaScript empêche la génération (le script échoue) : c'est voulu, ne pas le contourner.
- Les robots GitHub programmés ne tournent que sur la branche par défaut (`main`) et peuvent avoir des heures de retard.

## Outils du projet pour Claude

- Skills (`.claude/skills/`) : `ajouter-candidat`, `maj-programme`, `verifier-rendu`.
- Sous-agent (`.claude/agents/`) : `verificateur-sources` (lecture seule) — à utiliser pour relire une PR de données.
- Hooks (`.claude/settings.json`) : `check-data` après chaque modification de `data/*.json`, et avant tout `git commit` (bloquant).
