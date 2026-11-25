// Datový model turnaje jednotlivců a převod na vstup losování.
//
// Turnaj:
//   { id, name, city, fed, dateFrom, dateTo, arbiter, deputy, organizer, timeControl,
//     rounds, system, cycles, initialColour, points, tiebreaks, players, roundsData, requests,
//     tpnFrozen, tpnManual }
//   system: 'dutch' (švýcarský systém) | 'rr' (každý s každým, cycles = 1 nebo 2)
// Hráč: { id, name, title, rating, fideId, fed, club, birth, sex, status, withdrawnFrom }
// Kolo: { pairs: [{ white, black, result }], byes: [{ player, type }] }
//   result: '1-0' | '0-1' | '½-½' | '+-' | '-+' | '--' | null
//   type:   'PAB' (volno přidělené losováním) | 'HPB' (půlbodové volno na žádost)
//           | 'FPB' (celobodové volno) | 'ZPB' (nula bodů, omluvená absence)
// requests: { [kolo]: { [idHráče]: 'HPB' | 'ZPB' | 'FPB' } } – volna nahlášená předem

import { pairDutch } from './dutch.js';
import { roundRobinSchedule, roundRobinRounds } from './roundrobin.js';

export const POINTS_DEFAULT = Object.freeze({
  win: 1, draw: 0.5, loss: 0, forfeitWin: 1, forfeitLoss: 0, pab: 1, hpb: 0.5, fpb: 1, zpb: 0,
});

/** Pomocná hodnocení švýcarského systému podle Soutěžního řádu ŠSČR, čl. 5.2.3. */
export const TIEBREAKS_SR_SWISS = Object.freeze(['DE', 'BH-C1', 'BH', 'SB', 'BPG']);

/** Pomocná hodnocení turnaje každý s každým podle Soutěžního řádu ŠSČR, čl. 5.2.2. */
export const TIEBREAKS_SR_RR = Object.freeze(['SB', 'DE', 'TOP']);

export const isRoundRobin = (t) => t.system === 'rr';

/** Jednoznačné označení vylosovaného kola (kvůli synchronizaci mezi zařízeními). */
export function newRoundId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export const TITLES = ['GM', 'IM', 'WGM', 'FM', 'WIM', 'CM', 'WFM', 'WCM'];

export const RESULTS = ['1-0', '½-½', '0-1', '+-', '-+', '--'];

export const BYE_LABEL = {
  PAB: 'volno (los)',
  HPB: 'volno ½ b.',
  FPB: 'volno 1 b.',
  ZPB: 'nehraje',
  RRB: 'volno',
};

export function newTournament(over = {}) {
  return {
    id: over.id ?? `t${Date.now().toString(36)}`,
    name: '',
    city: '',
    fed: 'CZE',
    dateFrom: '',
    dateTo: '',
    arbiter: '',
    deputy: '',
    organizer: '',
    timeControl: '',
    rounds: 7,
    system: 'dutch',
    cycles: 1,
    initialColour: null,
    points: { ...POINTS_DEFAULT },
    tiebreaks: [...TIEBREAKS_SR_SWISS],
    players: [],
    roundsData: [],
    requests: {},
    tpnFrozen: false,
    tpnManual: false,
    created: new Date().toISOString(),
    ...over,
  };
}

export function newPlayer(t, over = {}) {
  const id = t.players.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  return {
    id,
    name: '',
    title: '',
    rating: 0,
    fideId: '',
    fed: '',
    club: '',
    birth: '',
    sex: '',
    status: 'active',
    withdrawnFrom: null,
    ...over,
  };
}

const titleRank = (t) => {
  const i = TITLES.indexOf((t || '').toUpperCase());
  return i < 0 ? TITLES.length : i;
};

/** Pořadí pro startovní čísla (C.04.2 čl. 2.2): rating, titul, abecedně. */
export function initialOrder(a, b) {
  return (
    (Number(b.rating) || 0) - (Number(a.rating) || 0)
    || titleRank(a.title) - titleRank(b.title)
    || (a.name || '').localeCompare(b.name || '', 'cs')
    || a.id - b.id
  );
}

/**
 * Přečísluje startovní čísla. Do 4. kola se řadí podle ratingu znovu (opravy údajů),
 * potom se pozdě přihlášení jen vloží na správné místo (C.04.2 čl. 2.3–2.5).
 */
