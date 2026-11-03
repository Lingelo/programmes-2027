// Veille des candidatures : lecture de la page https://www.france-vote.fr/candidats
// Deuxième source, en plus de Wikipédia : France-Vote recense des candidats déclarés que
// la page Wikipédia ne liste pas toujours (ex. Juan Branco, annoncé le 19 décembre 2025).
//
// Deux endroits de la page sont lus :
//  - les fiches (h2 = nom, p = parti, span = statut) : on ne garde que « Candidature déclarée » ;
//  - les données structurées (ItemList schema.org) : les personnes qui n'ont pas de fiche
//    détaillée y figurent aussi, dans la rubrique des « autres candidatures déclarées ».

export const URL_FRANCE_VOTE = 'https://www.france-vote.fr/candidats';

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’' };
const decoder = (s) => String(s).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&([a-z]+);/gi, (m, n) => ENTITES[n] ?? m).trim();

/** Renvoie [{ nom, parti, statut }] des candidatures déclarées listées par France-Vote. */
export function lireFranceVote(html) {
  const fiches = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>\s*<p[^>]*>([^<]*)<\/p>\s*<span[^>]*>([^<]+)<\/span>/g)]
    .map((m) => ({ nom: decoder(m[1]), parti: decoder(m[2]), statut: decoder(m[3]) }));
  const avecFiche = new Set(fiches.map((f) => f.nom));
  const declares = fiches.filter((f) => /candidature\s+d[ée]clar[ée]e/i.test(f.statut));

  // Personnes des données structurées sans fiche détaillée = « autres candidatures déclarées »
  for (const bloc of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let j;
    try { j = JSON.parse(bloc[1]); } catch { continue; }
    const listes = [j, ...(j['@graph'] || [])].filter((x) => x?.['@type'] === 'ItemList');
    for (const liste of listes) {
      for (const el of liste.itemListElement || []) {
        const p = el.item || el;
        if (p?.['@type'] !== 'Person' || !p.name || avecFiche.has(p.name)) continue;
        declares.push({ nom: decoder(p.name), parti: decoder(p.affiliation?.name || ''), statut: 'Candidature déclarée' });
      }
    }
  }
  // Sans doublons
  return [...new Map(declares.map((d) => [d.nom, d])).values()];
}
