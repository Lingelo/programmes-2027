// Construction des biographies à partir de Wikipédia (résumé) et Wikidata (faits structurés).
// Utilisé par sync-wikipedia.mjs (robot quotidien). Aucune dépendance.

const UA = 'programmes-2027/1.0 (https://github.com/lingelo/programmes-2027)';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url) {
  for (let essai = 1; essai <= 4; essai++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
      if (r.ok) return r.json();
      if (r.status === 404) return null;
    } catch { /* réseau */ }
    await pause(800 * 2 ** essai);
  }
  return null;
}

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#160': ' ', '#39': "'" };
const decoder = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITES[n] ?? m);

async function texte(url) {
  for (let essai = 1; essai <= 4; essai++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
      if (r.ok) return r.text();
      if (r.status === 404) return null;
    } catch { /* réseau */ }
    await pause(1500 * 2 ** essai);
  }
  return null;
}

// Introduction complète de l'article (section 0), nettoyée
async function introWikipedia(titre) {
  for (const host of ['fr.wikipedia.org', 'fr.m.wikipedia.org']) {
    const html = await texte(`https://${host}/api/rest_v1/page/html/${encodeURIComponent(titre)}`);
    if (!html) continue;
    const section0 = html.split(/<section data-mw-section-id="1"/)[0];
    const paragraphes = [...section0.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
      .map((m) => decoder(m[1]
        .replace(/<sup[\s\S]*?<\/sup>/g, '')
        .replace(/<style[\s\S]*?<\/style>/g, '')
        .replace(/<[^>]+>/g, ''))
        .replace(/\s+/g, ' ').replace(/\s+([,.;)])/g, '$1').trim())
      .filter((t) => t.length > 60 && !/[{}]|<|wt":/.test(t) && !/^(Pour les articles homonymes|Ne doit pas être confondu|Cet article)/.test(t));
    if (!paragraphes.length) continue;
    // On garde l'intro dans la limite d'environ 1 400 caractères (paragraphes entiers)
    const garde = [];
    for (const p of paragraphes) {
      if (garde.length && garde.join(' ').length + p.length > 1400) break;
      garde.push(p);
    }
    return garde;
  }
  return null;
}

// Résumé de l'article Wikipédia en français (hôte mobile : même contenu, quotas distincts)
async function resumeWikipedia(titre) {
  for (const host of ['fr.wikipedia.org', 'fr.m.wikipedia.org']) {
    const j = await json(`https://${host}/api/rest_v1/page/summary/${encodeURIComponent(titre)}`);
    if (j?.extract) return { texte: j.extract, url: j.content_urls?.desktop?.page || `https://fr.wikipedia.org/wiki/${encodeURIComponent(titre)}` };
  }
  return null;
}

const valeur = (claim) => claim?.mainsnak?.datavalue?.value;
const idDe = (claim) => valeur(claim)?.id;
const dateDe = (v) => {
  if (!v?.time) return null;
  const m = v.time.match(/^\+?(-?\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  // précision Wikidata : 9 = année, 10 = mois, 11 = jour
  if (v.precision <= 9) return m[1];
  if (v.precision === 10) return `${m[1]}-${m[2]}`;
  return `${m[1]}-${m[2]}-${m[3]}`;
};
const qualif = (claim, p) => claim?.qualifiers?.[p]?.[0]?.datavalue?.value;

async function libelles(ids) {
  const out = {};
  const liste = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < liste.length; i += 50) {
    const j = await json(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${liste.slice(i, i + 50).join('|')}&props=labels&languages=fr|en&format=json`);
    for (const [id, e] of Object.entries(j?.entities || {})) out[id] = e.labels?.fr?.value || e.labels?.en?.value || null;
  }
  return out;
}

// Faits structurés depuis Wikidata (via le titre de l'article fr)
export async function faitsWikidata(titre) {
  const j = await json(`https://www.wikidata.org/w/api.php?action=wbgetentities&sites=frwiki&titles=${encodeURIComponent(titre)}&props=claims&format=json`);
  const ent = Object.values(j?.entities || {})[0];
  if (!ent || ent.missing !== undefined) return null;
  const c = ent.claims || {};
  const rangOk = (cl) => cl.rank !== 'deprecated';

  const naissance = dateDe(valeur(c.P569?.[0]));
  const genre = { Q6581072: 'f', Q6581097: 'm' }[idDe(c.P21?.[0])] || null;
  const lieuId = idDe(c.P19?.[0]);
  const professions = (c.P106 || []).filter(rangOk).map(idDe);
  const formations = (c.P69 || []).filter(rangOk).map(idDe);
  const fonctionsBrutes = (c.P39 || []).filter(rangOk).map((cl) => ({
    id: idDe(cl),
    debut: dateDe(qualif(cl, 'P580')),
    fin: dateDe(qualif(cl, 'P582')),
  })).filter((f) => f.id);

  const noms = await libelles([lieuId, ...professions, ...formations, ...fonctionsBrutes.map((f) => f.id)]);

  // Fusion des mandats répétés (ex. plusieurs législatures de député)
  const parLibelle = new Map();
  for (const f of fonctionsBrutes) {
    const label = noms[f.id];
    if (!label) continue;
    const enCours = Boolean(f.debut && !f.fin);
    const prec = parLibelle.get(label);
    if (!prec) { parLibelle.set(label, { label, debut: f.debut, fin: f.fin, enCours }); continue; }
    if (f.debut && (!prec.debut || f.debut < prec.debut)) prec.debut = f.debut;
    if (f.fin && (!prec.fin || f.fin > prec.fin)) prec.fin = f.fin;
    prec.enCours ||= enCours;
  }
  for (const f of parLibelle.values()) { if (f.enCours) f.fin = null; delete f.enCours; }
  const fonctions = [...parLibelle.values()]
    .sort((a, b) => (b.debut || '0').localeCompare(a.debut || '0'))
    .slice(0, 10);

  return nettoyer({
    wikidata: ent.id,
    genre,
    naissance,
    lieuNaissance: noms[lieuId] || null,
    professions: [...new Set(professions.map((id) => noms[id]).filter(Boolean))].slice(0, 6),
    formation: [...new Set(formations.map((id) => noms[id]).filter(Boolean))].slice(0, 5),
    fonctions,
  });
}

// ---------- Nettoyage des libellés Wikidata ----------
// Exclut les catégories socio-professionnelles INSEE et les termes trop génériques
const PROFESSIONS_VAGUES = /^(personnalité politique|homme politique|femme politique|permanent politique|politicien|politicienne|maire|fonctionnaire|militant|militante|enseignant de gymnasium)$|^(professions?|personnes|cadres|ouvriers|employés|artisans|agriculteurs|agent général)\b|,/i;
const FONCTIONS_VAGUES = /^(président|présidente|conseiller|conseillère|membre|maire|député|députée|ministre|secrétaire|porte-parole|chef adjoint|cheffe adjointe)$|^(membre du conseil d'administration|président du conseil de surveillance)$/i;

// « conseiller ou conseillère » -> forme accordée au genre de la personne
export function accorder(label, genre) {
  return label.replace(/([\p{L}'-]+) ou ([\p{L}'-]+)/gu, (_, m, f) => (genre === 'f' ? f : m));
}

export function nettoyer(b) {
  const a = (l) => accorder(l, b.genre);
  b.professions = [...new Set(b.professions.map(a))].filter((l) => !PROFESSIONS_VAGUES.test(l));
  b.fonctions = b.fonctions.map((f) => ({ ...f, label: a(f.label) })).filter((f) => !FONCTIONS_VAGUES.test(f.label));
  return b;
}

export async function construireBio(titre) {
  const intro = await introWikipedia(titre);
  const resume = await resumeWikipedia(titre);
  const faits = await faitsWikidata(titre);
  if (!intro && !resume && !faits) return null;
  return {
    paragraphes: intro || (resume?.texte ? [resume.texte] : []),
    wikipedia: resume?.url || `https://fr.wikipedia.org/wiki/${encodeURIComponent(titre)}`,
    ...(faits || {}),
    majLe: new Date().toISOString().slice(0, 10),
  };
}
