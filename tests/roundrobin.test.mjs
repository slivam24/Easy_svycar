import test from 'node:test';
import assert from 'node:assert/strict';
import { bergerTable, roundRobinSchedule, roundRobinRounds } from '../js/roundrobin.js';
import {
  newTournament, newPlayer, renumber, generateRoundRobin, roundRecord, scoreAfter, pendingGames,
  withdrawalEffect, TIEBREAKS_SR_RR,
} from '../js/model.js';
import { computeStandings, tiebreakData, tiebreakValue, tiebreaksFor } from '../js/tiebreaks.js';

const fmt = (rounds) => rounds.map((r) => r.map(([w, b]) => `${w}-${b}`).join(' '));

test('Bergerova tabulka pro 7–8 hráčů odpovídá FIDE C.05, příloha 1', () => {
  assert.deepEqual(fmt(bergerTable(8)), [
    '1-8 2-7 3-6 4-5',
    '8-5 6-4 7-3 1-2',
    '2-8 3-1 4-7 5-6',
    '8-6 7-5 1-4 2-3',
    '3-8 4-2 5-1 6-7',
    '8-7 1-6 2-5 3-4',
    '4-8 5-3 6-2 7-1',
  ]);
  assert.deepEqual(fmt(bergerTable(7)), fmt(bergerTable(8)));
});

test('Bergerova tabulka pro 9–10 hráčů odpovídá FIDE C.05, příloha 1', () => {
  assert.deepEqual(fmt(bergerTable(10)), [
    '1-10 2-9 3-8 4-7 5-6',
    '10-6 7-5 8-4 9-3 1-2',
    '2-10 3-1 4-9 5-8 6-7',
    '10-7 8-6 9-5 1-4 2-3',
    '3-10 4-2 5-1 6-9 7-8',
    '10-8 9-7 1-6 2-5 3-4',
    '4-10 5-3 6-2 7-1 8-9',
    '10-9 1-8 2-7 3-6 4-5',
    '5-10 6-4 7-3 8-2 9-1',
  ]);
});

test('každý hraje s každým právě jednou (dvoukolově dvakrát, jednou bílými a jednou černými)', () => {
  for (let n = 3; n <= 22; n++) {
    for (const cycles of [1, 2]) {
      const sch = roundRobinSchedule(n, cycles);
      assert.equal(sch.length, roundRobinRounds(n, cycles));
      const games = new Map();
      for (const r of sch) {
        const seen = new Set();
        for (const [w, b] of r) {
          assert.ok(!seen.has(w) && !seen.has(b), 'hráč dvakrát v kole');
          seen.add(w).add(b);
          if (w > n || b > n) continue;
          const key = `${Math.min(w, b)}-${Math.max(w, b)}`;
          games.set(key, [...(games.get(key) || []), w]);
        }
      }
      assert.equal(games.size, (n * (n - 1)) / 2);
      for (const whites of games.values()) {
        assert.equal(whites.length, cycles);
        if (cycles === 2) assert.notEqual(whites[0], whites[1]);
      }
    }
  }
});

test('dvoukolový turnaj: nikdo nemá třikrát po sobě stejnou barvu (prohozená poslední dvě kola)', () => {
  for (let n = 3; n <= 20; n++) {
    const sch = roundRobinSchedule(n, 2);
    for (let p = 1; p <= n; p++) {
      const seq = sch
        .map((r) => r.find(([w, b]) => (w === p || b === p) && w <= n && b <= n))
        .filter(Boolean)
        .map(([w]) => (w === p ? 'W' : 'B'))
        .join('');
      assert.doesNotMatch(seq, /WWW|BBB/, `${n} hráčů, č. ${p}: ${seq}`);
    }
  }
});

function rr(n, results, { cycles = 1 } = {}) {
  const t = newTournament({ system: 'rr', cycles, tiebreaks: [...TIEBREAKS_SR_RR] });
  for (let i = 0; i < n; i++) t.players.push(newPlayer(t, { name: `Hráč ${i + 1}`, rating: 2000 - i }));
  renumber(t);
  generateRoundRobin(t);
  // results: { 'a-b': '1-0' } z pohledu hráče a (startovní čísla)
  for (const rd of t.roundsData) {
    for (const g of rd.pairs) {
      const k1 = `${g.white}-${g.black}`;
      const k2 = `${g.black}-${g.white}`;
      if (results[k1]) g.result = results[k1];
      else if (results[k2]) g.result = { '1-0': '0-1', '0-1': '1-0', '½-½': '½-½', '+-': '-+', '-+': '+-', '--': '--' }[results[k2]];
      else g.result = '½-½';
    }
  }
  return t;
}

