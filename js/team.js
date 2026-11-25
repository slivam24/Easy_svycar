// Soutěže družstev: model, rozpis (každý s každým), losování (švýcarský systém) a pořadí.
//
// Pravidla: Soutěžní řád ŠSČR (SŘ) čl. 3.4.1 (domácí mají na lichých šachovnicích bílé),
// 5.3.1–5.3.2 (skóre, zápasové body 3/1/0), 5.3.3 a 5.3.4 (pořadí), 5.3.6 (odstoupení družstva);
// FIDE C.07 čl. 13 (pomocná hodnocení družstev) a čl. 16 (neodehraná kola ve švýcarském systému);
// losování švýcarským systémem podle FIDE C.04.3 se zápasovými body jako hlavním skóre.
//
// Turnaj družstev:
//   { kind: 'team', system: 'rr' | 'dutch', cycles, boards, matchPoints: { win, draw, loss },
//     pabGamePoints, teams: [...], roundsData: [{ matches: [...], byes: [...] }], tiebreaks, ... }
// Družstvo: { id, name, club, tpn, status, withdrawnFrom, roster: [hráč] }
//   hráč na soupisce: { id, name, title, rating, fideId }
// Utkání: { home, away, boards: null | [{ hp, ap, result }] }
//   boards = null: sestavy podle pořadí na soupisce (výsledky zatím nezadané)
//   hp / ap = id hráče nebo null (neobsazená šachovnice)

import { pairDutch } from './dutch.js';
import { roundRobinSchedule, roundRobinRounds } from './roundrobin.js';
import { newTournament, initialOrder, newRoundId } from './model.js';

export const TEAM_TIEBREAKS = {
  GP: { label: 'Skóre (součet bodů z partií)', short: 'Skóre', help: 'Game Points (C.07 čl. 13.1), SŘ 5.3.3 b), 5.3.4 c)' },
  WONG: { label: 'Vyhrané partie', short: 'VP', help: 'Součet vyhraných partií ze všech utkání, SŘ 5.3.3 c)' },
  EDE: { label: 'Vzájemná utkání', short: 'Vz', help: 'Extended Direct Encounter (C.07 čl. 13.3), SŘ 5.3.3 d)' },
  TOP: { label: 'Výsledek proti vítězi, druhému…', short: '1., 2.…', help: 'SŘ 5.3.3 e)' },
  'BH-MP': { label: 'Buchholz ze zápasových bodů', short: 'BH-ZB', help: 'Buchholz (C.07 čl. 8.1, 13), SŘ 5.3.4 b)' },
  'BH-GP-C1': { label: 'Buchholz ze skóre bez nejhoršího', short: 'BH-S-1', help: 'Buchholz Cut-1 ze skóre (C.07 čl. 14.1), SŘ 5.3.4 d)' },
  'BH-GP': { label: 'Buchholz ze skóre', short: 'BH-S', help: 'Buchholz ze skóre (C.07 čl. 13), SŘ 5.3.4 e)' },
  EMGSB: { label: 'Rozšířený Sonneborn-Berger', short: 'ESB', help: 'ZB soupeře × skóre proti němu, EMGSB (C.07 čl. 13.2.2)' },
};

/** SŘ 5.3.3: každý s každým (po zápasových bodech). */
export const TEAM_TB_SR_RR = Object.freeze(['GP', 'WONG', 'EDE', 'TOP']);
/** SŘ 5.3.4: švýcarský systém (po zápasových bodech). */
export const TEAM_TB_SR_SWISS = Object.freeze(['BH-MP', 'GP', 'BH-GP-C1', 'BH-GP']);

const SWISS_ONLY = ['BH-MP', 'BH-GP-C1', 'BH-GP'];
export function teamTiebreaksFor(system) {
  return Object.keys(TEAM_TIEBREAKS).filter((c) => system !== 'rr' || !SWISS_ONLY.includes(c));
}

export const isTeam = (t) => t?.kind === 'team';

export function newTeamTournament(over = {}) {
  const system = over.system || 'rr';
  return newTournament({
    kind: 'team',
    system,
    cycles: 1,
    boards: 8,
    matchPoints: { win: 3, draw: 1, loss: 0 },
    pabGamePoints: null, // null = jako výhra na všech šachovnicích (C.07 čl. 12)
    teams: [],
    nextPlayerId: 1,
    tiebreaks: [...(system === 'rr' ? TEAM_TB_SR_RR : TEAM_TB_SR_SWISS)],
    rounds: 0,
    ...over,
  });
}

