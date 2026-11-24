#!/usr/bin/env node
// Vérifie la cohérence de data/candidats.json (lancé en CI avant chaque déploiement).
import { readFile } from 'node:fs/promises';

const d = JSON.parse(await readFile(new URL('../data/candidats.json', import.meta.url), 'utf8'));
const erreurs = [];
const avertissements = []; // non bloquants : affichés, mais n'empêchent ni le commit ni le déploiement
const STATUTS_PROGRAMME = ['non publié', 'partiel', 'complet'];
const MAX_PHARES = 3;

// Correspondance phare ↔ mesure (heuristique, donc seulement un avertissement) :
// un phare doit reprendre le titre d'une mesure, ou au moins 60 % de ses mots significatifs
// doivent figurer dans le titre et le détail d'une même mesure.
const MOTS_VIDES = new Set('les des une dans pour par sur aux avec sans que qui est son ses leur plus moins tous toutes tout entre dont etre faire ans'.split(' '));
const normaliser = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, ' ').replace(/[^a-z0-9%€ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const motsSignificatifs = (s) => normaliser(s).split(' ').filter((m) => (m.length >= 3 || /\d/.test(m)) && !MOTS_VIDES.has(m));
const pharePresent = (phare, mesures) => {
  const p = normaliser(phare);
  const mots = motsSignificatifs(phare);
  return mesures.some((m) => {
    const titre = normaliser(m.titre);
    if (titre && (p.includes(titre) || titre.includes(p))) return true;
    const texte = new Set(motsSignificatifs(`${m.titre} ${m.detail}`));
    return mots.length > 0 && mots.filter((x) => texte.has(x)).length / mots.length >= 0.6;
  });
};
const bords = new Set(d.bords.map((b) => b.id));
const themes = new Set(d.themes.map((t) => t.id));
const enjeux = new Set(d.enjeux.map((e) => e.id));
const ids = new Set();
// Une source doit pointer vers une page précise (article, fiche), pas vers la page d'accueil d'un site.
const sourceValide = (u) => {
  try {
    const x = new URL(u);
    if (x.pathname.length <= 1) return false;                       // page d'accueil
    if (/20(12|17|22)/.test(x.href) && !/2027/.test(x.href)) return false; // élection passée
    return true;
  } catch { return false; }
};

for (const c of d.candidats) {
  const qui = c.id || '(sans id)';
  if (!c.id || ids.has(c.id)) erreurs.push(`${qui} : id manquant ou en double`);
  ids.add(c.id);
  for (const k of ['prenom', 'nom', 'parti', 'partiCourt', 'bord', 'couleur', 'statut', 'programme']) if (!c[k]) erreurs.push(`${qui} : champ « ${k} » manquant`);
  if (!bords.has(c.bord)) erreurs.push(`${qui} : bord inconnu « ${c.bord} »`);
  if (!/^#[0-9a-f]{6}$/i.test(c.couleur)) erreurs.push(`${qui} : couleur invalide`);
  for (const [k, v] of Object.entries(c.positions || {})) {
    if (!enjeux.has(k)) erreurs.push(`${qui} : enjeu inconnu « ${k} »`);
    if (!v?.valeur || !sourceValide(v.source)) erreurs.push(`${qui} : position « ${k} » sans source précise`);
  }
  for (const [t, liste] of Object.entries(c.propositions || {})) {
    if (!themes.has(t)) erreurs.push(`${qui} : thème inconnu « ${t} »`);
    for (const p of liste) {
      if (!p.titre || !p.detail) erreurs.push(`${qui}/${t} : proposition incomplète`);
      if (!sourceValide(p.source)) erreurs.push(`${qui}/${t} : source invalide ou trop vague (page d'accueil) pour « ${p.titre} »`);
    }
  }
  if (c.programme && !STATUTS_PROGRAMME.includes(c.programme)) erreurs.push(`${qui} : statut de programme inconnu « ${c.programme} » (attendu : ${STATUTS_PROGRAMME.join(' / ')})`);
  if (c.phares !== undefined && !Array.isArray(c.phares)) erreurs.push(`${qui} : « phares » doit être une liste`);

  // Règles d'harmonisation des fiches (candidats actifs seulement ; un candidat retiré garde son historique)
  if (c.statut === 'retiré') continue;
  const mesures = Object.values(c.propositions || {}).flat();
  const phares = Array.isArray(c.phares) ? c.phares : [];
  if (phares.length > MAX_PHARES) erreurs.push(`${qui} : ${phares.length} mesures phares (${MAX_PHARES} au maximum)`);
  if (mesures.length && !phares.length) erreurs.push(`${qui} : ${mesures.length} mesure(s) mais aucune mesure phare (en choisir 1 à ${MAX_PHARES} parmi les mesures)`);
  if (!mesures.length && phares.length) erreurs.push(`${qui} : mesures phares sans aucune mesure dans « propositions »`);
  if (c.programme === 'non publié' && mesures.length) erreurs.push(`${qui} : programme « non publié » incompatible avec ${mesures.length} mesure(s) (passer en « partiel » ou « complet »)`);
  if (c.programme !== 'non publié' && !mesures.length) avertissements.push(`${qui} : programme « ${c.programme} » mais aucune mesure`);
  for (const p of phares) {
    if (typeof p !== 'string' || !p.trim()) { erreurs.push(`${qui} : mesure phare vide`); continue; }
    if (mesures.length && !pharePresent(p, mesures)) avertissements.push(`${qui} : le phare « ${p} » ne correspond à aucune mesure (reprendre le titre d'une mesure existante)`);
  }
  if (new Set(phares).size !== phares.length) erreurs.push(`${qui} : mesure phare en double`);
  for (const [k, v] of Object.entries(c.positions || {})) {
    if (v?.valeur && v.valeur.replace(/(\d) (?=\d{3}\b)/g, '$1').split(/\s+/).filter((m) => /[\p{L}\d]/u.test(m)).length > 6) avertissements.push(`${qui} : position « ${k} » trop longue (1 à 5 mots attendus) : « ${v.valeur} »`);
  }
  for (const [t, liste] of Object.entries(c.propositions || {})) for (const p of liste) {
    if (p.detail && p.detail.length < 40) avertissements.push(`${qui}/${t} : détail très court pour « ${p.titre} » (${p.detail.length} caractères)`);
  }
  const textes = [...phares, ...Object.values(c.positions || {}).map((v) => v?.valeur), ...mesures.flatMap((p) => [p.titre, p.detail])];
  for (const s of textes) {
    if (typeof s !== 'string') continue;
    if (s.includes('"')) avertissements.push(`${qui} : guillemets droits (utiliser « ») dans « ${s.slice(0, 60)}… »`);
    if (/[^\s  (\d][:?!](\s|$)/.test(s)) avertissements.push(`${qui} : espace manquante avant « : », « ? » ou « ! » dans « ${s.slice(0, 60)}… »`);
  }
}

// Positions complémentaires (40 propositions) : candidats et propositions existants, sources précises
try {
  const comp = JSON.parse(await readFile(new URL('../data/positions-complementaires.json', import.meta.url), 'utf8'));
  const fv = JSON.parse(await readFile(new URL('../data/francevote.json', import.meta.url), 'utf8').catch(() => 'null'));
  const propsFV = new Set((fv?.propositions || []).map((p) => p.id));
  for (const [id, c] of Object.entries(comp.candidats || {})) {
    if (!ids.has(id)) erreurs.push(`positions complémentaires : candidat inconnu « ${id} »`);
    if (fv?.candidats?.[id]) erreurs.push(`positions complémentaires : « ${id} » est déjà évalué par France-Vote`);
    for (const [k, v] of Object.entries(c.positions || {})) {
      if (propsFV.size && !propsFV.has(k)) erreurs.push(`positions complémentaires ${id} : proposition inconnue « ${k} »`);
      if (![-2, -1, 0, 1, 2].includes(v)) erreurs.push(`positions complémentaires ${id}/${k} : valeur ${v} hors échelle`);
      if (!sourceValide(c.sources?.[k]?.url)) erreurs.push(`positions complémentaires ${id}/${k} : source manquante ou trop vague`);
    }
  }
} catch (e) { if (e.code !== 'ENOENT') erreurs.push(`positions complémentaires illisibles : ${e.message}`); }

if (avertissements.length) console.log(`Avertissements (non bloquants) :\n- ${avertissements.join('\n- ')}\n`);
if (erreurs.length) { console.error(erreurs.join('\n')); process.exit(1); }
console.log(`OK — ${d.candidats.length} candidats, ${d.candidats.reduce((n, c) => n + Object.values(c.propositions || {}).flat().length, 0)} propositions.`);
