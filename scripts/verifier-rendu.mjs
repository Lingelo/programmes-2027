#!/usr/bin/env node
// Contrôle automatique du rendu, dans un vrai navigateur (Playwright / Chromium).
// Mesure la position réelle des éléments et signale :
//  - les pages qui ne s'affichent pas (erreur JavaScript, rendu jamais terminé) ;
//  - les débordements horizontaux (page plus large que l'écran) ;
//  - les chevauchements dans la boussole (nom sur un autre nom ou sur un point, nom coupé) ;
//  - les éléments qui sortent de l'écran ou dont le texte est tronqué ;
//  - les pastilles de position qui passent sur deux lignes.
//
// Usage :
//   node scripts/verifier-rendu.mjs            (toutes les fiches, un duel sur six, pages principales, 4 largeurs)
//   node scripts/verifier-rendu.mjs --rapide   (pages principales seulement, 2 largeurs)
// Prérequis : avoir généré le site (node scripts/build-site.mjs). Code de sortie 1 si un problème est trouvé.

import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('../', import.meta.url));
const rapide = process.argv.includes('--rapide');
const data = JSON.parse(await readFile(join(RACINE, 'data/candidats.json'), 'utf8'));
const BASE = new URL(data.meta.site).pathname; // ex. /programmes-2027/

// Playwright : dépendance du projet si installée, sinon installation globale de la machine
async function chargerPlaywright() {
  try { return await import('playwright'); } catch { /* repli */ }
  const req = createRequire(import.meta.url);
  for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { return req(p); } catch { /* suivant */ } }
  console.error('Playwright introuvable : npm install --no-save playwright');
  process.exit(2);
}

// Petit serveur statique qui sert le dépôt sous le chemin de base du site (comme GitHub Pages)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json' };
const serveur = createServer(async (req, res) => {
  const chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!chemin.startsWith(BASE)) { res.writeHead(404).end(); return; }
  let rel = normalize(chemin.slice(BASE.length)).replace(/^(\.\.[/\\])+/, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  try {
    const contenu = await readFile(join(RACINE, rel));
    res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] || 'application/octet-stream' }).end(contenu);
  } catch {
    const p404 = await readFile(join(RACINE, '404.html')).catch(() => '');
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }).end(p404);
  }
});
await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
const ORIGINE = `http://127.0.0.1:${serveur.address().port}${BASE}`;

const principales = ['', 'candidats/', 'themes/', 'theme/travail/', 'signatures/', 'methodo/', 'comparer/', 'comparer/?c=zemmour,polony,becht,egger'];
let pages = principales;
if (!rapide) {
  const duels = (await readdir(join(RACINE, 'comparer')).catch(() => [])).filter((d) => d.includes('-vs-')).filter((_, i) => i % 6 === 0);
  pages = [...principales, ...data.candidats.map((c) => `candidat/${c.id}/`), ...duels.map((d) => `comparer/${d}/`)];
}
const largeurs = rapide ? [390, 1280] : [360, 390, 768, 1280];

const { chromium } = await chargerPlaywright();
const navigateur = await chromium.launch();
const problemes = [];
for (const w of largeurs) {
  const page = await navigateur.newPage({ viewport: { width: w, height: 900 } });
  await page.addInitScript(() => { try { localStorage.clear(); } catch { /* ignore */ } });
  let erreursJs = [];
  page.on('pageerror', (e) => erreursJs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erreursJs.push(m.text()); });
  for (const u of pages) {
    erreursJs = [];
    await page.goto(ORIGINE + u, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.rendu, null, { timeout: 5000 }).catch(() => erreursJs.push('rendu jamais terminé'));
    const trouves = await page.evaluate(() => {
      const out = [];
      const inter = (a, b, marge = 0.5) => a.left < b.right - marge && b.left < a.right - marge && a.top < b.bottom - marge && b.top < a.bottom - marge;
      if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page plus large que l'écran (${document.documentElement.scrollWidth}px)`);
      document.querySelectorAll('svg.boussole').forEach((svg, k) => {
        const textes = [...svg.querySelectorAll('text')].map((t) => ({ t: t.textContent, r: t.getBoundingClientRect() }));
        const points = [...svg.querySelectorAll('.bp__point')].map((c) => c.getBoundingClientRect());
        for (let i = 0; i < textes.length; i++) for (let j = i + 1; j < textes.length; j++)
          if (inter(textes[i].r, textes[j].r)) out.push(`boussole ${k} : « ${textes[i].t} » chevauche « ${textes[j].t} »`);
        textes.forEach(({ t, r }) => points.forEach((pt) => { if (inter(r, pt, 1)) out.push(`boussole ${k} : « ${t} » sur un point`); }));
        const vb = svg.getBoundingClientRect();
        textes.forEach(({ t, r }) => { if (r.left < vb.left - 1 || r.right > vb.right + 1) out.push(`boussole ${k} : « ${t} » coupé au bord`); });
      });
      const defile = (el) => { for (let e = el.parentElement; e; e = e.parentElement) if (/(auto|scroll)/.test(getComputedStyle(e).overflowX)) return true; return false; };
      document.querySelectorAll('.niveau, .tag, .parti, .btn, .pill, .cand, .carte, .proche, .duel, .etape, h1, h2').forEach((el) => {
        if (defile(el)) return;
        const r = el.getBoundingClientRect(); if (!r.width) return;
        if (r.right > innerWidth + 1 || r.left < -1) out.push(`${el.className || el.tagName} dépasse l'écran : « ${el.textContent.trim().slice(0, 40)} »`);
        if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible') out.push(`${el.className} texte tronqué : « ${el.textContent.trim().slice(0, 40)} »`);
      });
      document.querySelectorAll('.niveau').forEach((el) => { if (el.getBoundingClientRect().height > 26) out.push(`pastille sur 2 lignes : « ${el.textContent} »`); });
      return out;
    });
    for (const x of [...new Set([...erreursJs.map((e) => `erreur JS : ${e}`), ...trouves])]) problemes.push(`${String(w).padEnd(5)} /${u.padEnd(44)} ${x}`);
  }
  await page.close();
}
await navigateur.close();
serveur.close();

console.log(`${pages.length} pages × ${largeurs.length} largeurs (${largeurs.join(', ')} px) contrôlées.`);
if (problemes.length) {
  console.log(`${problemes.length} problème(s) :\n${problemes.join('\n')}`);
  process.exit(1);
}
console.log('Aucun chevauchement, débordement ni erreur JavaScript.');
