---
name: maj-programme
description: Mettre à jour les mesures, positions et mesures phares d'un ou plusieurs candidats à partir des annonces de campagne 2027, avec vérification de chaque source. Utilisée par la tâche hebdomadaire et à la demande (ex. « intègre le nouveau programme de Mélenchon »).
---

# Mettre à jour un programme

Règles absolues : `CLAUDE.md` § Règles de contenu.

## 1. Chercher
Pour chaque candidat visé, cherche les annonces depuis `meta.contenuMisAJour` (data/candidats.json) :
site de campagne officiel, puis presse nationale (Le Monde, Le Figaro, Libération, franceinfo, AFP,
Les Échos, Public Sénat, LCP…), puis sites de synthèse en dernier recours.

## 2. Vérifier (obligatoire)
- Ouvre chaque page avec WebFetch et lis-la. Un résumé de moteur de recherche ne suffit jamais.
- Contrôle : date 2025-2026, attribution explicite au candidat, pour 2027, citation fidèle.
- En cas de doute ou de sources contradictoires : n'ajoute pas, mentionne-le dans la PR.
- Pour un lot important, confie la relecture au sous-agent `verificateur-sources`.

## 3. Écrire dans `data/candidats.json`
- `propositions.<theme>` : `{ "titre": "…", "detail": "…", "source": "URL précise" }` — `theme` parmi `themes[].id`.
- `positions.<enjeu>` (tableau « en un coup d'œil ») : `{ "valeur": "1 à 5 mots", "source": "URL" }` — enjeux : `enjeux[].id`.
- `phares` : 3 mesures maximum, déjà présentes dans `propositions`.
- `programme` : `non publié` / `partiel` / `complet` ; `sources` : ajouter les URL utilisées.
- Conserve l'existant sauf contradiction par une source plus récente ou abandon par le candidat ;
  remplace une source faible par une source officielle ou de presse quand tu en trouves une.
- Candidat retiré : `statut: "retiré"` et ajout dans `retires`. Nouveau candidat : le signaler (skill `ajouter-candidat`).
- Mets `meta.contenuMisAJour` à la date du jour.

## 4. Positions sur les 40 propositions
Pour un candidat **absent** de `data/francevote.json`, `data/positions-complementaires.json` :
`positions.<id>` ∈ {-2,-1,0,1,2} + `sources.<id>` = `{ url, titre, editeur, date }`, seulement si la prise de
position correspond clairement au texte de la proposition. Ne jamais éditer `data/francevote.json`.

## 5. Terminer
```bash
node scripts/check-data.mjs && node scripts/build-site.mjs && node scripts/verifier-rendu.mjs --rapide
```
Branche `maj-programmes-AAAA-MM-JJ` → PR (liste par candidat des ajouts / modifications / retraits avec sources,
terminée par « À relire avant fusion : vérifiez chaque source. »). Ne fusionne pas une PR de contenu sans relecture humaine.