export function newTeam(t, over = {}) {
  const id = t.teams.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  return { id, name: '', club: '', tpn: 0, status: 'active', withdrawnFrom: null, roster: [], ...over };
}

export function newRosterPlayer(t, over = {}) {
  const id = t.nextPlayerId || 1;
  t.nextPlayerId = id + 1;
  return { id, name: '', title: '', rating: 0, fideId: '', ...over };
}

export const teamById = (t, id) => t.teams.find((x) => x.id === id);

export function rosterPlayer(t, pid) {
  for (const team of t.teams) {
    const p = team.roster.find((x) => x.id === pid);
    if (p) return { player: p, team };
  }
  return null;
}

/** Síla družstva: průměrný rating hráčů na prvních šachovnicích soupisky (C.04.2 čl. 2.1). */
export function teamStrength(t, team) {
  const top = team.roster.slice(0, t.boards).map((p) => Number(p.rating) || 0);
  return top.length ? top.reduce((a, b) => a + b, 0) / top.length : 0;
}

/** Nasazovací čísla družstev: podle síly, nebo vylosovaná. */
export function renumberTeams(t) {
  if (!t.tpnManual && !t.roundsData.length) {
    [...t.teams]
      .sort((a, b) => teamStrength(t, b) - teamStrength(t, a) || initialOrder({ name: a.name, id: a.id }, { name: b.name, id: b.id }))
      .forEach((x, i) => (x.tpn = i + 1));
  } else {
    let max = Math.max(0, ...t.teams.map((x) => x.tpn || 0));
    for (const x of t.teams) if (!x.tpn) x.tpn = ++max;
  }
  t.teams.sort((a, b) => a.tpn - b.tpn);
  return t;
}

