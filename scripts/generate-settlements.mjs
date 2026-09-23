/**
 * Generates `src/data/settlements.json` — the settlement directory behind the
 * «Населённый пункт» field of the sign-up form (Issue #83).
 *
 * Source: ОКТМО (Общероссийский классификатор территорий муниципальных
 * образований), Rosstat open-data set 7708234640-oktmo,
 * https://rosstat.gov.ru/opendata/7708234640-oktmo — the snapshot pinned in
 * SOURCE_URL below («с учетом изменений 938/2026», published 2026-09-01).
 * Licence: an official classifier of a federal body; official documents are not
 * objects of copyright (ГК РФ ст. 1259 п. 6), and Rosstat publishes the set as
 * open data for free reuse. Nothing here is fetched at runtime: the JSON is
 * bundled and served from the site's own origin.
 *
 * Cut-off: urban settlements only — section 2 rows whose type is г (город),
 * пгт, рп (рабочий посёлок), кп (курортный посёлок), дп (дачный посёлок),
 * гп (городской посёлок) — about 2.6k places, plus the federal cities and the
 * towns inside them, which ОКТМО files as municipalities, not as section-2
 * settlements. The full section 2 is ~158k rows (villages, хутора, станицы …):
 * several MB even compacted, which a sign-up page cannot ship; a lookup of that
 * size belongs server-side (a platform endpoint or a paid address API). A place
 * missing from the directory is not a dead end: the form keeps free text and
 * asks for the region separately.
 *
 * Region names: the nominative official names of the federal subjects, with
 * redundant parentheticals dropped («Республика Татарстан», not «… (Татарстан)»)
 * and the federal cities as «г. Москва». The autonomous okrugs that ОКТМО nests
 * inside Архангельская and Тюменская области are split out by their code range.
 *
 * Usage: `node scripts/generate-settlements.mjs [path-or-url-of-oktmo.csv]`.
 * rosstat.gov.ru serves its certificate without the intermediate, which Node's
 * fetch refuses (UNABLE_TO_VERIFY_LEAF_SIGNATURE) while curl and browsers
 * complete the chain themselves — so download first and pass the path:
 *   curl -o oktmo.csv <SOURCE_URL> && node scripts/generate-settlements.mjs oktmo.csv
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL =
  'https://rosstat.gov.ru/opendata/7708234640-oktmo/data-20260901T1609-structure-20260210T1102.csv';
const OUT = fileURLToPath(new URL('../src/data/settlements.json', import.meta.url));

const URBAN_TYPES = ['г', 'пгт', 'рп', 'кп', 'дп', 'гп'];

/** ОКТМО region code (TER) → official nominative name. */
const REGIONS = {
  '01': 'Алтайский край',
  '03': 'Краснодарский край',
  '04': 'Красноярский край',
  '05': 'Приморский край',
  '07': 'Ставропольский край',
  '08': 'Хабаровский край',
  '10': 'Амурская область',
  '11': 'Архангельская область',
  '12': 'Астраханская область',
  '14': 'Белгородская область',
  '15': 'Брянская область',
  '17': 'Владимирская область',
  '18': 'Волгоградская область',
  '19': 'Вологодская область',
  '20': 'Воронежская область',
  '21': 'Донецкая Народная Республика',
  '22': 'Нижегородская область',
  '23': 'Запорожская область',
  '24': 'Ивановская область',
  '25': 'Иркутская область',
  '26': 'Республика Ингушетия',
  '27': 'Калининградская область',
  '28': 'Тверская область',
  '29': 'Калужская область',
  '30': 'Камчатский край',
  '32': 'Кемеровская область — Кузбасс',
  '33': 'Кировская область',
  '34': 'Костромская область',
  '35': 'Республика Крым',
  '36': 'Самарская область',
  '37': 'Курганская область',
  '38': 'Курская область',
  '40': 'г. Санкт-Петербург',
  '41': 'Ленинградская область',
  '42': 'Липецкая область',
  '43': 'Луганская Народная Республика',
  '44': 'Магаданская область',
  '45': 'г. Москва',
  '46': 'Московская область',
  '47': 'Мурманская область',
  '49': 'Новгородская область',
  '50': 'Новосибирская область',
  '52': 'Омская область',
  '53': 'Оренбургская область',
  '54': 'Орловская область',
  '56': 'Пензенская область',
  '57': 'Пермский край',
  '58': 'Псковская область',
  '60': 'Ростовская область',
  '61': 'Рязанская область',
  '63': 'Саратовская область',
  '64': 'Сахалинская область',
  '65': 'Свердловская область',
  '66': 'Смоленская область',
  '67': 'г. Севастополь',
  '68': 'Тамбовская область',
  '69': 'Томская область',
  '70': 'Тульская область',
  '71': 'Тюменская область',
  '73': 'Ульяновская область',
  '74': 'Херсонская область',
  '75': 'Челябинская область',
  '76': 'Забайкальский край',
  '77': 'Чукотский автономный округ',
  '78': 'Ярославская область',
  '79': 'Республика Адыгея',
  '80': 'Республика Башкортостан',
  '81': 'Республика Бурятия',
  '82': 'Республика Дагестан',
  '83': 'Кабардино-Балкарская Республика',
  '84': 'Республика Алтай',
  '85': 'Республика Калмыкия',
  '86': 'Республика Карелия',
  '87': 'Республика Коми',
  '88': 'Республика Марий Эл',
  '89': 'Республика Мордовия',
  '90': 'Республика Северная Осетия — Алания',
  '91': 'Карачаево-Черкесская Республика',
  '92': 'Республика Татарстан',
  '93': 'Республика Тыва',
  '94': 'Удмуртская Республика',
  '95': 'Республика Хакасия',
  '96': 'Чеченская Республика',
  '97': 'Чувашская Республика',
  '98': 'Республика Саха (Якутия)',
  '99': 'Еврейская автономная область',
};

