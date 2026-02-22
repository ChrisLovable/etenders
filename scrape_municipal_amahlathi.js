/**
 * Amahlathi Local Municipality tender scraper
 * Fetches Open tenders from WordPress Events API (category 165)
 * Source URL: https://amahlathi.gov.za/tenders-rfqs/
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://amahlathi.gov.za';
const TENDERS_URL = 'https://amahlathi.gov.za/tenders-rfqs/';
const EVENTS_API = `${BASE_URL}/wp-json/wp/v2/event`;
const OPEN_CATEGORY_ID = 165;
const DELAY_MS = 500;

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

function stripHtml(html) {
  if (!html) return '';
  const $ = cheerio.load(`<div>${html}</div>`);
  return String($('div').text() || '').replace(/\s+/g, ' ').trim();
}

function formatDateIso(iso) {
  const d = new Date(String(iso || ''));
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function parseClosingDate(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const m = t.match(/closing\s*date\s*[:\-]?\s*(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})/i);
  if (m) {
    const mm = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    const month = mm[m[2].slice(0, 3).toLowerCase()] || '01';
    return `${String(m[1]).padStart(2, '0')}/${month}/${m[3]}`;
  }
  const d = t.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  return d ? d[0] : '';
}

function extractBidNumber(text) {
  const t = String(text || '').toUpperCase();
  const patterns = [
    /ALM[-/]SCM\/\d+(?:-\d+)?\/\d{4}-\d{2}/,
    /ALM\/SCM\/\d+(?:-\d+)?\/\d{4}-\d{2}/,
    /ALM\/\d+\/\d{4}-\d{2}/,
    /\b(?:BID|RFQ|SCM)\s*(?:NO|REF)?\s*[:#-]?\s*([A-Z0-9./-]{3,})\b/i
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) {
      const candidate = (m[1] || m[0]).trim();
      if (/^(ADVERT|ADVERTS|BID|RFQ)$/.test(candidate)) continue;
      return candidate;
    }
  }
  return '';
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchOpenTenders() {
  const rows = [];
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

  for (let page = 1; page <= 5; page++) {
    try {
      const { data } = await axios.get(EVENTS_API, {
        params: { per_page: 50, page, status: 'publish', orderby: 'date', order: 'desc' },
        timeout: 20000,
        headers
      });
      const items = Array.isArray(data) ? data : [];
      if (!items.length) break;

      for (const e of items) {
        const categories = Array.isArray(e.event_category) ? e.event_category : [];
        const classList = Array.isArray(e.class_list) ? e.class_list : [];
        const isOpen = categories.includes(OPEN_CATEGORY_ID) || classList.includes('event_category-open');
        if (!isOpen) continue;

        const title = stripHtml(e.title?.rendered || '');
        const content = stripHtml(e.content?.rendered || '');
        const combined = `${title} ${content}`;
        if (/(awarded|closed|closing bid results)/i.test(combined)) continue;

        const closingDate = parseClosingDate(content) || parseClosingDate(title);
        const advertised = formatDateIso(e.date || e.date_gmt);
        const tenderNumber = extractBidNumber(combined);
        const description = (title || content.slice(0, 300) || 'Amahlathi tender').slice(0, 500);

        rows.push({
          tenderNumber: tenderNumber || `AMAH-${String(rows.length + 1).padStart(3, '0')}`,
          description,
          advertised,
          closingDate
        });
      }
      if (items.length < 50) break;
      await sleep(DELAY_MS);
    } catch (err) {
      console.warn('API fetch failed:', err.message);
      break;
    }
  }

  return rows;
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || 'amahlathi_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : null;

  console.log('\n🔍 SCRAPING AMAHLATHI LOCAL MUNICIPALITY TENDERS');
  console.log('=================================================');

  const entries = await fetchOpenTenders();

  const seen = new Set();
  const unique = [];
  for (const e of entries) {
    const key = `${e.tenderNumber}|${e.description}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(e);
  }

  const sliced = limit ? unique.slice(0, limit) : unique;
  const csvRows = sliced.map(e => ({
    'Category': 'Municipal',
    'Tender Number': e.tenderNumber || '',
    'Tender Description': e.description || 'Amahlathi tender (see source)',
    'Advertised': e.advertised || '',
    'Closing': e.closingDate || '',
    'Organ Of State': 'Amahlathi Local Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'Stutterheim and surrounding areas',
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
    'Source': 'Amahlathi'
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
