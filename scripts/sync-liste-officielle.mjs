#!/usr/bin/env node
// Liste officielle des candidats à la présidentielle 2027, arrêtée par le Conseil constitutionnel
// (décision « PDR » publiée vers début-mi-mars 2027, ordre fixé par tirage au sort).
//
// Le numéro de la décision n'est pas connu à l'avance : le script parcourt les décisions PDR
// suivantes sur conseil-constitutionnel.fr (https://www.conseil-constitutionnel.fr/decision/AAAA/AAAANNNPDR.htm)
// et reprend chaque jour là où il s'est arrêté. Il ne tourne que pendant la période utile
// (février à mai 2027), sauf avec --forcer ou --url.
//
// Usage :
//   node scripts/sync-liste-officielle.mjs                      (robot quotidien)
//   node scripts/sync-liste-officielle.mjs --url <décision> --sortie <fichier>   (test, ex. décision 2022-187)
//   node scripts/sync-liste-officielle.mjs --forcer --annees 2022 --depuis 183 --sortie <fichier>   (test de la recherche)

import { readFile, writeFile } from 'node:fs/promises';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, t) => (a.startsWith('--') ? [...acc, [a.slice(2), t[i + 1]?.startsWith('--') || t[i + 1] === undefined ? true : t[i + 1]]] : acc), []));
const DATA = new URL('../data/candidats.json', import.meta.url);
const SORTIE = args.sortie ? new URL(args.sortie, `file://${process.cwd()}/`) : new URL('../data/liste-officielle.json', import.meta.url);
const UA = 'Mozilla/5.0 (compatible; programmes-2027/1.0; +https://github.com/lingelo/programmes-2027)';
const PERIODE = { debut: '2027-02-01', fin: '2027-05-31' };
const DERNIERE_PDR_CONNUE = 199; // décision n° 2023-199 PDR, la dernière avant la campagne 2027
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
const aujourdhui = new Date().toISOString().slice(0, 10);

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', eacute: 'é', egrave: 'è', Eacute: 'É' };
const texteBrut = (html) => html
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '')
  .replace(/<sup>\s*er\s*<\/sup>/g, 'er')
  .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITES[n] ?? m)
  .replace(/[ \t ]+/g, ' ');

async function telecharger(url) {
  for (let essai = 1; essai <= 3; essai++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (r.status === 404) return null;
      if (r.ok) {
        const txt = await r.text();
        return /Page non trouvée/.test(txt.slice(0, 3000)) ? null : txt;
      }
    } catch { /* réseau */ }
    await pause(1500 * essai);
  }
  return undefined; // indéterminé (erreur réseau)
}

// « Mme Marine LE PEN » -> { civilite, prenom: 'Marine', nom: 'LE PEN' }
function decouperNom(ligne) {
  const m = ligne.match(/^(Mme|M\.)\s+(.+)$/);
  if (!m) return null;
  const mots = m[2].trim().split(/\s+/);
  const majuscule = (w) => w === w.toLocaleUpperCase('fr') && /\p{Lu}/u.test(w);
  const i = mots.findIndex(majuscule);
  if (i <= 0) return null;
  return { civilite: m[1], prenom: mots.slice(0, i).join(' '), nom: mots.slice(i).join(' ') };
}

// Extrait la liste d'une décision « arrêtant la liste des candidats », sinon null
function lireDecision(html) {
  const txt = texteBrut(html);
  const debut = txt.search(/liste des candidats[^\n]*arrêtée comme suit\s*:/i);
  if (debut < 0) return null;
  const apres = txt.slice(debut).split(/\n/).slice(1);
  const lignes = [];
  for (const brute of apres) {
    const l = brute.trim().replace(/[,;.]$/, '').trim();
    if (!l) continue;
    if (/^Article\s+2/i.test(l)) break;
    const p = decouperNom(l);
    if (p) lignes.push(p); else if (lignes.length) break;
  }
  if (!lignes.length) return null;
  const titre = (html.match(/<h1 class="title">([^<]+)/) || [])[1]?.trim() || null;
  const date = (txt.match(/Rendu public le (\d{1,2})(?:er)? (\p{L}+) (\d{4})/u) || []);
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const iso = date.length ? `${date[3]}-${String(MOIS.indexOf(date[2].toLowerCase()) + 1).padStart(2, '0')}-${date[1].padStart(2, '0')}` : null;
  return { titre, date: iso, candidats: lignes };
}

