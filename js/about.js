// Nápověda: návod k použití a seznam změn. Seznam změn je zároveň zdroj čísla verze
// (první záznam = aktuální verze; musí odpovídat "version" v package.json).

/**
 * Seznam změn od nejnovější. Do `items` patří to, co uživatel v aplikaci pozná:
 * nové funkce, opravy a změny chování. Technické úpravy bez dopadu na uživatele sem nepatří.
 */
export const CHANGELOG = [
  {
    version: '1.6.0',
    date: '2026-11-27',
    title: 'Nápověda a seznam změn',
    items: [
      'Nová část Nápověda (odkaz vpravo nahoře): návod k použití a tento seznam změn.',
      'Po aktualizaci aplikace se na úvodní stránce ukáže, co je nového.',
    ],
  },
  {
    version: '1.5.0',
    date: '2026-11-26',
    title: 'Tisk seznamu družstev a soupisek',
    items: [
      'Soutěže družstev: v části Družstva jde vytisknout seznam družstev a soupisky všech družstev.',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-11-25',
    title: 'Synchronizace mezi zařízeními',
    items: [
      'Turnaj může být otevřený na více zařízeních najednou (počítač rozhodčího, telefony); změny se objeví během pár sekund.',
      'Další zařízení se připojí QR kódem nebo odkazem v části Sdílení.',
      'Přenos je šifrovaný (AES-256-GCM), klíč je jen v odkazu. Volitelně vlastní server ntfy.',
      'Výsledky zadané souběžně na různých zařízeních se nepřepíšou; bez internetu se změny odešlou, jakmile je spojení.',
      'Stav spojení je vidět v záhlaví. Změny se posílají v dávkách, aby stačil limit veřejného serveru; po jeho překročení aplikace chvíli počká.',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-11-22',
    title: 'Soutěže družstev',
    items: [
      'Soutěže družstev každý s každým (jedno- i dvoukolově) a švýcarským systémem.',
      'Družstva se soupiskami, sestavy a výsledky po šachovnicích, domácí mají bílé na lichých šachovnicích (SŘ čl. 3.4.1).',
      'Zápasové body 3/1/0 nebo 2/1/0, pořadí podle SŘ čl. 5.3.3 a 5.3.4, vystoupení družstva podle čl. 5.3.6.',
      'Křížová tabulka družstev a výsledky jednotlivců.',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-11-22',
    title: 'Turnaje každý s každým',
    items: [
      'Jedno- i dvoukolové turnaje každý s každým podle Bergerových tabulek FIDE.',
      'Losování startovních čísel, odstoupení hráče podle SŘ čl. 5.2.4, křížová tabulka hráč × hráč.',
      'Pomocná hodnocení podle SŘ čl. 5.2.2 (Sonneborn-Berger, vzájemné partie, výsledek proti vítězi…) a Koya.',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-11-22',
    title: 'Lepší čitelnost',
    items: [
      'Opraveno: formulářová pole měla ve tmavém režimu tmavý text na tmavém pozadí.',
      'Šedé texty jsou tmavší; všechny texty splňují kontrast WCAG AA ve světlém i tmavém režimu.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-11-21',
    title: 'První verze',
    items: [
      'Turnaje jednotlivců švýcarským systémem s losováním podle holandského systému FIDE (C.04.3, od 1. 2. 2026).',
      'Pomocná hodnocení podle FIDE C.07 (od 1. 3. 2026) s výchozím pořadím podle Soutěžního řádu ŠSČR.',
      'Zadávání výsledků z mobilu, pořadí, křížová tabulka a tisk.',
      'Export TRF, záloha a načtení turnaje, práce bez internetu.',
    ],
  },
];

export const VERSION = CHANGELOG[0].version;

const SEEN_KEY = 'svycar:seenVersion';

/**
 * Verze, kterou uživatel naposledy viděl. Nový uživatel novinky nepotřebuje: uloží se mu aktuální verze.
 * Kdo už má turnaje z doby před seznamem změn (1.5.0 a starší), uvidí novinky od 1.6.0.
 */
function seenVersion() {
  try {
    const v = localStorage.getItem(SEEN_KEY);
    if (v) return v;
    const before = localStorage.getItem('svycar:index') && CHANGELOG.find((c) => c.version === '1.5.0');
    if (before) return before.version;
    localStorage.setItem(SEEN_KEY, VERSION);
    return VERSION;
  } catch {
    return VERSION;
  }
}

export function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, VERSION);
  } catch {
    /* bez úložiště se upozornění prostě ukáže znovu */
  }
}

/** Záznamy novější než verze, kterou uživatel viděl (prázdné, pokud nic nového není). */
export function unseenChanges(seen = seenVersion()) {
  const i = CHANGELOG.findIndex((c) => c.version === seen);
  return i < 0 ? [] : CHANGELOG.slice(0, i);
}

const fmtDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}. ${m}. ${y}`;
};

/** Upozornění na úvodní stránce po aktualizaci aplikace. */
export function whatsNewNotice(esc) {
  const news = unseenChanges();
  if (!news.length) return '';
  return `<section class="card whats-new" id="whatsNew">
    <div class="row between"><h2>Co je nového ve verzi ${esc(VERSION)}</h2>
      <button class="small" id="whatsNewClose" aria-label="Skrýt">✕</button></div>
    <ul class="small">${news.flatMap((c) => c.items).slice(0, 6).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <a href="#napoveda=zmeny">Celý seznam změn</a>
  </section>`;
}

// ------------------------------------------------------------------ návod
// Každá kapitola je [nadpis, HTML]. Texty odpovídají popiskům tlačítek v aplikaci.
const GUIDE = [
  ['Rychlý start', `
    <ol>
      <li>Na úvodní stránce napište název turnaje, vyberte systém a klepněte na <b>＋ Nový turnaj</b>.</li>
      <li>V části <b>Nastavení</b> doplňte údaje o turnaji, počet kol a případně pomocná hodnocení. Uložte.</li>
      <li>V části <b>Hráči</b> přidejte hráče (u družstev v části <b>Družstva</b> družstva a jejich soupisky).</li>
      <li>V části <b>Kola</b> vylosujte 1. kolo (u turnaje každý s každým vytvořte rozpis všech kol).</li>
      <li>Zadávejte výsledky a po dohrání kola klepněte na <b>Další kolo →</b> a vylosujte další.</li>
      <li>Průběžné <b>Pořadí</b> a <b>Tabulku</b> můžete kdykoli zobrazit a vytisknout.</li>
    </ol>
    <p>Všechno se ukládá samo hned po každé změně, žádné tlačítko „Uložit turnaj“ není.</p>`],
  ['Hráči', `
    <ul>
      <li>Hráče přidáte formulářem nahoře; povinné je jen jméno. Startovní čísla se přidělí sama podle ratingu, titulu a abecedy.</li>
      <li>Víc hráčů najednou: rozbalte <b>Vložit víc hráčů najednou</b> a vložte jednoho hráče na řádek
        (<code>Příjmení Jméno; rating; titul; FIDE ID; federace; oddíl; narození</code>). Jde vložit i sloupce zkopírované z Excelu.</li>
      <li>Úprava hráče: klepněte na jeho jméno v seznamu. Hráče, který už hrál, nejde smazat – místo toho ho označte jako <b>Odstoupil</b>.</li>
      <li>Hráč přidaný po 1. kole švýcarského turnaje je pozdě přihlášený: za odehraná kola má 0 bodů a losuje se od dalšího kola.</li>
      <li>Po 4. kole švýcaru se startovní čísla už nemění (FIDE C.04.2 čl. 2).</li>
    </ul>`],
  ['Losování a výsledky (švýcarský systém)', `
    <ul>
      <li>V části <b>Kola</b> vyberte kolo nahoře v řadě tlačítek; hotová kola mají ✓.</li>
      <li>Před losováním rozbalte <b>Hráči, kteří kolo nehrají</b> a nastavte volno na žádost (½ nebo 1 bod) nebo omluvenou
        absenci (0 bodů). Tito hráči se nevylosují.</li>
      <li>U 1. kola můžete zvolit barvu hráče č. 1; jinak se vylosuje.</li>
      <li>Při lichém počtu hráčů dostane jeden hráč volno z losování (body nastavíte v Nastavení).</li>
      <li>Výsledek zadáte klepnutím na <b>1–0</b>, <b>½</b> nebo <b>0–1</b>. Druhým klepnutím na stejné tlačítko výsledek zrušíte.
        Kontumace jsou pod tlačítkem <b>⋯</b>.</li>
      <li>Další kolo jde vylosovat, až jsou zadané všechny výsledky. Pod vylosovaným kolem je <b>Jak losování proběhlo</b> –
        postup po bodových skupinách.</li>
      <li>Losování posledního kola jde zrušit tlačítkem <b>Zrušit losování tohoto kola</b> (třeba když jste zapomněli
        nastavit nehrajícího hráče). Výsledek staršího kola jde opravit, další kola se ale znovu nelosují.</li>
      <li>Hráč, který odstoupí, se od dalšího kola nelosuje; jeho dosavadní výsledky zůstávají.</li>
    </ul>`],
  ['Turnaj každý s každým', `
    <ul>
      <li>Nejdřív přidejte všechny hráče. Startovní čísla jsou podle ratingu, nebo je v části Hráči vylosujte
        tlačítkem <b>🎲 Vylosovat startovní čísla</b>.</li>
      <li>V části Kola klepněte na <b>Vytvořit rozpis všech kol</b>. Pak už hráče přidat nejde; rozpis jde zrušit,
        dokud není zadaný žádný výsledek.</li>
      <li>Při lichém počtu hráčů má v každém kole jeden hráč volno.</li>
      <li>Odstoupení podle SŘ čl. 5.2.4: kdo odehrál aspoň polovinu partií, prohraje zbývající kontumačně, jinak se kontumují všechny jeho partie.
        Aplikace to u hráče sama vypíše.</li>
    </ul>`],
  ['Soutěže družstev', `
    <ul>
      <li>Při zakládání vyberte v nabídce systému skupinu <b>Družstva</b>. V Nastavení zvolte počet šachovnic a zápasové body.</li>
      <li>V části <b>Družstva</b> přidejte družstva a klepnutím na název otevřete soupisku. Pořadí na soupisce určuje výchozí
        sestavu od 1. šachovnice; měnit ho jde šipkami ↑ ↓. Celou soupisku jde vložit najednou.</li>
      <li>V části <b>Utkání</b> klepněte na utkání: otevře se sestava po šachovnicích. Hráče na šachovnici jde změnit
        výběrem ze soupisky; neobsazená šachovnice se počítá jako kontumace.</li>
      <li>Výsledky se zadávají z pohledu domácích (družstvo uvedené první). Domácí mají bílé na lichých šachovnicích.</li>
      <li>Družstvo, které vystoupí, označte v jeho detailu tlačítkem <b>Družstvo vystoupilo</b>. Ve švýcaru se dál nelosuje;
        v soutěži každý s každým aplikace zbylá utkání kontumuje nebo všechna jeho utkání anuluje podle SŘ čl. 5.3.6.</li>
      <li>Část <b>Jednotlivci</b> ukazuje body a úspěšnost hráčů ze všech utkání.</li>
    </ul>`],
  ['Pořadí, pomocná hodnocení a tabulka', `
    <ul>
      <li><b>Pořadí</b> se počítá po posledním dohraném kole; jiné kolo vyberete vpravo nahoře (<b>po kole</b>).</li>
      <li>Najetím myší na zkratku hodnocení v záhlaví tabulky se ukáže jeho celý název.</li>
      <li>Pořadí pomocných hodnocení změníte v <b>Nastavení</b>: šipkami ↑ ↓, ✕ hodnocení odebere, další přidáte z nabídky.
        Tlačítko <b>Podle Soutěžního řádu ŠSČR</b> vrátí výchozí pořadí.</li>
      <li><b>Tabulka</b> u švýcaru ukazuje v každém kole startovní číslo soupeře, barvu (b/č) a výsledek;
        u turnaje každý s každým výsledky hráč × hráč.</li>
    </ul>`],
  ['Tisk', `
    <p>Tlačítka 🖨 jsou u losování kola, pořadí, tabulky a u družstev i u seznamu družstev a soupisek. Otevře se tiskové okno
      prohlížeče; místo tiskárny jde zvolit <b>Uložit jako PDF</b> a soubor třeba vyvěsit nebo poslat.</p>`],
  ['Více zařízení (synchronizace)', `
    <ol>
      <li>Na hlavním zařízení otevřete turnaj, část <b>Sdílení</b>, a klepněte na <b>Zapnout synchronizaci</b>.</li>
      <li>Na telefonu rozhodčího načtěte zobrazený QR kód fotoaparátem, nebo mu pošlete odkaz (<b>Kopírovat odkaz</b>).</li>
      <li>Turnaj se na telefon stáhne a od té chvíle se změny přenášejí oběma směry. Stav spojení je vidět v záhlaví.</li>
    </ol>
    <ul>
      <li>Při připojování musí být turnaj na původním zařízení otevřený (stačí na pozadí).</li>
      <li>Kdo má odkaz, může turnaj i upravovat – posílejte ho jen rozhodčím.</li>
      <li>Zadávat výsledky můžete z více zařízení současně. Losovat je lepší jen na jednom.</li>
    </ul>`],
  ['Záloha, TRF a přenos do jiného programu', `
    <ul>
      <li>Turnaje jsou uložené jen v tomto prohlížeči. Když vymažete data prohlížeče nebo změníte zařízení, o turnaj přijdete –
        proto si v části <b>Sdílení</b> stahujte <b>zálohu (.json)</b>.</li>
      <li>Zálohu nebo soubor TRF z jiného programu načtete na úvodní stránce v části <b>Načíst turnaj</b>.</li>
      <li><b>Stáhnout TRF</b> vytvoří zprávu pro FIDE (TRF-16). Hodí se i ke kontrole losování nezávislým programem.</li>
    </ul>`],
  ['Instalace a práce bez internetu', `
    <ul>
      <li>Aplikaci jde přidat na plochu telefonu: v prohlížeči zvolte <b>Přidat na plochu</b> (Android: menu ⋮, iPhone: Sdílet ⎋).</li>
      <li>Po prvním otevření funguje i bez internetu. Bez připojení nefunguje jen synchronizace; změny se odešlou později.</li>
      <li>Nová verze aplikace se stáhne na pozadí a projeví se při dalším otevření.</li>
    </ul>`],
];

/** Stránka Nápověda. `part` je 'navod' nebo 'zmeny'. */
export function aboutView(part, esc) {
  const changes = part === 'zmeny';
  const tabs = `<div class="chips" role="tablist">
    <a class="chip" role="tab" href="#napoveda" aria-pressed="${!changes}" aria-selected="${!changes}">Návod</a>
    <a class="chip" role="tab" href="#napoveda=zmeny" aria-pressed="${changes}" aria-selected="${changes}">Seznam změn</a>
  </div>`;
  const body = changes
    ? `<section class="card">
        <h2>Seznam změn</h2>
        <ol class="changelog">${CHANGELOG.map((c) => `<li>
          <h3>${esc(c.title)} <span class="muted small nowrap">verze ${esc(c.version)} · ${fmtDate(c.date)}</span></h3>
          <ul>${c.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></li>`).join('')}</ol>
      </section>`
    : `<section class="card guide">
        <h2>Návod k použití</h2>
        <p class="muted">Švýcar řídí šachové turnaje jednotlivců i soutěže družstev švýcarským systémem a systémem každý s každým.
          Běží v prohlížeči na počítači, tabletu i telefonu a data zůstávají v zařízení.</p>
        ${GUIDE.map(([h, html], i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(h)}</summary><div class="guide-body">${html}</div></details>`).join('')}
      </section>
      <section class="card">
        <h2>O losování</h2>
        <p class="small">Losování švýcarským systémem se řídí pravidly FIDE C.04.1, C.04.2 a C.04.3 (holandský systém) ve znění
          platném od 1. 2. 2026, pomocná hodnocení pravidly FIDE C.07 ve znění od 1. 3. 2026 a výchozí pořadí hodnocení
          Soutěžním řádem ŠSČR. Program není na seznamu programů schválených FIDE (C.04.2 čl. 1.4); u turnajů
          započítávaných na FIDE doporučujeme losování ověřit nezávislým programem pomocí souboru TRF.</p>
      </section>`;
  return `${tabs}${body}<p class="muted small center">Švýcar, verze ${esc(VERSION)} (${fmtDate(CHANGELOG[0].date)})</p>`;
}
