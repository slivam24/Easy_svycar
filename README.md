# Švýcar – šachové turnaje jednotlivců

Webová aplikace pro řízení šachových turnajů jednotlivců švýcarským systémem i systémem každý
s každým. Běží v prohlížeči
na počítači, tabletu i telefonu, funguje i bez internetu a nepotřebuje server: data zůstávají
v zařízení.

## Co umí

- **Losování** podle FIDE C.04.3 (holandský systém) ve znění platném od 1. 2. 2026, spolu
  s C.04.1 a C.04.2:
  - kritéria [C1]–[C21], včetně nového [C5] (volno z losování dostane hráč s co nejnižším skóre)
    a [C9] (u volna co nejméně neodehraných partií),
  - přidělení barev podle čl. 5, pořadí šachovnic podle C.04.2 čl. 3.6,
  - volna na žádost (½ i 0 bodu), omluvené absence, pozdě přihlášení, odstoupení a kontumace,
  - startovní čísla podle ratingu, titulu a abecedy (C.04.2 čl. 2), po 4. kole se už nemění.
- **Každý s každým** (jedno- i dvoukolově) podle Bergerových tabulek FIDE (C.05, příloha 1):
  - startovní čísla losem nebo podle ratingu, při lichém počtu hráčů má nejvyšší číslo volno,
  - u dvoukolového turnaje jsou podle doporučení FIDE prohozená poslední dvě kola prvního cyklu
    (nikdo nemá třikrát po sobě stejnou barvu) a druhý cyklus má obrácené barvy,
  - odstoupení podle Soutěžního řádu ŠSČR čl. 5.2.4: po odehrání aspoň poloviny partií se
    kontumují zbývající partie, jinak všechny,
  - křížová tabulka hráč × hráč.
- **Pomocná hodnocení** podle FIDE C.07 ve znění od 1. 3. 2026, včetně čl. 16 (neodehraná kola)
  a výjimky pro Cut-1. Výchozí pořadí odpovídá Soutěžnímu řádu ŠSČR:
  - švýcarský systém (čl. 5.2.3): vzájemné partie, Buchholz bez nejhoršího, Buchholz,
    Sonneborn-Berger, více partií černými, los,
  - každý s každým (čl. 5.2.2): Sonneborn-Berger, vzájemné partie, výsledek proti vítězi, dále
    proti druhému, třetímu atd., los. Kontumace se tu počítají jako partie (C.07 čl. 15.2)
    a Buchholz se nenabízí (C.07 čl. 8), naopak je k dispozici Koya.

  Pořadí jde změnit
  a přidat další hodnocení (Buchholz Cut-2 a medián, SB Cut-1, průměrný Buchholz soupeřů, počet
  výher, progresivní skóre, průměrný rating soupeřů, turnajový výkon a další).
- **Výsledky z mobilu**: velká tlačítka 1–0, ½, 0–1 a kontumace.
- **Pořadí** po libovolném kole, křížová **tabulka**, **tisk** losování, pořadí a tabulky.
- **Export TRF** (zpráva pro FIDE, kontrola losování jiným programem), **záloha** a **načtení**
  turnaje ze zálohy nebo z TRF.

## Jak losování funguje

Pravidla holandského systému určují posloupnost kandidátů (výběr hráčů z vyšší skupiny,
transpozice, výměny mezi S1 a S2) a pořadí kritérií. Vybere se první kandidát v posloupnosti,
který kritéria splní nejlépe. Program kandidáty nezkouší jednoho po druhém:

1. Pro každou bodovou skupinu nejdřív určí možné množiny hráčů, kteří propadnou do nižší skupiny,
   podle kritérií, která závisí jen na nich ([C4]–[C9]).
2. Vážené párování (Edmondsův algoritmus s květy, `js/matching.js`) najde nejlepší dosažitelné
   hodnoty kritérií [C10]–[C21].
3. Další vážená párování vyberou z kandidátů s touto hodnotou ten, který je v posloupnosti
   pravidel první.

Výsledek je stejný, jako kdyby se kandidáti zkoušeli postupně, ale i turnaj se stovkami hráčů
se vylosuje za zlomek sekundy. Postup losování po skupinách jde zobrazit u každého kola.

## Ověření

- Všech 9 kol vzorového turnaje z příručky FIDE „Mastering the Dutch“ (M. Held, verze 2026)
  vychází stejně, včetně kol, kde stará pravidla dávají jiný výsledek.
- Rozpis každý s každým odpovídá všem Bergerovým tabulkám FIDE pro 3–16 hráčů.
- Testovací případy programu bbpPairings (`tests/fixtures/bbp`, licence Apache 2.0) včetně
  15. kola turnaje se 60 hráči a kontumacemi.
- Párovací algoritmy jsou porovnané s hrubou silou na stovkách náhodných grafů, export a import
  TRF se zkoušejí tam a zpět.

Program není na seznamu programů schválených FIDE (C.04.2 čl. 1.4). U turnajů započítávaných
na FIDE doporučujeme ověřit losování nezávislým programem; soubor TRF k tomu stačí.

## Spuštění a vývoj

Aplikace je čistý HTML/CSS/JavaScript bez sestavování.

```sh
npm run serve   # http://localhost:8080
npm test        # testy (Node.js 20+), bez dalších závislostí
```

Nasazení: GitHub Pages z větve `main`, kořenová složka.

| Soubor | Obsah |
| --- | --- |
| `js/dutch.js` | losování (holandský systém FIDE 2026) |
| `js/roundrobin.js` | rozpis každý s každým (Bergerovy tabulky FIDE) |
| `js/matching.js` | párování v obecném grafu: největší počet dvojic a největší váha (BigInt) |
| `js/tiebreaks.js` | pomocná hodnocení FIDE C.07 |
| `js/model.js` | datový model turnaje, body, startovní čísla, převod na vstup losování |
| `js/trf.js` | formát TRF-16 |
| `js/store.js` | uložení turnajů v zařízení |
| `js/app.js` | uživatelské rozhraní |

## Omezení

- Data jsou jen v jednom zařízení; mezi zařízeními se přenášejí zálohou.
- Zatím bez zrychleného losování (Baku), soutěží družstev, Varmových tabulek a ruční úpravy
  vylosovaných dvojic.
- Hodnocení podle ratingu počítají jen se soupeři, kteří rating mají.
