import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHANGELOG, VERSION, unseenChanges, aboutView } from '../js/about.js';

const cmp = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

test('verze v seznamu změn odpovídá package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(VERSION, pkg.version);
});

test('seznam změn je seřazený od nejnovější verze a má platná data', () => {
  for (const c of CHANGELOG) {
    assert.match(c.version, /^\d+\.\d+\.\d+$/);
    assert.match(c.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!Number.isNaN(Date.parse(c.date)), c.date);
    assert.ok(c.title && c.items.length, c.version);
  }
  for (let i = 1; i < CHANGELOG.length; i++) {
    assert.ok(cmp(CHANGELOG[i - 1].version, CHANGELOG[i].version) > 0, `${CHANGELOG[i - 1].version} > ${CHANGELOG[i].version}`);
    assert.ok(CHANGELOG[i - 1].date >= CHANGELOG[i].date, CHANGELOG[i - 1].version);
  }
});

test('co je nového: jen verze novější než naposledy viděná', () => {
  assert.deepEqual(unseenChanges(VERSION), []);
  assert.deepEqual(unseenChanges(CHANGELOG[2].version).map((c) => c.version), [CHANGELOG[0].version, CHANGELOG[1].version]);
  assert.deepEqual(unseenChanges('0.0.1'), []);
});

test('stránka nápovědy se vykreslí', () => {
  const esc = (s) => String(s);
  assert.match(aboutView('navod', esc), /Návod k použití/);
  const ch = aboutView('zmeny', esc);
  for (const c of CHANGELOG) assert.ok(ch.includes(c.title), c.title);
});
