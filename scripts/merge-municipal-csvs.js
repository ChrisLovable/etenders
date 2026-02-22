#!/usr/bin/env node
/**
 * Merges all municipal CSVs into a single all_municipal_tenders.csv.
 * Uses municipal_scrapers.js as source of truth - auto-includes new municipalities.
 *
 * When adding a new municipality:
 * 1. Add to municipal_scrapers.js, server.js, web/main.js
 * 2. Create scrape_municipal_X.js and run it to generate X_tenders.csv
 * 3. Run: npm run generate-config (updates netlify.toml + runs this merge)
 *
 * Run: node scripts/merge-municipal-csvs.js  OR  npm run merge-municipal
 * Output: all_municipal_tenders.csv (project root) and web/data/all_municipal_tenders.csv
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const projectRoot = path.join(__dirname, '..');
const { listScrapers } = require(path.join(projectRoot, 'municipal_scrapers.js'));

const scrapers = listScrapers();
const csvFilenames = scrapers.map(s => s.csvFilename).filter(Boolean);

let allRows = [];
let headers = null;

for (const csv of csvFilenames) {
  const filePath = path.join(projectRoot, csv);
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠ Skipping (not found): ${csv}`);
    continue;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const rows = parse(raw, { columns: true, skip_empty_lines: true, relax_column_count: true });
    if (!rows.length) continue;
    if (!headers) headers = Object.keys(rows[0]);
    for (const r of rows) {
      const normalized = {};
      for (const h of headers) {
        normalized[h] = r[h] ?? '';
      }
      allRows.push(normalized);
    }
    console.log(`  ✓ ${csv}: ${rows.length} rows`);
  } catch (err) {
    console.warn(`  ⚠ Skipping ${csv}: ${err.message}`);
  }
}

if (allRows.length === 0) {
  console.log('No municipal data to merge.');
  process.exit(0);
}

const csv = stringify(allRows, { header: true, columns: headers });
const outPath = path.join(projectRoot, 'all_municipal_tenders.csv');
fs.writeFileSync(outPath, csv, 'utf8');
console.log(`\n✅ Wrote ${allRows.length} rows to ${path.basename(outPath)}`);

// Also write to web/data for local dev
const webDataPath = path.join(projectRoot, 'web', 'data', 'all_municipal_tenders.csv');
fs.mkdirSync(path.dirname(webDataPath), { recursive: true });
fs.writeFileSync(webDataPath, csv, 'utf8');
console.log(`   Wrote to web/data/${path.basename(webDataPath)}`);
