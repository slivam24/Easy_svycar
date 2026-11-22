// Uživatelské rozhraní soutěží družstev.

import { TITLES, fmtPts } from './model.js';
import {
  TEAM_TIEBREAKS, TEAM_TB_SR_RR, TEAM_TB_SR_SWISS, teamTiebreaksFor, newTeam, newRosterPlayer, teamById,
  rosterPlayer, teamStrength, renumberTeams, drawTeamNumbers, teamNumbersByStrength, matchBoards, defaultBoards,
  boardResult, homeIsWhite, matchScore, matchOverride, teamRecord, pendingMatches, generateTeamRoundRobin,
  pairNextTeamRound, teamStandings, teamWithdrawal, playerResults,
} from './team.js';
import { roundRobinRounds } from './roundrobin.js';

let C = null; // pomocné funkce z app.js
let editingTeam = null;
let openMatch = null;
let lastLog = null;

export const TEAM_TABS = [
  ['kola', 'Utkání'],
  ['druzstva', 'Družstva'],
  ['poradi', 'Pořadí'],
  ['tabulka', 'Tabulka'],
  ['jednotlivci', 'Jednotlivci'],
  ['turnaj', 'Nastavení'],
  ['export', 'Export'],
];

export const TEAM_SYSTEMS = {
  'team-rr1': 'Družstva – každý s každým',
  'team-rr2': 'Družstva – každý s každým dvoukolově',
  'team-dutch': 'Družstva – švýcarský systém',
};

export const teamSystemKey = (t) => (t.system === 'rr' ? `team-rr${t.cycles === 2 ? 2 : 1}` : 'team-dutch');

export function applyTeamSystem(t, key) {
  const rr = key !== 'team-dutch';
  const changed = teamSystemKey(t) !== key;
  t.system = rr ? 'rr' : 'dutch';
  t.cycles = key === 'team-rr2' ? 2 : 1;
  if (changed) t.tiebreaks = [...(rr ? TEAM_TB_SR_RR : TEAM_TB_SR_SWISS)];
  if (rr) t.rounds = roundRobinRounds(t.teams.length, t.cycles);
  else if (!t.rounds) t.rounds = 7;
}

export function initTeamUI(ctx) {
  C = ctx;
}

export function resetTeamUI() {
  editingTeam = null;
  openMatch = null;
}

export function renderTeam(tab) {
  const fn = {
    kola: renderMatches, druzstva: renderTeams, poradi: renderTeamStandings, tabulka: renderTeamCross,
    jednotlivci: renderIndividuals, turnaj: renderTeamSettings, export: renderTeamExport,
  }[tab] || renderMatches;
  fn();
}

const esc = (s) => C.esc(s);
const T = () => C.getT();
const pname = (pid) => (pid ? rosterPlayer(T(), pid)?.player.name ?? '?' : '');
const tname = (id) => teamById(T(), id)?.name || '?';

