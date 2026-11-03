---
name: verifier-rendu
description: Contrôler le rendu du site dans un vrai navigateur (chevauchements dans la boussole, débordements, textes tronqués, erreurs JavaScript) sur mobile et ordinateur, puis regarder des captures. À utiliser après toute modification de js/app.js, css/style.css, templates/ ou des données affichées.
---

# Vérifier le rendu

1. Régénérer le site : `node scripts/build-site.mjs`
2. Contrôle mesuré (positions réelles des éléments, serveur local intégré) :
   - rapide : `node scripts/verifier-rendu.mjs --rapide` (pages principales, 390 et 1280 px)
   - complet : `node scripts/verifier-rendu.mjs` (toutes les fiches, un duel sur six, 360/390/768/1280 px, ~2 min)
   Code de sortie 1 = problème : corrige et relance jusqu'à « Aucun chevauchement, débordement ni erreur JavaScript ».
3. **Regarde aussi** : le script ne juge pas l'ambiguïté (un nom placé loin de son point) ni l'esthétique.
   Prends des captures Playwright des zones modifiées (mobile 390 px, `deviceScaleFactor: 2`) et ouvre-les.
4. Pièges déjà rencontrés : noms de la boussole sur des points voisins, points aux valeurs extrêmes
   (−100/+100) sur les légendes, fiche qui ne s'affiche pas à cause d'une donnée manquante (`null.eco`).

Le robot GitHub « Construction du site » lance le contrôle complet sur chaque pull request.
