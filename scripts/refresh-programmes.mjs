#!/usr/bin/env node
// Mise à jour hebdomadaire des programmes avec Claude + recherche web.
// Le résultat n'est JAMAIS publié directement : le workflow ouvre une Pull Request
// à relire par un humain avant fusion.
//
// Usage : ANTHROPIC_API_KEY=... node scripts/refresh-programmes.mjs [id1,id2,...]

import { readFile, writeFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const DATA = new URL('../data/candidats.json', import.meta.url);
const data = JSON.parse(await readFile(DATA, 'utf8'));
const themeIds = data.themes.map((t) => t.id);
const enjeuIds = data.enjeux.map((e) => e.id);

const Proposition = z.object({
  titre: z.string().min(3).max(120),
  detail: z.string().min(10).max(600),
  source: z.string().url(),
});
const Reponse = z.object({
  changements: z.string(),
  slogan: z.string().nullable(),
  statut: z.string(),
  programme: z.enum(['complet', 'partiel', 'non publié']),
  phares: z.array(z.string().max(140)).max(5),
  positions: z.record(z.enum(enjeuIds), z.string().max(60)),
  propositions: z.record(z.enum(themeIds), z.array(Proposition).max(8)),
  sources: z.array(z.string().url()).max(10),
});

const client = new Anthropic();
const filtre = process.argv[2]?.split(',');
const cibles = data.candidats.filter((c) => !filtre || filtre.includes(c.id));
const aujourdhui = new Date().toISOString().slice(0, 10);

const SYSTEM = `Tu tiens à jour un comparateur non partisan des programmes de l'élection présidentielle française de 2027.
Règles :
- Neutralité absolue : décris les mesures avec les mots du candidat, sans jugement ni adjectif évaluatif.
- N'ajoute une mesure que si tu as trouvé une source en ligne qui l'attribue explicitement au candidat pour 2027 ; mets l'URL exacte de cette source.
- Préfère, dans l'ordre : site officiel de campagne, presse nationale (Le Monde, Le Figaro, Libération, franceinfo, AFP, Les Échos...), puis les autres sites.
- Conserve les mesures existantes sauf si une source plus récente les contredit ou si le candidat les a abandonnées.
- Si le candidat s'est retiré, mets statut à « retiré » et explique-le dans « changements ».
- Thèmes autorisés : ${themeIds.join(', ')}. Enjeux autorisés pour « positions » (réponse très courte, 1 à 5 mots) : ${enjeuIds.join(', ')}.
- Réponds en français.`;

function consigne(c) {
  const actuel = {
    slogan: c.slogan, statut: c.statut, programme: c.programme, phares: c.phares,
    positions: c.positions, propositions: c.propositions, sources: c.sources,
  };
  return `Nous sommes le ${aujourdhui}. Candidat : ${c.prenom} ${c.nom} (${c.parti}).
Voici sa fiche actuelle (JSON) :
${JSON.stringify(actuel, null, 2)}

Cherche sur le web les annonces récentes de programme de ce candidat pour 2027, puis renvoie la fiche mise à jour.
Termine ta réponse par UN SEUL bloc \`\`\`json contenant un objet avec exactement les clés :
changements (résumé des modifications, ou "aucun"), slogan, statut, programme ("complet" | "partiel" | "non publié"), phares, positions, propositions, sources.`;
}

async function interroger(c) {
  const messages = [{ role: 'user', content: consigne(c) }];
  // Boucle pour les tours mis en pause par l'outil serveur (pause_turn)
  for (let tour = 0; tour < 5; tour++) {
    const stream = client.beta.messages.stream({
      model: 'claude-opus-5-5',
      max_tokens: 32000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: SYSTEM,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8, user_location: { type: 'approximate', country: 'FR' } }],
      messages,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error('refus du modèle');
    if (msg.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: msg.content });
      continue;
    }
    const texte = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const bloc = [...texte.matchAll(/```json\s*([\s\S]*?)```/g)].pop();
    if (!bloc) throw new Error('pas de bloc JSON dans la réponse');
    return Reponse.parse(JSON.parse(bloc[1]));
  }
  throw new Error('trop de reprises (pause_turn)');
}

const resume = [];
for (const c of cibles) {
  process.stdout.write(`→ ${c.prenom} ${c.nom}… `);
  try {
    const r = await interroger(c);
    Object.assign(c, {
      slogan: r.slogan, statut: r.statut, programme: r.programme, phares: r.phares,
      positions: r.positions, propositions: r.propositions, sources: r.sources,
    });
    resume.push(`- **${c.prenom} ${c.nom}** : ${r.changements}`);
    console.log('ok');
  } catch (e) {
    resume.push(`- **${c.prenom} ${c.nom}** : non mis à jour (${e.message})`);
    console.log(`échec : ${e.message}`);
  }
}

data.meta.contenuMisAJour = aujourdhui;
await writeFile(DATA, JSON.stringify(data, null, 2) + '\n');
await writeFile(new URL('../RESUME_MAJ.md', import.meta.url), `## Mise à jour des programmes du ${aujourdhui}\n\n${resume.join('\n')}\n\n> Généré automatiquement avec recherche web. **Vérifiez chaque source avant de fusionner.**\n`);
console.log('Terminé.');