export function renumber(t) {
  if (t.tpnManual) {
    // vylosovaná čísla (každý s každým): noví hráči na konec
    let max = Math.max(0, ...t.players.map((p) => p.tpn || 0));
    for (const p of t.players) if (!p.tpn) p.tpn = ++max;
    t.players.sort((a, b) => a.tpn - b.tpn);
    t.players.forEach((p, i) => (p.tpn = i + 1));
    return t;
  }
  const frozen = t.roundsData.length >= 4 || t.tpnFrozen;
  if (!frozen || !t.players.every((p) => p.tpn)) {
    if (!frozen) {
      [...t.players].sort(initialOrder).forEach((p, i) => (p.tpn = i + 1));
    } else {
      const known = t.players.filter((p) => p.tpn).sort((a, b) => a.tpn - b.tpn);
      for (const p of t.players.filter((x) => !x.tpn)) {
        let pos = known.findIndex((k) => initialOrder(p, k) < 0);
        if (pos < 0) pos = known.length;
        known.splice(pos, 0, p);
      }
      known.forEach((p, i) => (p.tpn = i + 1));
    }
  }
  t.players.sort((a, b) => a.tpn - b.tpn);
  return t;
}

export const playerById = (t, id) => t.players.find((p) => p.id === id);

/**
 * Záznam hráče v kole r (1..).
 * @returns {{kind, opp, colour, points, result, pending}|null} null = kolo ještě nebylo
 */
export function roundRecord(t, pid, r) {
  const rd = t.roundsData[r - 1];
  if (!rd) return null;
  const pt = t.points;
  for (const g of rd.pairs) {
    if (g.white !== pid && g.black !== pid) continue;
    const white = g.white === pid;
    const opp = white ? g.black : g.white;
    const colour = white ? 'W' : 'B';
    const forced = isRoundRobin(t) ? withdrawalResult(t, g, r) : null;
    const res = forced ?? g.result;
    const base = { opp, colour, result: res, pending: false, forced: !!forced };
    switch (res) {
      case '1-0':
        return { ...base, kind: 'game', points: white ? pt.win : pt.loss };
      case '0-1':
        return { ...base, kind: 'game', points: white ? pt.loss : pt.win };
      case '½-½':
        return { ...base, kind: 'game', points: pt.draw };
      case '+-':
        return { ...base, kind: white ? 'forfeitWin' : 'forfeitLoss', points: white ? pt.forfeitWin : pt.forfeitLoss };
      case '-+':
        return { ...base, kind: white ? 'forfeitLoss' : 'forfeitWin', points: white ? pt.forfeitLoss : pt.forfeitWin };
      case '--':
        return { ...base, kind: 'forfeitLoss', points: pt.forfeitLoss, double: true };
      default:
        return { ...base, kind: 'game', points: 0, pending: true };
    }
  }
  const bye = rd.byes.find((b) => b.player === pid);
  if (bye) {
    const points = { PAB: pt.pab, HPB: pt.hpb, FPB: pt.fpb, ZPB: pt.zpb }[bye.type] ?? 0;
    return { kind: bye.type, opp: null, colour: null, points, result: null, pending: false };
  }
  return { kind: 'absent', opp: null, colour: null, points: 0, result: null, pending: false };
}

/**
 * Soutěžní řád ŠSČR, čl. 5.2.4 (každý s každým): hráč, který vystoupil nebo byl vyloučen
 * po odehrání aspoň poloviny partií, prohrává zbývající partie kontumačně; jinak se všechny jeho
 * partie prohlásí za prohrané kontumací.
 * @returns {object|null} { from: kolo, od kterého se kontumuje } nebo null
 */
export function withdrawalEffect(t, pid) {
  const p = playerById(t, pid);
  if (!p || p.status !== 'withdrawn' || !p.withdrawnFrom) return null;
  let total = 0;
  let played = 0;
  t.roundsData.forEach((rd, i) => {
    const g = rd.pairs.find((x) => x.white === pid || x.black === pid);
    if (!g) return;
    total++;
    if (i + 1 < p.withdrawnFrom && ['1-0', '0-1', '½-½'].includes(g.result)) played++;
  });
  return { from: played * 2 >= total ? p.withdrawnFrom : 1, played, total };
}

function withdrawalResult(t, g, r) {
  const w = withdrawalEffect(t, g.white);
  const b = withdrawalEffect(t, g.black);
  const wOut = w && r >= w.from;
  const bOut = b && r >= b.from;
  if (wOut && bOut) return '--';
  if (wOut) return '-+';
  if (bOut) return '+-';
  return null;
}

/**
 * Turnaj každý s každým: vytvoří rozpis všech kol podle Bergerových tabulek FIDE.
 * Startovní čísla musí být určená předem (losem nebo podle ratingu).
 */