test('rozpis turnaje: lichý počet hráčů má v každém kole jedno volno', () => {
  const t = rr(5, {});
  assert.equal(t.rounds, 5);
  for (const rd of t.roundsData) {
    assert.equal(rd.pairs.length, 2);
    assert.equal(rd.byes.length, 1);
    assert.equal(rd.byes[0].type, 'RRB');
  }
  // volno nedává body
  for (const p of t.players) assert.equal(scoreAfter(t, p.id, 5), 2);
});

test('SŘ 5.2.4: odstoupení po odehrání aspoň poloviny partií – zbývající partie kontumačně', () => {
  const t = rr(6, {});
  const p = t.players[0];
  p.status = 'withdrawn';
  p.withdrawnFrom = 4; // odehrál 3 z 5 partií
  const eff = withdrawalEffect(t, p.id);
  assert.equal(eff.played, 3);
  assert.equal(eff.from, 4);
  assert.equal(roundRecord(t, p.id, 3).kind, 'game');
  assert.equal(roundRecord(t, p.id, 4).kind, 'forfeitLoss');
  assert.equal(scoreAfter(t, p.id, 5), 1.5);
});

test('SŘ 5.2.4: odstoupení před polovinou partií – všechny partie prohrané kontumací', () => {
  const t = rr(6, {});
  const p = t.players[0];
  p.status = 'withdrawn';
  p.withdrawnFrom = 3; // odehrál 2 z 5 partií
  assert.equal(withdrawalEffect(t, p.id).from, 1);
  for (let r = 1; r <= 5; r++) assert.equal(roundRecord(t, p.id, r).kind, 'forfeitLoss');
  assert.equal(scoreAfter(t, p.id, 5), 0);
  // soupeři mají kontumační výhru, výsledky nejsou potřeba zadávat
  for (let r = 1; r <= 5; r++) t.roundsData[r - 1].pairs.forEach((g) => { if (g.white === p.id || g.black === p.id) g.result = null; });
  assert.equal(pendingGames(t, 3), 0);
});

test('SB v turnaji každý s každým: kontumace se počítá jako partie se skutečným skóre soupeře (C.07 čl. 15.2)', () => {
  // 4 hráči: 1 porazil 2, s 3 remizoval, nad 4 vyhrál kontumačně
  const t = rr(4, { '1-2': '1-0', '1-3': '½-½', '1-4': '+-', '2-3': '1-0', '2-4': '1-0', '3-4': '0-1' });
  const data = tiebreakData(t, 3);
  // skóre: 1 = 2.5, 2 = 2, 3 = 0.5, 4 = 1
  assert.equal(data.score.get(1), 2.5);
  assert.equal(tiebreakValue('SB', 1, data, t), 2 * 1 + 0.5 * 0.5 + 1 * 1);
  // Koya: body proti hráčům s aspoň 50 % (1.5 b. ze 3): hráč 2 → 1 bod
  assert.equal(tiebreakValue('KS', 1, data, t), 1);
  // partie černými: kontumační prohra se nepočítá, kontumační výhra ano (typ B)
  assert.ok(tiebreaksFor('rr').includes('KS'));
  assert.ok(!tiebreaksFor('rr').includes('BH'));
  assert.ok(!tiebreaksFor('dutch').includes('KS'));
});

test('pořadí podle SŘ 5.2.2: Sonneborn-Berger, vzájemné partie, výsledky proti prvnímu, druhému…', () => {
  // 5 hráčů. Hráči 2 a 3 mají stejně bodů (2) i SB (3.75) a spolu remizovali;
  // rozhodne výsledek proti vítězi (hráč 1, 2.5 b.): 2 s ním remizoval, 3 prohrál.
  const t = rr(5, {
    '1-2': '½-½', '1-3': '1-0', '1-4': '1-0', '1-5': '0-1',
    '2-3': '½-½', '2-4': '1-0', '2-5': '0-1',
    '3-4': '½-½', '3-5': '1-0',
    '4-5': '1-0',
  });
  const st = computeStandings(t);
  const s = new Map(st.map((r) => [r.player.id, r]));
  assert.equal(s.get(2).score, s.get(3).score);
  assert.equal(s.get(2).tb.SB, s.get(3).tb.SB);
  assert.ok(s.get(2).rank < s.get(3).rank);
  assert.ok(s.get(2).used.includes('TOP'));
});
