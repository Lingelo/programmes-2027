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
const sourceValide = (u) => {
  try {
    const x = new URL(u);
    if (x.pathname.length <= 1) return false;                       // page d'accueil
    if (/20(12|17|22)/.test(x.href) && !/2027/.test(x.href)) return false; // élection passée
    return true;
  } catch { return false; }
};

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

// Positions complémentaires (40 propositions) : candidats et propositions existants, sources précises
try {
  const comp = JSON.parse(await readFile(new URL('../data/positions-complementaires.json', import.meta.url), 'utf8'));
  const fv = JSON.parse(await readFile(new URL('../data/francevote.json', import.meta.url), 'utf8').catch(() => 'null'));
  const propsFV = new Set((fv?.propositions || []).map((p) => p.id));
  for (const [id, c] of Object.entries(comp.candidats || {})) {
    if (!ids.has(id)) erreurs.push(`positions complémentaires : candidat inconnu « ${id} »`);
    if (fv?.candidats?.[id]) erreurs.push(`positions complémentaires : « ${id} » est déjà évalué par France-Vote`);
    for (const [k, v] of Object.entries(c.positions || {})) {
      if (propsFV.size && !propsFV.has(k)) erreurs.push(`positions complémentaires ${id} : proposition inconnue « ${k} »`);
      if (![-2, -1, 0, 1, 2].includes(v)) erreurs.push(`positions complémentaires ${id}/${k} : valeur ${v} hors échelle`);
      if (!sourceValide(c.sources?.[k]?.url)) erreurs.push(`positions complémentaires ${id}/${k} : source manquante ou trop vague`);
    }
  }
} catch (e) { if (e.code !== 'ENOENT') erreurs.push(`positions complémentaires illisibles : ${e.message}`); }

if (erreurs.length) { console.error(erreurs.join('\n')); process.exit(1); }
console.log(`OK — ${d.candidats.length} candidats, ${d.candidats.reduce((n, c) => n + Object.values(c.propositions || {}).flat().length, 0)} propositions.`);