// ---------- Recherche de la décision ----------
const data = JSON.parse(await readFile(DATA, 'utf8'));
const precedent = JSON.parse(await readFile(SORTIE, 'utf8').catch(() => 'null'));
const etat = precedent || { statut: 'attendue', dernierNumeroTeste: DERNIERE_PDR_CONNUE };

if (etat.statut === 'publiee' && !args.url && !args.forcer) {
  console.log(`Liste officielle déjà publiée (${etat.decision}).`);
  process.exit(0);
}
if (!args.url && !args.forcer && (aujourdhui < PERIODE.debut || aujourdhui > PERIODE.fin)) {
  await writeFile(SORTIE, JSON.stringify({ ...etat, statut: 'attendue', verifieLe: aujourdhui, periode: PERIODE }, null, 2) + '\n');
  console.log(`Hors période (${PERIODE.debut} → ${PERIODE.fin}) : rien à chercher.`);
  process.exit(0);
}

let trouvee = null;
let dernierTeste = args.depuis ? Number(args.depuis) : (etat.dernierNumeroTeste || DERNIERE_PDR_CONNUE);
const ANNEES = args.annees ? String(args.annees).split(',').map(Number) : [2027, 2026]; // --annees sert aux tests
if (args.url) {
  const html = await telecharger(args.url);
  const d = html && lireDecision(html);
  if (d) trouvee = { ...d, url: args.url };
} else {
  // On teste les numéros suivants, pour les années 2026 et 2027, et on s'arrête après
  // plusieurs numéros consécutifs inexistants.
  let manquants = 0;
  for (let n = dernierTeste + 1; n <= dernierTeste + 60 && manquants < 8 && !trouvee; n++) {
    let existe = false;
    for (const annee of ANNEES) {
      const url = `https://www.conseil-constitutionnel.fr/decision/${annee}/${annee}${n}PDR.htm`;
      const html = await telecharger(url);
      if (html === undefined) { console.warn(`Réseau indisponible pour ${url}`); manquants = 99; break; }
      if (html === null) continue;
      existe = true;
      const d = lireDecision(html);
      if (d) trouvee = { ...d, url };
      break;
    }
    if (existe) { manquants = 0; if (!trouvee) dernierTeste = n; } else manquants++;
    await pause(400);
  }
}

// Garde-fou : uniquement la liste de l'élection 2027 (sauf test explicite avec --url / --annees)
if (trouvee && !args.url && !args.annees && (!trouvee.date || trouvee.date < '2027-01-01')) {
  console.log(`Décision ignorée (datée du ${trouvee.date || '?'}, antérieure à 2027) : ${trouvee.url}`);
  trouvee = null;
}

if (!trouvee) {
  await writeFile(SORTIE, JSON.stringify({ ...etat, statut: 'attendue', verifieLe: aujourdhui, dernierNumeroTeste: dernierTeste, periode: PERIODE }, null, 2) + '\n');
  console.log(`Liste officielle pas encore publiée (dernière décision PDR existante testée : n° ${dernierTeste}).`);
  process.exit(0);
}

// ---------- Rattachement aux fiches du site ----------
const index = data.candidats.map((c) => ({ id: c.id, cle: norm(`${c.prenom} ${c.nom}`) }));
const rattacher = (p) => {
  const cle = norm(`${p.prenom} ${p.nom}`);
  return index.find((x) => x.cle === cle)?.id ?? index.find((x) => x.cle.endsWith(norm(p.nom)) && x.cle.startsWith(norm(p.prenom).split(' ')[0]))?.id ?? null;
};
const candidats = trouvee.candidats.map((p, i) => ({ ordre: i + 1, ...p, id: rattacher(p) }));
const sortie = {
  statut: 'publiee',
  decision: trouvee.titre,
  date: trouvee.date,
  url: trouvee.url,
  verifieLe: aujourdhui,
  candidats,
  nonRattaches: candidats.filter((c) => !c.id).map((c) => `${c.prenom} ${c.nom}`),
};
await writeFile(SORTIE, JSON.stringify(sortie, null, 2) + '\n');
console.log(`Liste officielle trouvée : ${trouvee.titre} — ${candidats.length} candidats (${sortie.nonRattaches.length} sans fiche sur le site${sortie.nonRattaches.length ? ' : ' + sortie.nonRattaches.join(', ') : ''}).`);
