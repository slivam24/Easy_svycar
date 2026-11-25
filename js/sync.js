// Synchronizace turnaje mezi zařízeními.
//
// Zařízení si posílají změny přes server ntfy.sh (nebo jiný server ntfy), který jen přeposílá
// zprávy. Obsah je šifrovaný AES-256-GCM; klíč je jen v odkazu pro připojení (za znakem #, ten se
// na žádný server neposílá). Server tak vidí jen nečitelná data.
//
// Slučování: každá změna je „nastav hodnotu na cestě v datech turnaje“ s časovým razítkem
// (hybridní hodiny + id zařízení). Pro každou cestu platí poslední změna. Výsledky zadané na dvou
// zařízeních do různých partií se tak nepřepíšou.

export const DEFAULT_SERVER = 'https://ntfy.sh';
const PREFIX = 'ES1';
const PART = 3800; // znaků na jednu zprávu (limit ntfy je 4096 bajtů)
const LOCAL_KEYS = new Set(['sync', 'updated', '_clock']);

// ------------------------------------------------------------------ pomocné
const enc = new TextEncoder();
const dec = new TextDecoder();

function randomBytes(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

export function b64u(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64u(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const randomId = (n = 10) => b64u(randomBytes(n)).replace(/[-_]/g, 'x').slice(0, n);

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const pkey = (path) => JSON.stringify(path);

/** Kopie turnaje bez místních údajů (klíč synchronizace, časy, hodiny). */
export function shareable(t) {
  const out = {};
  for (const [k, v] of Object.entries(t)) if (!LOCAL_KEYS.has(k)) out[k] = clone(v);
  return out;
}

// ------------------------------------------------------------------ konfigurace a odkaz
export function newSyncConfig(server = DEFAULT_SERVER) {
  return {
    server: server.replace(/\/+$/, ''),
    topic: `easysvycar-${randomId(20)}`,
    key: b64u(randomBytes(32)),
    device: randomId(8),
    enabled: true,
    last: null,
    outbox: [],
  };
}

/** Odkaz pro připojení dalšího zařízení. */
export function joinLink(t, base) {
  const s = t.sync;
  const srv = s.server === DEFAULT_SERVER ? '' : `&srv=${encodeURIComponent(s.server)}`;
  return `${base}#sync=${s.topic}.${s.key}${srv}`;
}

export function parseJoin(hash) {
  const h = new URLSearchParams(hash.replace(/^#/, ''));
  const v = h.get('sync');
  if (!v) return null;
  const [topic, key] = v.split('.');
  if (!/^easysvycar-[A-Za-z0-9]{10,}$/.test(topic || '') || !key || key.length < 40) return null;
  return { topic, key, server: (h.get('srv') || DEFAULT_SERVER).replace(/\/+$/, '') };
}

// ------------------------------------------------------------------ hodiny
let lastMs = 0;
let counter = 0;
/** Zapamatuje si razítko z jiného zařízení, aby naše další razítka byla novější. */
export function observe(ts) {
  const ms = parseInt(String(ts).slice(0, 9), 36);
  if (ms > lastMs) {
    lastMs = ms;
    counter = 0;
  }
}

/** Časové razítko porovnatelné jako řetězec: čas, pořadí, zařízení. */
export function stamp(device) {
  let ms = Date.now();
  if (ms <= lastMs) {
    ms = lastMs;
    counter++;
  } else {
    lastMs = ms;
    counter = 0;
  }
  return `${ms.toString(36).padStart(9, '0')}.${counter.toString(36).padStart(4, '0')}.${device}`;
}

// ------------------------------------------------------------------ rozdíly a slučování
/** Změny mezi dvěma stavy turnaje: [{ p: cesta, v: hodnota }] (v === undefined = smazat). */
export function diffOps(prev, next, path = [], out = []) {
  // nově vylosované kolo (jiné rid) se nahradí celé, aby přebilo výsledky starého losování
  if (isObj(prev) && isObj(next) && (prev.rid || next.rid) && prev.rid !== next.rid) {
    out.push({ p: path, v: clone(next) });
    return out;
  }
  if (isObj(prev) && isObj(next)) {
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const k of keys) {
      if (path.length === 0 && LOCAL_KEYS.has(k)) continue;
      diffOps(prev[k], next[k], [...path, k], out);
    }
    return out;
  }
  if (Array.isArray(prev) && Array.isArray(next) && prev.length === next.length) {
    for (let i = 0; i < prev.length; i++) diffOps(prev[i], next[i], [...path, i], out);
    return out;
  }
  if (JSON.stringify(prev) !== JSON.stringify(next)) out.push({ p: path, v: clone(next) });
  return out;
}

function getAt(obj, path) {
  let x = obj;
  for (const k of path) {
    if (x === null || typeof x !== 'object') return undefined;
    x = x[k];
  }
  return x;
}

function setAt(obj, path, value) {
  if (!path.length) {
    for (const k of Object.keys(obj)) if (!LOCAL_KEYS.has(k)) delete obj[k];
    for (const [k, v] of Object.entries(value || {})) if (!LOCAL_KEYS.has(k)) obj[k] = clone(v);
    return;
  }
  let x = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (x[k] === null || typeof x[k] !== 'object') x[k] = typeof path[i + 1] === 'number' ? [] : {};
    x = x[k];
  }
  const last = path[path.length - 1];
  if (value === undefined) {
    if (Array.isArray(x)) x[last] = null;
    else delete x[last];
  } else x[last] = clone(value);
}

/**
 * Použije změny na turnaj (poslední zápis vyhrává pro každou cestu).
 * @returns {number} počet použitých změn
 */
export function applyOps(t, ops) {
  const clock = (t._clock ||= {});
  let applied = 0;
  const sorted = [...ops].sort((a, b) => a.p.length - b.p.length || (a.ts < b.ts ? -1 : 1));
  for (const op of sorted) {
    const key = pkey(op.p);
    let stale = false;
    for (let i = 0; i <= op.p.length; i++) {
      const c = clock[pkey(op.p.slice(0, i))];
      if (c && (i < op.p.length ? c > op.ts : c >= op.ts)) {
        stale = true;
        break;
      }
    }
    if (stale) continue;
    setAt(t, op.p, op.v);
    clock[key] = op.ts;
    const prefix = key.slice(0, -1);
    for (const k of Object.keys(clock)) {
      if (k !== key && k.startsWith(op.p.length ? `${prefix},` : '[') && clock[k] < op.ts) delete clock[k];
    }
    applied++;
  }
  return applied;
}

/** Stav pro nové zařízení: data i hodiny. */
export function snapshot(t) {
  return { t: shareable(t), clock: clone(t._clock || {}) };
}

/** Sloučí stav jiného zařízení do turnaje. */
export function mergeSnapshot(t, snap) {
  const ops = Object.entries(snap.clock || {}).map(([k, ts]) => {
    const p = JSON.parse(k);
    return { p, v: getAt(snap.t, p), ts };
  });
  return applyOps(t, ops);
}

// ------------------------------------------------------------------ šifrování a zprávy
async function importKey(keyB64) {
  return crypto.subtle.importKey('raw', unb64u(keyB64), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function deflate(bytes) {
  const cs = new CompressionStream('deflate-raw');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer());
}

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
}

/** Zpráva → seznam řetězců pro server (zkomprimováno, zašifrováno, rozděleno). */
export async function encodeMessage(obj, keyB64) {
  const key = await importKey(keyB64);
  const iv = randomBytes(12);
  const data = await deflate(enc.encode(JSON.stringify(obj)));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const all = new Uint8Array(iv.length + ct.length);
  all.set(iv);
  all.set(ct, iv.length);
  const body = b64u(all);
  const id = randomId(8);
  const n = Math.max(1, Math.ceil(body.length / PART));
  return Array.from({ length: n }, (_, i) => `${PREFIX}|${id}|${i}|${n}|${body.slice(i * PART, (i + 1) * PART)}`);
}

/** Skládá části zpráv a dešifruje celé zprávy. */
export class Assembler {
  constructor(keyB64) {
    this.keyB64 = keyB64;
    this.parts = new Map();
  }

  /** @returns {Promise<object|null>} celá zpráva, nebo null (čeká se na další části / cizí zpráva) */
  async push(text) {
    const m = /^ES1\|([A-Za-z0-9]+)\|(\d+)\|(\d+)\|([A-Za-z0-9_-]*)$/.exec(text || '');
    if (!m) return null;
    const [, id, iS, nS, chunk] = m;
    const n = Number(nS);
    if (!this.parts.has(id)) this.parts.set(id, { n, got: new Map(), at: Date.now() });
    const entry = this.parts.get(id);
    entry.got.set(Number(iS), chunk);
    for (const [k, e] of this.parts) if (Date.now() - e.at > 10 * 60 * 1000) this.parts.delete(k);
    if (entry.got.size < entry.n) return null;
    this.parts.delete(id);
    const body = Array.from({ length: n }, (_, i) => entry.got.get(i)).join('');
    try {
      const all = unb64u(body);
      const key = await importKey(this.keyB64);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, key, all.subarray(12));
      return JSON.parse(dec.decode(await inflate(new Uint8Array(plain))));
    } catch {
      return null; // jiný klíč nebo poškozená zpráva
    }
  }
}

// ------------------------------------------------------------------ přenos přes ntfy
/**
 * Spojení s jedním „kanálem“ (topic) na serveru ntfy.
 * onMessage(obj, ntfyId) dostává dešifrované zprávy; onStatus('online' | 'offline' | 'connecting').
 */
export class Channel {
  constructor({ server, topic, key, onMessage, onStatus, since = 'all' }) {
    Object.assign(this, { server, topic, key, onMessage, onStatus, since });
    this.asm = new Assembler(key);
    this.es = null;
    this.closed = false;
    this.retry = null;
  }

  start() {
    this.closed = false;
    this.connect();
  }

  connect() {
    if (this.closed) return;
    this.onStatus?.('connecting');
    const url = `${this.server}/${this.topic}/sse?since=${encodeURIComponent(this.since || 'all')}`;
    const es = new EventSource(url);
    this.es = es;
    es.onopen = () => {
      this.delay = 4000;
      this.onStatus?.('online');
    };
    es.onmessage = async (ev) => {
      let data;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (data.event !== 'message') return;
      this.since = data.id;
      const obj = await this.asm.push(data.message);
      if (obj) this.onMessage?.(obj, data.id);
    };
    es.onerror = () => {
      es.close();
      if (this.closed) return;
      this.onStatus?.('offline');
      clearTimeout(this.retry);
      // při výpadku nebo omezení serverem (429) prodlužovat pauzu, ať se limit dál nečerpá
      this.delay = Math.min((this.delay || 4000) * 2, 60000);
      this.retry = setTimeout(() => this.connect(), this.delay);
    };
  }

  stop() {
    this.closed = true;
    clearTimeout(this.retry);
    this.es?.close();
    this.es = null;
  }

  /** Odešle zprávu (rozdělí ji na části). Vyhodí chybu, když se nepodaří. */
  async send(obj) {
    const parts = await encodeMessage(obj, this.key);
    for (const body of parts) {
      const res = await fetch(`${this.server}/${this.topic}`, { method: 'POST', body });
      if (!res.ok) {
        const err = new Error(res.status === 429 ? 'Server synchronizace hlásí příliš mnoho zpráv.' : `Server synchronizace: ${res.status}`);
        err.status = res.status;
        throw err;
      }
    }
  }
}
