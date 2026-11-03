#!/usr/bin/env node
// Synchronisation quotidienne avec Wikipédia (aucune dépendance, Node 20+).
//  1. Télécharge la photo des candidats qui n'en ont pas encore (Wikimedia Commons) dans img/candidats/
//  2. Met à jour les biographies (intro Wikipédia + faits Wikidata).
//  3. Veille : lit la page Wikipédia « Candidatures à l'élection présidentielle française de 2027 »
//     et la liste de France-Vote, et repère les candidats déclarés absents de data/candidats.json
//     -> data/veille.json (affiché sur le site).
// Ce script ne modifie jamais les programmes : il ne fait que signaler.

import { readFile, writeFile, access } from 'node:fs/promises';
import { construireBio } from './lib-bio.mjs';
import { lireFranceVote, URL_FRANCE_VOTE } from './veille-francevote.mjs';

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
    const r = await get(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${q}&gsrlimit=10&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=330&format=json`);
    const pages = Object.values(r?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    const exclus = (c.photoExclus || []).map(norm);
    // Une photo de portrait : nom exact dans le titre, JPEG/PNG, format portrait ou carré
    // (écarte bannières et visuels de campagne au format paysage), fichier non exclu.
    const choix = pages.find((pg) => {
      const ii = pg.imageinfo?.[0] || {};
      return norm(pg.title).includes(norm(nom))
        && /image\/(jpeg|png)/.test(ii.mime || '')
        && ii.width && ii.height / ii.width >= 0.8
        && !exclus.includes(norm(pg.title));
    });
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
// 3 a. Wikipédia
try {
  const html = await get(`https://fr.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(PAGE)}`, 'text');
  // Section(s) dont le titre parle de candidats déclarés / désignés
  const sections = html.split(/<h[23][^>]*>/i).slice(1);
  const cibles = sections.filter((s) => /candidat(e|ure)?s?\s+(d[ée]clar|d[ée]sign|officiel)/i.test(s.slice(0, 300).replace(/<[^>]+>/g, '')));
  const noms = new Map(); // texte du lien -> titre de l'article
  for (const sec of cibles) {
    for (const ligne of sec.split(/<tr[\s>]/i).slice(1)) {
      // Liens internes de la ligne dont le texte ressemble à « Prénom Nom »
      const liens = [...ligne.matchAll(/<a([^>]+rel="mw:WikiLink"[^>]*)>([^<]{3,60})<\/a>/g)].map((m) => ({
        texte: m[2].trim(),
        titre: decodeURIComponent((m[1].match(/href="\.\/([^"#?]+)/) || [])[1] || ''),
      }));
      const personne = liens.find((l) => l.titre && /^\p{Lu}[\p{L}'-]+(\s+(de |du |le |la )?\p{Lu}[\p{L}'-]+){1,3}$/u.test(l.texte));
      if (personne) noms.set(personne.texte, personne.titre);
    }
  }
  sourceOk = noms.size > 0;
  // Garde-fou : un nom n'est signalé que si Wikidata confirme qu'il s'agit d'une personne (Q5),
  // pour écarter les lieux ou organisations présents dans le tableau (ex. « Grand Chalon »).
  for (const [texte, titre] of noms) {
    if (estConnu(texte)) continue;
    const j = await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&sites=frwiki&titles=${encodeURIComponent(titre)}&props=claims&format=json`).catch(() => null);
    const ent = Object.values(j?.entities || {})[0];
    const humain = (ent?.claims?.P31 || []).some((cl) => cl.mainsnak?.datavalue?.value?.id === 'Q5');
    if (humain) nouveaux.push(texte);
    await pause(300);
  }
  nouveaux.sort();
} catch (e) {
  console.warn(`Veille : ${e.message}`);
}

const ancienne = JSON.parse(await readFile(VEILLE, 'utf8').catch(() => '{}'));
const anciensDetails = ancienne.details || (ancienne.nouveaux || []).map((nom) => ({ nom, sources: ['Wikipédia'] }));
const reprendre = (source) => anciensDetails.filter((d) => d.sources.includes(source)).map((d) => d.nom);

// 3 b. France-Vote
let nouveauxFV = [];
let fvOk = false;
try {
  const r = await fetch(URL_FRANCE_VOTE, { headers: { 'User-Agent': UA } });
  if (r.ok) {
    const declares = lireFranceVote(await r.text());
    fvOk = declares.length >= 10; // garde-fou : page vide ou structure changée
    if (fvOk) nouveauxFV = declares.filter((d) => !estConnu(d.nom)).map((d) => d.nom);
    else console.warn(`France-Vote : seulement ${declares.length} candidats lus, structure de la page peut-être modifiée.`);
  } else console.warn(`France-Vote : HTTP ${r.status}`);
} catch (e) {
  console.warn(`France-Vote : ${e.message}`);
}

// Fusion des deux sources (si une source est indisponible, on garde ses derniers résultats)
const parNom = new Map();
const noter = (nom, source) => {
  const cle = norm(nom);
  const d = parNom.get(cle) || { nom, sources: [] };
  if (!d.sources.includes(source)) d.sources.push(source);
  parNom.set(cle, d);
};
for (const n of sourceOk ? nouveaux : reprendre('Wikipédia')) noter(n, 'Wikipédia');
for (const n of fvOk ? nouveauxFV : reprendre('France-Vote')) noter(n, 'France-Vote');
const details = [...parNom.values()].filter((d) => !estConnu(d.nom)).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

const veille = {
  checkedAt: new Date().toISOString().slice(0, 10),
  sources: {
    wikipedia: { url: `https://fr.wikipedia.org/wiki/${PAGE}`, ok: sourceOk },
    francevote: { url: URL_FRANCE_VOTE, ok: fvOk },
  },
  sourceOk: sourceOk || fvOk,
  nouveaux: details.map((d) => d.nom),
  details,
};

await writeFile(VEILLE, JSON.stringify(veille, null, 2) + '\n');
if (photosChangees || biosChangees) await writeFile(DATA, JSON.stringify(data, null, 2) + '\n');

console.log(`Photos mises à jour : ${photosChangees}`);
console.log(`Biographies mises à jour : ${biosChangees}`);
console.log(`Page Wikipédia lue : ${sourceOk ? 'oui' : 'non'} · France-Vote lu : ${fvOk ? 'oui' : 'non'}`);
console.log(`Nouveaux noms : ${veille.nouveaux.join(', ') || 'aucun'}`);
