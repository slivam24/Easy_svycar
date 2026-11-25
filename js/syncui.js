// Synchronizace v aplikaci: napojení na ukládání, příjem změn, připojení dalšího zařízení, karta v části Sdílení.

import {
  DEFAULT_SERVER, newSyncConfig, joinLink, parseJoin, diffOps, applyOps, stamp, observe, snapshot, mergeSnapshot,
  shareable, Channel, randomId,
} from './sync.js';
import qrcode from './vendor/qrcode.js';
import { saveTournament, loadTournament, listTournaments } from './store.js';

let C = null;
let chan = null;
let chanId = null;
let baseline = null;
let sendTimer = null;
let firstQueued = 0;
let status = 'off';
let deferred = false;
let joinChan = null;
let blockedUntil = 0; // po odmítnutí serverem (limit zpráv) chvíli neposílat
const helloTimers = new Map();

export { parseJoin };

export function initSync(ctx) {
  C = ctx;
  window.addEventListener('online', () => flush());
  document.addEventListener('focusout', () => {
    if (deferred) setTimeout(() => {
      if (deferred && !typing()) {
        deferred = false;
        rerender();
      }
    }, 50);
  });
  setInterval(() => flush(), 20000);
}

const cur = () => C.getT();

function typing() {
  const a = document.activeElement;
  if (!a) return false;
  if (a.tagName === 'TEXTAREA') return true;
  return a.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'file', 'submit'].includes(a.type);
}

function rerender() {
  if (typing()) {
    deferred = true;
    return;
  }
  const y = window.scrollY;
  // zůstat na stejném kole: zobrazené kolo zapsat do adresy (bez nové položky v historii)
  const chip = document.querySelector('.chips [data-round][aria-pressed="true"]');
  const h = new URLSearchParams(location.hash.slice(1));
  if (chip && h.get('t') && !h.get('kolo')) {
    h.set('kolo', chip.dataset.round);
    history.replaceState(null, '', `#${h.toString()}`);
  }
  C.render();
  window.scrollTo(0, y);
}

const LABELS = {
  online: ['● Synchronizováno', 'ok'],
  sending: ['● Odesílám…', 'ok'],
  connecting: ['◌ Připojuji…', 'wait'],
  offline: ['○ Offline – změny počkají', 'bad'],
  limited: ['○ Limit serveru – změny počkají', 'bad'],
  off: ['', ''],
};

function setStatus(s) {
  status = s;
  const t = cur();
  const pending = t?.sync?.outbox?.length;
  const key = s === 'online' && pending ? 'sending' : s;
  const el = document.getElementById('syncStatus');
  if (el) {
    el.textContent = LABELS[key][0];
    el.dataset.state = LABELS[key][1];
    el.hidden = !LABELS[key][0];
  }
  const box = document.getElementById('syncState');
  if (box) box.textContent = LABELS[key][0] || 'Vypnuto';
}

/** Zapne nebo vypne spojení podle otevřeného turnaje. */
export function attach(t) {
  if (!t || !t.sync?.enabled) {
    detach();
    setStatus('off');
    return;
  }
  if (chan && chanId === t.id) return;
  detach();
  chanId = t.id;
  if (!t._clock || !Object.keys(t._clock).length) t._clock = { '[]': stamp(t.sync.device) };
  baseline = shareable(t);
  chan = new Channel({
    server: t.sync.server, topic: t.sync.topic, key: t.sync.key, since: t.sync.last || 'all',
    onMessage, onStatus: setStatus,
  });
  chan.start();
  // po delší přestávce (server drží zprávy 12 hodin) si vyžádat celý stav od ostatních
  if (!t.sync.seenAt || Date.now() - t.sync.seenAt > 11 * 3600 * 1000) sendMsg({ k: 'hello', hid: randomId(8) }).catch(() => {});
  flush();
}

function detach() {
  chan?.stop();
  chan = null;
  chanId = null;
  clearTimeout(sendTimer);
  for (const tm of helloTimers.values()) clearTimeout(tm);
  helloTimers.clear();
}

async function sendMsg(obj) {
  const t = cur();
  if (!chan || !t) throw new Error('Synchronizace není připojená.');
  await chan.send({ ...obj, f: t.sync.device, tid: t.id });
}

/** Zavolat po každé místní změně (uložení). */
export function localChange() {
  const t = cur();
  if (!t?.sync?.enabled || chanId !== t.id || !baseline) return;
  const ops = diffOps(baseline, shareable(t));
  if (!ops.length) return;
  const stamped = ops.map((o) => ({ ...o, ts: stamp(t.sync.device) }));
  applyOps(t, stamped); // jen zapíše hodiny, hodnoty jsou stejné
  baseline = shareable(t);
  (t.sync.outbox ||= []).push(...stamped);
  saveTournament(t);
  schedule();
}

