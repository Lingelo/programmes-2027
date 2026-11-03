// Programmes 2027 — application (vanilla JS, routeur par hash, mobile first)

const app = document.getElementById('app');
// Chemin de base du site (ex. « /programmes-2027/ »), défini dans <meta name="site-base">
const BASE = document.querySelector('meta[name="site-base"]')?.content || '/';
const lien = (chemin = '') => BASE + chemin;
const URLS = {
  accueil: () => lien(''),
  candidat: (id) => lien(`candidat/${id}/`),
  themes: () => lien('themes/'),
  theme: (id) => lien(`theme/${id}/`),
  comparer: (ids = []) => lien('comparer/') + (ids.length ? `?c=${ids.join(',')}` : ''),
  duel: (a, b) => lien(`comparer/${a}-vs-${b}/`),
  signatures: () => lien('signatures/'),
  methodo: () => lien('methodo/'),
  candidats: () => lien('candidats/'),
};
const MAX_COMPARE = 4;

const state = {
  data: null,
  veille: null,
  parrainages: null,
  listeOfficielle: null,
  fv: null,
  complements: null,
  filtreBord: null,
  recherche: '',
  avecProgramme: false,
  compare: lireCompare(),
  themeCompare: null,
};

// ---------- Utilitaires ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plur = (n, s, p = s + 's') => `${n} ${n > 1 ? p : s}`;

function couleurTexte(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.36 ? '#121212' : '#ffffff';
}
const styleCouleur = (c) => `--c:${c.couleur};--ct:${couleurTexte(c.couleur)}`;

function dateFr(iso, opts = { day: 'numeric', month: 'long', year: 'numeric' }) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', opts);
}
function age(iso) {
  if (!iso || iso.length < 10) return null;
  const n = new Date(iso + 'T12:00:00'), a = new Date();
  return a.getFullYear() - n.getFullYear() - (a < new Date(a.getFullYear(), n.getMonth(), n.getDate()) ? 1 : 0);
}
const annee = (iso) => (iso ? iso.slice(0, 4) : '');
function periode(f) {
  if (f.debut && !f.fin) return `${annee(f.debut)} –`; // date de fin parfois absente de Wikidata : on ne présume pas « en cours »
  if (f.debut && f.fin) return annee(f.debut) === annee(f.fin) ? annee(f.debut) : `${annee(f.debut)} – ${annee(f.fin)}`;
  if (f.fin) return `jusqu'en ${annee(f.fin)}`;
  return '';
}
function joursAvant(iso) {
  const d = new Date(iso + 'T08:00:00+02:00');
  return Math.max(0, Math.ceil((d - Date.now()) / 86400000));
}

function lireCompare() {
  try { return JSON.parse(localStorage.getItem('compare') || '[]').slice(0, MAX_COMPARE); } catch { return []; }
}
function ecrireCompare() {
  try { localStorage.setItem('compare', JSON.stringify(state.compare)); } catch { /* navigation privée */ }
  majTray();
}
function basculerCompare(id) {
  const i = state.compare.indexOf(id);
  if (i >= 0) state.compare.splice(i, 1);
  else {
    if (state.compare.length >= MAX_COMPARE) state.compare.shift();
    state.compare.push(id);
  }
  ecrireCompare();
  document.querySelectorAll(`[data-compare="${id}"]`).forEach((b) => {
    const on = state.compare.includes(id);
    b.setAttribute('aria-pressed', on);
    if (b.dataset.libelle !== undefined) b.innerHTML = libelleCompare(on, b.dataset.libelle === 'grand');
  });
}
const libelleCompare = (on, grand) => grand
  ? (on ? '✓ Dans le comparateur<small>toucher pour retirer</small>' : 'COMPARER !<small>+1 candidat dans le match</small>')
  : (on ? '✓ Ajouté' : '+ Comparer');

const parId = (id) => state.data.candidats.find((c) => c.id === id);
const bordDe = (c) => state.data.bords.find((b) => b.id === c.bord);
// Élision : « d'Édouard Philippe », « de Marine Le Pen »
const de = (n) => (/^[aeiouyàâäéèêëîïôöùûü]/i.test(n) ? `d'${n}` : `de ${n}`);
const nbProps = (c) => Object.values(c.propositions || {}).reduce((n, l) => n + l.length, 0);
const ordreBord = (c) => state.data.bords.findIndex((b) => b.id === c.bord);
// Candidats « principaux » : ceux qui ont au moins 3 mesures sourcées (pages duel générées pour eux)
const estPrincipal = (c) => nbProps(c) >= 3;
const principaux = () => candidatsTries().filter(estPrincipal);
// Ordre canonique d'un duel : de la gauche vers la droite (puis ordre du fichier)
function duelIds(a, b) {
  const rang = (c) => ordreBord(c) * 1000 + state.data.candidats.indexOf(c);
  return rang(a) <= rang(b) ? [a.id, b.id] : [b.id, a.id];
}
const lienDuel = (a, b) => URLS.duel(...duelIds(a, b));
const candidatsTries = () => [...state.data.candidats].sort((a, b) => ordreBord(a) - ordreBord(b));

// ---------- Photos (Wikipédia / Wikimedia Commons) ----------
const PHOTO_TTL = 7 * 86400000;
const enCours = new Map();
function photoCache(wiki) {
  try {
    const v = JSON.parse(localStorage.getItem('photo:' + wiki) || 'null');
    if (v && Date.now() - v.t < PHOTO_TTL) return v.u;
  } catch { /* ignore */ }
  return undefined;
}
async function photoWiki(wiki) {
  const cache = photoCache(wiki);
  if (cache !== undefined) return cache;
  if (enCours.has(wiki)) return enCours.get(wiki);
  const p = fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wiki)}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then((j) => {
      const u = j?.thumbnail?.source ? j.thumbnail.source.replace(/\/\d+px-/, '/400px-') : null;
      // On ne met en cache que les réponses valides (pas les erreurs réseau / 429)
      try { localStorage.setItem('photo:' + wiki, JSON.stringify({ u, t: Date.now() })); } catch { /* ignore */ }
      return u;
    })
    .catch(() => null);
  enCours.set(wiki, p);
  return p;
}
function hydraterPhotos(root = document) {
  root.querySelectorAll('.avatar[data-wiki]:not([data-ok])').forEach(async (el) => {
    el.dataset.ok = '1';
    const url = await photoWiki(el.dataset.wiki);
    if (!url) return;
    const img = new Image();
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => { el.querySelector('.avatar__init')?.remove(); el.prepend(img); };
    img.src = url;
  });
}

function avatar(c, taille = '') {
  const init = (c.prenom[0] + c.nom.replace(/^(Le |La |De )/i, '')[0]).toUpperCase();
  const img = c.photo
    ? `<img src="${esc(lien(c.photo))}" alt="${esc(`${c.prenom} ${c.nom}`)}" width="${taille === 'xl' ? 128 : taille === 'sm' ? 44 : 76}" height="${taille === 'xl' ? 128 : taille === 'sm' ? 44 : 76}" loading="${taille === 'xl' ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer">`
    : `<svg class="avatar__silhouette" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="38" r="19"/><path d="M14 100c2-24 17-36 36-36s34 12 36 36z"/></svg><span class="avatar__init avatar__init--petit">${esc(init)}</span>`;
  const wiki = !c.photo && c.wiki ? ` data-wiki="${esc(c.wiki)}"` : '';
  return `<span class="avatar ${taille ? 'avatar--' + taille : ''}" style="${styleCouleur(c)}"${wiki} role="img" aria-label="Photo de ${esc(c.prenom + ' ' + c.nom)}">${img}</span>`;
}

const tagProgramme = (c) => ({
  complet: '<span class="tag tag--complet">Programme publié</span>',
  partiel: '<span class="tag tag--partiel">Programme partiel</span>',
}[c.programme] || '<span class="tag tag--non">Programme à venir</span>');
const pastilleParti = (c) => `<span class="parti" style="${styleCouleur(c)}">${esc(c.partiCourt)}</span>`;