export function generateRoundRobin(t) {
  if (t.roundsData.length) throw new Error('Rozpis už existuje.');
  const n = t.players.length;
  if (n < 3) throw new Error('Turnaj každý s každým potřebuje aspoň 3 hráče.');
  renumber(t);
  const byTpn = new Map(t.players.map((p) => [p.tpn, p.id]));
  const schedule = roundRobinSchedule(n, t.cycles || 1);
  t.rounds = roundRobinRounds(n, t.cycles || 1);
  t.roundsData = schedule.map((pairs) => {
    const rd = { rid: newRoundId(), pairs: [], byes: [] };
    for (const [w, b] of pairs) {
      if (w > n) rd.byes.push({ player: byTpn.get(b), type: 'RRB' });
      else if (b > n) rd.byes.push({ player: byTpn.get(w), type: 'RRB' });
      else rd.pairs.push({ white: byTpn.get(w), black: byTpn.get(b), result: null });
    }
    return rd;
  });
  t.tpnFrozen = true;
  return t;
}

/** Vylosuje startovní čísla (pro turnaj každý s každým, C.05: čísla se losují). */
export function drawStartNumbers(t, random = Math.random) {
  const ids = t.players.map((p) => p.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  ids.forEach((id, i) => (playerById(t, id).tpn = i + 1));
  t.tpnManual = true;
  t.players.sort((a, b) => a.tpn - b.tpn);
}

/** Startovní čísla znovu podle ratingu. */
export function numbersByRating(t) {
  t.tpnManual = false;
  t.tpnFrozen = false;
  for (const p of t.players) p.tpn = 0;
  renumber(t);
}

export function scoreAfter(t, pid, r) {
  let s = 0;
  for (let i = 1; i <= r; i++) {
    const rec = roundRecord(t, pid, i);
    if (rec) s += rec.points;
  }
  return s;
}

/** Je hráč v kole r k dispozici pro losování? */
export function isAvailable(t, p, r) {
  if (p.status === 'withdrawn' && p.withdrawnFrom && p.withdrawnFrom <= r) return false;
  if (t.requests?.[r]?.[p.id]) return false;
  return true;
}

export function pendingGames(t, r) {
  const rd = t.roundsData[r - 1];
  if (!rd) return 0;
  return rd.pairs.filter((g) => !g.result && !(isRoundRobin(t) && withdrawalResult(t, g, r))).length;
}

/** Vstup pro losování kola r. */
export function buildPairingInput(t, r) {
  const players = [];
  const others = [];
  for (const p of t.players) {
    const history = [];
    for (let i = 1; i < r; i++) {
      const rec = roundRecord(t, p.id, i);
      history.push({ kind: rec.kind, opp: rec.opp, colour: rec.kind === 'game' ? rec.colour : null, points: rec.points });
    }
    const item = { id: p.id, tpn: p.tpn, history };
    (isAvailable(t, p, r) ? players : others).push(item);
  }
  return {
    players,
    others,
    round: r,
    totalRounds: t.rounds,
    initialColour: t.initialColour || 'W',
    points: { win: t.points.win, draw: t.points.draw, loss: t.points.loss },
  };
}

/**
 * Vylosuje další kolo a uloží ho do turnaje.
 * @returns {{ round: number, log: string[] }}
 */
export function pairNextRound(t, { random = Math.random } = {}) {
  const r = t.roundsData.length + 1;
  if (r > t.rounds) throw new Error('Všechna kola už jsou vylosovaná.');
  if (r > 1 && pendingGames(t, r - 1)) throw new Error(`Nejdřív zadej všechny výsledky ${r - 1}. kola.`);
  if (r === 1) renumber(t);
  if (!t.initialColour) t.initialColour = random() < 0.5 ? 'W' : 'B';
  const input = buildPairingInput(t, r);
  const out = pairDutch(input);
  const byes = [];
  if (out.bye !== null) byes.push({ player: out.bye, type: 'PAB' });
  for (const [pid, type] of Object.entries(t.requests?.[r] || {})) {
    const p = playerById(t, Number(pid));
    if (p && !(p.status === 'withdrawn' && p.withdrawnFrom <= r)) byes.push({ player: p.id, type });
  }
  t.roundsData.push({
    rid: newRoundId(),
    pairs: out.pairs.map((g) => ({ white: g.white, black: g.black, result: null })),
    byes,
    pairedAt: new Date().toISOString(),
  });
  return { round: r, log: out.log };
}

/** Smaže poslední kolo (jen dokud nemá výsledky, nebo s potvrzením v UI). */
export function unpairLastRound(t) {
  t.roundsData.pop();
}

/** Výsledek z pohledu bílého v bodech, pro zobrazení. */
export function resultLabel(res) {
  return res || '';
}

export function fmtPts(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return '';
  const whole = Math.floor(x + 1e-9);
  const frac = x - whole;
  if (Math.abs(frac - 0.5) < 1e-9) return whole === 0 ? '½' : `${whole}½`;
  if (Math.abs(frac) < 1e-9) return String(whole);
  return String(Math.round(x * 100) / 100).replace('.', ',');
}
