#!/usr/bin/env node
// Positions des candidats sur 40 propositions, d'après les données ouvertes de France-Vote
// (https://www.france-vote.fr/donnees — licence CC BY 4.0, réutilisation libre avec mention de la source).
//
// Le fichier publié par France-Vote est une grille : 40 propositions × personnalités, valeurs de
// −2 (opposition nette) à +2 (soutien net), avec la source quand elle existe. C'est une lecture
// éditoriale et indicative, que le site affiche comme telle, avec attribution.
//
// Ce script :
//  - ne garde que les personnalités qui ont une fiche sur le site (rattachement par le nom) ;
//  - calcule la « boussole » à deux axes (économie, société) avec la méthode de France-Vote :
//    somme(position × poids de l'axe) / somme(2 × |poids|), ramenée sur −100…+100 ;
//  - écrit data/francevote.json.
//
// Usage : node scripts/sync-francevote.mjs

import { readFile, writeFile } from 'node:fs/promises';

const URL_DONNEES = 'https://www.france-vote.fr/donnees.json';
const PAGE_DONNEES = 'https://www.france-vote.fr/donnees';
const UA = 'Mozilla/5.0 (compatible; programmes-2027/1.0; +https://github.com/lingelo/programmes-2027)';
const DATA = new URL('../data/candidats.json', import.meta.url);
const SORTIE = new URL('../data/francevote.json', import.meta.url);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();

const data = JSON.parse(await readFile(DATA, 'utf8'));
let fv;
try {
  const r = await fetch(URL_DONNEES, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  fv = await r.json();
  if (!Array.isArray(fv.propositions) || fv.propositions.length < 10 || !fv.positions) throw new Error('structure inattendue');
} catch (e) {
  console.warn(`France-Vote indisponible (${e.message}) : données précédentes conservées.`);
  process.exit(0);
}

const props = Object.fromEntries(fv.propositions.map((p) => [p.id, p]));
function boussole(positions) {
  const axe = (a) => {
    let num = 0, den = 0;
    for (const [id, v] of Object.entries(positions)) {
      const w = props[id]?.axes?.[a];
      if (w == null || typeof v !== 'number') continue;
      num += v * w; den += 2 * Math.abs(w);
    }
    return den ? Math.round((100 * num) / den) : null;
  };
  return { eco: axe('eco'), soc: axe('soc') };
}

const index = new Map(data.candidats.map((c) => [norm(`${c.prenom} ${c.nom}`), c.id]));
const candidats = {};
const nonRattaches = [];
for (const p of fv.candidats || []) {
  const id = index.get(norm(p.nom));
  const positions = fv.positions?.[p.slug];
  if (!positions) continue;
  if (!id) { nonRattaches.push(p.nom); continue; }
  candidats[id] = {
    slug: p.slug,
    url: `https://www.france-vote.fr/candidats/${p.slug}`,
    famille: p.famille || null,
    positions,
    sources: fv.sources?.[p.slug] || {},
    boussole: boussole(positions),
  };
}

const sortie = {
  source: 'France-Vote',
  licence: fv.licence || 'CC BY 4.0',
  page: PAGE_DONNEES,
  avertissement: fv.avertissement || 'Lecture éditoriale et indicative.',
  recupereLe: new Date().toISOString().slice(0, 10),
  echelle: fv.echelle,
  themes: fv.themes,
  propositions: fv.propositions.map(({ id, theme, texte, court, axes }) => ({ id, theme, texte, court, axes: axes || null })),
  candidats,
  nonRattaches,
};

// On ne réécrit le fichier que si le contenu a changé (hors date de récupération)
const avant = JSON.parse(await readFile(SORTIE, 'utf8').catch(() => 'null'));
const sansDate = (o) => JSON.stringify({ ...o, recupereLe: undefined });
if (avant && sansDate(avant) === sansDate(sortie)) {
  console.log('Positions France-Vote inchangées.');
  process.exit(0);
}
await writeFile(SORTIE, JSON.stringify(sortie, null, 1) + '\n');
const nbSources = Object.values(candidats).reduce((n, c) => n + Object.values(c.sources).filter(Boolean).length, 0);
console.log(`France-Vote : ${Object.keys(candidats).length} candidats rattachés, ${sortie.propositions.length} propositions, ${nbSources} positions sourcées. Hors site : ${nonRattaches.join(', ') || 'aucun'}.`);