// ---------------------------------------------------------------- družstva a soupisky
function renderTeams() {
  const t = T();
  const R = t.roundsData.length;
  const team = editingTeam ? teamById(t, editingTeam) : null;
  const hasMatches = (id) => t.roundsData.some((rd) => rd.matches.some((m) => m.home === id || m.away === id));
  C.view.innerHTML = `
    ${team ? teamEditor(t, team, hasMatches(team.id)) : ''}
    <section class="card">
      <div class="row between"><h2>Družstva (${t.teams.length})</h2>
        <span class="muted small">${t.system === 'rr'
    ? (t.tpnManual ? 'Čísla družstev jsou vylosovaná.' : 'Čísla podle průměrného ratingu prvních šachovnic.')
    : 'Nasazení podle průměrného ratingu prvních šachovnic (C.04.2 čl. 2).'}</span></div>
      ${t.teams.length ? `<div class="table-wrap"><table class="t"><thead><tr><th class="num">Č.</th><th>Družstvo</th><th>Oddíl</th>
        <th class="num">Hráčů</th><th class="num">Průměr ${t.boards} šach.</th></tr></thead><tbody>
        ${t.teams.map((x) => `<tr class="${x.status === 'withdrawn' ? 'withdrawn' : ''}"><td class="num">${x.tpn || ''}</td>
          <td class="name"><button class="link" data-team="${x.id}">${esc(x.name)}</button></td><td>${esc(x.club)}</td>
          <td class="num">${x.roster.length}</td><td class="num">${Math.round(teamStrength(t, x)) || ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Zatím žádná družstva.</p>'}
      ${!R && t.teams.length > 1 ? `<div class="row" style="margin-top:.6rem">
        ${t.system === 'rr' ? '<button id="drawTeams">🎲 Vylosovat čísla družstev</button>' : ''}
        ${t.tpnManual ? '<button id="strengthTeams">Čísla podle ratingu</button>' : ''}</div>` : ''}
    </section>
    ${!team ? `<section class="card">
      <h2>Přidat družstvo</h2>
      <form id="teamForm" class="grid" autocomplete="off">
        <label class="f" style="grid-column:1/-1">Název družstva<input name="name" required placeholder="ŠK Praha B"></label>
        <label class="f">Oddíl<input name="club"></label>
        <div class="row" style="grid-column:1/-1"><button class="primary">＋ Přidat družstvo</button></div>
      </form>
      ${R && t.system === 'rr' ? '<p class="muted small">Rozpis už je hotový; další družstvo do soutěže každý s každým přidat nejde.</p>' : ''}
    </section>` : ''}`;
  C.view.querySelectorAll('[data-team]').forEach((b) => b.addEventListener('click', () => {
    editingTeam = Number(b.dataset.team);
    renderTeams();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
  C.$('#teamForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (R && t.system === 'rr') return C.toast('Rozpis už je hotový.');
    const fd = new FormData(e.target);
    const x = newTeam(t, { name: fd.get('name').trim(), club: fd.get('club').trim() });
    t.teams.push(x);
    renumberTeams(t);
    if (t.system === 'rr') t.rounds = roundRobinRounds(t.teams.length, t.cycles);
    C.save();
    editingTeam = x.id;
    renderTeams();
  });
  C.$('#drawTeams')?.addEventListener('click', () => {
    drawTeamNumbers(t, C.secureRandom);
    C.save();
    C.toast('Čísla družstev vylosována');
    renderTeams();
  });
  C.$('#strengthTeams')?.addEventListener('click', () => {
    teamNumbersByStrength(t);
    C.save();
    renderTeams();
  });
  if (team) bindTeamEditor(t, team, hasMatches(team.id));
}

function teamEditor(t, team, played) {
  const w = teamWithdrawal(t, team.id);
  return `<section class="card">
    <div class="row between"><h2>${esc(team.name)}</h2><button id="closeTeam">Hotovo</button></div>
    <form id="teamEdit" class="grid" autocomplete="off">
      <label class="f">Název<input name="name" value="${esc(team.name)}" required></label>
      <label class="f">Oddíl<input name="club" value="${esc(team.club)}"></label>
      <div class="row" style="grid-column:1/-1"><button class="primary">Uložit</button>
        ${!played ? '<button type="button" class="danger" id="delTeam">Smazat družstvo</button>' : ''}
        ${played ? `<button type="button" id="withdrawTeam">${team.status === 'withdrawn' ? 'Vrátit do soutěže' : 'Družstvo vystoupilo'}</button>` : ''}</div>
    </form>
    ${played && t.system === 'rr' ? `<p class="muted small">${w
    ? (w.annul ? `Odehrálo ${w.played} z ${w.total} utkání, méně než polovinu: všechna jeho utkání jsou anulovaná (SŘ čl. 5.3.6).`
      : `Odehrálo ${w.played} z ${w.total} utkání: výsledky platí, zbývající utkání jsou kontumovaná (SŘ čl. 5.3.6).`)
    : 'SŘ čl. 5.3.6: když družstvo vystoupí po odehrání aspoň poloviny utkání, výsledky platí a zbytek se kontumuje; jinak se jeho utkání anulují.'}</p>` : ''}
    <h3 style="margin-top:1rem">Soupiska</h3>
    <p class="muted small">Pořadí na soupisce určuje výchozí sestavu od 1. šachovnice (SŘ čl. 3.6.2).</p>
    ${team.roster.length ? `<ol class="tb-list">${team.roster.map((p, i) => `<li><span class="lbl">${i + 1}. ${esc(p.title ? `${p.title} ` : '')}${esc(p.name)}
        <span class="muted small">${p.rating || ''}${p.fideId ? ` · FIDE ${esc(p.fideId)}` : ''}</span></span>
      <button class="small" data-pup="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Výš">↑</button>
      <button class="small" data-pdown="${i}" ${i === team.roster.length - 1 ? 'disabled' : ''} aria-label="Níž">↓</button>
      <button class="small" data-prm="${i}" aria-label="Odebrat">✕</button></li>`).join('')}</ol>` : '<p class="muted">Soupiska je prázdná.</p>'}
    <form id="rosterForm" class="grid" autocomplete="off">
      <label class="f" style="grid-column:1/-1">Příjmení a jméno<input name="name" required placeholder="Novák Jan"></label>
      <label class="f">Rating<input name="rating" inputmode="numeric"></label>
      <label class="f">Titul<select name="title"><option value=""></option>${TITLES.map((x) => `<option>${x}</option>`).join('')}</select></label>
      <label class="f">FIDE ID<input name="fideId" inputmode="numeric"></label>
      <div class="row" style="grid-column:1/-1"><button class="primary">＋ Přidat na soupisku</button></div>
    </form>
    <details style="margin-top:.6rem"><summary>Vložit celou soupisku</summary>
      <p class="muted small">Jeden hráč na řádek v pořadí soupisky: <code>Příjmení Jméno; rating; titul; FIDE ID</code> (středník nebo tabulátor).</p>
      <textarea id="rosterBulk"></textarea>
      <div class="row"><button id="rosterBulkAdd" class="primary">Přidat hráče</button></div>
    </details>
  </section>`;
}

function bindTeamEditor(t, team, played) {
  const rerender = () => {
    renumberTeams(t);
    C.save();
    renderTeams();
  };
  C.$('#closeTeam').addEventListener('click', () => {
    editingTeam = null;
    renderTeams();
  });
  C.$('#teamEdit').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    team.name = fd.get('name').trim();
    team.club = fd.get('club').trim();
    C.toast('Uloženo');
    rerender();
  });
  C.$('#delTeam')?.addEventListener('click', () => {
    if (!confirm(`Smazat družstvo ${team.name}?`)) return;
    t.teams = t.teams.filter((x) => x.id !== team.id);
    t.teams.forEach((x) => (x.tpn = 0));
    if (t.system === 'rr') t.rounds = roundRobinRounds(t.teams.length, t.cycles);
    editingTeam = null;
    rerender();
  });
  C.$('#withdrawTeam')?.addEventListener('click', () => {
    if (team.status === 'withdrawn') {
      team.status = 'active';
      team.withdrawnFrom = null;
    } else {
      team.status = 'withdrawn';
      team.withdrawnFrom = firstOpenRound(t, team.id);
    }
    rerender();
  });
  const move = (i, d) => {
    const r = team.roster;
    [r[i], r[i + d]] = [r[i + d], r[i]];
    rerender();
  };
  C.view.querySelectorAll('[data-pup]').forEach((b) => b.addEventListener('click', () => move(Number(b.dataset.pup), -1)));
  C.view.querySelectorAll('[data-pdown]').forEach((b) => b.addEventListener('click', () => move(Number(b.dataset.pdown), 1)));
  C.view.querySelectorAll('[data-prm]').forEach((b) => b.addEventListener('click', () => {
    const p = team.roster[Number(b.dataset.prm)];
    const usedInMatch = t.roundsData.some((rd) => rd.matches.some((m) => m.boards?.some((x) => x.hp === p.id || x.ap === p.id)));
    if (usedInMatch) return C.toast('Hráč už hrál; ze soupisky ho nejde odebrat.');
    team.roster.splice(Number(b.dataset.prm), 1);
    rerender();
  }));
  C.$('#rosterForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    team.roster.push(newRosterPlayer(t, {
      name: fd.get('name').trim(), rating: Number(fd.get('rating')) || 0, title: fd.get('title'), fideId: fd.get('fideId').trim(),
    }));
    rerender();
    C.$('#rosterForm [name=name]')?.focus();
  });
  C.$('#rosterBulkAdd').addEventListener('click', () => {
    const lines = C.$('#rosterBulk').value.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const c = line.split(/\t|;/).map((x) => x.trim());
      if (!c[0]) continue;
      team.roster.push(newRosterPlayer(t, {
        name: c[0], rating: Number(c[1]) || 0, title: TITLES.includes((c[2] || '').toUpperCase()) ? c[2].toUpperCase() : '', fideId: c[3] || '',
      }));
    }
    C.toast(`Přidáno hráčů: ${lines.length}`);
    rerender();
  });
}

