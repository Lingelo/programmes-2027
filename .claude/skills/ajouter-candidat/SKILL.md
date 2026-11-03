---
name: ajouter-candidat
description: Ajouter un nouveau candidat à la présidentielle 2027 sur le site (fiche, bord, couleur, photo, positions, image de partage, pages). À utiliser quand la veille (data/veille.json) signale une nouvelle candidature ou qu'on demande d'ajouter quelqu'un.
---

# Ajouter un candidat

Respecte les règles de `CLAUDE.md` (sources 2027 uniquement, neutralité, « non évalué » plutôt qu'interpréter).

## 1. Confirmer la candidature
- Au moins une source datée qui annonce explicitement la candidature à la présidentielle 2027
  (presse nationale, site de campagne). Lis-la avec WebFetch. Note la date d'annonce.
- Vérifie qu'il ne s'agit pas d'une personne déjà présente (homonyme, nom composé).

## 2. Ajouter l'entrée dans `data/candidats.json`
Insère l'objet dans `candidats`, à côté des candidats du même bord. Champs :

| Champ | Règle |
|---|---|
| `id` | nom en minuscules sans accents, tirets (`dupont-aignan`) ; c'est l'adresse `/candidat/<id>/` |
| `prenom`, `nom` | tels qu'écrits par le candidat |
| `parti`, `partiCourt` | nom complet et sigle (≤ 8 caractères) |
| `bord` | un `id` de `bords` ; s'appuyer sur la classification d'une source (France-Vote « famille », presse) ; à défaut `autre` |
| `couleur` | couleur officielle du parti (hex 6 chiffres) ; contraste lisible avec du texte blanc ou noir |
| `wiki` | titre exact de l'article fr.wikipedia (`Prénom_Nom`) ou `null` — sert aux photos et bios automatiques |
| `photo`, `photoCredit` | `null` : la synchro télécharge une photo libre ; sinon `img/candidats/<id>.jpg` + URL Commons |
| `slogan` | entre guillemets dans la source, sinon `null` |
| `statut` | `déclaré` / `déclarée` / `désigné` / `désignée` |
| `declaration` | `AAAA-MM-JJ` ou `null` si inconnue (ne jamais inventer un jour) |
| `programme` | `non publié` / `partiel` / `complet` |
| `site` | site de campagne ou `null` |
| `bio` | 1 à 2 phrases factuelles et sourcées |
| `phares`, `positions`, `propositions` | voir la skill `maj-programme` ; vides si rien de sourcé |
| `sources` | URL des sources utilisées |

## 3. Positions sur les 40 propositions
- Si le candidat est dans `data/francevote.json`, rien à faire (automatique).
- Sinon, ajoute dans `data/positions-complementaires.json` uniquement les positions sourcées 2025-2026
  qui correspondent clairement au texte d'une proposition (id dans `data/francevote.json` → `propositions`).

## 4. Générer et vérifier
```bash
node scripts/check-data.mjs
node scripts/og-images.mjs        # image de partage img/og/<id>.png
node scripts/build-site.mjs       # crée candidat/<id>/ et les duels
node scripts/verifier-rendu.mjs --rapide
```
Puis branche → PR → robot vert → fusion (voir `CLAUDE.md`). Dans la PR : sources de la candidature et du classement.