export function drawTeamNumbers(t, random = Math.random) {
  const ids = t.teams.map((x) => x.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  ids.forEach((id, i) => (teamById(t, id).tpn = i + 1));
  t.tpnManual = true;
  t.teams.sort((a, b) => a.tpn - b.tpn);
}

export function teamNumbersByStrength(t) {
  t.tpnManual = false;
  renumberTeams(t);
}

// ------------------------------------------------------------------ utkání a výsledky

/** Výchozí sestavy: hráči v pořadí soupisky od 1. šachovnice (SŘ 3.6.2). */
export function defaultBoards(t, m) {
  const h = teamById(t, m.home)?.roster || [];
  const a = teamById(t, m.away)?.roster || [];
  return Array.from({ length: t.boards }, (_, i) => ({ hp: h[i]?.id ?? null, ap: a[i]?.id ?? null, result: null }));
}

export const matchBoards = (t, m) => m.boards || defaultBoards(t, m);

/** Výsledek šachovnice s ohledem na neobsazené šachovnice (kontumace). */
export function boardResult(b) {
  if (!b.hp && !b.ap) return '--';
  if (!b.hp) return '-+';
  if (!b.ap) return '+-';
  return b.result;
}

const BOARD_POINTS = { '1-0': [1, 0], '½-½': [0.5, 0.5], '0-1': [0, 1], '+-': [1, 0], '-+': [0, 1], '--': [0, 0] };

/** Domácí mají na lichých šachovnicích bílé (SŘ 3.4.1). */
export const homeIsWhite = (boardIndex) => boardIndex % 2 === 0;

/** Skóre utkání. */
export function matchScore(t, m) {
  const boards = matchBoards(t, m);
  let home = 0;
  let away = 0;
  let homeWins = 0;
  let awayWins = 0;
  let pending = 0;
  let homePresent = 0;
  let awayPresent = 0;
  for (const b of boards) {
    if (b.hp) homePresent++;
    if (b.ap) awayPresent++;
    const r = boardResult(b);
    if (!r) {
      pending++;
      continue;
    }
    const [h, a] = BOARD_POINTS[r];
    home += h;
    away += a;
    if (h === 1) homeWins++;
    if (a === 1) awayWins++;
  }
  return { home, away, homeWins, awayWins, pending, homeAbsent: homePresent === 0, awayAbsent: awayPresent === 0 };
}

/**
 * SŘ 5.3.6: družstvo, které vystoupilo (nebo bylo vyloučeno) po odehrání aspoň poloviny utkání,
 * má zbývající utkání kontumovaná; jinak se všechna jeho utkání anulují.
 */
export function teamWithdrawal(t, tid) {
  const team = teamById(t, tid);
  if (!team || team.status !== 'withdrawn' || !team.withdrawnFrom) return null;
  let total = 0;
  let played = 0;
  t.roundsData.forEach((rd, i) => {
    const m = rd.matches.find((x) => x.home === tid || x.away === tid);
    if (!m) return;
    total++;
    if (i + 1 < team.withdrawnFrom) played++;
  });
  if (t.system !== 'rr') return { from: team.withdrawnFrom, annul: false, played, total };
  return played * 2 >= total ? { from: team.withdrawnFrom, annul: false, played, total } : { from: 1, annul: true, played, total };
}

/** Jak se utkání v kole r počítá (vliv odstoupení). null = normálně. */
export function matchOverride(t, m, r) {
  const wh = teamWithdrawal(t, m.home);
  const wa = teamWithdrawal(t, m.away);
  if ((wh && wh.annul) || (wa && wa.annul)) return { annul: true };
  const hOut = wh && r >= wh.from;
  const aOut = wa && r >= wa.from;
  if (hOut && aOut) return { forfeit: 'both' };
  if (hOut) return { forfeit: 'home' };
  if (aOut) return { forfeit: 'away' };
  return null;
}

/**
 * Záznam družstva v kole r: { kind, opp, colour, mp, gp, wins, pending }.
 * kind: 'match' (odehrané utkání), 'forfeitWin', 'forfeitLoss' (nenastoupilo), 'PAB', 'RRB' (volno),
 *       'annulled' (anulované utkání), 'absent'
 */
export function teamRecord(t, tid, r) {
  const rd = t.roundsData[r - 1];
  if (!rd) return null;
  const mp = t.matchPoints;
  const m = rd.matches.find((x) => x.home === tid || x.away === tid);
  if (m) {
    const home = m.home === tid;
    const opp = home ? m.away : m.home;
    const colour = home ? 'W' : 'B';
    const ov = matchOverride(t, m, r);
    if (ov?.annul) return { kind: 'annulled', opp, colour, mp: 0, gp: 0, wins: 0, pending: false };
    if (ov?.forfeit) {
      const lost = ov.forfeit === 'both' || (ov.forfeit === 'home') === home;
      return lost
        ? { kind: 'forfeitLoss', opp, colour, mp: mp.loss, gp: 0, wins: 0, pending: false, forced: true }
        : { kind: 'forfeitWin', opp, colour, mp: mp.win, gp: t.boards, wins: t.boards, pending: false, forced: true };
    }
    const s = matchScore(t, m);
    const my = home ? s.home : s.away;
    const their = home ? s.away : s.home;
    const wins = home ? s.homeWins : s.awayWins;
    const absentMe = home ? s.homeAbsent : s.awayAbsent;
    const absentThem = home ? s.awayAbsent : s.homeAbsent;
    const points = my > their ? mp.win : my === their ? mp.draw : mp.loss;
    let kind = 'match';
    if (absentMe) kind = 'forfeitLoss';
    else if (absentThem) kind = 'forfeitWin';
    return { kind, opp, colour, mp: s.pending ? 0 : points, gp: my, wins, pending: s.pending > 0 };
  }
  const bye = rd.byes.find((b) => b.team === tid);
  if (bye?.type === 'PAB') {
    const gp = t.pabGamePoints ?? t.boards;
    return { kind: 'PAB', opp: null, colour: null, mp: mp.win, gp, wins: 0, pending: false };
  }
  if (bye) return { kind: 'RRB', opp: null, colour: null, mp: 0, gp: 0, wins: 0, pending: false };
  return { kind: 'absent', opp: null, colour: null, mp: 0, gp: 0, wins: 0, pending: false };
}

export function teamTotals(t, tid, R = t.roundsData.length) {
  let mp = 0;
  let gp = 0;
  let wins = 0;
  for (let r = 1; r <= R; r++) {
    const rec = teamRecord(t, tid, r);
    if (!rec || rec.pending) continue;
    mp += rec.mp;
    gp += rec.gp;
    wins += rec.wins;
  }
  return { mp, gp, wins };
}

export function pendingMatches(t, r) {
  const rd = t.roundsData[r - 1];
  if (!rd) return 0;
  return rd.matches.filter((m) => {
    const ov = matchOverride(t, m, r);
    return !ov && matchScore(t, m).pending > 0;
  }).length;
}

// ------------------------------------------------------------------ rozpis a losování

export function generateTeamRoundRobin(t) {
  if (t.roundsData.length) throw new Error('Rozpis už existuje.');
  const n = t.teams.length;
  if (n < 3) throw new Error('Soutěž každý s každým potřebuje aspoň 3 družstva.');
  renumberTeams(t);
  const byTpn = new Map(t.teams.map((x) => [x.tpn, x.id]));
  t.rounds = roundRobinRounds(n, t.cycles || 1);
  t.roundsData = roundRobinSchedule(n, t.cycles || 1).map((pairs) => {
    const rd = { rid: newRoundId(), matches: [], byes: [] };
    for (const [h, a] of pairs) {
      if (h > n) rd.byes.push({ team: byTpn.get(a), type: 'RRB' });
      else if (a > n) rd.byes.push({ team: byTpn.get(h), type: 'RRB' });
      else rd.matches.push({ home: byTpn.get(h), away: byTpn.get(a), boards: null });
    }
    return rd;
  });
  return t;
}

export function teamPairingInput(t, r) {
  const players = [];
  const others = [];
  for (const team of t.teams) {
    const history = [];
    for (let i = 1; i < r; i++) {
      const rec = teamRecord(t, team.id, i);
      const kind = rec.kind === 'match' ? 'game' : rec.kind === 'RRB' || rec.kind === 'annulled' ? 'absent' : rec.kind;
      history.push({ kind, opp: rec.opp, colour: rec.kind === 'match' ? rec.colour : null, points: rec.mp });
    }
    const item = { id: team.id, tpn: team.tpn, history };
    const out = team.status === 'withdrawn' && team.withdrawnFrom && team.withdrawnFrom <= r;
    (out ? others : players).push(item);
  }
  const mp = t.matchPoints;
  return {
    players, others, round: r, totalRounds: t.rounds, initialColour: t.initialColour || 'W',
    points: { win: mp.win, draw: mp.draw, loss: mp.loss },
  };
}

/** Švýcarský systém družstev: vylosuje další kolo (zápasové body jako hlavní skóre). */
export function pairNextTeamRound(t, { random = Math.random } = {}) {
  const r = t.roundsData.length + 1;
  if (r > t.rounds) throw new Error('Všechna kola už jsou vylosovaná.');
  if (r > 1 && pendingMatches(t, r - 1)) throw new Error(`Nejdřív zadej všechny výsledky ${r - 1}. kola.`);
  if (t.teams.length < 2) throw new Error('Soutěž potřebuje aspoň dvě družstva.');
  if (r === 1) renumberTeams(t);
  if (!t.initialColour) t.initialColour = random() < 0.5 ? 'W' : 'B';
  const out = pairDutch(teamPairingInput(t, r));
  t.roundsData.push({
    rid: newRoundId(),
    matches: out.pairs.map((g) => ({ home: g.white, away: g.black, boards: null })),
    byes: out.bye !== null ? [{ team: out.bye, type: 'PAB' }] : [],
    pairedAt: new Date().toISOString(),
  });
  return { round: r, log: out.log };
}

// ------------------------------------------------------------------ pořadí

function teamData(t, R) {
  const recs = new Map();
  const tot = new Map();
  for (const team of t.teams) {
    const arr = [];
    for (let r = 1; r <= R; r++) arr.push(teamRecord(t, team.id, r) || { kind: 'absent', mp: 0, gp: 0, wins: 0 });
    recs.set(team.id, arr);
    tot.set(team.id, teamTotals(t, team.id, R));
  }
  const rr = t.system === 'rr';
  const isForfeit = (rec) => rec.kind === 'forfeitWin' || rec.kind === 'forfeitLoss';
  // utkání pro vzájemná utkání: v soutěži každý s každým i kontumovaná (C.07 čl. 15.2)
  const encounter = (rec) => !rec.pending && !!rec.opp && (rec.kind === 'match' || (rr && isForfeit(rec)));
  // Buchholz (švýcarský systém): neodehraná kola podle C.07 čl. 16.4 – fiktivní soupeř
  const maxMp = t.matchPoints.draw * t.rounds;
  const maxGp = (t.boards / 2) * t.rounds;
  const bh = new Map();
  for (const team of t.teams) {
    const own = tot.get(team.id);
    const list = recs.get(team.id).filter((rec) => !rec.pending && rec.kind !== 'RRB' && rec.kind !== 'annulled').map((rec) => {
      if (rec.kind === 'match') {
        const o = tot.get(rec.opp);
        return { mp: o.mp, gp: o.gp, myGp: rec.gp, vur: false };
      }
      let capMp = maxMp;
      let capGp = maxGp;
      if (isForfeit(rec) && rec.opp) {
        capMp = tot.get(rec.opp).mp;
        capGp = tot.get(rec.opp).gp;
      }
      return { mp: Math.min(own.mp, capMp), gp: Math.min(own.gp, capGp), myGp: rec.gp, vur: rec.kind === 'forfeitLoss' };
    });
    bh.set(team.id, list);
  }
  return { recs, tot, encounter, bh };
}

function cutLowest(list, key) {
  if (!list.length) return 0;
  const items = list.map((x) => ({ v: x[key], vur: x.vur }));
  const min = Math.min(...items.map((x) => x.v));
  const vurs = items.filter((x) => x.vur);
  let idx = items.findIndex((x) => x.v === min);
  if (vurs.length) {
    const lowestVur = vurs.reduce((a, b) => (b.v < a.v ? b : a));
    if (lowestVur.v >= min) idx = items.indexOf(lowestVur); // čl. 16.5
  }
  items.splice(idx, 1);
  return items.reduce((s, x) => s + x.v, 0);
}

function teamTbValue(code, id, data) {
  const { tot, bh, recs, encounter } = data;
  switch (code) {
    case 'GP':
      return tot.get(id).gp;
    case 'WONG':
      return tot.get(id).wins;
    case 'BH-MP':
      return bh.get(id).reduce((s, x) => s + x.mp, 0);
    case 'BH-GP':
      return bh.get(id).reduce((s, x) => s + x.gp, 0);
    case 'BH-GP-C1':
      return cutLowest(bh.get(id), 'gp');
    case 'EMGSB':
      return recs.get(id).filter(encounter).reduce((s, r) => s + tot.get(r.opp).mp * r.gp, 0);
    default:
      return 0;
  }
}

// C.07 čl. 13.3: vzájemná utkání nejdřív podle zápasových bodů, a když nic nerozhodnou, podle skóre.
function extendedDirectEncounter(group, data, win) {
  const { recs, encounter } = data;
  const solveBy = (S, key) => {
    const pts = new Map(S.map((id) => [id, 0]));
    const missing = new Map(S.map((id) => [id, 0]));
    let allMet = true;
    for (const a of S) {
      for (const b of S) {
        if (a === b) continue;
        const ms = recs.get(a).filter((r) => encounter(r) && r.opp === b);
        if (!ms.length) {
          missing.set(a, missing.get(a) + 1);
          allMet = false;
        } else pts.set(a, pts.get(a) + ms.reduce((s, r) => s + r[key], 0) / ms.length);
      }
    }
    if (allMet) {
      const sorted = [...S].sort((x, y) => pts.get(y) - pts.get(x));
      const parts = [];
      for (const id of sorted) {
        const last = parts[parts.length - 1];
        if (last && Math.abs(pts.get(last[0]) - pts.get(id)) < 1e-9) last.push(id);
        else parts.push([id]);
      }
      return parts;
    }
    // švýcarský systém: jen kdo je sám na čele bez ohledu na chybějící utkání (čl. 6.3)
    const maxPer = key === 'mp' ? win : Infinity;
    const ranked = [];
    let rest = [...S];
    for (;;) {
      const lead = rest.find((id) => rest.every((o) => o === id || pts.get(id) > pts.get(o) + missing.get(o) * maxPer));
      if (!lead) break;
      ranked.push([lead]);
      rest = rest.filter((x) => x !== lead);
      if (rest.length < 2) break;
    }
    return rest.length ? [...ranked, rest] : ranked;
  };
  const solve = (S) => {
    if (S.length < 2) return [S];
    let parts = solveBy(S, 'mp');
    if (parts.length === 1) parts = solveBy(S, 'gp');
    if (parts.length === 1) return parts;
    return parts.flatMap((p) => (p.length > 1 ? solve(p) : [p]));
  };
  return solve(group);
}

// SŘ 5.3.3 e): výsledek proti vítěznému družstvu, dále proti druhému, třetímu… (zápasové body, pak skóre)
function againstOrder(group, order, data) {
  const { recs, encounter } = data;
  const others = order.filter((g) => g !== group);
  const vec = new Map(group.map((id) => {
    const v = [];
    for (const key of ['mp', 'gp']) {
      for (const og of others) {
        const set = new Set(og);
        v.push(recs.get(id).filter((r) => encounter(r) && set.has(r.opp)).reduce((s, r) => s + r[key], 0));
      }
    }
    return [id, v];
  }));
  const cmp = (a, b) => {
    const x = vec.get(a);
    const y = vec.get(b);
    for (let i = 0; i < x.length; i++) if (Math.abs(x[i] - y[i]) > 1e-9) return y[i] - x[i];
    return 0;
  };
  const sorted = [...group].sort(cmp);
  const parts = [];
  for (const id of sorted) {
    const last = parts[parts.length - 1];
    if (last && cmp(last[0], id) === 0) last.push(id);
    else parts.push([id]);
  }
  return parts;
}

/**
 * Pořadí družstev po kole R: zápasové body, pak pomocná hodnocení.
 * @returns {Array<{ team, mp, gp, wins, tb, rank, tied, used }>}
 */
export function teamStandings(t, R = t.roundsData.length, codes = t.tiebreaks) {
  const data = teamData(t, R);
  const rows = t.teams.map((team) => {
    const tb = {};
    for (const c of codes) if (TEAM_TIEBREAKS[c] && c !== 'EDE' && c !== 'TOP') tb[c] = teamTbValue(c, team.id, data);
    const s = data.tot.get(team.id);
    return { team, mp: s.mp, gp: s.gp, wins: s.wins, tb };
  });
  const byId = new Map(rows.map((r) => [r.team.id, r]));
  let groups = [];
  for (const r of [...rows].sort((a, b) => b.mp - a.mp)) {
    const g = groups[groups.length - 1];
    if (g && byId.get(g[0]).mp === r.mp) g.push(r.team.id);
    else groups.push([r.team.id]);
  }
  const used = new Map();
  const mark = (g, code) => g.forEach((id) => used.set(id, [...(used.get(id) || []), code]));
  for (const code of codes) {
    if (!TEAM_TIEBREAKS[code]) continue;
    const next = [];
    for (const g of groups) {
      if (g.length < 2) {
        next.push(g);
        continue;
      }
      if (code === 'EDE' || code === 'TOP') {
        const parts = code === 'EDE' ? extendedDirectEncounter(g, data, t.matchPoints.win) : againstOrder(g, groups, data);
        if (parts.length > 1) mark(g, code);
        next.push(...parts);
        continue;
      }
      const val = (id) => byId.get(id).tb[code];
      const sorted = [...g].sort((a, b) => val(b) - val(a));
      let run = [];
      for (const id of sorted) {
        if (run.length && Math.abs(val(run[0]) - val(id)) > 1e-9) {
          next.push(run);
          run = [];
        }
        run.push(id);
      }
      next.push(run);
    }
    groups = next;
  }
  const out = [];
  let place = 1;
  for (const g of groups) {
    for (const id of [...g].sort((a, b) => byId.get(a).team.tpn - byId.get(b).team.tpn)) {
      out.push({ ...byId.get(id), rank: place, tied: g.length > 1, used: used.get(id) || [] });
    }
    place += g.length;
  }
  return out;
}

/** Výsledky jednotlivců (hráčů ze soupisek) po kole R. */
export function playerResults(t, R = t.roundsData.length) {
  const stats = new Map();
  const add = (pid, team, board, pts, played) => {
    if (!pid) return;
    if (!stats.has(pid)) stats.set(pid, { pid, team, points: 0, games: 0, boards: [] });
    const s = stats.get(pid);
    s.points += pts;
    if (played) s.games++;
    s.boards.push(board);
  };
  for (let r = 1; r <= R; r++) {
    for (const m of t.roundsData[r - 1]?.matches || []) {
      if (matchOverride(t, m, r)) continue;
      matchBoards(t, m).forEach((b, i) => {
        const res = boardResult(b);
        if (!res || !b.hp || !b.ap) return;
        const [h, a] = BOARD_POINTS[res];
        const played = ['1-0', '½-½', '0-1'].includes(res);
        add(b.hp, m.home, i + 1, h, played || h > 0);
        add(b.ap, m.away, i + 1, a, played || a > 0);
      });
    }
  }
  return [...stats.values()];
}