function schedule() {
  if (!firstQueued) firstQueued = Date.now();
  clearTimeout(sendTimer);
  // dávka: počkat 6 s na další změny, nejdéle 15 s (veřejný server má denní limit zpráv)
  const wait = Date.now() - firstQueued > 15000 ? 0 : 6000;
  sendTimer = setTimeout(flush, wait);
  setStatus(status);
}

let flushing = false;
async function flush() {
  const t = cur();
  if (flushing || !chan || !t?.sync?.enabled || !t.sync.outbox?.length || Date.now() < blockedUntil) return;
  flushing = true;
  firstQueued = 0;
  const n = t.sync.outbox.length;
  const latest = new Map();
  for (const op of t.sync.outbox) latest.set(JSON.stringify(op.p), op);
  try {
    await sendMsg({ k: 'ops', ops: [...latest.values()] });
    t.sync.outbox.splice(0, n);
    saveTournament(t);
    setStatus('online');
  } catch (err) {
    if (err.status === 429) {
      blockedUntil = Date.now() + 5 * 60 * 1000;
      setStatus('limited');
      C.toast('Server synchronizace hlásí limit zpráv. Změny se pošlou za pár minut.');
    } else setStatus('offline');
  } finally {
    flushing = false;
  }
}

function onMessage(msg, ntfyId) {
  const t = cur();
  if (!t || t.id !== chanId) return;
  t.sync.last = ntfyId;
  t.sync.seenAt = Date.now();
  if (msg.f === t.sync.device || (msg.tid && msg.tid !== t.id)) {
    saveTournament(t);
    return;
  }
  localChange(); // nejdřív zachytit vlastní neodeslané změny
  let changed = 0;
  if (msg.k === 'ops' && Array.isArray(msg.ops)) {
    msg.ops.forEach((o) => observe(o.ts));
    changed = applyOps(t, msg.ops);
  } else if (msg.k === 'hello') {
    if (!helloTimers.has(msg.hid)) {
      helloTimers.set(msg.hid, setTimeout(() => {
        helloTimers.delete(msg.hid);
        sendMsg({ k: 'snap', re: msg.hid, s: snapshot(cur()) }).catch(() => {});
      }, 400 + Math.random() * 1600));
    }
  } else if (msg.k === 'snap' && msg.s) {
    clearTimeout(helloTimers.get(msg.re));
    helloTimers.delete(msg.re);
    Object.values(msg.s.clock || {}).forEach(observe);
    changed = mergeSnapshot(t, msg.s);
  }
  baseline = shareable(t);
  saveTournament(t);
  if (changed) rerender();
}

// ------------------------------------------------------------------ připojení nového zařízení
export function stopJoin() {
  joinChan?.stop();
  joinChan = null;
}

export function renderJoin(j) {
  const existing = listTournaments().map((x) => loadTournament(x.id)).find((x) => x?.sync?.topic === j.topic);
  if (existing) {
    if (!existing.sync.enabled) {
      existing.sync.enabled = true;
      saveTournament(existing);
    }
    location.replace(`#t=${encodeURIComponent(existing.id)}`);
    return;
  }
  C.view.innerHTML = `<section class="card">
    <h2>Připojení k turnaji</h2>
    <p id="joinMsg">Čekám na zařízení, které turnaj sdílí…</p>
    <p class="muted small">Na zařízení, ze kterého jste odkaz dostali, musí být turnaj otevřený (stačí na pozadí).
      Data jdou zašifrovaná přes server ${C.esc(new URL(j.server).host)}.</p>
    <p class="muted small">Stav: <span id="joinState">připojuji…</span></p>
    <a class="btn" href="#">Zrušit</a>
  </section>`;
  stopJoin();
  const device = randomId(8);
  const buffered = [];
  let tries = 0;
  let helloTimer = null;
  const ch = new Channel({
    server: j.server, topic: j.topic, key: j.key, since: 'all',
    onStatus: (s) => {
      const el = document.getElementById('joinState');
      if (el) el.textContent = { online: 'spojeno se serverem', connecting: 'připojuji…', offline: 'bez spojení, zkouším znovu' }[s] || s;
    },
    onMessage: (msg, id) => {
      if (msg.k === 'ops' && Array.isArray(msg.ops)) buffered.push(...msg.ops);
      if (msg.k !== 'snap' || !msg.s?.t?.id) return;
      clearInterval(helloTimer);
      let t = loadTournament(msg.s.t.id) || { id: msg.s.t.id };
      t._clock ||= {};
      Object.values(msg.s.clock || {}).forEach(observe);
      mergeSnapshot(t, msg.s);
      if (buffered.length) {
        buffered.forEach((o) => observe(o.ts));
        applyOps(t, buffered);
      }
      t.sync = { server: j.server, topic: j.topic, key: j.key, device, enabled: true, last: id, outbox: [], seenAt: Date.now() };
      saveTournament(t);
      stopJoin();
      C.toast('Turnaj je připojený');
      location.replace(`#t=${encodeURIComponent(t.id)}`);
    },
  });
  joinChan = ch;
  ch.start();
  const hello = () => {
    tries++;
    ch.send({ k: 'hello', f: device, hid: randomId(8) }).catch(() => {});
    if (tries >= 8) clearInterval(helloTimer);
    const msgEl = document.getElementById('joinMsg');
    if (msgEl && tries > 1) msgEl.textContent = 'Stále čekám na zařízení, které turnaj sdílí. Zkontrolujte, že je na něm turnaj otevřený.';
  };
  hello();
  helloTimer = setInterval(hello, 20000);
}