// ---------- Vues ----------
function vueAccueil() {
  const d = state.data;
  const cands = d.candidats;
  const detailles = cands.filter((c) => nbProps(c) > 0).length;
  const totalProps = cands.reduce((n, c) => n + nbProps(c), 0);
  const j = joursAvant(d.meta.election.tour1);

  app.innerHTML = `
    <section class="hero">
      <span class="pill"><span class="dot-live"></span><span>1er tour · ${esc(dateFr(d.meta.election.tour1, { day: 'numeric', month: 'long' }))}</span></span>
      <h1>Alors comme ça, vous savez <span class="surligne-rose">pour qui voter</span>&nbsp;? <span class="surligne-noir">Comparons.</span></h1>
      <p class="chapo">Les programmes des candidats à l'élection présidentielle 2027, mesure par mesure, <strong>avec les sources</strong>. Choisissez <span class="chip-inline">2 à 4 candidats</span> et mettez-les face à face.</p>
    </section>

    <section class="section">
      <div class="panneau" aria-label="Compteurs">
        <div class="panneau__titre"><span>LE COMPTE À REBOURS</span><span class="live">● LIVE</span></div>
        <div class="panneau__gros">J-${j}</div><div class="panneau__sous">avant le 1er tour · ${esc(dateFr(d.meta.election.tour1))}</div>
        <hr>
        <div class="panneau__stats">
          <div><b>${cands.length}</b> <span>candidats</span></div>
          <div><b>${detailles}</b> <span>avec propositions</span></div>
          <div><b>${totalProps}</b> <span>mesures sourcées</span></div>
          <div><b>${d.themes.length}</b> <span>thèmes</span></div>
        </div>
      </div>
    </section>

    ${blocListeOfficielle()}

    ${blocVeille()}

    <section class="section carte">
      <h2 class="section-titre">En trois lignes</h2>
      <div class="etapes">
        <div class="etape"><span class="etape__num">1</span><div>Parcourez les candidats, classés de la <strong>gauche à la droite</strong>, avec la couleur de leur parti.</div></div>
        <div class="etape"><span class="etape__num">2</span><div>Ouvrez une fiche pour lire le <strong>programme détaillé</strong>, thème par thème, chaque mesure avec sa source.</div></div>
        <div class="etape"><span class="etape__num">3</span><div>Ajoutez-en jusqu'à 4 au comparateur et voyez <strong>qui propose quoi</strong>, côte à côte.</div></div>
      </div>
    </section>

    <section class="section" id="candidats">
      <h2 class="section-titre">Les candidats (${cands.length}) · <a href="${URLS.candidats()}">la liste complète des candidatures →</a></h2>
      <div class="spectre" aria-hidden="true">
        <div class="spectre__barre"></div>
        <div class="spectre__labels"><span>Gauche</span><span>Centre</span><span>Droite</span></div>
      </div>
      <div class="filtres" role="group" aria-label="Filtrer par bord politique" id="filtres"></div>
      <div class="recherche">
        <input type="search" id="q" placeholder="Nom, parti…" aria-label="Rechercher un candidat" value="${esc(state.recherche)}">
        <div class="toggle" role="group" aria-label="Afficher">
          <button type="button" data-prog="0" aria-pressed="${!state.avecProgramme}">Tous</button>
          <button type="button" data-prog="1" aria-pressed="${state.avecProgramme}">Détaillés</button>
        </div>
      </div>
      <div class="grille" id="grille"></div>
    </section>
    ${blocDuelsPopulaires()}
    ${blocRetires()}`;

  renderFiltres();
  renderGrille();
  app.querySelector('#q').addEventListener('input', (e) => { state.recherche = e.target.value; renderGrille(); });
  app.querySelectorAll('[data-prog]').forEach((b) => b.addEventListener('click', () => {
    state.avecProgramme = b.dataset.prog === '1';
    app.querySelectorAll('[data-prog]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    renderGrille();
  }));
}

function blocVeille() {
  const v = state.veille;
  if (!v?.nouveaux?.length) return '';
  return `<section class="section alerte" role="status">
    <b>VEILLE AUTO</b> — ${plur(v.nouveaux.length, 'nouvelle candidature détectée', 'nouvelles candidatures détectées')}, en cours de vérification :
    ${(v.details || v.nouveaux.map((nom) => ({ nom, sources: ['Wikipédia'] }))).map((d) => `${esc(d.nom)} <span class="small">(${esc(d.sources.join(', '))})</span>`).join(', ')}.</section>`;
}

function renderFiltres() {
  const el = document.getElementById('filtres');
  const presents = new Set(state.data.candidats.map((c) => c.bord));
  const bords = state.data.bords.filter((b) => presents.has(b.id));
  const couleurBord = (b) => state.data.candidats.find((c) => c.bord === b.id)?.couleur || '#ccc';
  el.innerHTML = `<button class="filtre" type="button" data-bord="" aria-pressed="${!state.filtreBord}">Tous</button>` +
    bords.map((b) => `<button class="filtre" type="button" data-bord="${b.id}" aria-pressed="${state.filtreBord === b.id}"><span class="pastille" style="background:${couleurBord(b)}"></span>${esc(b.label)}</button>`).join('');
  el.querySelectorAll('[data-bord]').forEach((btn) => btn.addEventListener('click', () => {
    state.filtreBord = btn.dataset.bord || null;
    el.querySelectorAll('[data-bord]').forEach((x) => x.setAttribute('aria-pressed', x === btn));
    renderGrille();
  }));
}

function renderGrille() {
  const q = norm(state.recherche);
  const liste = candidatsTries().sort((a, b) => (LO() ? (officiel(a) ? 0 : 1) - (officiel(b) ? 0 : 1) : 0)).filter((c) =>
    (!state.filtreBord || c.bord === state.filtreBord) &&
    (!state.avecProgramme || nbProps(c) > 0) &&
    (!q || norm(`${c.prenom} ${c.nom} ${c.parti} ${c.partiCourt}`).includes(q)));
  const el = document.getElementById('grille');
  el.innerHTML = liste.length ? liste.map(carteCandidat).join('') : '<p class="vide">Aucun candidat ne correspond.</p>';
  el.querySelectorAll('[data-compare]').forEach((b) => b.addEventListener('click', (e) => {
    basculerCompare(b.dataset.compare);
  }));
  hydraterPhotos(el);
}

function carteCandidat(c) {
  const on = state.compare.includes(c.id);
  const n = nbProps(c);
  return `<article class="cand" style="${styleCouleur(c)}">
    <div class="cand__bande"></div>
    <div class="cand__corps">
      ${avatar(c)}
      <div class="cand__infos">
        <a class="cand__nom" href="${URLS.candidat(c.id)}"><span class="cand__prenom">${esc(c.prenom)}</span>${esc(c.nom)}</a>
        <div class="meta-ligne">${pastilleParti(c)}<span class="tag">${esc(bordDe(c)?.label)}</span>${age(c.biographie?.naissance) ? `<span class="tag">${age(c.biographie.naissance)} ans</span>` : ''}</div>
      </div>
    </div>
    ${c.slogan ? `<p class="cand__slogan">« ${esc(c.slogan)} »</p>` : ''}
    ${collecteOuverte() ? `<div class="cand__parr">${barreParrainages(c.id, true)}</div>` : ''}
    <div class="cand__pied">
      ${tagOfficiel(c)}
      ${tagProgramme(c)}
      ${n ? `<span class="tag">${plur(n, 'mesure')}</span>` : ''}
      <button type="button" class="cand__ajout" data-compare="${c.id}" data-libelle="" aria-pressed="${on}" aria-label="Ajouter ${esc(c.nom)} au comparateur">${libelleCompare(on, false)}</button>
    </div>
  </article>`;
}

function vueCandidat(id) {
  const c = parId(id);
  if (!c) return vue404();
  const d = state.data;
  const on = state.compare.includes(c.id);
  const themes = d.themes.filter((t) => c.propositions?.[t.id]?.length);
  const positions = d.enjeux.filter((e) => c.positions?.[e.id]);

  app.innerHTML = `
    <a class="lien-retour" href="${URLS.accueil()}">← Tous les candidats</a>
    <article>
      <section class="carte fiche__tete" style="${styleCouleur(c)}">
        <div class="fiche__fond"></div>
        <div class="fiche__id">
          ${avatar(c, 'xl')}
          <h1>${esc(c.prenom)} ${esc(c.nom)}</h1>
          <div class="meta-ligne">
            <span class="parti" style="${styleCouleur(c)}">${esc(c.parti)}</span>
            <span class="tag">${esc(bordDe(c)?.label)}</span>
            ${tagOfficiel(c)}
            ${tagProgramme(c)}
          </div>
          ${c.slogan ? `<p class="fiche__slogan">« ${esc(c.slogan)} »</p>` : ''}
          <p class="fiche__bio">${esc(c.bio)}</p>
          ${c.photoCredit ? `<p class="mono small">Photo : <a href="${esc(c.photoCredit)}" target="_blank" rel="noopener">Wikimedia Commons ↗</a></p>` : '<p class="mono small">Pas encore de photo libre de droits : elle sera ajoutée automatiquement dès qu\'elle existera.</p>'}
          <p class="mono small">${esc(c.statut[0].toUpperCase() + c.statut.slice(1))}${c.declaration ? ` le ${esc(dateFr(c.declaration))}` : ''}${c.site ? ` · <a href="${esc(c.site)}" target="_blank" rel="noopener">site officiel ↗</a>` : ''}</p>
          <div class="actions">
            <button type="button" class="btn btn--rouge" data-compare="${c.id}" data-libelle="grand" aria-pressed="${on}">${libelleCompare(on, true)}</button>
            <a class="btn" href="${URLS.comparer()}">Voir le comparateur →</a>
          </div>
        </div>
      </section>

      ${blocParrainagesFiche(c)}

      ${c.phares?.length ? `
      <section class="section carte">
        <h2 class="section-titre">Les mesures phares</h2>
        <div class="etapes">${c.phares.map((p, i) => `<div class="etape"><span class="etape__num">${i + 1}</span><div><strong>${esc(p)}</strong></div></div>`).join('')}</div>
      </section>` : ''}

      ${positions.length ? `
      <section class="section">
        <div class="panneau">
          <div class="panneau__titre"><span>EN UN COUP D'ŒIL</span></div>
          <hr>
          <div class="panneau__stats" style="grid-template-columns:1fr">
            ${positions.map((e) => `<div><span>${esc(e.label)} :</span> <b>${esc(c.positions[e.id].valeur)}</b> <a class="source source--sombre" href="${esc(c.positions[e.id].source)}" target="_blank" rel="noopener">source ↗</a></div>`).join('')}
          </div>
        </div>
      </section>` : ''}

      <section class="section">
        <h2 class="section-titre">Le programme 2027 ${esc(de(`${c.prenom} ${c.nom}`))}</h2>
        ${themes.length ? themes.map((t, i) => `
          <details class="theme-bloc" ${i < 2 ? 'open' : ''}>
            <summary><span>${t.emoji}</span>${esc(t.label)} <span class="compte">${c.propositions[t.id].length}</span></summary>
            ${c.propositions[t.id].map(prop).join('')}
          </details>`).join('') : `
          <div class="alerte">Ce candidat n'a pas encore publié de programme détaillé. La fiche sera complétée automatiquement dès que des propositions seront annoncées.</div>`}
      </section>

      ${blocPositionsFiche(c)}

      ${blocDuels(c)}

      ${blocBio(c)}

      <section class="section alerte small">
        <b>SOURCES</b> — ${(c.sources || []).map((s) => `<a class="source" href="${esc(s)}" target="_blank" rel="noopener">${esc(new URL(s).hostname)}</a>`).join(' · ')}
        <br>${esc(d.meta.avertissement)}
      </section>
    </article>`;

  app.querySelectorAll('[data-compare]').forEach((b) => b.addEventListener('click', () => basculerCompare(b.dataset.compare)));
  hydraterPhotos(app);
}

function blocBio(c) {
  const b = c.biographie;
  if (!b) return '';
  const a = age(b.naissance);
  const faits = [
    b.naissance && ['Naissance', `${b.naissance.length === 10 ? dateFr(b.naissance) : annee(b.naissance)}${b.lieuNaissance ? ` à ${b.lieuNaissance}` : ''}${a ? ` (${a} ans)` : ''}`],
    b.formation?.length && ['Formation', b.formation.join(' · ')],
    b.professions?.length && ['Métiers', b.professions.join(' · ')],
  ].filter(Boolean);
  const [premier, ...suite] = b.paragraphes || [];
  return `
      <section class="section carte" style="${styleCouleur(c)}">
        <h2 class="section-titre">Qui est-ce ? · Le parcours avant 2027</h2>
        ${faits.length ? `<dl class="faits">${faits.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
        ${b.fonctions?.length ? `
        <h3 class="sous-titre">Parcours</h3>
        <ol class="parcours">${b.fonctions.map((f) => `<li><span class="parcours__date">${esc(periode(f))}</span><span>${esc(f.label[0].toUpperCase() + f.label.slice(1))}</span></li>`).join('')}</ol>` : ''}
        ${premier ? `
        <h3 class="sous-titre">Biographie</h3>
        <div class="bio-texte">
          <p>${esc(premier)}</p>
          ${suite.length ? `<details class="suite"><summary>Lire la suite</summary>${suite.map((p) => `<p>${esc(p)}</p>`).join('')}</details>` : ''}
        </div>` : ''}
        <p class="mono small credit">Source : <a href="${esc(b.wikipedia)}" target="_blank" rel="noopener">Wikipédia</a> (texte sous licence CC BY-SA 4.0)${b.wikidata ? ` et <a href="https://www.wikidata.org/wiki/${esc(b.wikidata)}" target="_blank" rel="noopener">Wikidata</a>` : ''}${b.majLe ? `, mis à jour le ${esc(dateFr(b.majLe))}` : ''}.</p>
      </section>`;
}

// ---------- Positions sur 40 propositions (données ouvertes France-Vote, CC BY 4.0) ----------
const FV = () => state.fv;
// Enjeux du tableau « en un coup d'œil » -> proposition équivalente parmi les 40
const ENJEU_VERS_PROP = { retraite: 'soc1', smic: 'soc2', fortune: 'eco1', nucleaire: 'env1', immigration: 'imm1', europe: 'eur1' };
function celluleEnjeu(c, e) {
  const p = c.positions?.[e.id];
  if (p) return `${esc(p.valeur)} <a class="source" href="${esc(p.source)}" target="_blank" rel="noopener" aria-label="source">↗</a>`;
  const f = fvDe(c), pid = ENJEU_VERS_PROP[e.id], v = f?.positions?.[pid];
  const prop = FV()?.propositions.find((x) => x.id === pid);
  if (typeof v !== 'number' || !prop) return '<span class="inconnu">non précisé</span>';
  const src = f.sources?.[pid];
  return `${chip(v)}<br><span class="small" title="${esc(prop.texte)}">${esc(prop.court)}</span> <span class="mono small">(${f.origine === 'francevote' ? 'France-Vote' : 'relevé'}${src ? `, <a class="source" href="${esc(src.url)}" target="_blank" rel="noopener">source</a>` : ''})</span>`;
}
const MIN_COMMUNES = 10; // propositions évaluées en commun pour afficher une proximité
function fvDe(c) {
  const f = FV()?.candidats?.[c.id];
  if (f) return { ...f, origine: 'francevote' };
  const comp = state.complements?.candidats?.[c.id];
  if (comp && Object.keys(comp.positions || {}).length) return { positions: comp.positions, sources: comp.sources || {}, boussole: null, famille: null, origine: 'site' };
  return null;
}
const NIVEAUX = { '-2': 'Opposition nette', '-1': 'Plutôt opposé', 0: 'Nuancé', 1: 'Plutôt favorable', 2: 'Soutien net' };
const chip = (v) => (typeof v === 'number' ? `<span class="niveau niveau--${v < 0 ? 'm' + -v : v}">${NIVEAUX[v]}</span>` : '<span class="niveau niveau--ne">Non évalué</span>');
const sens = (v, neg, pos, centre) => (v == null ? '—' : v <= -15 ? neg : v >= 15 ? pos : centre);
const lireBoussole = (b) => `Économie <b>${sens(b.eco, 'interventionniste', 'libérale', 'au centre')}</b> (${b.eco > 0 ? '+' : ''}${b.eco}) · société <b>${sens(b.soc, 'progressiste', 'conservatrice', 'modérée')}</b> (${b.soc > 0 ? '+' : ''}${b.soc})`;

// Proximité : 100 % = mêmes positions sur toutes les propositions évaluées par les deux
function proximite(a, b) {
  const pa = fvDe(a)?.positions, pb = fvDe(b)?.positions;
  if (!pa || !pb) return null;
  const ids = Object.keys(pa).filter((k) => typeof pa[k] === 'number' && typeof pb[k] === 'number');
  if (ids.length < MIN_COMMUNES) return null;
  return Math.round(100 - (ids.reduce((s, k) => s + Math.abs(pa[k] - pb[k]), 0) / ids.length) * 25);
}

function svgBoussole(focus = null, etiquettes = false) {
  const W = 300, H = 336, M = 26, HAUT = 30, L = W - 2 * M;
  const x = (v) => M + ((v + 100) / 200) * L;
  const y = (v) => HAUT + ((100 - v) / 200) * L;
  const pts = candidatsTries().filter((c) => fvDe(c)?.boussole?.eco != null);
  // Étiquettes sans chevauchement : le candidat mis en avant d'abord, puis les autres s'il reste de la place
  const places = [];
  const libre = (bx, by, w) => places.every((p) => Math.abs(p.y - by) > 12 || bx + w < p.x || bx > p.x + p.w);
  const etiquette = (c, f) => {
    const b = fvDe(c).boussole, w = c.nom.length * (f ? 7.6 : 6.2) + 4;
    const droite = x(b.eco) < W - M - w - 14;
    const ecart = f ? 15 : 10;
    const bx = droite ? x(b.eco) + ecart : x(b.eco) - ecart - w, by = y(b.soc);
    if (!f && !libre(bx, by, w)) return '';
    places.push({ x: bx, y: by, w });
    return `<text x="${droite ? bx : bx + w}" y="${by + 4}" text-anchor="${droite ? 'start' : 'end'}" class="bp__nom">${esc(c.nom)}</text>`;
  };
  if (focus && !pts.some((c) => c.id === focus.id)) focus = null;
  const ordreEtiquettes = focus ? [focus, ...pts.filter((c) => c.id !== focus.id)] : pts;
  const textes = new Map();
  for (const c of ordreEtiquettes) if (fvDe(c) && (etiquettes || (focus && c.id === focus.id))) textes.set(c.id, etiquette(c, focus && c.id === focus.id));
  const point = (c) => {
    const b = fvDe(c).boussole, f = focus && c.id === focus.id;
    return `<a href="${URLS.candidat(c.id)}" class="bp${f ? ' bp--focus' : ''}"><title>${esc(c.prenom)} ${esc(c.nom)} : économie ${b.eco}, société ${b.soc}</title>
      <circle cx="${x(b.eco)}" cy="${y(b.soc)}" r="13" class="bp__cible"/>
      <circle cx="${x(b.eco)}" cy="${y(b.soc)}" r="${f ? 10 : 6}" fill="${c.couleur}" class="bp__point"/>
      ${textes.get(c.id) || ''}</a>`;
  };
  // Le candidat mis en avant est dessiné en dernier (au-dessus des autres)
  const ordre = focus ? [...pts.filter((c) => c.id !== focus.id), ...pts.filter((c) => c.id === focus.id)] : pts;
  const bas = HAUT + L;
  return `<svg class="boussole" viewBox="0 0 ${W} ${H}" role="img" aria-label="Boussole politique : économie de gauche (interventionniste) à droite (libérale), société de bas (progressiste) en haut (conservatrice)">
    <rect x="${M}" y="${HAUT}" width="${L}" height="${L}" class="boussole__fond"/>
    <line x1="${W / 2}" x2="${W / 2}" y1="${HAUT}" y2="${bas}" class="boussole__axe"/>
    <line y1="${HAUT + L / 2}" y2="${HAUT + L / 2}" x1="${M}" x2="${W - M}" class="boussole__axe"/>
    <text x="${W / 2}" y="${HAUT - 10}" text-anchor="middle" class="boussole__lib">↑ Société conservatrice</text>
    <text x="${M}" y="${bas + 18}" class="boussole__lib">← Économie interventionniste</text>
    <text x="${W - M}" y="${bas + 18}" text-anchor="end" class="boussole__lib">libérale →</text>
    <text x="${W / 2}" y="${bas + 36}" text-anchor="middle" class="boussole__lib">↓ Société progressiste</text>
    ${ordre.map(point).join('')}
  </svg>`;
}

const creditFV = (avecSite = false) => FV() ? `<p class="mono small credit">Positions : <a href="${esc(FV().page)}" target="_blank" rel="noopener">France-Vote</a>, lecture éditoriale indicative, licence ${esc(FV().licence)} — données du ${esc(dateFr(FV().recupereLe))}. Boussole et proximités calculées par Programmes 2027 à partir de ces données.${avecSite ? ' Pour les candidats que France-Vote n\'évalue pas, positions relevées par Programmes 2027, uniquement quand une prise de position sourcée existe.' : ''}</p>` : '';

function lignePosition(p, f) {
  const v = f.positions[p.id], src = f.sources?.[p.id];
  return `<div class="pos">
    <div class="pos__texte"><strong>${esc(p.court)}</strong><span>${esc(p.texte)}</span>
      ${src ? `<a class="source" href="${esc(src.url)}" target="_blank" rel="noopener">source : ${esc(src.editeur || new URL(src.url).hostname)}${src.date ? `, ${esc(dateFr(src.date))}` : ''} ↗</a>` : '<span class="pos__indicatif">lecture indicative, sans source publiée</span>'}</div>
    ${chip(v)}
  </div>`;
}

function blocPositionsFiche(c) {
  if (!FV()) return '';
  const f = fvDe(c);
  const nbProp = FV().propositions.length;
  if (!f) return `<section class="section alerte"><b>${nbProp} PROPOSITIONS</b> — Aucune prise de position ${esc(de(`${c.prenom} ${c.nom}`))} n'a encore été relevée sur les ${nbProp} propositions du comparateur (retraites, SMIC, immigration, nucléaire, Europe…). Elles apparaîtront ici dès qu'une position sourcée sera publiée.</section>`;
  if (f.origine === 'site' || !f.boussole) {
    const connues = FV().propositions.filter((p) => typeof f.positions[p.id] === 'number');
    return `
      <section class="section carte" style="${styleCouleur(c)}">
        <h2 class="section-titre">Ses positions sur ${nbProp} propositions</h2>
        <p style="margin:0 0 12px"><strong>${connues.length} position${connues.length > 1 ? 's' : ''} connue${connues.length > 1 ? 's' : ''} sur ${nbProp}.</strong> Les autres propositions ne sont pas encore évaluées, faute de prise de position publique. Pas assez de positions pour placer ${esc(c.prenom)} ${esc(c.nom)} sur la boussole ou calculer ses candidats les plus proches.</p>
        <div class="theme-bloc">${connues.map((p) => lignePosition(p, f)).join('')}</div>
        ${creditFV(true)}
      </section>`;
  }
  const autres = candidatsTries().filter((x) => x.id !== c.id && fvDe(x)).map((x) => ({ x, p: proximite(c, x) })).filter((o) => o.p != null).sort((a, b) => b.p - a.p);
  const lienAvec = (x) => (estPrincipal(c) && estPrincipal(x) ? lienDuel(c, x) : URLS.comparer([c.id, x.id]));
  const ligneProche = ({ x, p }) => `<a class="proche" href="${lienAvec(x)}" style="${styleCouleur(x)}">${avatar(x, 'sm')}<span>${esc(x.prenom)} ${esc(x.nom)}</span><b>${p} %</b></a>`;
  const themes = Object.entries(FV().themes);
  return `
      <section class="section carte" style="${styleCouleur(c)}">
        <h2 class="section-titre">Sa boussole politique</h2>
        <div class="boussole-bloc">
          ${svgBoussole(c)}
          <div>
            <p style="margin:0 0 12px">${lireBoussole(f.boussole)}</p>
            ${f.famille ? `<p class="small" style="margin:0 0 12px">Famille politique (France-Vote) : <b>${esc(f.famille)}</b></p>` : ''}
            <h3 class="sous-titre" style="margin-top:0">Les plus proches</h3>
            <div class="proches">${autres.slice(0, 4).map(ligneProche).join('')}</div>
            <h3 class="sous-titre">Les plus éloignés</h3>
            <div class="proches">${autres.slice(-3).reverse().map(ligneProche).join('')}</div>
          </div>
        </div>
        <h3 class="sous-titre">Ses positions sur ${FV().propositions.length} propositions</h3>
        ${themes.map(([tid, tlib], i) => {
          const ps = FV().propositions.filter((p) => p.theme === tid);
          return `<details class="theme-bloc" ${i === 0 ? 'open' : ''}><summary>${esc(tlib)} <span class="compte">${ps.length}</span></summary>${ps.map((p) => lignePosition(p, f)).join('')}</details>`;
        }).join('')}
        ${creditFV()}
      </section>`;
}

function blocPositionsComparees(choisis) {
  if (!FV()) return '';
  const avec = choisis.filter(fvDe);
  const nb = FV().propositions.length;
  if (!avec.length) return `<section class="section alerte"><b>${nb} PROPOSITIONS</b> — Aucun des candidats choisis n'a encore de position relevée sur les ${nb} propositions.</section>`;
  const proxi = choisis.length === 2 ? proximite(choisis[0], choisis[1]) : null;
  const partiels = choisis.filter((c) => fvDe(c)?.origine === 'site' || !fvDe(c));
  return `
    <section class="section">
      <h2 class="section-titre">Les ${nb} propositions face à face${proxi != null ? ` · proximité ${proxi} %` : ''}</h2>
      ${partiels.length ? `<p class="small" style="margin:0 0 10px">Peu ou pas de positions connues pour ${partiels.map((c) => esc(c.nom)).join(', ')} : les cases « non évalué » ne sont pas comptées${choisis.length === 2 ? ', et la proximité n\'est affichée qu\'à partir de ' + MIN_COMMUNES + ' propositions évaluées en commun' : ''}.</p>` : ''}
      <div class="matrice-wrap">
        <table class="matrice matrice--pos">
          <thead><tr><th scope="col">Proposition</th>${choisis.map((c) => `<th scope="col"><span class="th-cand">${avatar(c, 'sm')}${esc(c.nom)}</span></th>`).join('')}</tr></thead>
          <tbody>${Object.entries(FV().themes).map(([tid, tlib]) => `
            <tr class="ligne-theme"><th scope="rowgroup" colspan="${choisis.length + 1}">${esc(tlib)}</th></tr>
            ${FV().propositions.filter((p) => p.theme === tid).map((p) => `<tr><th scope="row" title="${esc(p.texte)}">${esc(p.court)}</th>${choisis.map((c) => {
              const f = fvDe(c); if (!f) return `<td>${chip(undefined)}</td>`;
              const src = f.sources?.[p.id];
              return `<td>${chip(f.positions[p.id])}${src ? ` <a class="source" href="${esc(src.url)}" target="_blank" rel="noopener" aria-label="source">↗</a>` : ''}</td>`;
            }).join('')}</tr>`).join('')}`).join('')}
          </tbody>
        </table>
      </div>
      ${creditFV(partiels.length > 0)}
    </section>`;
}

// ---------- Liste officielle (Conseil constitutionnel, mars 2027) ----------
const LO = () => state.listeOfficielle;
// « LE PEN » -> « Le Pen », « DUPONT-AIGNAN » -> « Dupont-Aignan »
const casseNom = (s) => String(s).toLocaleLowerCase('fr').replace(/(^|[\s'’-])(\p{L})/gu, (m, sep, l) => sep + l.toLocaleUpperCase('fr'));
const officiel = (c) => LO()?.candidats.find((x) => x.id === c.id) || null;
const tagOfficiel = (c) => !LO() ? '' : officiel(c)
  ? `<span class="tag tag--complet">✓ Candidat${c.prenom && /e$/.test(c.statut) ? 'e' : ''} officiel${/e$/.test(c.statut) ? 'le' : ''} · n° ${officiel(c).ordre}</span>`
  : '<span class="tag tag--non">Non retenu</span>';

function blocListeOfficielle() {
  const l = LO();
  if (!l) return '';
  return `
    <section class="section carte" style="border-color:var(--encre)">
      <h2 class="section-titre">✓ La liste officielle des candidats</h2>
      <p style="margin:0 0 12px">Arrêtée par le Conseil constitutionnel${l.date ? ` le ${esc(dateFr(l.date))}` : ''} : <strong>${plur(l.candidats.length, 'candidat')}</strong>, dans l'ordre du tirage au sort (ordre des panneaux et des bulletins).</p>
      <ol class="liste-officielle">${l.candidats.map((x) => {
        const c = x.id ? parId(x.id) : null;
        return `<li>${c ? `<a href="${URLS.candidat(c.id)}" style="${styleCouleur(c)}">${avatar(c, 'sm')}<span><b>${x.ordre}.</b> ${esc(c.prenom)} ${esc(c.nom)}</span></a>` : `<span class="lo-sans"><b>${x.ordre}.</b> ${esc(x.prenom)} ${esc(casseNom(x.nom))}</span>`}</li>`;
      }).join('')}</ol>
      <p class="mono small credit">Source : <a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.decision || 'décision du Conseil constitutionnel')}</a></p>
    </section>`;
}

// ---------- Parrainages ----------
const P = () => state.parrainages;
const collecteOuverte = () => ['en-cours', 'cloture'].includes(P()?.statut);
const seuil = () => P()?.regles?.seuil || 500;

function texteParrainagesTicker() {
  if (!collecteOuverte()) return 'Parrainages : 500 signatures d\'élus nécessaires, collecte début 2027';
  const q = Object.values(P().candidats).filter((x) => x.seuilAtteint).length;
  return `Parrainages : ${plur(q, 'candidat qualifié', 'candidats qualifiés')} au ${dateFr(P().dernierePublication)}`;
}

function barreParrainages(id, compact = false) {
  const f = P()?.candidats?.[id];
  const n = f?.total || 0;
  const pct = Math.min(100, (n / seuil()) * 100);
  const ok = f?.seuilAtteint;
  return `<div class="jauge ${ok ? 'jauge--ok' : ''}" role="img" aria-label="${n} parrainages sur ${seuil()}">
      <div class="jauge__barre"><span style="width:${pct}%"></span></div>
      <div class="jauge__texte mono"><b>${n}</b>/${seuil()} signatures${ok ? ' · ✓ qualifié' : ''}${!compact && f ? ` · ${f.departements} départements` : ''}</div>
    </div>`;
}

function sparkline(hist) {
  if (!hist?.length || hist.length < 2) return '';
  const w = 300, h = 70, max = Math.max(seuil(), hist.at(-1).cumul);
  const x = (i) => (i / (hist.length - 1)) * w;
  const y = (v) => h - (v / max) * h;
  const pts = hist.map((p, i) => `${x(i).toFixed(1)},${y(p.cumul).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 -4 ${w} ${h + 8}" preserveAspectRatio="none" role="img" aria-label="Évolution des parrainages">
    <line x1="0" x2="${w}" y1="${y(seuil())}" y2="${y(seuil())}" class="spark__seuil"/>
    <polyline points="${pts}" class="spark__ligne"/>
  </svg>`;
}

function blocParrainagesFiche(c) {
  const p = P();
  if (!p) return '';
  if (!collecteOuverte()) {
    return `<section class="section alerte"><b>PARRAINAGES</b> — La collecte des 500 signatures d'élus n'a pas encore commencé (ouverture ${esc(p.calendrier?.ouverture || 'début 2027')}). Le compteur s'affichera ici automatiquement. <a href="${URLS.signatures()}">En savoir plus</a></section>`;
  }
  const f = p.candidats[c.id];
  return `
      <section class="section carte" style="${styleCouleur(c)}">
        <h2 class="section-titre">Parrainages</h2>
        ${barreParrainages(c.id)}
        ${f ? `${sparkline(f.historique)}
        <p class="small" style="margin:8px 0 0">${Object.entries(f.mandats).slice(0, 4).map(([m, n]) => `${esc(m)} : <b>${n}</b>`).join(' · ')}</p>` : '<p class="small">Aucun parrainage validé publié pour l\'instant.</p>'}
        <p class="mono small credit">Source : Conseil constitutionnel · publication du ${esc(dateFr(p.dernierePublication))}</p>
      </section>`;
}

function vueParrainages() {
  const p = P();
  const d = state.data;
  const regles = p?.regles || { seuil: 500, minDepartements: 30, maxParDepartement: 50 };
  const intro = `
    <section class="hero">
      <span class="pill"><span class="dot-live"></span><span>${collecteOuverte() ? `Publication du ${esc(dateFr(p.dernierePublication, { day: 'numeric', month: 'long' }))}` : 'Collecte pas encore ouverte'}</span></span>
      <h1>Les <span class="surligne-rose">500 signatures</span>, <span class="surligne-noir">le compteur.</span></h1>
      <p class="chapo">Pour être candidat, il faut le parrainage d'au moins ${regles.seuil} élus. Le Conseil constitutionnel publie les signatures validées au moins deux fois par semaine : ce compteur se met à jour tout seul.</p>
    </section>
    <section class="section carte">
      <h2 class="section-titre">Les règles en trois lignes</h2>
      <div class="etapes">
        <div class="etape"><span class="etape__num">1</span><div><strong>${regles.seuil} signatures</strong> d'élus (maires, parlementaires, conseillers départementaux et régionaux…).</div></div>
        <div class="etape"><span class="etape__num">2</span><div>Venant d'au moins <strong>${regles.minDepartements} départements</strong> ou collectivités d'outre-mer.</div></div>
        <div class="etape"><span class="etape__num">3</span><div>Pas plus de <strong>${regles.maxParDepartement} signatures</strong> comptées par département (un dixième).</div></div>
      </div>
    </section>`;

  if (!collecteOuverte()) {
    app.innerHTML = intro + `
    <section class="section">
      <div class="panneau">
        <div class="panneau__titre"><span>CALENDRIER</span><span class="live">● EN ATTENTE</span></div>
        <hr>
        <div class="panneau__stats" style="grid-template-columns:1fr">
          <div><span>Ouverture :</span> <b>${esc(p?.calendrier?.ouverture || 'début 2027')}</b></div>
          <div><span>Clôture :</span> <b>${esc(dateFr(p?.calendrier?.cloture || '2027-03-12'))} au plus tard</b></div>
          <div><span>Dernière vérification :</span> <b>${esc(dateFr(p?.verifieLe))}</b></div>
        </div>
      </div>
    </section>
    <section class="section alerte">La <strong>liste officielle des candidats</strong> sera arrêtée par le Conseil constitutionnel à l'issue de la collecte (mars 2027). Elle s'affichera automatiquement sur ce site.</section>
    <section class="section alerte">Aucun parrainage n'est encore publié. Dès la première publication officielle, le classement de tous les candidats apparaîtra ici, ainsi qu'une jauge sur chaque fiche.</section>`;
    return;
  }

  const lignes = Object.entries(p.candidats).map(([id, f]) => ({ c: parId(id), f }))
    .concat(Object.entries(p.nonRattaches || {}).map(([nom, f]) => ({ c: null, nom, f })))
    .sort((a, b) => b.f.total - a.f.total);
  const qualifies = lignes.filter((l) => l.f.seuilAtteint).length;
  // Les candidats suivis par le site restent toujours dans la liste principale
  const principales = lignes.filter((l) => l.c || l.f.total >= 50);
  const petites = lignes.filter((l) => !l.c && l.f.total < 50);
  const sansParrain = d.candidats.filter((c) => !p.candidats[c.id]);

  app.innerHTML = intro + `
    <section class="section">
      <div class="panneau">
        <div class="panneau__titre"><span>LE TABLEAU DE BORD</span><span class="live">● ${p.statut === 'cloture' ? 'CLOS' : 'LIVE'}</span></div>
        <div class="panneau__gros">${p.total.toLocaleString('fr-FR')}</div><div class="panneau__sous">parrainages validés au ${esc(dateFr(p.dernierePublication))}</div>
        <hr>
        <div class="panneau__stats">
          <div><b>${qualifies}</b> <span>qualifiés</span></div>
          <div><b>${lignes.length}</b> <span>personnes parrainées</span></div>
        </div>
      </div>
    </section>
    <section class="section carte" style="padding:0;overflow:hidden">
      ${principales.map(ligneParrainage).join('')}
    </section>
    ${petites.length ? `
    <details class="section theme-bloc">
      <summary>Autres personnes parrainées (moins de 50 signatures) <span class="compte">${petites.length}</span></summary>
      ${petites.map(ligneParrainage).join('')}
    </details>` : ''}
    ${sansParrain.length ? `<p class="small mono">Aucun parrainage publié : ${sansParrain.map((c) => esc(c.nom)).join(', ')}.</p>` : ''}
    <p class="small mono">Source : <a href="${esc(p.source)}" target="_blank" rel="noopener">données ouvertes du Conseil constitutionnel</a> · vérifié le ${esc(dateFr(p.verifieLe))}.</p>`;
  hydraterPhotos(app);
}

function ligneParrainage({ c, nom, f }) {
  return `
        <div class="ligne-cand" ${c ? `style="${styleCouleur(c)}"` : ''}>
          ${c ? avatar(c, 'sm') : '<span class="avatar avatar--sm" style="--c:#ddd"><span class="avatar__init">?</span></span>'}
          <div class="ligne-cand__corps">
            ${c ? `<a class="ligne-cand__nom" href="${URLS.candidat(c.id)}">${esc(c.prenom)} ${esc(c.nom)}</a> ${pastilleParti(c)}` : `<span class="ligne-cand__nom">${esc(nom)}</span>`}
            ${c ? barreParrainages(c.id) : `<div class="jauge ${f.seuilAtteint ? 'jauge--ok' : ''}"><div class="jauge__barre"><span style="width:${Math.min(100, f.total / seuil() * 100)}%"></span></div><div class="jauge__texte mono"><b>${f.total}</b>/${seuil()}${f.seuilAtteint ? ' · ✓ qualifié' : ''} · ${f.departements} départements</div></div>`}
          </div>
        </div>`;
}

function blocDuels(c) {
  if (!estPrincipal(c)) return '';
  const autres = principaux().filter((x) => x.id !== c.id);
  if (!autres.length) return '';
  return `
      <section class="section">
        <h2 class="section-titre">Comparer ${esc(c.prenom)} ${esc(c.nom)} avec…</h2>
        <div class="duels">${autres.map((x) => `<a class="duel" href="${lienDuel(c, x)}" style="${styleCouleur(x)}">${avatar(x, 'sm')}<span>${esc(c.nom)} <b>ou</b> ${esc(x.nom)}</span></a>`).join('')}</div>
      </section>`;
}

function blocDuelsPopulaires() {
  const p = principaux();
  const paires = [];
  // Duels gauche/droite les plus parlants : extrêmes du spectre puis voisins
  for (let i = 0; i < p.length; i++) for (let j = p.length - 1; j > i; j--) paires.push([p[i], p[j]]);
  const choix = paires.sort((x, y) => (nbProps(y[0]) + nbProps(y[1])) - (nbProps(x[0]) + nbProps(x[1]))).slice(0, 8);
  if (!choix.length) return '';
  return `
    <section class="section">
      <h2 class="section-titre">Les duels</h2>
      <div class="duels">${choix.map(([a, b]) => `<a class="duel" href="${lienDuel(a, b)}"><span class="duel__avatars">${avatar(a, 'sm')}${avatar(b, 'sm')}</span><span>${esc(a.nom)} <b>ou</b> ${esc(b.nom)}</span></a>`).join('')}</div>
    </section>`;
}

function blocRetires() {
  const d = state.data;
  if (!d.retires?.length && !d.pressentis?.length) return '';
  return `
    <section class="section carte carte--creme">
      ${d.retires?.length ? `
      <h2 class="section-titre">Ils se sont retirés</h2>
      <ul class="liste-simple">${d.retires.map((r) => `<li><strong>${esc(r.nom)}</strong> <span class="small">(${esc(r.parti)})</span> — <span class="small">${r.retrait ? `retrait le ${esc(dateFr(r.retrait))}` : esc(r.note || '')}</span></li>`).join('')}</ul>` : ''}
      ${d.pressentis?.length ? `
      <h2 class="section-titre" style="margin-top:18px">Pourraient se déclarer</h2>
      <p class="small" style="margin:0">${d.pressentis.map(esc).join(' · ')}</p>` : ''}
    </section>`;
}

function prop(p) {
  let host = '';
  try { host = p.source ? new URL(p.source).hostname.replace(/^www\./, '') : ''; } catch { /* ignore */ }
  return `<div class="prop">
    <h4>${esc(p.titre)}</h4>
    <p>${esc(p.detail)}</p>
    ${p.source ? `<a class="source" href="${esc(p.source)}" target="_blank" rel="noopener">source : ${esc(host)} ↗</a>` : ''}
  </div>`;
}

function vueComparer(param) {
  const d = state.data;
  if (param) {
    const ids = param.split(',').filter(parId).slice(0, MAX_COMPARE);
    if (ids.length) { state.compare = ids; ecrireCompare(); }
  }
  const choisis = state.compare.map(parId).filter(Boolean);
  const themesDispo = d.themes.filter((t) => choisis.some((c) => c.propositions?.[t.id]?.length));
  if (!themesDispo.find((t) => t.id === state.themeCompare)) state.themeCompare = themesDispo[0]?.id || null;

  app.innerHTML = `
    <section class="hero">
      <span class="pill">Le match · ${choisis.length}/${MAX_COMPARE}</span>
      ${choisis.length === 2
        ? `<h1>${esc(choisis[0].nom)} ou ${esc(choisis[1].nom)}&nbsp;: <span class="surligne-rose">les programmes 2027</span> face à face</h1>`
        : '<h1>Qui propose <span class="surligne-rose">quoi</span>&nbsp;?</h1>'}
      <p class="chapo">Touchez les visages pour ajouter ou retirer des candidats (4 maximum).</p>
    </section>

    <section class="section">
      <div class="selecteur" role="group" aria-label="Choisir les candidats">
        ${candidatsTries().map((c) => `
          <button type="button" class="sel" data-sel="${c.id}" aria-pressed="${state.compare.includes(c.id)}">
            ${avatar(c, 'sm')}<span>${esc(c.nom)}</span>
          </button>`).join('')}
      </div>
    </section>

    ${choisis.length < 2 ? `
      <section class="section carte carte--creme"><p style="margin:0"><strong>Choisissez au moins 2 candidats</strong> pour lancer le match. Astuce : ceux qui ont le badge <span class="tag tag--complet">Programme publié</span> ou <span class="tag tag--partiel">Programme partiel</span> ont le plus de contenu.</p></section>` : `

    <section class="section">
      <h2 class="section-titre">En un coup d'œil</h2>
      <div class="matrice-wrap">
        <table class="matrice">
          <thead><tr><th scope="col">Enjeu</th>${choisis.map((c) => `<th scope="col"><span class="th-cand">${avatar(c, 'sm')}${esc(c.nom)}</span></th>`).join('')}</tr></thead>
          <tbody>
            ${d.enjeux.map((e) => `<tr><th scope="row">${esc(e.label)}</th>${choisis.map((c) => `<td>${celluleEnjeu(c, e)}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <section class="section">
      <h2 class="section-titre">Thème par thème</h2>
      ${themesDispo.length ? `
      <div class="onglets filtres" role="tablist">
        ${themesDispo.map((t) => `<button type="button" role="tab" class="filtre" data-theme="${t.id}" aria-pressed="${t.id === state.themeCompare}" aria-selected="${t.id === state.themeCompare}">${t.emoji} ${esc(t.label)}</button>`).join('')}
      </div>
      <div class="compare-scroll"><div class="compare" id="compare-cols"></div></div>
      <p class="mono small">← faites glisser pour voir tous les candidats →</p>` : '<div class="alerte">Aucune proposition publiée pour ces candidats pour l\'instant.</div>'}
    </section>

    ${blocPositionsComparees(choisis)}

    <section class="section">
      <button type="button" class="btn" id="partager">Partager ce match ↗</button>
    </section>`}`;

  app.querySelectorAll('[data-sel]').forEach((b) => b.addEventListener('click', () => {
    basculerCompare(b.dataset.sel);
    history.replaceState(null, '', URLS.comparer(state.compare));
    vueComparer();
  }));
  app.querySelectorAll('[data-theme]').forEach((b) => b.addEventListener('click', () => {
    state.themeCompare = b.dataset.theme;
    app.querySelectorAll('[data-theme]').forEach((x) => { x.setAttribute('aria-pressed', x === b); x.setAttribute('aria-selected', x === b); });
    renderColonnes(choisis);
  }));
  app.querySelector('#partager')?.addEventListener('click', partager);
  if (choisis.length >= 2 && themesDispo.length) renderColonnes(choisis);
  hydraterPhotos(app);
}

function renderColonnes(choisis) {
  const el = document.getElementById('compare-cols');
  if (!el) return;
  const t = state.themeCompare;
  el.innerHTML = choisis.map((c) => `
    <div class="col" style="${styleCouleur(c)}">
      <div class="col__tete">${avatar(c, 'sm')}<a href="${URLS.candidat(c.id)}">${esc(c.prenom)} ${esc(c.nom)}<br><small class="mono">${esc(c.partiCourt)}</small></a></div>
      <div class="col__corps">${c.propositions?.[t]?.length ? c.propositions[t].map(prop).join('') : '<p class="vide">Pas de proposition publiée sur ce thème.</p>'}</div>
    </div>`).join('');
  hydraterPhotos(el);
}

async function partager() {
  const url = new URL(URLS.comparer(state.compare), location.origin).href;
  const noms = state.compare.map(parId).map((c) => c.nom).join(' vs ');
  try {
    if (navigator.share) await navigator.share({ title: `${noms} — Programmes 2027`, url });
    else { await navigator.clipboard.writeText(url); alert('Lien copié !'); }
  } catch { /* annulé */ }
}

function vueThemes() {
  const d = state.data;
  app.innerHTML = `
    <section class="hero">
      <span class="pill">Par thème</span>
      <h1>Un sujet, <span class="surligne-noir">tous les candidats.</span></h1>
    </section>
    <section class="section themes-grille">
      ${d.themes.map((t) => {
        const n = d.candidats.filter((c) => c.propositions?.[t.id]?.length).length;
        return `<a class="theme-tuile" href="${URLS.theme(t.id)}"><span class="emoji">${t.emoji}</span>${esc(t.label)}<small>${plur(n, 'candidat')}</small></a>`;
      }).join('')}
    </section>`;
}

function vueTheme(id) {
  const d = state.data;
  const t = d.themes.find((x) => x.id === id);
  if (!t) return vue404();
  const avec = candidatsTries().filter((c) => c.propositions?.[t.id]?.length);
  const sans = candidatsTries().filter((c) => !c.propositions?.[t.id]?.length);
  app.innerHTML = `
    <a class="lien-retour" href="${URLS.themes()}">← Tous les thèmes</a>
    <section class="hero">
      <span class="pill">${t.emoji} Thème</span>
      <h1>${esc(t.label)}</h1>
      <p class="chapo">Que proposent les candidats à la présidentielle 2027 sur ce sujet&nbsp;? Classés de la gauche vers la droite, chaque mesure avec sa source.</p>
    </section>
    <section class="section carte" style="padding:0;overflow:hidden">
      ${avec.map((c) => `
        <div class="ligne-cand">
          ${avatar(c, 'sm')}
          <div class="ligne-cand__corps">
            <a class="ligne-cand__nom" href="${URLS.candidat(c.id)}">${esc(c.prenom)} ${esc(c.nom)}</a> ${pastilleParti(c)}
            ${c.propositions[t.id].map((p) => `<div style="margin-top:8px"><strong>${esc(p.titre)}</strong> — ${esc(p.detail)} ${p.source ? `<a class="source" href="${esc(p.source)}" target="_blank" rel="noopener">source ↗</a>` : ''}</div>`).join('')}
          </div>
        </div>`).join('') || '<p class="vide">Aucune proposition publiée pour l\'instant.</p>'}
    </section>
    ${sans.length ? `<p class="small mono">Rien de publié sur ce thème : ${sans.map((c) => esc(c.nom)).join(', ')}.</p>` : ''}`;
  hydraterPhotos(app);
}

function vueCandidatures() {
  const d = state.data;
  const parDate = [...d.candidats].sort((a, b) => (b.declaration || '0').localeCompare(a.declaration || '0'));
  const lo = LO();
  app.innerHTML = `
    <section class="hero">
      <span class="pill"><span class="dot-live"></span><span>Mis à jour le ${esc(dateFr(state.veille?.checkedAt || d.meta.contenuMisAJour))}</span></span>
      <h1>Candidats à la présidentielle 2027&nbsp;: <span class="surligne-rose">la liste complète</span></h1>
      <p class="chapo"><strong>${plur(d.candidats.length, 'candidature déclarée', 'candidatures déclarées')}</strong> pour l'élection des ${esc(dateFr(d.meta.election.tour1, { day: 'numeric', month: 'long' }))} et ${esc(dateFr(d.meta.election.tour2))}, de la plus récente à la plus ancienne. ${lo ? `La liste officielle arrêtée par le Conseil constitutionnel compte ${plur(lo.candidats.length, 'candidat')}.` : 'La liste officielle sera arrêtée par le Conseil constitutionnel en mars 2027, après la collecte des 500 parrainages.'}</p>
    </section>

    ${blocListeOfficielle()}

    ${FV() ? `<section class="section carte">
      <h2 class="section-titre">La boussole des candidats</h2>
      <div class="boussole-bloc boussole-bloc--large">${svgBoussole(null, true)}
        <p class="small" style="margin:0">Chaque point est un candidat, calculé à partir de ses positions sur ${FV().propositions.length} propositions : à gauche une économie plus interventionniste, à droite plus libérale ; en haut des positions de société plus conservatrices, en bas plus progressistes. Touchez un point pour ouvrir la fiche. Les coordonnées figurent dans le tableau ci-dessous.</p></div>
      ${creditFV()}
    </section>` : ''}

    <section class="section">
      <h2 class="section-titre">Toutes les candidatures déclarées</h2>
      <div class="matrice-wrap">
        <table class="matrice candidatures">
          <thead><tr><th scope="col">Candidat</th><th scope="col">Parti</th><th scope="col">Bord</th><th scope="col">Annonce</th><th scope="col">Programme</th>${FV() ? '<th scope="col">Boussole (éco · société)</th>' : ''}</tr></thead>
          <tbody>${parDate.map((c) => `<tr style="${styleCouleur(c)}">
            <th scope="row"><a class="th-cand" href="${URLS.candidat(c.id)}">${avatar(c, 'sm')}<span>${esc(c.prenom)} ${esc(c.nom)}</span></a></th>
            <td>${pastilleParti(c)}<br><span class="small">${esc(c.parti)}</span></td>
            <td>${esc(bordDe(c)?.label)}</td>
            <td>${c.declaration ? esc(dateFr(c.declaration)) : '<span class="inconnu">—</span>'}<br><span class="small">${esc(c.statut)}</span></td>
            <td>${tagProgramme(c)}${tagOfficiel(c) ? '<br>' + tagOfficiel(c) : ''}</td>
            ${FV() ? `<td class="mono">${fvDe(c)?.boussole ? `${fvDe(c).boussole.eco} · ${fvDe(c).boussole.soc}` : '<span class="inconnu">—</span>'}</td>` : ''}
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </section>

    ${blocRetires()}

    <section class="section carte">
      <h2 class="section-titre">Comment devient-on candidat&nbsp;?</h2>
      <div class="etapes">
        <div class="etape"><span class="etape__num">1</span><div>Être de <strong>nationalité française</strong>, avoir <strong>au moins 18 ans</strong> et ne pas être privé de ses droits civiques ni frappé d'inéligibilité.</div></div>
        <div class="etape"><span class="etape__num">2</span><div>Réunir <strong>500 parrainages</strong> d'élus d'au moins 30 départements, pas plus de 50 par département. <a href="${URLS.signatures()}">Voir le compteur →</a></div></div>
        <div class="etape"><span class="etape__num">3</span><div>Déposer une <strong>déclaration de situation patrimoniale</strong> et respecter les règles de financement de campagne (mandataire, plafond de dépenses).</div></div>
        <div class="etape"><span class="etape__num">4</span><div>Le <strong>Conseil constitutionnel</strong> vérifie les dossiers et arrête la liste officielle, dans l'ordre d'un tirage au sort.</div></div>
      </div>
      <p class="mono small credit">Sources : <a href="https://www.conseil-constitutionnel.fr" target="_blank" rel="noopener">Conseil constitutionnel</a> · <a href="https://www.vie-publique.fr" target="_blank" rel="noopener">vie-publique.fr</a></p>
    </section>`;
  hydraterPhotos(app);
}

function vueMethodo() {
  const d = state.data;
  app.innerHTML = `
    <section class="hero"><span class="pill">Méthodo</span><h1>Comment c'est <span class="surligne-rose">fabriqué</span>.</h1></section>
    <section class="section carte prose">
      <h2>D'où viennent les données ?</h2>
      <p>Chaque mesure renvoie à une source : site de campagne, presse nationale ou fiches de synthèse. La liste des candidats suit la page Wikipédia <a href="https://fr.wikipedia.org/wiki/Candidatures_%C3%A0_l%27%C3%A9lection_pr%C3%A9sidentielle_fran%C3%A7aise_de_2027" target="_blank" rel="noopener">Candidatures à l'élection présidentielle française de 2027</a>. Les photos viennent de Wikimedia Commons.</p>
      <h2>Comment ça se met à jour ?</h2>
      <ul>
        <li><strong>Tous les jours</strong>, un robot (GitHub Actions) vérifie la liste des candidats sur Wikipédia, signale les nouveaux noms et rafraîchit les photos.</li>
        <li><strong>Chaque semaine</strong>, un second robot recherche les nouvelles annonces de programme et propose une mise à jour, <strong>relue par un humain</strong> avant publication.</li>
        <li>Tout le monde peut proposer une correction : les données sont un simple fichier <code>data/candidats.json</code>.</li>
      </ul>
      <h2>Bords politiques</h2>
      <p>Le classement suit l'usage courant de la presse et de Wikipédia. Il reste une simplification : un candidat peut être plus à gauche sur un sujet et plus à droite sur un autre.</p>
      <h2>Avertissement</h2>
      <p>${esc(d.meta.avertissement)}</p>
      <h2>Les 40 propositions et la boussole</h2>
      <p>Les positions de chaque candidat sur 40 propositions (de « opposition nette » à « soutien net ») viennent des <a href="https://www.france-vote.fr/donnees" target="_blank" rel="noopener">données ouvertes de France-Vote</a>, publiées sous licence CC BY 4.0. Il s'agit d'une lecture éditoriale et indicative : une position sans source publiée est signalée comme telle. La boussole (économie et société, de −100 à +100) et les pourcentages de proximité sont calculés par ce site à partir de ces données, avec la méthode de France-Vote pour la boussole. Les données sont mises à jour automatiquement.</p>
      <h2>Uniquement la campagne 2027</h2>
      <p>${esc(d.meta.regle || '')} Une position que le candidat défendait en 2017 ou en 2022 n'est reprise que si une source de la campagne 2027 la confirme. « Non précisé » signifie qu'aucune source 2027 n'a encore été trouvée, pas que le candidat n'a pas d'avis.</p>
      <p class="mono small">Contenu vérifié le ${esc(dateFr(d.meta.contenuMisAJour))}${state.veille?.checkedAt ? ` · liste vérifiée sur Wikipédia le ${esc(dateFr(state.veille.checkedAt))}` : ''}.</p>
    </section>`;
}

function vue404() {
  app.innerHTML = `<section class="hero"><h1>Oups, <span class="surligne-rose">page introuvable</span>.</h1><p class="chapo"><a href="${URLS.accueil()}">Retour aux candidats</a></p></section>`;
}

// ---------- Panier collant ----------
function majTray() {
  const tray = document.getElementById('tray');
  const route = routeCourante().route;
  const choisis = state.compare.map(parId).filter(Boolean);
  if (!choisis.length || route === 'comparer') { tray.hidden = true; return; }
  tray.hidden = false;
  tray.innerHTML = `<a class="btn btn--rouge" href="${URLS.comparer(choisis.map((c) => c.id))}">
    <span class="tray__avatars">${choisis.map((c) => avatar(c, 'sm')).join('')}</span>
    <span>COMPARER ! <small>${choisis.length}/${MAX_COMPARE}</small></span>
  </a>`;
  hydraterPhotos(tray);
}

// ---------- Routeur ----------
// Le site est fait de vraies pages (une adresse par contenu, générées à l'avance pour
// les moteurs de recherche) ; le script les « hydrate » avec les données à jour.
function routeCourante() {
  const chemin = decodeURIComponent(location.pathname).slice(BASE.length - 1).replace(/^\/|\/$/g, '');
  const [route = '', param = ''] = chemin.split('/');
  return { route, param };
}

function router() {
  const { route, param } = routeCourante();
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('actif',
    (a.dataset.nav === 'home' && (route === '' || route === 'candidat' || route === 'candidats')) ||
    (a.dataset.nav === 'themes' && (route === 'themes' || route === 'theme')) ||
    (a.dataset.nav === 'compare' && route === 'comparer') ||
    (a.dataset.nav === 'parrainages' && route === 'signatures')));
  switch (route) {
    case '': vueAccueil(); break;
    case 'candidat': vueCandidat(param); break;
    case 'comparer': {
      const duel = param.match(/^(.+)-vs-(.+)$/);
      vueComparer(duel ? `${duel[1]},${duel[2]}` : new URLSearchParams(location.search).get('c') || '');
      break;
    }
    case 'themes': vueThemes(); break;
    case 'theme': vueTheme(param); break;
    case 'methodo': vueMethodo(); break;
    case 'candidats': vueCandidatures(); break;
    case 'signatures': vueParrainages(); break;
    default: vue404();
  }
  majTray();
  document.documentElement.dataset.rendu = route || 'accueil';
}

// Anciennes adresses en « #/… » : redirection vers la vraie page
function redirigerAncienneAdresse() {
  const h = location.hash;
  if (!h.startsWith('#/')) return false;
  const [, route = '', param = ''] = h.split('/');
  const cible = {
    '': URLS.accueil(), candidat: URLS.candidat(param), themes: URLS.themes(), theme: URLS.theme(param),
    comparer: URLS.comparer(param ? param.split(',') : []), parrainages: URLS.signatures(), methodo: URLS.methodo(),
  }[route];
  if (cible) { location.replace(cible); return true; }
  return false;
}

function enTete() {
  const d = state.data;
  const n = d.candidats.length;
  const j = joursAvant(d.meta.election.tour1);
  const maj = state.veille?.checkedAt || d.meta.contenuMisAJour;
  const morceaux = [
    `J-${j} avant le 1er tour`,
    `${n} candidats déclarés`,
    `1er tour le ${dateFr(d.meta.election.tour1)}`,
    `2nd tour le ${dateFr(d.meta.election.tour2)}`,
    LO() ? `Liste officielle : ${LO().candidats.length} candidats` : texteParrainagesTicker(),
    `Mis à jour le ${dateFr(maj)}`,
  ];
  document.getElementById('ticker').textContent = (morceaux.join(' · ') + ' · ').repeat(2);
  document.getElementById('countdown').innerHTML = `<span class="dot-live"></span>${n} candidats en lice<br>1<sup>er</sup> tour dans <b>${j} jours</b>`;
  document.getElementById('footer-update').textContent = `Dernière mise à jour : ${dateFr(maj)}`;
}

async function init() {
  if (redirigerAncienneAdresse()) return;
  if (!app.children.length) app.innerHTML = '<p class="chargement">Chargement des programmes…</p>';
  try {
    const optionnel = (u) => fetch(u, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [data, veille, parrainages, listeOfficielle, fv, complements] = await Promise.all([
      fetch(lien('data/candidats.json'), { cache: 'no-cache' }).then((r) => r.json()),
      optionnel(lien('data/veille.json')),
      optionnel(lien('data/parrainages.json')),
      optionnel(lien('data/liste-officielle.json')),
      optionnel(lien('data/francevote.json')),
      optionnel(lien('data/positions-complementaires.json')),
    ]);
    state.fv = fv;
    state.complements = complements;
    state.listeOfficielle = listeOfficielle?.statut === 'publiee' ? listeOfficielle : null;
    state.data = data;
    state.veille = veille;
    state.parrainages = parrainages;
    state.compare = state.compare.filter(parId);
    enTete();
    router();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<p class="chargement">Impossible de charger les données. ${esc(e.message)}</p>`;
  }
}

init();
