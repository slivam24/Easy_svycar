import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newTeamTournament, newTeam, newRosterPlayer, generateTeamRoundRobin, pairNextTeamRound, teamRecord,
  teamTotals, teamStandings, matchScore, boardResult, homeIsWhite, pendingMatches, teamWithdrawal,
  playerResults, renumberTeams,
} from '../js/team.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function build(n, { system = 'rr', boards = 4, cycles = 1 } = {}) {
  const t = newTeamTournament({ system, boards, cycles });
  for (let i = 0; i < n; i++) {
    const team = newTeam(t, { name: `Družstvo ${String.fromCharCode(65 + i)}` });
    for (let b = 0; b < boards + 2; b++) team.roster.push(newRosterPlayer(t, { name: `${team.name} ${b + 1}`, rating: 2300 - i * 50 - b * 20 }));
    t.teams.push(team);
  }
  renumberTeams(t);
  return t;
}

// výsledky šachovnic z pohledu domácích, např. ['1-0', '½-½', '0-1', '1-0']
function setBoards(t, r, home, results) {
  const m = t.roundsData[r - 1].matches.find((x) => x.home === home || x.away === home);
  const h = t.teams.find((x) => x.id === m.home).roster;
  const a = t.teams.find((x) => x.id === m.away).roster;
  const flip = { '1-0': '0-1', '0-1': '1-0', '½-½': '½-½', '+-': '-+', '-+': '+-', '--': '--' };
  m.boards = results.map((res, i) => ({ hp: h[i].id, ap: a[i].id, result: m.home === home ? res : flip[res] }));
  return m;
}

test('utkání: skóre, zápasové body 3/1/0 (SŘ 5.3.1–5.3.2) a barvy na šachovnicích (SŘ 3.4.1)', () => {
  const t = build(4);
  generateTeamRoundRobin(t);
  assert.equal(t.rounds, 3);
  const m = setBoards(t, 1, t.roundsData[0].matches[0].home, ['1-0', '½-½', '0-1', '1-0']);
  const s = matchScore(t, m);
  assert.equal(s.home, 2.5);
  assert.equal(s.away, 1.5);
  assert.equal(teamRecord(t, m.home, 1).mp, 3);
  assert.equal(teamRecord(t, m.away, 1).mp, 0);
  assert.equal(teamRecord(t, m.home, 1).wins, 2);
  assert.ok(homeIsWhite(0) && !homeIsWhite(1) && homeIsWhite(2));
  // remíza 2:2 = 1 zápasový bod
  const m2 = setBoards(t, 1, t.roundsData[0].matches[1].home, ['1-0', '0-1', '½-½', '½-½']);
  assert.equal(teamRecord(t, m2.home, 1).mp, 1);
  assert.equal(teamRecord(t, m2.away, 1).mp, 1);
  assert.equal(pendingMatches(t, 1), 0);
});

test('neobsazená šachovnice je kontumace pro soupeře', () => {
  assert.equal(boardResult({ hp: 1, ap: null, result: null }), '+-');
  assert.equal(boardResult({ hp: null, ap: 2, result: null }), '-+');
  assert.equal(boardResult({ hp: null, ap: null, result: null }), '--');
  assert.equal(boardResult({ hp: 1, ap: 2, result: null }), null);
});

test('SŘ 5.3.6: odstoupení po polovině utkání – zbývající kontumace; dříve – anulování', () => {
  const t = build(5);
  generateTeamRoundRobin(t);
  for (let r = 1; r <= t.rounds; r++) {
    for (const m of t.roundsData[r - 1].matches) setBoards(t, r, m.home, ['1-0', '1-0', '0-1', '½-½']);
  }
  const team = t.teams[0];
  // kola, ve kterých družstvo hraje (5 družstev: jedno volno)
  const playRounds = t.roundsData.map((rd, i) => (rd.matches.some((m) => m.home === team.id || m.away === team.id) ? i + 1 : null)).filter(Boolean);
  team.status = 'withdrawn';
  team.withdrawnFrom = playRounds[2]; // odehrálo 2 ze 4 utkání = polovina
  let w = teamWithdrawal(t, team.id);
  assert.equal(w.annul, false);
  assert.equal(teamRecord(t, team.id, playRounds[2]).kind, 'forfeitLoss');
  assert.equal(teamRecord(t, team.id, playRounds[0]).kind, 'match');
  team.withdrawnFrom = playRounds[1]; // odehrálo 1 ze 4
  w = teamWithdrawal(t, team.id);
  assert.equal(w.annul, true);
  for (const r of playRounds) assert.equal(teamRecord(t, team.id, r).kind, 'annulled');
  assert.equal(teamTotals(t, team.id).mp, 0);
});

