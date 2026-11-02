#!/usr/bin/env node
// Génère le site statique (une vraie page HTML par contenu) pour le référencement :
//  - exécute js/app.js dans un DOM simulé (jsdom) pour chaque adresse, comme un navigateur ;
//  - ajoute titre, description, adresse canonique, Open Graph, Twitter et données structurées ;
//  - écrit index.html, candidat/<id>/, theme/<id>/, comparer/<a>-vs-<b>/, sitemap.xml, robots.txt…
// Le navigateur réexécute ensuite app.js pour rendre la page interactive avec les données à jour.
//
// Usage : node scripts/build-site.mjs

import { readFile, writeFile, mkdir, access, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { JSDOM, VirtualConsole } from 'jsdom';

const RACINE = new URL('../', import.meta.url);
const fichier = (p) => new URL(p, RACINE);
const lire = (p) => readFile(fichier(p), 'utf8');
const existe = (p) => access(fichier(p)).then(() => true, () => false);

const data = JSON.parse(await lire('data/candidats.json'));
const parrainages = JSON.parse(await lire('data/parrainages.json').catch(() => 'null'));
const SITE = (data.meta.site || 'https://lingelo.github.io/programmes-2027/').replace(/\/?$/, '/');
const BASE = new URL(SITE).pathname;
const absolu = (chemin = '') => SITE + chemin.replace(/^\//, '');
const gabarit = await lire('templates/page.html');
const code = await lire('js/app.js');
const VERSION = createHash('sha1').update(code + await lire('css/style.css')).digest('hex').slice(0, 8);
const aujourdhui = new Date().toISOString().slice(0, 10);

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const couper = (s, n) => (s.length <= n ? s : s.slice(0, s.lastIndexOf(' ', n - 1)).replace(/[,;:.\s]+$/, '') + '…');
const nbProps = (c) => Object.values(c.propositions || {}).reduce((n, l) => n + l.length, 0);
const bordDe = (c) => data.bords.find((b) => b.id === c.bord);
const ordre = (c) => data.bords.findIndex((b) => b.id === c.bord) * 1000 + data.candidats.indexOf(c);
const tries = [...data.candidats].sort((a, b) => ordre(a) - ordre(b));
const principaux = tries.filter((c) => nbProps(c) >= 3);
const nomComplet = (c) => `${c.prenom} ${c.nom}`;

// ---------- Description des pages ----------
const SITE_NOM = 'Programmes 2027';
const pages = [];
const ajouter = (p) => pages.push(p);

const fil = (...etapes) => ({
  '@type': 'BreadcrumbList',
  itemListElement: [{ name: 'Accueil', chemin: '' }, ...etapes].map((e, i) => ({ '@type': 'ListItem', position: i + 1, name: e.name, item: absolu(e.chemin) })),
});

const election = {
  '@type': 'Event',
  name: 'Élection présidentielle française de 2027 — premier tour',
  startDate: data.meta.election.tour1,
  eventStatus: 'https://schema.org/EventScheduled',
  eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
  location: { '@type': 'Country', name: 'France' },
  organizer: { '@type': 'GovernmentOrganization', name: 'République française', url: 'https://www.service-public.gouv.fr' },
};

ajouter({
  chemin: '',
  titre: 'Programmes présidentielle 2027 : le comparatif des candidats',
  description: `Comparez les programmes des ${data.candidats.length} candidats à l'élection présidentielle 2027 : retraites, SMIC, impôts, nucléaire, immigration, Europe. Mesures sourcées, mises à jour chaque semaine.`,
  priorite: '1.0', frequence: 'daily',
  jsonld: [election, {
    '@type': 'ItemList', name: 'Candidats à l\'élection présidentielle 2027',
    itemListElement: tries.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: nomComplet(c), url: absolu(`candidat/${c.id}/`) })),
  }],
});