// ------------------------------------------------------------------ karta v části Sdílení
export function mountSyncCard(el) {
  const t = cur();
  const s = t.sync;
  if (!s?.enabled) {
    el.innerHTML = `<section class="card">
      <h2>Synchronizace mezi zařízeními</h2>
      <p>Turnaj můžete mít otevřený na více zařízeních najednou, třeba na počítači u rozhodčího a na telefonech.
        Výsledky, losování i úpravy se na ostatních zařízeních objeví během pár sekund.</p>
      <ul class="small">
        <li>Změny jdou přes server <strong>${C.esc(new URL(s?.server || DEFAULT_SERVER).host)}</strong>, který je jen přeposílá. Jsou zašifrované (AES-256)
          a klíč je jen v odkazu pro připojení, server je přečíst nemůže. Zprávy na serveru vydrží 12 hodin.</li>
        <li>Kdo má odkaz, může turnaj vidět i upravovat. Posílejte ho jen rozhodčím.</li>
        <li>Veřejný server přenese z jedné sítě asi 250 zpráv denně; změny se proto posílají v dávkách po několika sekundách.</li>
      </ul>
      ${s ? '<button class="primary" id="syncOn">Znovu zapnout synchronizaci</button>' : `
      <details style="margin:.4rem 0 .8rem"><summary class="small">Vlastní server ntfy</summary>
        <label class="f" style="max-width:26rem;margin-top:.4rem">Adresa serveru<input id="syncServer" value="${DEFAULT_SERVER}" inputmode="url"></label></details>
      <button class="primary" id="syncOn">Zapnout synchronizaci</button>`}
    </section>`;
    el.querySelector('#syncOn').addEventListener('click', () => {
      if (s) s.enabled = true;
      else {
        const srv = (el.querySelector('#syncServer')?.value || DEFAULT_SERVER).trim();
        try {
          new URL(srv);
        } catch {
          C.toast('Neplatná adresa serveru.');
          return;
        }
        t.sync = newSyncConfig(srv);
        t._clock = { '[]': stamp(t.sync.device) };
      }
      saveTournament(t);
      attach(t);
      C.toast('Synchronizace zapnuta');
      mountSyncCard(el);
    });
    return;
  }
  const link = joinLink(t, `${location.origin}${location.pathname}`);
  let svg = '';
  try {
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    svg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: 'QR kód pro připojení k turnaji' });
  } catch {
    svg = '';
  }
  el.innerHTML = `<section class="card">
    <h2>Synchronizace mezi zařízeními</h2>
    <p>Stav: <strong id="syncState">${C.esc(LABELS[status]?.[0] || 'Připojuji…')}</strong></p>
    <p>Na dalším zařízení načtěte QR kód fotoaparátem, nebo tam otevřete odkaz. Turnaj se stáhne a od té chvíle se změny
      posílají oběma směry, dokud je turnaj na zařízení otevřený.</p>
    <div class="qr-box">${svg}</div>
    <div class="row" style="margin:.6rem 0">
      <button class="primary" id="syncCopy">Kopírovat odkaz</button>
      ${navigator.share ? '<button id="syncShare">Sdílet odkaz…</button>' : ''}
    </div>
    <p class="muted small">Kdo má odkaz, může turnaj vidět i upravovat. Server ${C.esc(new URL(s.server).host)} vidí jen zašifrovaná data.
      Neodeslané změny (bez internetu) se pošlou, jakmile bude spojení.</p>
    <button class="danger" id="syncOff">Vypnout synchronizaci na tomto zařízení</button>
  </section>`;
  el.querySelector('#syncCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link);
      C.toast('Odkaz zkopírován');
    } catch {
      prompt('Zkopírujte odkaz:', link);
    }
  });
  el.querySelector('#syncShare')?.addEventListener('click', () => {
    navigator.share({ title: t.name, text: `Turnaj ${t.name}`, url: link }).catch(() => {});
  });
  el.querySelector('#syncOff').addEventListener('click', () => {
    if (!confirm('Vypnout synchronizaci na tomto zařízení? Ostatní zařízení budou dál synchronizovat mezi sebou.')) return;
    t.sync.enabled = false;
    saveTournament(t);
    attach(t);
    mountSyncCard(el);
  });
  setStatus(status);
}
