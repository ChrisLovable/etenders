/**
 * Generates govdata.csv from etenders scrape results
 * Contains # (Tender Number) and description (Tender Description)
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const ROOT = path.join(__dirname, '..');
const ADV_CSV = path.join(ROOT, 'advertised_tenders.csv');
const MUNI_CSV = path.join(ROOT, 'municipal_tenders.csv');
const OUT_CSV = path.join(ROOT, 'govdata.csv');

function loadCsv(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  return parse(raw, { columns: true, skip_empty_lines: true });
}

function run() {
  const rows = [];
  const seen = new Set();

  for (const file of [ADV_CSV, MUNI_CSV]) {
    const data = loadCsv(file);
    for (const r of data) {
      const num = (r['Tender Number'] || '').trim();
      const desc = (r['Tender Description'] || '').trim();
      if (!num && !desc) continue;
      const key = `${num}|${desc}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ '#': num, description: desc });
    }
  }

  const csv = stringify(rows, { header: true });
  fs.writeFileSync(OUT_CSV, csv);
  console.log(`Wrote ${rows.length} rows to govdata.csv`);
}

run();