for (const c of data.candidats) {
  const b = c.biographie || {};
  const phares = (c.phares || []).join(' ; ');
  const n = nbProps(c);
  ajouter({
    chemin: `candidat/${c.id}/`,
    titre: `${nomComplet(c)} : programme présidentielle 2027 (${c.partiCourt})`,
    description: couper(n
      ? `Programme 2027 de ${nomComplet(c)} (${c.parti}) : ${phares || 'les mesures'}. ${n} mesures sourcées, comparaison avec les autres candidats, parcours et parrainages.`
      : `${nomComplet(c)}, candidat${c.statut.endsWith('e') ? 'e' : ''} ${c.parti} à la présidentielle 2027${c.slogan ? ` (« ${c.slogan} »)` : ''} : programme, parcours, parrainages.`, 158),
    image: (await existe(`img/og/${c.id}.png`)) ? `img/og/${c.id}.png` : null,
    type: 'profile',
    priorite: n ? '0.9' : '0.6', frequence: 'weekly',
    jsonld: [
      {
        '@type': 'ProfilePage',
        dateModified: data.meta.contenuMisAJour,
        mainEntity: {
          '@type': 'Person',
          name: nomComplet(c), givenName: c.prenom, familyName: c.nom,
          description: c.bio,
          ...(c.photo ? { image: absolu(c.photo) } : {}),
          ...(b.naissance ? { birthDate: b.naissance } : {}),
          ...(b.lieuNaissance ? { birthPlace: { '@type': 'Place', name: b.lieuNaissance } } : {}),
          affiliation: { '@type': 'Organization', name: c.parti },
          sameAs: [b.wikipedia, b.wikidata && `https://www.wikidata.org/wiki/${b.wikidata}`, c.site].filter(Boolean),
        },
      },
      fil({ name: 'Candidats', chemin: '' }, { name: nomComplet(c), chemin: `candidat/${c.id}/` }),
    ],
  });
}

ajouter({
  chemin: 'themes/',
  titre: 'Les programmes 2027 thème par thème | Programmes 2027',
  description: 'Retraites, salaires, impôts, écologie, immigration, sécurité, santé, éducation, Europe, institutions : ce que proposent tous les candidats à la présidentielle 2027, thème par thème.',
  priorite: '0.8', frequence: 'weekly',
  jsonld: [fil({ name: 'Thèmes', chemin: 'themes/' })],
});

for (const t of data.themes) {
  const qui = tries.filter((c) => c.propositions?.[t.id]?.length);
  ajouter({
    chemin: `theme/${t.id}/`,
    titre: `${t.label} : que proposent les candidats à la présidentielle 2027 ?`,
    description: couper(`${t.label} : les propositions des candidats à la présidentielle 2027${qui.length ? ` (${qui.slice(0, 6).map((c) => c.nom).join(', ')}${qui.length > 6 ? '…' : ''})` : ''}, classées de la gauche vers la droite, avec leurs sources.`, 158),
    priorite: '0.8', frequence: 'weekly',
    jsonld: [fil({ name: 'Thèmes', chemin: 'themes/' }, { name: t.label, chemin: `theme/${t.id}/` })],
  });
}

ajouter({
  chemin: 'comparer/',
  titre: 'Comparateur des programmes 2027 : jusqu\'à 4 candidats face à face',
  description: 'Choisissez de 2 à 4 candidats à la présidentielle 2027 et comparez leurs programmes : retraite, SMIC, impôts, nucléaire, immigration, Europe, thème par thème.',
  priorite: '0.8', frequence: 'weekly',
  jsonld: [fil({ name: 'Comparateur', chemin: 'comparer/' })],
});

for (let i = 0; i < principaux.length; i++) {
  for (let j = i + 1; j < principaux.length; j++) {
    const [a, b] = [principaux[i], principaux[j]];
    ajouter({
      chemin: `comparer/${a.id}-vs-${b.id}/`,
      titre: `${a.nom} ou ${b.nom} : comparatif des programmes 2027`,
      description: couper(`${nomComplet(a)} (${a.partiCourt}) ou ${nomComplet(b)} (${b.partiCourt}) : retraite, SMIC, impôts, nucléaire, immigration, Europe. Les programmes pour la présidentielle 2027 face à face, avec les sources.`, 158),
      priorite: '0.7', frequence: 'weekly',
      jsonld: [fil({ name: 'Comparateur', chemin: 'comparer/' }, { name: `${a.nom} ou ${b.nom}`, chemin: `comparer/${a.id}-vs-${b.id}/` })],
    });
  }
}