function firstOpenRound(t, tid) {
  for (let r = 1; r <= t.roundsData.length; r++) {
    const m = t.roundsData[r - 1].matches.find((x) => x.home === tid || x.away === tid);
    if (m && matchScore(t, m).pending === matchBoards(t, m).length) return r;
  }
  return t.roundsData.length + 1;
}

// ---------------------------------------------------------------- utkání
function renderMatches() {
  const t = T();
  const R = t.roundsData.length;
  const rr = t.system === 'rr';
  if (rr && !R) {
    C.view.innerHTML = scheduleView(t);
    C.$('#makeSchedule')?.addEventListener('click', () => {
      try {
        generateTeamRoundRobin(t);
        C.save();
        C.toast(`Rozpis vytvořen: ${t.rounds} kol`);
        C.go({ round: 1 });
      } catch (err) {
        C.toast(err.message);
      }
    });
    return;
  }
  const { round } = C.parseHash();
  let sel;
  if (rr) {
    let first = 1;
    while (first < R && !pendingMatches(t, first)) first++;
    sel = round && round <= R ? round : first;
  } else {
    sel = round && round <= R + 1 ? round : R && pendingMatches(t, R) ? R : Math.min(R + 1, t.rounds);
  }
  const chips = [];
  for (let r = 1; r <= t.rounds; r++) {
    const done = r <= R && !pendingMatches(t, r);
    chips.push(`<button class="chip${done ? ' done' : ''}" aria-pressed="${r === sel}" data-round="${r}" ${r > R + (rr ? 0 : 1) ? 'disabled' : ''}>${r}. kolo</button>`);
  }
  C.view.innerHTML = `<div class="chips">${chips.join('')}</div>${sel <= R ? roundView(t, sel) : pairingView(t, sel)}`;
  C.view.querySelectorAll('[data-round]').forEach((b) => b.addEventListener('click', () => {
    openMatch = null;
    C.go({ round: Number(b.dataset.round) });
  }));
  if (sel <= R) bindRound(t, sel);
  else bindPairing(t, sel);
}

function scheduleView(t) {
  const n = t.teams.length;
  return `<section class="card">
    <h2>Rozpis soutěže každý s každým</h2>
    ${n < 3 ? '<div class="notice warn">Soutěž každý s každým potřebuje aspoň 3 družstva.</div>' : ''}
    <p>${n} družstev, ${t.cycles === 2 ? 'dvoukolově' : 'jednokolově'}, ${t.boards} šachovnic: <strong>${roundRobinRounds(n, t.cycles)} kol</strong>${n % 2 ? ', v každém kole má jedno družstvo volno' : ''}.
      Rozpis podle Schurigových (Bergerových) tabulek. Domácí je družstvo uvedené první a má bílé na lichých šachovnicích (SŘ čl. 3.4.1).</p>
    <p class="muted small">Čísla družstev: ${t.tpnManual ? 'vylosovaná' : 'podle ratingu'}. Vylosovat je jde v části Družstva.</p>
    <button class="primary" id="makeSchedule" ${n < 3 ? 'disabled' : ''}>Vytvořit rozpis všech kol</button>
  </section>`;
}

