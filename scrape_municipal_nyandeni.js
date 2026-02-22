/**
 * Nyandeni Local Municipality tender scraper
 * Uses internal API: /user-get-tenders-available-list
 * Source: https://nyandenilm.gov.za/tenders-index
 */
const axios = require('axios');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://nyandenilm.gov.za';
const TENDERS_URL = `${BASE_URL}/tenders-index`;
const API_URL = `${BASE_URL}/user-get-tenders-available-list`;
const DELAY_MS = 300;

const CSV_HEADER = [
  { id: 'Category', title: 'Category' },
  { id: 'Tender Number', title: 'Tender Number' },
  { id: 'Tender Description', title: 'Tender Description' },
  { id: 'Advertised', title: 'Advertised' },
  { id: 'Closing', title: 'Closing' },
  { id: 'Organ Of State', title: 'Organ Of State' },
  { id: 'Tender Type', title: 'Tender Type' },
  { id: 'Province', title: 'Province' },
  { id: 'Place where goods, works or services are required', title: 'Place where goods, works or services are required' },
  { id: 'Special Conditions', title: 'Special Conditions' },
  { id: 'Contact Person', title: 'Contact Person' },
  { id: 'Email', title: 'Email' },
  { id: 'Telephone number', title: 'Telephone number' },
  { id: 'FAX Number', title: 'FAX Number' },
  { id: 'Is there a briefing session?', title: 'Is there a briefing session?' },
  { id: 'Is it compulsory?', title: 'Is it compulsory?' },
  { id: 'Briefing Date and Time', title: 'Briefing Date and Time' },
  { id: 'Briefing Venue', title: 'Briefing Venue' },
  { id: 'eSubmission', title: 'eSubmission' },
  { id: 'Two Envelope Submission', title: 'Two Envelope Submission' },
  { id: 'Source URL', title: 'Source URL' },
  { id: 'Tender ID', title: 'Tender ID' },
  { id: 'Source', title: 'Source' }
];

function formatDateYMD(d) {
  if (!d) return '';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchTenders(year, month) {
  const params = {};
  if (year) params.year = year;
  if (month) params.month = month;
  const { data } = await axios.get(API_URL, {
    params,
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  return data?.data || [];
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || 'nyandeni_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : 500;

  console.log('\n🔍 SCRAPING NYANDENI LOCAL MUNICIPALITY TENDERS');
  console.log('================================================');

  const seen = new Map();
  const currentYear = new Date().getFullYear();

  try {
    const allItems = await fetchTenders();
    for (const item of allItems) seen.set(item.id, item);
  } catch (_) {}

  for (let year = currentYear; year >= currentYear - 3; year--) {
    for (let month = 1; month <= 12; month++) {
      try {
        const items = await fetchTenders(year, month);
        for (const item of items) seen.set(item.id, item);
        if (items.length > 0) await sleep(DELAY_MS);
      } catch (err) {
        console.warn(`Fetch failed ${year}-${month}:`, err.message);
      }
    }
  }

  const entries = [...seen.values()]
    .sort((a, b) => (b.closing_date || '').localeCompare(a.closing_date || ''))
    .slice(0, limit);

  const csvRows = entries.map(e => {
    const ref = (e.reference_number || '').replace(/&amp;/g, '&').trim();
    const title = (e.title || 'Nyandeni tender').replace(/&amp;/g, '&').trim();
    const detailUrl = `${BASE_URL}/tender-available-view/${e.id}`;
    return {
      'Category': 'Municipal',
      'Tender Number': ref,
      'Tender Description': title.slice(0, 500),
      'Advertised': formatDateYMD(e.date_opened) || formatDateYMD(e.start_date),
      'Closing': formatDateYMD(e.closing_date) || formatDateYMD(e.end_date),
      'Organ Of State': 'Nyandeni Local Municipality',
      'Tender Type': 'Request for Bid',
      'Province': 'Eastern Cape',
      'Place where goods, works or services are required': 'Libode, Nyandeni',
      'Special Conditions': '',
      'Contact Person': '',
      'Email': '',
      'Telephone number': '047 555 5000',
      'FAX Number': '',
      'Is there a briefing session?': '',
      'Is it compulsory?': '',
      'Briefing Date and Time': '',
      'Briefing Venue': '',
      'eSubmission': '',
      'Two Envelope Submission': '',
      'Source URL': e.advert_url || e.application_form_url || detailUrl,
      'Tender ID': e.id || '',
      'Source': 'Nyandeni'
    };
  });

  const csvWriter = createCsvWriter({ path: outPath, header: CSV_HEADER });
  await csvWriter.writeRecords(csvRows);

  console.log(`\n💾 Wrote ${csvRows.length} rows to ${csvFilename}`);
  return { rows: csvRows.length, data: csvRows, message: `Wrote ${csvRows.length} rows to ${csvFilename}` };
}

if (require.main === module) {
  runScraper()
    .then(r => console.log(r.message))
    .catch(err => {
      console.error(err.message);
      process.exit(1);
    });
}

module.exports = { runScraper };