const reglesP = parrainages?.regles || { seuil: 500, minDepartements: 30, maxParDepartement: 50 };
ajouter({
  chemin: 'signatures/',
  titre: 'Parrainages présidentielle 2027 : le compteur des 500 signatures',
  description: 'Combien de parrainages pour chaque candidat à la présidentielle 2027 ? Compteur mis à jour automatiquement à partir des publications du Conseil constitutionnel, règles et calendrier.',
  priorite: '0.8', frequence: 'daily',
  jsonld: [
    {
      '@type': 'FAQPage',
      mainEntity: [
        ['Combien de parrainages faut-il pour être candidat à la présidentielle 2027 ?', `Il faut au moins ${reglesP.seuil} parrainages d'élus (maires, parlementaires, conseillers départementaux et régionaux…), venant d'au moins ${reglesP.minDepartements} départements ou collectivités d'outre-mer, sans que plus d'un dixième (${reglesP.maxParDepartement}) ne provienne du même département.`],
        ['Quand a lieu la collecte des parrainages pour 2027 ?', `La collecte s'ouvre à la publication du décret de convocation des électeurs (au plus tard début février 2027) et se termine au plus tard le 12 mars 2027.`],
        ['Qui publie les parrainages ?', 'Le Conseil constitutionnel publie les parrainages validés au moins deux fois par semaine pendant la collecte.'],
      ].map(([q, r]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: r } })),
    },
    fil({ name: 'Signatures', chemin: 'signatures/' }),
  ],
});

ajouter({
  chemin: 'methodo/',
  titre: 'Méthodologie et sources | Programmes 2027',
  description: 'Comment sont choisies et vérifiées les mesures du comparatif des programmes 2027 : sources datées de la campagne, neutralité, mises à jour automatiques.',
  priorite: '0.4', frequence: 'monthly',
  jsonld: [fil({ name: 'Méthodo', chemin: 'methodo/' })],
});

// ---------- En-tête <head> d'une page ----------
const siteJsonld = { '@type': 'WebSite', name: SITE_NOM, url: SITE, inLanguage: 'fr-FR', description: 'Comparatif non partisan des programmes de l\'élection présidentielle 2027.' };

function head(p) {
  const url = absolu(p.chemin);
  const image = absolu(p.image || 'img/og/accueil.png');
  const ld = { '@context': 'https://schema.org', '@graph': [siteJsonld, ...(p.jsonld || [])] };
  return [
    `  <title>${esc(p.titre)}</title>`,
    `  <meta name="description" content="${esc(p.description)}">`,
    `  <link rel="canonical" href="${url}">`,
    `  <meta name="robots" content="${p.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1'}">`,
    `  <meta property="og:site_name" content="${SITE_NOM}">`,
    `  <meta property="og:locale" content="fr_FR">`,
    `  <meta property="og:type" content="${p.type || 'website'}">`,
    `  <meta property="og:title" content="${esc(p.titre)}">`,
    `  <meta property="og:description" content="${esc(p.description)}">`,
    `  <meta property="og:url" content="${url}">`,
    `  <meta property="og:image" content="${image}">`,
    `  <meta property="og:image:width" content="1200">`,
    `  <meta property="og:image:height" content="630">`,
    `  <meta name="twitter:card" content="summary_large_image">`,
    `  <meta name="twitter:title" content="${esc(p.titre)}">`,
    `  <meta name="twitter:description" content="${esc(p.description)}">`,
    `  <meta name="twitter:image" content="${image}">`,
    `  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`,
  ].join('\n');
}