test('pořadí každý s každým podle SŘ 5.3.3: zápasové body, skóre, vyhrané partie, vzájemná utkání', () => {
  const t = build(4);
  generateTeamRoundRobin(t);
  const [A, B, C, D] = t.teams.map((x) => x.id);
  const res = new Map([
    [`${A}-${B}`, ['1-0', '1-0', '½-½', '0-1']], // A 2.5 : 1.5
    [`${A}-${C}`, ['0-1', '½-½', '½-½', '0-1']], // A 1 : 3
    [`${A}-${D}`, ['1-0', '1-0', '1-0', '0-1']], // A 3 : 1
    [`${B}-${C}`, ['1-0', '1-0', '½-½', '½-½']], // B 3 : 1
    [`${B}-${D}`, ['1-0', '1-0', '1-0', '1-0']], // B 4 : 0
    [`${C}-${D}`, ['0-1', '½-½', '½-½', '0-1']], // C 1 : 3
  ]);
  for (let r = 1; r <= 3; r++) {
    for (const m of t.roundsData[r - 1].matches) {
      const k = res.get(`${m.home}-${m.away}`) ? `${m.home}-${m.away}` : `${m.away}-${m.home}`;
      setBoards(t, r, Number(k.split('-')[0]), res.get(k));
    }
  }
  // ZB: A 6, B 6, C 3, D 3; skóre: A 6.5, B 8.5
  const st = teamStandings(t);
  assert.deepEqual(st.slice(0, 2).map((x) => x.team.id), [B, A]);
  assert.equal(st[0].mp, 6);
  assert.equal(st[0].gp, 8.5);
  assert.equal(st[1].gp, 6.5);
  // C a D: 3 ZB, skóre C 5, D 4 → C před D
  assert.equal(st[2].team.id, C);
});

test('vzájemná utkání rozhodnou, když jsou ZB, skóre i vyhrané partie stejné', () => {
  const t = build(4);
  generateTeamRoundRobin(t);
  const [A, B, C, D] = t.teams.map((x) => x.id);
  const res = new Map([
    [`${A}-${B}`, ['1-0', '½-½', '½-½', '½-½']], // A vyhrál 2.5 : 1.5
    [`${A}-${C}`, ['0-1', '½-½', '½-½', '½-½']], // A prohrál 1.5 : 2.5
    [`${A}-${D}`, ['1-0', '½-½', '½-½', '½-½']], // A vyhrál 2.5 : 1.5
    [`${B}-${C}`, ['1-0', '½-½', '½-½', '½-½']], // B vyhrál 2.5 : 1.5
    [`${B}-${D}`, ['1-0', '½-½', '½-½', '½-½']], // B vyhrál 2.5 : 1.5
    [`${C}-${D}`, ['1-0', '½-½', '½-½', '0-1']], // 2 : 2
  ]);
  for (let r = 1; r <= 3; r++) {
    for (const m of t.roundsData[r - 1].matches) {
      const k = res.get(`${m.home}-${m.away}`) ? `${m.home}-${m.away}` : `${m.away}-${m.home}`;
      setBoards(t, r, Number(k.split('-')[0]), res.get(k));
    }
  }
  const st = teamStandings(t);
  const row = (id) => st.find((x) => x.team.id === id);
  // A i B: 6 ZB, skóre 6.5, vyhrané partie 2 → rozhodne vzájemné utkání (A vyhrál)
  assert.equal(row(A).mp, row(B).mp);
  assert.equal(row(A).gp, row(B).gp);
  assert.equal(row(A).wins, row(B).wins);
  assert.ok(row(A).rank < row(B).rank);
  assert.ok(row(A).used.includes('EDE'));
});

test('švýcarský systém družstev: losování všech kol bez opakování soupeřů, volno při lichém počtu', () => {
  const r = rng(5);
  const t = build(9, { system: 'dutch', boards: 4 });
  t.rounds = 5;
  for (let k = 1; k <= 5; k++) {
    pairNextTeamRound(t, { random: r });
    const rd = t.roundsData[k - 1];
    assert.equal(rd.matches.length, 4);
    assert.equal(rd.byes.length, 1);
    for (const m of rd.matches) {
      for (let q = 1; q < k; q++) assert.notEqual(teamRecord(t, m.home, q).opp, m.away);
      const res = ['1-0', '½-½', '0-1'];
      setBoards(t, k, m.home, Array.from({ length: 4 }, () => res[Math.floor(r() * 3)]));
    }
  }
  // volno dostal pokaždé jiný tým (C.04.1 čl. 4)
  const byes = t.roundsData.map((rd) => rd.byes[0].team);
  assert.equal(new Set(byes).size, 5);
  const st = teamStandings(t);
  assert.equal(st.length, 9);
  assert.ok(st[0].mp >= st[8].mp);
  assert.ok('BH-MP' in st[0].tb && 'BH-GP-C1' in st[0].tb);
});

test('výsledky jednotlivců ze soupisek', () => {
  const t = build(3, { boards: 2 });
  generateTeamRoundRobin(t);
  for (let r = 1; r <= t.rounds; r++) for (const m of t.roundsData[r - 1].matches) setBoards(t, r, m.home, ['1-0', '½-½']);
  const res = playerResults(t);
  const first = res.filter((x) => x.boards.every((b) => b === 1));
  assert.ok(first.length > 0);
  assert.ok(res.every((x) => x.games >= 1));
});