function pairingView(t, r) {
  const R = t.roundsData.length;
  const problems = [];
  if (R && pendingMatches(t, R)) problems.push(`Nejdřív zadej všechny výsledky ${R}. kola.`);
  if (t.teams.length < 2) problems.push('Soutěž potřebuje aspoň dvě družstva.');
  const active = t.teams.filter((x) => !(x.status === 'withdrawn' && x.withdrawnFrom <= r));
  return `<section class="card">
    <h2>Losování ${r}. kola</h2>
    ${problems.map((x) => `<div class="notice warn">${esc(x)}</div>`).join('')}
    <p>Losuje se <strong>${active.length}</strong> družstev${active.length % 2 ? ' (jedno dostane volno)' : ''}. Holandský systém FIDE se zápasovými body jako hlavním skóre.</p>
    ${r === 1 ? `<label class="f" style="max-width:22rem">Barva družstva č. 1 na 1. šachovnici v 1. kole (los)
      <select id="initColour"><option value="">vylosovat náhodně</option>
      <option value="W"${t.initialColour === 'W' ? ' selected' : ''}>bílá</option><option value="B"${t.initialColour === 'B' ? ' selected' : ''}>černá</option></select></label>` : ''}
    <button class="primary" id="doPair" style="margin-top:.6rem" ${problems.length ? 'disabled' : ''}>Vylosovat ${r}. kolo</button>
  </section>`;
}

function bindPairing(t, r) {
  C.$('#initColour')?.addEventListener('change', (e) => {
    t.initialColour = e.target.value || null;
    C.save();
  });
  C.$('#doPair')?.addEventListener('click', () => {
    try {
      const res = pairNextTeamRound(t, { random: C.secureRandom });
      lastLog = { round: res.round, lines: res.log };
      C.save();
      C.toast(`${res.round}. kolo vylosováno`);
      C.go({ round: res.round });
    } catch (err) {
      C.toast(err.message);
    }
  });
}

function scoreText(t, m, r) {
  const ov = matchOverride(t, m, r);
  if (ov?.annul) return 'anulováno';
  if (ov?.forfeit) return ov.forfeit === 'home' ? `0 : ${t.boards} k` : ov.forfeit === 'away' ? `${t.boards} : 0 k` : '0 : 0 k';
  const s = matchScore(t, m);
  return `${fmtPts(s.home) || 0} : ${fmtPts(s.away) || 0}${s.pending ? ` <span class="muted small">(chybí ${s.pending})</span>` : ''}`;
}

function roundView(t, r) {
  const rd = t.roundsData[r - 1];
  const pend = pendingMatches(t, r);
  const cards = rd.matches.map((m, i) => {
    const ov = matchOverride(t, m, r);
    const s = matchScore(t, m);
    const done = ov || !s.pending;
    const open = openMatch === i && !ov;
    return `<div class="card match${done ? ' has-result' : ''}" style="margin-bottom:.5rem;padding:.7rem">
      <button class="link match-head" data-open="${i}" style="width:100%;text-align:left;display:flex;justify-content:space-between;gap:.6rem;color:var(--ink)">
        <span>${i + 1}. ${esc(tname(m.home))} – ${esc(tname(m.away))}</span><span class="nowrap">${scoreText(t, m, r)}</span></button>
      ${ov?.forfeit ? '<div class="muted small">Kontumace: družstvo vystoupilo (SŘ čl. 5.3.6)</div>' : ''}
      ${ov?.annul ? '<div class="muted small">Anulováno: družstvo vystoupilo před polovinou soutěže (SŘ čl. 5.3.6)</div>' : ''}
      ${open ? boardsEditor(t, m, i) : ''}
    </div>`;
  }).join('');
  const byes = rd.byes.length
    ? `<p class="muted">Volno: ${rd.byes.map((b) => `${esc(tname(b.team))}${b.type === 'PAB' ? ` (${fmtPts(t.matchPoints.win)} ZB, ${fmtPts(t.pabGamePoints ?? t.boards)} b.)` : ''}`).join(', ')}</p>` : '';
  return `<section>
    <div class="row between" style="margin-bottom:.5rem"><h2 style="margin:0">${r}. kolo</h2>
      <span>${pend ? `<span class="muted">Nedohraná utkání: ${pend}</span>` : '<span class="notice ok">Všechny výsledky zadány</span>'}</span></div>
    <p class="muted small">Klepnutím na utkání otevřete sestavy a výsledky po šachovnicích.</p>
    ${cards}
    ${byes}
    <div class="row" style="margin-top:.6rem">
      <button id="printRound">🖨 Tisk kola</button>
      ${!pend && r < t.rounds && (t.system === 'rr' || r === t.roundsData.length) ? '<button class="primary" id="toNext">Další kolo →</button>' : ''}
      ${t.system !== 'rr' && r === t.roundsData.length ? '<button class="danger" id="unpair">Zrušit losování tohoto kola</button>' : ''}
      ${t.system === 'rr' && !t.roundsData.some((x) => x.matches.some((m) => m.boards)) ? '<button class="danger" id="unschedule">Zrušit rozpis</button>' : ''}
    </div>
    ${lastLog && lastLog.round === r ? `<details style="margin-top:.6rem"><summary>Jak losování proběhlo</summary><pre class="log">${esc(lastLog.lines.join('\n'))}</pre></details>` : ''}
  </section>`;
}