const footerLiens = `    <h2>Les candidats</h2>
    <ul class="footer-liens">${tries.map((c) => `<li><a href="${BASE}candidat/${c.id}/">${esc(nomComplet(c))}</a></li>`).join('')}</ul>
    <h2>Les thèmes</h2>
    <ul class="footer-liens">${data.themes.map((t) => `<li><a href="${BASE}theme/${t.id}/">${esc(t.label)}</a></li>`).join('')}</ul>`;

const remplir = (p) => gabarit
  .replaceAll('{{BASE}}', BASE)
  .replaceAll('{{VERSION}}', VERSION)
  .replace('{{HEAD}}', head(p))
  .replace('{{FOOTER_LIENS}}', footerLiens);

// ---------- Rendu d'une page dans un DOM simulé ----------
async function rendre(p) {
  const html = remplir(p);
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => console.warn(`  [${p.chemin || '/'}] ${e.message}`));
  const dom = new JSDOM(html, { url: absolu(p.chemin), runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const w = dom.window;
  w.scrollTo = () => {};
  w.fetch = async (u) => {
    const url = new URL(u, w.location.href);
    if (url.origin !== new URL(SITE).origin || !url.pathname.startsWith(BASE)) return { ok: false, status: 404, json: async () => null };
    try {
      const txt = await lire(url.pathname.slice(BASE.length));
      return { ok: true, status: 200, json: async () => JSON.parse(txt), text: async () => txt };
    } catch { return { ok: false, status: 404, json: async () => null }; }
  };
  w.eval(code);
  for (let i = 0; i < 200 && !w.document.documentElement.dataset.rendu; i++) await new Promise((r) => setTimeout(r, 10));
  if (!w.document.documentElement.dataset.rendu) throw new Error(`rendu impossible pour /${p.chemin}`);
  const doc = w.document;
  delete doc.documentElement.dataset.rendu;
  doc.querySelectorAll('[data-ok]').forEach((e) => e.removeAttribute('data-ok'));
  const sortie = '<!doctype html>\n' + doc.documentElement.outerHTML + '\n';
  w.close();
  return sortie;
}

// ---------- Écriture ----------
// Nettoyage des anciennes pages générées (candidats ou duels disparus)
for (const dossier of ['candidat', 'theme', 'comparer']) await rm(fichier(dossier), { recursive: true, force: true });

for (const p of pages) {
  const html = await rendre(p);
  const dest = p.chemin ? `${p.chemin}index.html` : 'index.html';
  await mkdir(new URL('.', fichier(dest)), { recursive: true });
  await writeFile(fichier(dest), html);
}

// Page 404 (GitHub Pages la sert pour toute adresse inconnue)
await writeFile(fichier('404.html'), await rendre({ chemin: '404/', titre: 'Page introuvable | Programmes 2027', description: 'Cette page n\'existe pas.', noindex: true }));

// Plan du site
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${absolu(p.chemin)}</loc><lastmod>${p.chemin.startsWith('signatures') ? (parrainages?.verifieLe || aujourdhui) : data.meta.contenuMisAJour}</lastmod><changefreq>${p.frequence}</changefreq><priority>${p.priorite}</priority></url>`).join('\n')}
</urlset>
`;
await writeFile(fichier('sitemap.xml'), sitemap);
await writeFile(fichier('robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${absolu('sitemap.xml')}\n`);
await writeFile(fichier('manifest.webmanifest'), JSON.stringify({
  name: 'Programmes 2027 — le comparatif', short_name: 'Programmes 2027', lang: 'fr',
  start_url: BASE, scope: BASE, display: 'standalone', background_color: '#FFD23F', theme_color: '#FFD23F',
  icons: [{ src: `${BASE}img/icone-192.png`, sizes: '192x192', type: 'image/png' }, { src: `${BASE}img/icone-512.png`, sizes: '512x512', type: 'image/png' }],
}, null, 2) + '\n');

console.log(`${pages.length} pages générées (dont ${principaux.length * (principaux.length - 1) / 2} duels), sitemap.xml, robots.txt, 404.html.`);
