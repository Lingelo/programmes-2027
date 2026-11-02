#!/usr/bin/env node
// Vérifie la cohérence de data/candidats.json (lancé en CI avant chaque déploiement).
import { readFile } from 'node:fs/promises';

const d = JSON.parse(await readFile(new URL('../data/candidats.json', import.meta.url), 'utf8'));
const erreurs = [];
const bords = new Set(d.bords.map((b) => b.id));
const themes = new Set(d.themes.map((t) => t.id));
const enjeux = new Set(d.enjeux.map((e) => e.id));
const ids = new Set();
// Une source doit pointer vers une page précise (article, fiche), pas vers la page d'accueil d'un site.
const sourceValide = (u) => { try { const x = new URL(u); return x.pathname.length > 1; } catch { return false; } };

for (const c of d.candidats) {
  const qui = c.id || '(sans id)';
  if (!c.id || ids.has(c.id)) erreurs.push(`${qui} : id manquant ou en double`);
  ids.add(c.id);
  for (const k of ['prenom', 'nom', 'parti', 'partiCourt', 'bord', 'couleur', 'statut', 'programme']) if (!c[k]) erreurs.push(`${qui} : champ « ${k} » manquant`);
  if (!bords.has(c.bord)) erreurs.push(`${qui} : bord inconnu « ${c.bord} »`);
  if (!/^#[0-9a-f]{6}$/i.test(c.couleur)) erreurs.push(`${qui} : couleur invalide`);
  for (const [k, v] of Object.entries(c.positions || {})) {
    if (!enjeux.has(k)) erreurs.push(`${qui} : enjeu inconnu « ${k} »`);
    if (!v?.valeur || !sourceValide(v.source)) erreurs.push(`${qui} : position « ${k} » sans source précise`);
  }
  for (const [t, liste] of Object.entries(c.propositions || {})) {
    if (!themes.has(t)) erreurs.push(`${qui} : thème inconnu « ${t} »`);
    for (const p of liste) {
      if (!p.titre || !p.detail) erreurs.push(`${qui}/${t} : proposition incomplète`);
      if (!sourceValide(p.source)) erreurs.push(`${qui}/${t} : source invalide ou trop vague (page d'accueil) pour « ${p.titre} »`);
    }
  }
}

if (erreurs.length) { console.error(erreurs.join('\n')); process.exit(1); }
console.log(`OK — ${d.candidats.length} candidats, ${d.candidats.reduce((n, c) => n + Object.values(c.propositions || {}).flat().length, 0)} propositions.`);
