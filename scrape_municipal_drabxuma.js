/**
 * Dr AB Xuma Local Municipality tender scraper
 * Scrapes Open tenders from drabxumalm.gov.za/tenders/
 * Structure: h3 title, date/time @ Month DD, YYYY
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const TENDERS_URL = 'https://drabxumalm.gov.za/tenders/';

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

function formatDate(text) {
  const m = String(text || '').match(/@\s*(\w+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return '';
  const monthMap = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  const month = monthMap[m[1].slice(0, 3).toLowerCase()] || '01';
  return `${String(m[2]).padStart(2, '0')}/${month}/${m[3]}`;
}

function extractBidNumber(text) {
  const t = String(text || '').toUpperCase();
  const patterns = [
    /\b(?:BID|TENDER|ADVERT)\s*(?:NO|REF|DOCUMENT)?\s*[:#-]?\s*([A-Z0-9./-]{3,})\b/i,
    /\b(?:RFQ|RFP|SCM)\s*[:#-]?\s*([A-Z0-9./-]{3,})\b/i
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) {
      const c = (m[1] || m[0]).trim();
      if (/^(ADVERT|ADVERTS|BID|TENDER|DOCUMENT)$/i.test(c)) continue;
      return c;
    }
  }
  return '';
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || 'drabxuma_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : null;

  console.log('\n🔍 SCRAPING DR AB XUMA LOCAL MUNICIPALITY TENDERS');
  console.log('==================================================');

  const { data: html } = await axios.get(TENDERS_URL, {
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });

  const $ = cheerio.load(html);
  const entries = [];
  const seen = new Set();

  $('h3').each((_, el) => {
    const $h3 = $(el);
    const title = $h3.text().trim().replace(/\s+/g, ' ');
    if (!title || title.length < 10) return;

    const blockText = $h3.parent().text().replace(/\s+/g, ' ');
    const closingDate = formatDate(blockText);
    const tenderNumber = extractBidNumber(title) || extractBidNumber(blockText);
    const key = `${title}|${closingDate}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    entries.push({
      tenderNumber: tenderNumber || `DRABX-${String(entries.length + 1).padStart(3, '0')}`,
      description: title.slice(0, 500),
      advertised: '',
      closingDate
    });
  });

  const sliced = limit ? entries.slice(0, limit) : entries;
  const csvRows = sliced.map((e, i) => ({
    'Category': 'Municipal',
    'Tender Number': e.tenderNumber || `DRABX-${String(i + 1).padStart(3, '0')}`,
    'Tender Description': e.description || 'Dr AB Xuma tender (see source)',
    'Advertised': e.advertised || '',
    'Closing': e.closingDate || '',
    'Organ Of State': 'Dr AB Xuma Local Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'Engcobo, 58 Union Street',
    'Special Conditions': '',
    'Contact Person': '',
    'Email': '',
    'Telephone number': '',
    'FAX Number': '',
    'Is there a briefing session?': '',
    'Is it compulsory?': '',
    'Briefing Date and Time': '',
    'Briefing Venue': '',
    'eSubmission': '',
    'Two Envelope Submission': '',
    'Source URL': TENDERS_URL,
    'Tender ID': '',
    'Source': 'Dr AB Xuma'
  }));

  const csvWriter = createCsvWriter({ path: outPath, header: CSV_HEADER });
  await csvWriter.writeRecords(csvRows);

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