function boardsEditor(t, m, i) {
  const boards = matchBoards(t, m);
  const home = teamById(t, m.home);
  const away = teamById(t, m.away);
  const opts = (team, sel) => `<option value="">— neobsazeno —</option>${team.roster.map((p, k) => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${k + 1}. ${esc(p.name)}</option>`).join('')}`;
  return `<div class="boards" style="margin-top:.6rem">
    ${boards.map((b, k) => {
    const res = boardResult(b);
    const forced = !b.hp || !b.ap;
    const btn = (code, label) => `<button data-m="${i}" data-bd="${k}" data-res="${code}" aria-pressed="${res === code}"${forced ? ' disabled' : ''}>${label}</button>`;
    const hw = homeIsWhite(k);
    return `<div class="board${res ? ' has-result' : ''}">
      <div class="no">${k + 1}</div>
      <div class="players">
        <div class="pl"><span class="clr ${hw ? 'w' : 'b'}" aria-hidden="true"></span>
          <select data-m="${i}" data-bd="${k}" data-side="hp" aria-label="${k + 1}. šachovnice, ${esc(home.name)}">${opts(home, b.hp)}</select></div>
        <div class="pl"><span class="clr ${hw ? 'b' : 'w'}" aria-hidden="true"></span>
          <select data-m="${i}" data-bd="${k}" data-side="ap" aria-label="${k + 1}. šachovnice, ${esc(away.name)}">${opts(away, b.ap)}</select></div>
      </div>
      <div class="res">${btn('1-0', '1–0')}${btn('½-½', '½')}${btn('0-1', '0–1')}
        <button class="more" data-fm="${i}-${k}" aria-label="Kontumace" title="Kontumace"${forced ? ' disabled' : ''}>${['+-', '-+', '--'].includes(res) ? { '+-': '+ : −', '-+': '− : +', '--': '− : −' }[res] : '⋯'}</button></div>
      ${forced ? '<div class="forfeits"><span class="muted small">Neobsazená šachovnice: kontumace</span></div>' : `<div class="forfeits" data-forfeits="${i}-${k}" hidden>
        <span class="muted small">Kontumace (výsledek domácích):</span>
        ${btn('+-', '+ : −')}${btn('-+', '− : +')}${btn('--', '− : −')}</div>`}
    </div>`;
  }).join('')}
    <p class="muted small">Výsledky jsou z pohledu domácích (${esc(home.name)}). Bílé: domácí na lichých šachovnicích (SŘ čl. 3.4.1).</p>
  </div>`;
}

function bindRound(t, r) {
  const rd = t.roundsData[r - 1];
  const materialize = (m) => {
    if (!m.boards) m.boards = defaultBoards(t, m);
    return m.boards;
  };
  C.view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.open);
    openMatch = openMatch === i ? null : i;
    renderMatches();
  }));
  C.view.querySelectorAll('[data-res]').forEach((b) => b.addEventListener('click', () => {
    const m = rd.matches[Number(b.dataset.m)];
    const board = materialize(m)[Number(b.dataset.bd)];
    board.result = board.result === b.dataset.res ? null : b.dataset.res;
    C.save();
    renderMatches();
  }));
  C.view.querySelectorAll('select[data-side]').forEach((s) => s.addEventListener('change', () => {
    const m = rd.matches[Number(s.dataset.m)];
    const board = materialize(m)[Number(s.dataset.bd)];
    const val = s.value ? Number(s.value) : null;
    // stejný hráč nesmí hrát na dvou šachovnicích: prohodit
    const other = m.boards.find((x, k) => k !== Number(s.dataset.bd) && x[s.dataset.side] === val && val);
    if (other) other[s.dataset.side] = board[s.dataset.side];
    board[s.dataset.side] = val;
    C.save();
    renderMatches();
  }));
  C.view.querySelectorAll('[data-fm]').forEach((b) => b.addEventListener('click', () => {
    const box = C.view.querySelector(`[data-forfeits="${b.dataset.fm}"]`);
    if (box) box.hidden = !box.hidden;
  }));
  C.$('#toNext')?.addEventListener('click', () => {
    openMatch = null;
    C.go({ round: r + 1 });
  });
  C.$('#unpair')?.addEventListener('click', () => {
    if (!confirm(`Zrušit losování ${r}. kola?`)) return;
    t.roundsData.pop();
    lastLog = null;
    C.save();
    C.go({ round: r });
  });
  C.$('#unschedule')?.addEventListener('click', () => {
    if (!confirm('Zrušit rozpis všech kol?')) return;
    t.roundsData = [];
    C.save();
    C.go({ round: null });
  });
  C.$('#printRound').addEventListener('click', () => printRound(t, r));
}

function printRound(t, r) {
  const rd = t.roundsData[r - 1];
  const html = rd.matches.map((m, i) => {
    const rows = matchBoards(t, m).map((b, k) => `<tr><td class="num">${k + 1}</td><td>${homeIsWhite(k) ? '○' : '●'} ${esc(pname(b.hp) || '—')}</td>
      <td style="text-align:center">${esc(boardResult(b) || '')}</td><td>${homeIsWhite(k) ? '●' : '○'} ${esc(pname(b.ap) || '—')}</td></tr>`).join('');
    return `<h2>${i + 1}. ${esc(tname(m.home))} – ${esc(tname(m.away))} ${scoreText(t, m, r).replace(/<[^>]+>/g, '')}</h2>
      <table><thead><tr><th class="num">Š.</th><th>${esc(tname(m.home))}</th><th style="text-align:center">Výsledek</th><th>${esc(tname(m.away))}</th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join('');
  C.printHtml(`<h2>${r}. kolo</h2>${html}`);
}

