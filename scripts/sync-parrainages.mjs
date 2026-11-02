#!/usr/bin/env node
// Suivi des parrainages (« 500 signatures ») à partir des données ouvertes du Conseil constitutionnel.
// Le Conseil publie les parrainages validés au moins deux fois par semaine pendant la collecte
// (du décret de convocation, début 2027, jusqu'au 6e vendredi avant le 1er tour).
//
// Usage : node scripts/sync-parrainages.mjs [--url <fichier json|csv>] [--sortie <chemin>]
// Sans --url, on essaie les adresses officielles prévues pour 2027 puis data.gouv.fr.

import { readFile, writeFile } from 'node:fs/promises';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, t) => (a.startsWith('--') ? [...acc, [a.slice(2), t[i + 1]]] : acc), []));
const DATA = new URL('../data/candidats.json', import.meta.url);
const SORTIE = args.sortie ? new URL(args.sortie, `file://${process.cwd()}/`) : new URL('../data/parrainages.json', import.meta.url);
const UA = 'programmes-2027/1.0 (https://github.com/lingelo/programmes-2027)';
const SEUIL = 500;
const MIN_DEPARTEMENTS = 30;
const MAX_PAR_DEPARTEMENT = 50; // 1/10e des 500 signatures

const SOURCES_OFFICIELLES = [
  'https://presidentielle2027.conseil-constitutionnel.fr/telechargement/parrainagestotal.json',
  'https://presidentielle2027.conseil-constitutionnel.fr/telechargement/parrainagestotal.csv',
];

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();

async function telecharger(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    let txt;
    try { txt = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { txt = new TextDecoder('windows-1252').decode(buf); }
    return { url, txt };
  } catch {
    return null;
  }
}

// Recherche d'un jeu de données « parrainages 2027 » sur data.gouv.fr (miroir officiel)
async function sourceDataGouv() {
  try {
    const r = await fetch('https://www.data.gouv.fr/api/1/datasets/?q=parrainages%20presidentielle%202027&page_size=10', { headers: { 'User-Agent': UA } });
    if (!r.ok) return null;
    const j = await r.json();
    for (const ds of j.data || []) {
      if (!/2027/.test(ds.title) || !/parrain/i.test(ds.title)) continue;
      const res = (ds.resources || []).find((x) => /json/i.test(x.format)) || (ds.resources || []).find((x) => /csv/i.test(x.format));
      if (res?.url) return res.url;
    }
  } catch { /* ignore */ }
  return null;
}

function lireCsv(txt) {
  const lignes = txt.split(/\r?\n/).filter(Boolean);
  const sep = lignes[0].includes(';') ? ';' : ',';
  const decouper = (l) => [...l.matchAll(new RegExp(`("([^"]|"")*"|[^${sep}]*)(${sep}|$)`, 'g'))].map((m) => m[1].replace(/^"|"$/g, '').replace(/""/g, '"')).slice(0, -1);
  const entetes = decouper(lignes[0]).map(norm);
  const col = (motif) => entetes.findIndex((h) => motif.test(h));
  const iCand = col(/^candidat/), iDep = col(/^departement/), iMandat = col(/^mandat/), iDate = col(/date/);
  return lignes.slice(1).map(decouper).map((c) => ({
    Candidat: c[iCand], Departement: c[iDep], Mandat: c[iMandat],
    DatePublication: (c[iDate] || '').replace(/^(\d{2})\/(\d{2})\/(\d{4}).*/, '$3-$2-$1'),
  }));
}

function lireJson(txt) {
  const j = JSON.parse(txt);
  const liste = Array.isArray(j) ? j : j.parrainages || j.data || [];
  return liste.map((p) => ({
    Candidat: p.Candidat ?? p.candidat,
    Departement: p.Departement ?? p.departement ?? p['Département'],
    Mandat: p.Mandat ?? p.mandat,
    DatePublication: String(p.DatePublication ?? p['Date de publication'] ?? p.date ?? '').slice(0, 10),
  }));
}

// ---------- Récupération ----------
let brut = null;
const essais = args.url ? [args.url] : SOURCES_OFFICIELLES;
for (const u of essais) { brut = await telecharger(u); if (brut) break; }
if (!brut && !args.url) {
  const u = await sourceDataGouv();
  if (u) brut = await telecharger(u);
}

const precedent = JSON.parse(await readFile(SORTIE, 'utf8').catch(() => 'null'));
const data = JSON.parse(await readFile(DATA, 'utf8'));
const aujourdhui = new Date().toISOString().slice(0, 10);

