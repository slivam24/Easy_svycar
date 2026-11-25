import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diffOps, applyOps, stamp, observe, snapshot, mergeSnapshot, shareable, encodeMessage, Assembler,
  newSyncConfig, joinLink, parseJoin,
} from '../js/sync.js';
import { newTournament, newPlayer, renumber, pairNextRound } from '../js/model.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

function base() {
  const t = newTournament({ name: 'Test', rounds: 3 });
  for (let i = 0; i < 8; i++) t.players.push(newPlayer(t, { name: `H${i}`, rating: 2000 - i }));
  renumber(t);
  t.initialColour = 'W';
  return t;
}

// dvě zařízení: změny se posílají jako ops s razítky
function device(t, id) {
  return { t: clone(t), base: clone(t), id };
}
function local(dev, mutate) {
  mutate(dev.t);
  const ops = diffOps(dev.base, dev.t).map((o) => ({ ...o, ts: stamp(dev.id) }));
  applyOps(dev.t, ops); // zapíše hodiny
  dev.base = clone(dev.t);
  return ops;
}
function remote(dev, ops) {
  ops.forEach((o) => observe(o.ts));
  applyOps(dev.t, ops);
  dev.base = clone(dev.t);
}

test('změny z jednoho zařízení se na druhém projeví', () => {
  const t = base();
  t._clock = { '[]': stamp('A') };
  const A = device(t, 'A');
  const B = device(t, 'B');
  const ops = local(A, (x) => pairNextRound(x));
  remote(B, ops);
  assert.deepEqual(shareable(B.t), shareable(A.t));
  assert.equal(B.t.roundsData.length, 1);
});

test('souběžně zadané výsledky do různých partií se nepřepíšou', () => {
  const t = base();
  pairNextRound(t);
  t._clock = { '[]': stamp('A') };
  const A = device(t, 'A');
  const B = device(t, 'B');
  const opsA = local(A, (x) => { x.roundsData[0].pairs[0].result = '1-0'; });
  const opsB = local(B, (x) => { x.roundsData[0].pairs[3].result = '½-½'; });
  remote(A, opsB);
  remote(B, opsA);
  for (const d of [A, B]) {
    assert.equal(d.t.roundsData[0].pairs[0].result, '1-0');
    assert.equal(d.t.roundsData[0].pairs[3].result, '½-½');
  }
  assert.deepEqual(shareable(A.t), shareable(B.t));
});

test('stejná partie na dvou zařízeních: platí pozdější zápis, na obou stejně', () => {
  const t = base();
  pairNextRound(t);
  t._clock = { '[]': stamp('A') };
  const A = device(t, 'A');
  const B = device(t, 'B');
  const opsA = local(A, (x) => { x.roundsData[0].pairs[1].result = '1-0'; });
  const opsB = local(B, (x) => { x.roundsData[0].pairs[1].result = '0-1'; });
  remote(A, opsB);
  remote(B, opsA);
  assert.equal(A.t.roundsData[0].pairs[1].result, '0-1');
  assert.equal(B.t.roundsData[0].pairs[1].result, '0-1');
});

test('zpráva doručená dvakrát nebo pozdě nic nepokazí', () => {
  const t = base();
  pairNextRound(t);
  t._clock = { '[]': stamp('A') };
  const A = device(t, 'A');
  const B = device(t, 'B');
  const old = local(A, (x) => { x.roundsData[0].pairs[0].result = '1-0'; });
  const newer = local(A, (x) => { x.roundsData[0].pairs[0].result = '½-½'; });
  remote(B, newer);
  remote(B, old); // starší přijde pozdě
  remote(B, newer); // a ještě jednou
  assert.equal(B.t.roundsData[0].pairs[0].result, '½-½');
});

test('zrušené a znovu vylosované kolo přebije starší výsledky v tom kole', () => {
  const t = base();
  pairNextRound(t);
  t._clock = { '[]': stamp('A') };
  const A = device(t, 'A');
  const B = device(t, 'B');
  const r1 = local(B, (x) => { x.roundsData[0].pairs[0].result = '1-0'; });
  const r2 = local(A, (x) => { x.roundsData.pop(); x.players[0].name = 'Opraveno'; pairNextRound(x); });
  remote(A, r1); // výsledek k už zrušenému losování přijde pozdě
  remote(B, r2);
  assert.equal(A.t.roundsData[0].pairs[0].result, null);
  assert.deepEqual(shareable(A.t), shareable(B.t));
});

test('nové zařízení dostane celý stav (snapshot) a pak navazuje', () => {
  const t = base();
  pairNextRound(t);
  t._clock = { '[]': stamp('A') };
  const A = device(t, 'A');
  local(A, (x) => { x.roundsData[0].pairs[2].result = '0-1'; });
  const fresh = { id: A.t.id, _clock: {} };
  mergeSnapshot(fresh, clone(snapshot(A.t)));
  assert.deepEqual(shareable(fresh), shareable(A.t));
});

test('šifrovaná zpráva: rozdělení na části, složení, cizí klíč nic nepřečte', async () => {
  const cfg = newSyncConfig();
  const big = { k: 'snap', data: Array.from({ length: 3000 }, (_, i) => `hráč ${i} ${Math.sin(i)}`) };
  const parts = await encodeMessage(big, cfg.key);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 4096));
  const asm = new Assembler(cfg.key);
  let out = null;
  for (const p of [...parts].reverse()) out = (await asm.push(p)) || out;
  assert.deepEqual(out, big);
  const other = new Assembler(newSyncConfig().key);
  let bad = null;
  for (const p of parts) bad = (await other.push(p)) || bad;
  assert.equal(bad, null);
  assert.ok(!parts.join('').includes('hráč'));
});

test('odkaz pro připojení: klíč je jen za #', () => {
  const t = base();
  t.sync = newSyncConfig();
  const link = joinLink(t, 'https://example.org/app/');
  assert.ok(link.startsWith('https://example.org/app/#sync='));
  const j = parseJoin(new URL(link).hash);
  assert.equal(j.topic, t.sync.topic);
  assert.equal(j.key, t.sync.key);
  assert.equal(j.server, 'https://ntfy.sh');
  assert.equal(parseJoin('#t=abc'), null);
});