// ---------------------------------------------------------------- pořadí
function rankLabel(rows, i) {
  const r = rows[i];
  if (!r.tied) return `${r.rank}.`;
  const same = rows.filter((x) => x.rank === r.rank).length;
  return same > 1 ? `${r.rank}.–${r.rank + same - 1}.` : `${r.rank}.`;
}

const tbCell = (c, row) => (c === 'EDE' || c === 'TOP' ? (row.used.includes(c) ? '✓' : '') : fmtPts(row.tb[c]));

function renderTeamStandings() {
  const t = T();
  const R = t.roundsData.length;
  const done = R && pendingMatches(t, R) ? R - 1 : R;
  const { after } = C.parseHash();
  const upTo = after && after <= R ? after : done;
  const codes = t.tiebreaks.filter((c) => TEAM_TIEBREAKS[c]);
  const rows = upTo ? teamStandings(t, upTo) : [];
  const head = `<th class="num">Poř.</th><th class="num">Č.</th><th>Družstvo</th><th class="num">ZB</th>
    ${codes.map((c) => `<th class="num" title="${esc(TEAM_TIEBREAKS[c].label)} – ${esc(TEAM_TIEBREAKS[c].help)}">${esc(TEAM_TIEBREAKS[c].short)}</th>`).join('')}`;
  const body = rows.map((r, i) => `<tr class="${r.team.status === 'withdrawn' ? 'withdrawn' : ''}"><td class="num">${rankLabel(rows, i)}</td><td class="num">${r.team.tpn}</td>
    <td class="name">${esc(r.team.name)}</td><td class="num"><strong>${fmtPts(r.mp)}</strong></td>
    ${codes.map((c) => `<td class="num">${tbCell(c, r)}</td>`).join('')}</tr>`).join('');
  C.view.innerHTML = `<section class="card">
    <div class="row between"><h2>Pořadí po ${upTo}. kole</h2>
      <label class="row small">po kole <select id="after">${Array.from({ length: R }, (_, i) => `<option${i + 1 === upTo ? ' selected' : ''}>${i + 1}</option>`).join('')}</select></label></div>
    ${!upTo ? '<p class="muted">Pořadí bude po prvním kole.</p>' : `
    <div class="table-wrap"><table class="t"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    <p class="muted small">Zápasové body (ZB): výhra ${fmtPts(t.matchPoints.win)}, remíza ${fmtPts(t.matchPoints.draw)}, prohra ${fmtPts(t.matchPoints.loss)} (SŘ čl. 5.3.2).
      Pomocná hodnocení: ${codes.map((c) => esc(TEAM_TIEBREAKS[c].label)).join(' → ')}${codes.length ? ' → ' : ''}los.
      ${codes.some((c) => c === 'EDE' || c === 'TOP') ? '✓ = shodu rozhodlo toto hodnocení.' : ''}</p>
    <div class="row"><button id="printSt">🖨 Tisk pořadí</button></div>`}
  </section>`;
  C.$('#after')?.addEventListener('change', (e) => C.go({ after: Number(e.target.value) }));
  C.$('#printSt')?.addEventListener('click', () => C.printHtml(`<h2>Pořadí po ${upTo}. kole</h2><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`));
}