if (!brut) {
  // Collecte pas encore ouverte (ou site indisponible) : on conserve les derniers chiffres connus.
  const sortie = precedent?.statut === 'en-cours' || precedent?.statut === 'cloture'
    ? { ...precedent, verifieLe: aujourdhui, sourceIndisponible: true }
    : {
        statut: 'pas-ouverte',
        verifieLe: aujourdhui,
        regles: { seuil: SEUIL, minDepartements: MIN_DEPARTEMENTS, maxParDepartement: MAX_PAR_DEPARTEMENT },
        calendrier: { ouverture: 'à la publication du décret de convocation (au plus tard début février 2027)', cloture: '2027-03-12' },
        source: 'https://www.conseil-constitutionnel.fr',
        candidats: {},
      };
  await writeFile(SORTIE, JSON.stringify(sortie, null, 2) + '\n');
  console.log(`Aucune publication officielle trouvée (statut : ${sortie.statut}).`);
  process.exit(0);
}

const tous = brut.txt.trim().startsWith('[') || brut.txt.trim().startsWith('{') ? lireJson(brut.txt) : lireCsv(brut.txt);
// Garde-fou : seules les signatures publiées pour l'élection 2027 sont prises en compte
// (la collecte s'ouvre au plus tôt fin 2026). Tout fichier d'une élection passée est ignoré.
const DEBUT_2027 = args.depuis || '2026-12-01';
const parrainages = tous.filter((p) => p.DatePublication && p.DatePublication >= DEBUT_2027);
if (tous.length && !parrainages.length) {
  console.log(`Fichier ignoré : ${tous.length} signatures, toutes antérieures au ${DEBUT_2027} (élection passée).`);
  process.exit(0);
}

// ---------- Agrégation ----------
const index = new Map(data.candidats.map((c) => [norm(`${c.nom} ${c.prenom}`), c.id]));
const trouverId = (nomCC) => {
  const n = norm(nomCC);
  if (index.has(n)) return index.get(n);
  for (const [k, id] of index) if (n.includes(k) || k.includes(n)) return id;
  return null;
};

const parCand = new Map();
for (const p of parrainages) {
  if (!p.Candidat) continue;
  const cle = p.Candidat.trim();
  if (!parCand.has(cle)) parCand.set(cle, { total: 0, deps: new Map(), mandats: new Map(), dates: new Map() });
  const a = parCand.get(cle);
  a.total++;
  a.deps.set(p.Departement, (a.deps.get(p.Departement) || 0) + 1);
  a.mandats.set(p.Mandat, (a.mandats.get(p.Mandat) || 0) + 1);
  a.dates.set(p.DatePublication, (a.dates.get(p.DatePublication) || 0) + 1);
}

const candidats = {};
const nonRattaches = {};
for (const [nomCC, a] of parCand) {
  const deps = [...a.deps.values()];
  // Signatures qui comptent pour le seuil : 50 maximum par département
  const retenues = deps.reduce((s, n) => s + Math.min(n, MAX_PAR_DEPARTEMENT), 0);
  let cumul = 0;
  const historique = [...a.dates.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([date, n]) => ({ date, cumul: (cumul += n) }));
  const fiche = {
    nomOfficiel: nomCC,
    total: a.total,
    departements: a.deps.size,
    retenues,
    seuilAtteint: retenues >= SEUIL && a.deps.size >= MIN_DEPARTEMENTS,
    mandats: Object.fromEntries([...a.mandats.entries()].sort((x, y) => y[1] - x[1])),
    historique,
  };
  const id = trouverId(nomCC);
  if (id) candidats[id] = fiche; else nonRattaches[nomCC] = fiche;
}

const dates = parrainages.map((p) => p.DatePublication).filter(Boolean).sort();
const cloture = '2027-03-12';
const sortie = {
  statut: aujourdhui > cloture ? 'cloture' : 'en-cours',
  verifieLe: aujourdhui,
  dernierePublication: dates.at(-1) || null,
  total: parrainages.length,
  regles: { seuil: SEUIL, minDepartements: MIN_DEPARTEMENTS, maxParDepartement: MAX_PAR_DEPARTEMENT },
  calendrier: { cloture },
  source: brut.url,
  candidats,
  nonRattaches,
};
await writeFile(SORTIE, JSON.stringify(sortie, null, 2) + '\n');
console.log(`${parrainages.length} parrainages, ${Object.keys(candidats).length} candidats rattachés, ${Object.keys(nonRattaches).length} non rattachés. Dernière publication : ${sortie.dernierePublication}.`);
