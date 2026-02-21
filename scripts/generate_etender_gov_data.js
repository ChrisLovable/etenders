/**
 * Generates etender_gov_data.csv from advertised_tenders.csv
 * Contains ONLY eTenders.gov.za data: Tender Number and Tender Description
 * Excludes municipal scraped data (advertised_tenders.csv has no municipal data - it's eTenders API only)
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const ADV_CSV = path.join(__dirname, '..', 'advertised_tenders.csv');
const OUT_CSV = path.join(__dirname, '..', 'etender_gov_data.csv');

function run() {
  if (!fs.existsSync(ADV_CSV)) {
    console.warn('advertised_tenders.csv not found, skipping etender_gov_data.csv');
    return;
  }
  const raw = fs.readFileSync(ADV_CSV, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true });
  const out = rows.map(r => ({
    'Tender Number': r['Tender Number'] || '',
    'Tender Description': r['Tender Description'] || ''
  }));
  const csv = stringify(out, { header: true });
  fs.writeFileSync(OUT_CSV, csv);
  console.log(`Wrote ${out.length} rows to etender_gov_data.csv`);
}

run();
