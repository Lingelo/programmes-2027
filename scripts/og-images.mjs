#!/usr/bin/env node
// Génère les images de partage (Open Graph, 1200×630) et les icônes du site, avec Playwright.
// À lancer en local quand un candidat est ajouté ou que les mesures phares changent :
//   node scripts/og-images.mjs
// (Les pages sans image dédiée utilisent img/og/accueil.png.)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const RACINE = new URL('../', import.meta.url);
const data = JSON.parse(await readFile(new URL('data/candidats.json', RACINE), 'utf8'));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const texteSur = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.36 ? '#121212' : '#fff';
};
const SITE = data.meta.site.replace(/^https?:\/\//, '').replace(/\/$/, '');

const STYLE = `
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Space+Mono:wght@700&display=block" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; font-family: 'Space Grotesk', sans-serif; color: #121212;
    background: #FFD23F radial-gradient(rgba(0,0,0,.13) 2px, transparent 2.2px) 0 0 / 34px 34px; padding: 48px; overflow: hidden; }
  .carte { height: 100%; background: #fff; border: 6px solid #121212; border-radius: 34px; box-shadow: 14px 14px 0 #121212; padding: 40px 48px 30px; display: flex; flex-direction: column; position: relative; overflow: hidden; }
  .bande { position: absolute; left: 0; right: 0; top: 0; height: 26px; border-bottom: 6px solid #121212; }
  .pill { align-self: flex-start; background: #121212; color: #FFD23F; font-family: 'Space Mono', monospace; font-size: 24px; letter-spacing: .12em; text-transform: uppercase; padding: 10px 20px; border-radius: 14px; transform: rotate(-1.5deg); }
  .ligne { display: flex; gap: 36px; align-items: center; margin-top: 22px; }
  .photo { flex: none; width: 180px; height: 180px; border-radius: 50%; border: 6px solid #121212; box-shadow: 7px 7px 0 #121212; background-size: cover; background-position: 50% 20%; display: grid; place-items: center; font-family: 'Space Mono', monospace; font-size: 64px; color: #fff; }
  h1 { font-size: 70px; line-height: .98; letter-spacing: -.03em; }
  h1 small { display: block; font-size: 40px; font-weight: 500; letter-spacing: -.01em; }
  .parti { display: inline-block; margin-top: 16px; font-family: 'Space Mono', monospace; font-size: 24px; text-transform: uppercase; border: 4px solid #121212; border-radius: 12px; padding: 4px 14px; }
  ul { list-style: none; padding: 0; margin-top: 20px; display: grid; gap: 8px; }
  li { font-size: 25px; font-weight: 700; background: #FFF7D6; border: 4px solid #121212; border-radius: 14px; padding: 8px 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pied { margin-top: auto; padding-top: 12px; display: flex; justify-content: space-between; align-items: center; gap: 20px; font-family: 'Space Mono', monospace; font-size: 22px; white-space: nowrap; }
  .rose { background: #FF7EB6; border-radius: 14px; padding: 0 .15em; }
  .noir { background: #121212; color: #FFD23F; border-radius: 14px; padding: 0 .15em; }
</style>`;

// Photo intégrée en data URI (une page chargée par setContent ne peut pas lire file://)
const enDataUri = async (chemin) => {
  const buf = await readFile(new URL(chemin, RACINE));
  return `data:image/${chemin.endsWith('.png') ? 'png' : 'jpeg'};base64,${buf.toString('base64')}`;
};

async function carteCandidat(c) {
  const photo = c.photo ? `background-image:url('${await enDataUri(c.photo)}')` : `background:${c.couleur}`;
  const init = c.photo ? '' : esc(c.prenom[0] + c.nom[0]);
  const phares = (c.phares || []).slice(0, 2);
  return `<!doctype html><html><head><meta charset="utf-8">${STYLE}</head><body>
  <div class="carte"><div class="bande" style="background:${c.couleur}"></div>
    <span class="pill" style="margin-top:14px">Présidentielle 2027 · le programme</span>
    <div class="ligne">
      <div class="photo" style="${photo}">${init}</div>
      <div><h1><small>${esc(c.prenom)}</small>${esc(c.nom)}</h1>
        <span class="parti" style="background:${c.couleur};color:${texteSur(c.couleur)}">${esc(c.parti)}</span></div>
    </div>
    ${phares.length ? `<ul>${phares.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`
      : `<p style="font-size:34px;font-weight:700;margin-top:26px">${c.slogan ? `« ${esc(c.slogan)} »` : 'Programme à venir · fiche, parcours, parrainages'}</p>`}
    <div class="pied"><span>${esc(SITE)}</span><span>Mesures sourcées ✓</span></div>
  </div></body></html>`;
}

const carteAccueil = () => `<!doctype html><html><head><meta charset="utf-8">${STYLE}</head><body>
  <div class="carte">
    <span class="pill">1er tour · 18 avril 2027</span>
    <h1 style="font-size:78px;margin-top:26px;line-height:1.08">Présidentielle 2027&nbsp;: <span class="rose">qui propose quoi</span>&nbsp;? <span class="noir">Comparons.</span></h1>
    <p style="font-size:30px;margin-top:20px">Les programmes de ${data.candidats.length} candidats, thème par thème, avec les sources.</p>
    <div class="pied"><span>${esc(SITE)}</span><span>Retraites · SMIC · Europe…</span></div>
  </div></body></html>`;

const icone = (taille) => `<!doctype html><html><head><meta charset="utf-8">${STYLE}<style>body{width:${taille}px;height:${taille}px;padding:0;background:#FFD23F;display:grid;place-items:center}
  div{width:84%;height:84%;border-radius:50%;background:#121212;color:#FFD23F;display:grid;place-items:center;font-family:'Space Mono',monospace;font-weight:700;font-size:${Math.round(taille * 0.38)}px}</style></head><body><div>27</div></body></html>`;

await mkdir(new URL('img/og/', RACINE), { recursive: true });
const navigateur = await chromium.launch();
const page = await navigateur.newPage({ viewport: { width: 1200, height: 630 } });
const capturer = async (html, chemin, largeur = 1200, hauteur = 630) => {
  await page.setViewportSize({ width: largeur, height: hauteur });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: new URL(chemin, RACINE).pathname, type: 'png' });
};

await capturer(carteAccueil(), 'img/og/accueil.png');
for (const c of data.candidats) await capturer(await carteCandidat(c), `img/og/${c.id}.png`);
for (const t of [180, 192, 512]) await capturer(icone(t), `img/icone-${t}.png`, t, t);
await writeFile(new URL('img/icone.svg', RACINE), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#FFD23F"/><circle cx="50" cy="50" r="42" fill="#121212"/><text x="50" y="64" font-size="40" text-anchor="middle" fill="#FFD23F" font-family="monospace" font-weight="700">27</text></svg>\n`);
await navigateur.close();
console.log(`${data.candidats.length + 1} images de partage et 4 icônes générées.`);
