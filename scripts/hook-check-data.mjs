#!/usr/bin/env node
// Hooks Claude Code (voir .claude/settings.json) — garde-fous sur les données du site.
//   post : après une modification de data/*.json, lance check-data et renvoie les erreurs à Claude.
//   pre  : avant un « git commit », lance check-data et BLOQUE le commit en cas d'erreur.
// Entrée : JSON de l'événement sur stdin (tool_input.file_path ou tool_input.command).

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
const RACINE = fileURLToPath(new URL('../', import.meta.url));
let evenement = {};
try { evenement = JSON.parse(await new Promise((r) => { let s = ''; process.stdin.on('data', (d) => (s += d)); process.stdin.on('end', () => r(s || '{}')); })); } catch { process.exit(0); }
const entree = evenement.tool_input || {};

const verifier = () => {
  try { execFileSync(process.execPath, ['scripts/check-data.mjs'], { cwd: RACINE, stdio: 'pipe' }); return null; }
  catch (e) { return String(e.stderr || e.stdout || e.message).trim(); }
};

if (mode === 'post') {
  const fichier = String(entree.file_path || '');
  if (!/[\\/]data[\\/][^\\/]+\.json$/.test(fichier)) process.exit(0);
  const erreurs = verifier();
  if (erreurs) {
    // PostToolUse : decision « block » renvoie la raison à Claude, qui doit corriger
    process.stdout.write(JSON.stringify({ decision: 'block', reason: `check-data a trouvé des erreurs après la modification de ${fichier} :\n${erreurs}\nCorrige-les avant de continuer.` }));
  }
  process.exit(0);
}

if (mode === 'pre') {
  if (!/\bgit\b[^|;&]*\bcommit\b/.test(String(entree.command || ''))) process.exit(0);
  const erreurs = verifier();
  if (erreurs) {
    // PreToolUse : code 2 = l'appel est bloqué et stderr est renvoyé à Claude
    process.stderr.write(`Commit bloqué : node scripts/check-data.mjs échoue.\n${erreurs}\n`);
    process.exit(2);
  }
  process.exit(0);
}
