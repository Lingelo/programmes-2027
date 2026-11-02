#!/usr/bin/env node
// Synchronisation quotidienne avec Wikipédia (aucune dépendance, Node 20+).
//  1. Télécharge la photo des candidats qui n'en ont pas encore (Wikimedia Commons) dans img/candidats/
//  2. Met à jour les biographies (intro Wikipédia + faits Wikidata).
//  3. Lit la page « Candidatures à l'élection présidentielle française de 2027 » et repère
//     les noms de candidats déclarés absents de data/candidats.json -> data/veille.json.
// Ce script ne modifie jamais les programmes : il ne fait que signaler.

import { readFile, writeFile, access } from 'node:fs/promises';
import { construireBio } from './lib-bio.mjs';

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

// 1. Photos : téléchargées dans img/candidats/ (le site ne dépend pas de Wikipédia au chargement).
//    On ne remplace jamais une photo déjà présente : pour en changer, supprimer le fichier.
const existe = (f) => access(new URL('../' + f, import.meta.url)).then(() => true, () => false);
for (const c of data.candidats) {
  if (!c.wiki || (c.photo && await existe(c.photo))) continue;
  try {
    let j = null;
    for (const host of ['fr', 'en']) {
      j = await get(`https://${host}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(c.wiki)}`);
      if (j?.thumbnail?.source) break;
    }
    const src = j?.thumbnail?.source?.split('?')[0];
    if (!src) continue;
    const ext = src.match(/\.(jpe?g|png|webp)$/i)?.[0].toLowerCase() || '.jpg';
    const r = await fetch(src.replace(/\/\d+px-/, '/330px-'), { headers: { 'User-Agent': UA } });
    if (!r.ok) continue;
    const fichier = `img/candidats/${c.id}${ext}`;
    await writeFile(new URL('../' + fichier, import.meta.url), Buffer.from(await r.arrayBuffer()));
    c.photo = fichier;
    c.photoCredit = 'https://commons.wikimedia.org/wiki/File:' + decodeURIComponent(src.split('/').at(-2));
    photosChangees++;
  } catch (e) {
    console.warn(`Photo ${c.wiki} : ${e.message}`);
  }
  await pause(300);
}

// 1 bis. Candidats sans article Wikipédia : recherche d'une photo libre sur Wikimedia Commons.
//    Critère strict : le nom du fichier doit contenir « Prénom Nom ». Mettre "photoRecherche": false
//    sur un candidat pour l'exclure (homonymes connus).
for (const c of data.candidats) {
  if (c.photo && await existe(c.photo)) continue;
  if (c.wiki || c.photoRecherche === false) continue;
  try {
    const nom = `${c.prenom} ${c.nom}`;
    const q = encodeURIComponent(`intitle:"${nom}"`);
    const r = await get(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${q}&gsrlimit=10&prop=imageinfo&iiprop=url|mime&iiurlwidth=330&format=json`);
    const pages = Object.values(r?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    const choix = pages.find((pg) => norm(pg.title).includes(norm(nom)) && /image\/(jpeg|png)/.test(pg.imageinfo?.[0]?.mime || ''));
    if (!choix) continue;
    const info = choix.imageinfo[0];
    const img = await fetch(info.thumburl || info.url, { headers: { 'User-Agent': UA } });
    if (!img.ok) continue;
    const ext = info.mime === 'image/png' ? '.png' : '.jpg';
    const fichier = `img/candidats/${c.id}${ext}`;
    await writeFile(new URL('../' + fichier, import.meta.url), Buffer.from(await img.arrayBuffer()));
    c.photo = fichier;
    c.photoCredit = `https://commons.wikimedia.org/wiki/${encodeURIComponent(choix.title.replace(/ /g, '_'))}`;
    photosChangees++;
    console.log(`Photo Commons trouvée pour ${nom} : ${choix.title}`);
  } catch (e) {
    console.warn(`Commons ${c.id} : ${e.message}`);
  }
  await pause(500);
}

// 2. Biographies (on ne remplace que si le contenu a réellement changé)
let biosChangees = 0;
const sansDate = (b) => JSON.stringify({ ...b, majLe: undefined });
for (const c of data.candidats) {
  if (!c.wiki) continue;
  try {
    const b = await construireBio(c.wiki);
    if (!b || (!b.paragraphes.length && c.biographie)) continue;
    if (!c.biographie || sansDate(b) !== sansDate(c.biographie)) { c.biographie = b; biosChangees++; }
  } catch (e) {
    console.warn(`Bio ${c.wiki} : ${e.message}`);
  }
  await pause(1000);
}

// 3. Veille des candidatures
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
if (photosChangees || biosChangees) await writeFile(DATA, JSON.stringify(data, null, 2) + '\n');

console.log(`Photos mises à jour : ${photosChangees}`);
console.log(`Biographies mises à jour : ${biosChangees}`);
console.log(`Page Wikipédia lue : ${sourceOk ? 'oui' : 'non'}`);
console.log(`Nouveaux noms : ${veille.nouveaux.join(', ') || 'aucun'}`);