/** Region of a section-2 row, splitting out the okrugs nested by code range. */
function regionOf(ter, kod1) {
  if (ter === '11' && kod1.startsWith('8')) return 'Ненецкий автономный округ';
  if (ter === '71' && kod1.startsWith('8')) return 'Ханты-Мансийский автономный округ — Югра';
  if (ter === '71' && kod1.startsWith('9')) return 'Ямало-Ненецкий автономный округ';
  const name = REGIONS[ter];
  if (!name) throw new Error(`settlements: unmapped ОКТМО region code ${ter}`);
  return name;
}

/**
 * The federal cities and the towns inside them: ОКТМО files these as
 * municipalities (section 1), so section 2 never lists them as г.
 */
const FEDERAL_CITY_TOWNS = [
  ['Москва', 'г. Москва'],
  ['Зеленоград', 'г. Москва'],
  ['Московский', 'г. Москва'],
  ['Троицк', 'г. Москва'],
  ['Щербинка', 'г. Москва'],
  ['Санкт-Петербург', 'г. Санкт-Петербург'],
  ['Зеленогорск', 'г. Санкт-Петербург'],
  ['Колпино', 'г. Санкт-Петербург'],
  ['Красное Село', 'г. Санкт-Петербург'],
  ['Кронштадт', 'г. Санкт-Петербург'],
  ['Ломоносов', 'г. Санкт-Петербург'],
  ['Павловск', 'г. Санкт-Петербург'],
  ['Петергоф', 'г. Санкт-Петербург'],
  ['Пушкин', 'г. Санкт-Петербург'],
  ['Сестрорецк', 'г. Санкт-Петербург'],
  ['Севастополь', 'г. Севастополь'],
];

/** Semicolon CSV with double-quoted fields (`""` escapes, embedded newlines). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ';') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) rows.push([...row, field]);
  return rows;
}

async function load(source) {
  if (/^https?:/.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`settlements: HTTP ${res.status} for ${source}`);
    return res.text();
  }
  return readFile(source, 'utf8');
}

const source = process.argv[2] ?? SOURCE_URL;
const rows = parseCsv((await load(source)).replace(/^﻿/, ''));

// One entry per (name, region): two same-named пгт in one region would give the
// participant two identical options and the platform identical answers.
const places = new Map();
const add = (name, region, type) => {
  const key = `${name}\u0000${region}`;
  const rank = type === 'г' ? 0 : 1;
  const prev = places.get(key);
  if (!prev || rank < prev.rank) places.set(key, { name, region, rank });
};

for (const [ter, kod1, , kod3, , razdel, name1] of rows) {
  if (razdel !== '2' || kod3 === '000' || !name1) continue;
  // «рп (пгт) Архара»: a work settlement also listed by its older type.
  const m = /^(\S+)\s+(?:\(\S+\)\s+)?(.+)$/.exec(name1.trim());
  if (!m || !URBAN_TYPES.includes(m[1])) continue;
  add(m[2].replace(/\s+/g, ' '), regionOf(ter, kod1), m[1]);
}
for (const [name, region] of FEDERAL_CITY_TOWNS) add(name, region, 'г');

const sorted = [...places.values()].sort(
  (a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'ru') || a.region.localeCompare(b.region, 'ru'),
);
const regions = [...new Set(sorted.map((p) => p.region))].sort((a, b) => a.localeCompare(b, 'ru'));
const regionIndex = new Map(regions.map((r, i) => [r, i]));

// Compact on purpose: the file is shipped to every browser that focuses the
// field. `places` rows are [name, index into `regions`], cities (г) first.
const json = JSON.stringify({ regions, places: sorted.map((p) => [p.name, regionIndex.get(p.region)]) });
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${json}\n`);
console.log(`settlements: ${sorted.length} places in ${regions.length} regions, ${Buffer.byteLength(json)} bytes`);
