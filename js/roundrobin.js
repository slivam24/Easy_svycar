// Turnaj každý s každým: Bergerovy tabulky podle FIDE C.05, příloha 1.
//
// Při lichém počtu hráčů je nejvyšší číslo volno. U dvoukolového turnaje se podle doporučení FIDE
// prohodí poslední dvě kola prvního cyklu (aby nikdo neměl třikrát po sobě stejnou barvu)
// a druhý cyklus má obrácené barvy.

/**
 * Bergerova tabulka pro n hráčů.
 * @param {number} n počet hráčů (startovní čísla 1..n)
 * @returns {Array<Array<[number, number]>>} kola, v každém dvojice [bílý, černý] podle šachovnic;
 *   při lichém n je číslo n+1 volno
 */
export function bergerTable(n) {
  const N = n % 2 ? n + 1 : n;
  const m = N - 1;
  const wrap = (x) => ((((x - 1) % m) + m) % m) + 1;
  const rounds = [];
  for (let r = 1; r <= m; r++) {
    // soupeř hráče N: 2a ≡ r + 1 (mod N − 1)
    let a = 1;
    while ((2 * a) % m !== (r + 1) % m) a++;
    const pairs = [r % 2 ? [a, N] : [N, a]];
    for (let k = 2; k <= N / 2; k++) pairs.push([wrap(a + k - 1), wrap(a - (k - 1))]);
    rounds.push(pairs);
  }
  return rounds;
}

/**
 * Rozpis všech kol (jedno- nebo dvoukolový turnaj).
 * @returns {Array<Array<[number, number]>>} dvojice startovních čísel; volno je číslo > n
 */
export function roundRobinSchedule(n, cycles = 1) {
  const first = bergerTable(n);
  if (cycles === 1) return first;
  const c1 = first.slice();
  if (c1.length >= 2) [c1[c1.length - 2], c1[c1.length - 1]] = [c1[c1.length - 1], c1[c1.length - 2]];
  const c2 = first.map((pairs) => pairs.map(([w, b]) => [b, w]));
  return [...c1, ...c2];
}

/** Počet kol turnaje každý s každým. */
export function roundRobinRounds(n, cycles = 1) {
  if (n < 2) return 0;
  return (n % 2 ? n : n - 1) * cycles;
}
