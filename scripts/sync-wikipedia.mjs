#!/usr/bin/env node
// Synchronisation quotidienne avec Wikipédia (aucune dépendance, Node 20+).
//  1. Rafraîchit la photo de chaque candidat (Wikimedia Commons, via l'API REST de fr.wikipedia).
//  2. Lit la page « Candidatures à l'élection présidentielle française de 2027 » et repère
//     les noms de candidats déclarés absents de data/candidats.json -> data/veille.json.
// Ce script ne modifie jamais les programmes : il ne fait que signaler.

import { readFile, writeFile } from 'node:fs/promises';

const DATA = new URL('../data/candidats.json', import.meta.url);
const VEILLE = new URL('../data/veille.json', import.meta.url);
const PAGE = "Candidatures_à_l'élection_présidentielle_française_de_2027";
const UA = 'programmes-2027/1.0 (https://github.com/lingelo/programmes-2027)';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();

async function get(url, type = 'json') {
  for (let essai = 1; essai <= 4; essai++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
    if (r.ok) return type === 'json' ? r.json() : r.text();
    if (r.status === 404) return null;
    await pause(1000 * 2 ** essai);
  }
  throw new Error(`Échec ${url}`);
}

const data = JSON.parse(await readFile(DATA, 'utf8'));
let photosChangees = 0;

// 1. Photos
for (const c of data.candidats) {
  if (!c.wiki) continue;
  try {
    const j = await get(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(c.wiki)}`);
    const u = j?.thumbnail?.source ? j.thumbnail.source.replace(/\/\d+px-/, '/400px-') : null;
    if (u && u !== c.photo) { c.photo = u; photosChangees++; }
  } catch (e) {
    console.warn(`Photo ${c.wiki} : ${e.message}`);
  }
  await pause(250);
}

// 2. Veille des candidatures
const connus = data.candidats.map((c) => norm(`${c.prenom} ${c.nom}`));
const estConnu = (nom) => { const n = norm(nom); return connus.some((k) => k === n || n.includes(k) || k.includes(n)); };

let nouveaux = [];
let sourceOk = false;
try {
  const html = await get(`https://fr.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(PAGE)}`, 'text');
  // Section(s) dont le titre parle de candidats déclarés / désignés
  const sections = html.split(/<h[23][^>]*>/i).slice(1);
  const cibles = sections.filter((s) => /candidat(e|ure)?s?\s+(d[ée]clar|d[ée]sign|officiel)/i.test(s.slice(0, 300).replace(/<[^>]+>/g, '')));
  const noms = new Set();
  for (const sec of cibles) {
    for (const ligne of sec.split(/<tr[\s>]/i).slice(1)) {
      // Premier lien interne de la ligne dont le texte ressemble à « Prénom Nom »
      const liens = [...ligne.matchAll(/<a[^>]+rel="mw:WikiLink"[^>]*>([^<]{3,60})<\/a>/g)].map((m) => m[1].trim());
      const personne = liens.find((t) => /^\p{Lu}[\p{L}'-]+(\s+(de |du |le |la )?\p{Lu}[\p{L}'-]+){1,3}$/u.test(t));
      if (personne) noms.add(personne);
    }
  }
  sourceOk = noms.size > 0;
  nouveaux = [...noms].filter((n) => !estConnu(n)).sort();
} catch (e) {
  console.warn(`Veille : ${e.message}`);
}

const ancienne = JSON.parse(await readFile(VEILLE, 'utf8').catch(() => '{}'));
const veille = {
  checkedAt: new Date().toISOString().slice(0, 10),
  source: `https://fr.wikipedia.org/wiki/${PAGE}`,
  sourceOk,
  nouveaux: sourceOk ? nouveaux : (ancienne.nouveaux || []),
};

await writeFile(VEILLE, JSON.stringify(veille, null, 2) + '\n');
if (photosChangees) await writeFile(DATA, JSON.stringify(data, null, 2) + '\n');

console.log(`Photos mises à jour : ${photosChangees}`);
console.log(`Page Wikipédia lue : ${sourceOk ? 'oui' : 'non'}`);
console.log(`Nouveaux noms : ${veille.nouveaux.join(', ') || 'aucun'}`);