// ---------------------------------------------------------------- tabulka
function renderTeamCross() {
  const t = T();
  const R = t.roundsData.length;
  const rows = R ? teamStandings(t, R) : [];
  const byId = new Map(rows.map((r) => [r.team.id, r]));
  const ts = [...t.teams].sort((a, b) => a.tpn - b.tpn);
  let table;
  if (t.system === 'rr') {
    const cell = (a, b) => {
      const out = [];
      for (let r = 1; r <= R; r++) {
        const rec = teamRecord(t, a, r);
        if (rec?.opp !== b) continue;
        if (rec.kind === 'annulled') out.push('×');
        else if (rec.pending) out.push('·');
        else out.push(fmtPts(rec.gp) || '0');
      }
      return out.join(' ');
    };
    table = `<table class="t cross"><thead><tr><th class="num">Č.</th><th class="name">Družstvo</th>${ts.map((x) => `<th>${x.tpn}</th>`).join('')}
      <th>ZB</th><th>Skóre</th><th>Poř.</th></tr></thead><tbody>
      ${ts.map((a) => `<tr><td class="num">${a.tpn}</td><td class="name">${esc(a.name)}</td>
        ${ts.map((b) => (a.id === b.id ? '<td>■</td>' : `<td class="nowrap">${esc(cell(a.id, b.id))}</td>`)).join('')}
        <td><strong>${byId.get(a.id) ? fmtPts(byId.get(a.id).mp) || '0' : ''}</strong></td><td>${byId.get(a.id) ? fmtPts(byId.get(a.id).gp) || '0' : ''}</td>
        <td>${byId.get(a.id) ? `${byId.get(a.id).rank}.` : ''}</td></tr>`).join('')}
    </tbody></table>`;
  } else {
    const cell = (a, r) => {
      const rec = teamRecord(t, a, r);
      if (!rec) return '';
      if (rec.kind === 'PAB') return 'volno';
      if (!rec.opp) return '–';
      return `${teamById(t, rec.opp)?.tpn}${rec.colour === 'W' ? 'd' : 'h'} ${rec.pending ? '' : fmtPts(rec.gp) || '0'}`;
    };
    table = `<table class="t cross"><thead><tr><th class="num">Poř.</th><th class="num">Č.</th><th class="name">Družstvo</th>
      ${Array.from({ length: R }, (_, i) => `<th>${i + 1}</th>`).join('')}<th>ZB</th><th>Skóre</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="num">${r.rank}.</td><td class="num">${r.team.tpn}</td><td class="name">${esc(r.team.name)}</td>
        ${Array.from({ length: R }, (_, i) => `<td class="nowrap">${esc(cell(r.team.id, i + 1))}</td>`).join('')}
        <td><strong>${fmtPts(r.mp) || '0'}</strong></td><td>${fmtPts(r.gp) || '0'}</td></tr>`).join('')}
    </tbody></table>`;
  }
  C.view.innerHTML = `<section class="card">
    <h2>Tabulka</h2>
    <p class="muted small">${t.system === 'rr'
    ? 'Skóre družstva v řádku proti družstvu ve sloupci (× = anulováno).'
    : 'V buňce: číslo soupeře, d = doma / h = venku, skóre utkání.'}</p>
    <div class="table-wrap">${table}</div>
    <div class="row" style="margin-top:.6rem"><button id="printCross">🖨 Tisk tabulky</button></div>
  </section>`;
  C.$('#printCross').addEventListener('click', () => C.printHtml(`<h2>Tabulka</h2>${table}`));
}

// ---------------------------------------------------------------- jednotlivci
function renderIndividuals() {
  const t = T();
  const res = playerResults(t).map((s) => {
    const rp = rosterPlayer(t, s.pid);
    return { ...s, name: rp?.player.name, rating: rp?.player.rating, team: rp?.team };
  }).sort((a, b) => b.points - a.points || a.boards.length - b.boards.length || (a.name || '').localeCompare(b.name || '', 'cs'));
  const rows = res.map((s) => {
    const n = s.boards.length;
    const avg = n ? s.boards.reduce((x, y) => x + y, 0) / n : 0;
    return `<tr><td class="name">${esc(s.name)}</td><td>${esc(s.team?.name)}</td><td class="num">${s.rating || ''}</td>
      <td class="num"><strong>${fmtPts(s.points) || '0'}</strong></td><td class="num">${n}</td>
      <td class="num">${n ? Math.round((s.points / n) * 100) : 0} %</td><td class="num">${avg ? avg.toFixed(1).replace('.', ',') : ''}</td></tr>`;
  }).join('');
  const table = `<table class="t"><thead><tr><th>Hráč</th><th>Družstvo</th><th class="num">Rtg</th><th class="num">Body</th><th class="num">Partie</th>
    <th class="num">Úspěšnost</th><th class="num">Prům. šach.</th></tr></thead><tbody>${rows}</tbody></table>`;
  C.view.innerHTML = `<section class="card">
    <h2>Výsledky jednotlivců</h2>
    <p class="muted small">Body ze všech utkání včetně kontumačních výher u nastoupivšího hráče; anulovaná utkání se nepočítají.</p>
    ${res.length ? `<div class="table-wrap">${table}</div><div class="row" style="margin-top:.6rem"><button id="printInd">🖨 Tisk</button></div>` : '<p class="muted">Zatím žádné výsledky.</p>'}
  </section>`;
  C.$('#printInd')?.addEventListener('click', () => C.printHtml(`<h2>Výsledky jednotlivců</h2>${table}`));
}

// ---------------------------------------------------------------- nastavení
function renderTeamSettings() {
  const t = T();
  const R = t.roundsData.length;
  const rr = t.system === 'rr';
  const codes = t.tiebreaks;
  const valid = teamTiebreaksFor(t.system);
  const avail = valid.filter((c) => !codes.includes(c));
  const invalid = codes.filter((c) => !valid.includes(c));
  C.view.innerHTML = `
    <section class="card">
      <h2>Soutěž družstev</h2>
      <form id="setForm" class="grid">
        <label class="f" style="grid-column:1/-1">Název<input name="name" value="${esc(t.name)}" required></label>
        <label class="f">Místo<input name="city" value="${esc(t.city)}"></label>
        <label class="f">Od<input type="date" name="dateFrom" value="${esc(t.dateFrom)}"></label>
        <label class="f">Do<input type="date" name="dateTo" value="${esc(t.dateTo)}"></label>
        <label class="f">Řídicí orgán / pořadatel<input name="organizer" value="${esc(t.organizer)}"></label>
        <label class="f">Hlavní rozhodčí<input name="arbiter" value="${esc(t.arbiter)}"></label>
        <label class="f">Tempo hry<input name="timeControl" value="${esc(t.timeControl)}"></label>
        <label class="f">Systém<select name="system"${R ? ' disabled' : ''}>${Object.entries(TEAM_SYSTEMS).map(([k, v]) => `<option value="${k}"${teamSystemKey(t) === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="f">Počet šachovnic<input type="number" name="boards" min="1" max="20" value="${t.boards}"${R ? ' disabled' : ''}></label>
        ${rr ? `<label class="f">Počet kol<input value="${roundRobinRounds(t.teams.length, t.cycles) || '–'} (podle počtu družstev)" disabled></label>`
    : `<label class="f">Počet kol<input type="number" name="rounds" min="${Math.max(1, R)}" max="30" value="${t.rounds}"></label>`}
        <label class="f">Zápasové body za výhru / remízu<select name="mp"${R ? ' disabled' : ''}>
          <option value="3-1"${t.matchPoints.win === 3 ? ' selected' : ''}>3 / 1 (SŘ čl. 5.3.2)</option>
          <option value="2-1"${t.matchPoints.win === 2 ? ' selected' : ''}>2 / 1</option></select></label>
        ${!rr ? `<label class="f">Skóre za volno z losování<select name="pabgp"${R ? ' disabled' : ''}>
          <option value="full"${t.pabGamePoints === null ? ' selected' : ''}>jako výhra na všech šachovnicích</option>
          <option value="half"${t.pabGamePoints !== null ? ' selected' : ''}>polovina šachovnic</option></select></label>` : ''}
        <div class="row" style="grid-column:1/-1"><button class="primary">Uložit</button></div>
      </form>
    </section>
    <section class="card">
      <h2>Pomocná hodnocení</h2>
      <p class="muted small">O pořadí rozhodují nejdřív zápasové body, pak tato hodnocení. ${rr
    ? 'Výchozí podle SŘ čl. 5.3.3: skóre, vyhrané partie, vzájemná utkání, výsledek proti vítězi, druhému…, los.'
    : 'Výchozí podle SŘ čl. 5.3.4: Buchholz ze zápasových bodů, skóre, Buchholz ze skóre bez nejhoršího, Buchholz ze skóre, los.'}
        Výpočet podle FIDE C.07 čl. 13 (od 1. 3. 2026).</p>
      ${invalid.length ? `<div class="notice warn">${invalid.map((c) => esc(TEAM_TIEBREAKS[c]?.label || c)).join(', ')}: pro tento systém se nepoužívá.</div>` : ''}
      <ol class="tb-list">${codes.map((c, i) => `<li><span class="lbl">${i + 1}. ${esc(TEAM_TIEBREAKS[c]?.label || c)} <span class="muted small">${esc(TEAM_TIEBREAKS[c]?.help || '')}</span></span>
        <button class="small" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Výš">↑</button>
        <button class="small" data-down="${i}" ${i === codes.length - 1 ? 'disabled' : ''} aria-label="Níž">↓</button>
        <button class="small" data-rm="${i}" aria-label="Odebrat">✕</button></li>`).join('')}</ol>
      <div class="row">
        <select id="tbAdd" style="max-width:20rem"><option value="">Přidat hodnocení…</option>${avail.map((c) => `<option value="${c}">${esc(TEAM_TIEBREAKS[c].label)}</option>`).join('')}</select>
        <button id="tbPreset">Podle Soutěžního řádu ŠSČR</button>
      </div>
    </section>
    <section class="card">
      <h2>Smazat soutěž</h2>
      <button class="danger" id="delT">Smazat soutěž z tohoto zařízení</button>
    </section>`;
  C.$('#setForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    for (const k of ['name', 'city', 'dateFrom', 'dateTo', 'arbiter', 'organizer', 'timeControl']) t[k] = fd.get(k).trim();
    if (!R) {
      applyTeamSystem(t, fd.get('system'));
      t.boards = Math.max(1, Math.min(20, Number(fd.get('boards')) || t.boards));
      t.matchPoints = fd.get('mp') === '2-1' ? { win: 2, draw: 1, loss: 0 } : { win: 3, draw: 1, loss: 0 };
      if (fd.get('pabgp')) t.pabGamePoints = fd.get('pabgp') === 'half' ? t.boards / 2 : null;
    }
    if (t.system !== 'rr' && fd.get('rounds')) t.rounds = Math.max(R, Math.min(30, Number(fd.get('rounds')) || t.rounds));
    if (t.system === 'rr' && !R) t.rounds = roundRobinRounds(t.teams.length, t.cycles);
    C.save();
    C.toast('Uloženo');
    C.render();
  });
  const move = (i, d) => {
    const a = t.tiebreaks;
    [a[i], a[i + d]] = [a[i + d], a[i]];
    C.save();
    renderTeamSettings();
  };
  C.view.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => move(Number(b.dataset.up), -1)));
  C.view.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => move(Number(b.dataset.down), 1)));
  C.view.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
    t.tiebreaks.splice(Number(b.dataset.rm), 1);
    C.save();
    renderTeamSettings();
  }));
  C.$('#tbAdd').addEventListener('change', (e) => {
    if (!e.target.value) return;
    t.tiebreaks.push(e.target.value);
    C.save();
    renderTeamSettings();
  });
  C.$('#tbPreset').addEventListener('click', () => {
    t.tiebreaks = [...(t.system === 'rr' ? TEAM_TB_SR_RR : TEAM_TB_SR_SWISS)];
    C.save();
    renderTeamSettings();
  });
  C.$('#delT').addEventListener('click', () => C.deleteCurrent());
}

function renderTeamExport() {
  C.view.innerHTML = `
    <section class="card">
      <h2>Záloha</h2>
      <p class="muted small">Celá soutěž v jednom souboru. Na jiném zařízení ji načtete na úvodní stránce.</p>
      <button class="primary" id="dlJson">Stáhnout zálohu (.json)</button>
    </section>`;
  C.$('#dlJson').addEventListener('click', () => C.download(`${C.fileBase()}.json`, JSON.stringify(T(), null, 1), 'application/json'));
}
