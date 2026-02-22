/**
 * Mbhashe Local Municipality tender scraper
 * Uses WordPress REST API - fetches open and closed tenders from procurement categories
 * Source: https://mbhashemun.gov.za/procurement/tenders/
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://mbhashemun.gov.za';
const TENDERS_URL = `${BASE_URL}/procurement/tenders/`;
const API_URL = `${BASE_URL}/wp-json/wp/v2/posts`;
const OPEN_CATEGORY = 159;
const CLOSED_CATEGORY = 156;
const ADVERTS_NOTICES = 155;
const DELAY_MS = 400;

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
  return String($('div').text() || '').replace(/&#8211;/g, '-').replace(/&#038;/g, '&').replace(/\s+/g, ' ').trim();
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

function extractTenderNumber(title) {
  const t = String(title || '').toUpperCase();
  const patterns = [
    /\b(\d{4}\s+(?:WED|THU|MON|TUE|FRI|SAT|SUN)\s+\d{2}\s+\w{3})\b/,
    /\b(?:BID|TENDER)\s*(?:NO\.?|NUMBER)\s*[:\-]?\s*([A-Z0-9\/\-_]+)/i,
    /\b(\d{2}\/\d{4})\b/,
    /\b(MLM[-\/][A-Z0-9\/\-_]+)\b/i,
    /\b(0006\s*\([^)]+\))/i
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m && (m[1] || m[0])) return String(m[1] || m[0]).trim();
  }
  return '';
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchPosts(categoryId, page = 1) {
  const { data } = await axios.get(API_URL, {
    params: { categories: categoryId, per_page: 100, page, status: 'publish', orderby: 'date', order: 'desc' },
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  return Array.isArray(data) ? data : [];
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || 'mbhashe_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : 500;

  console.log('\n🔍 SCRAPING MBHASHE LOCAL MUNICIPALITY TENDERS');
  console.log('==============================================');

  const seen = new Map();
  const categories = [OPEN_CATEGORY, ADVERTS_NOTICES, CLOSED_CATEGORY];

  for (const catId of categories) {
    let page = 1;
    while (true) {
      try {
        const items = await fetchPosts(catId, page);
        if (!items.length) break;

        for (const item of items) {
          if (seen.has(item.id)) continue;

          const title = stripHtml(item.title?.rendered || '');
          const content = stripHtml(item.content?.rendered || '');
          const combined = `${title} ${content}`;

          if (!title || title.length < 5) continue;
          if (/(awarded|tender results|register for quarter)/i.test(title) && !/invitation|advert|panel|supply|construction|provision|servicing|recording/i.test(title)) continue;

          const link = item.link || `https://www.mbhashemun.gov.za/?p=${item.id}`;
          const closingDate = parseClosingDate(content) || parseClosingDate(title);
          const advertised = formatDateIso(item.date || item.date_gmt);
          const tenderNumber = extractTenderNumber(title) || extractTenderNumber(combined) || `MBH-${String(item.id)}`;

          seen.set(item.id, {
            id: item.id,
            title,
            link,
            advertised,
            closingDate,
            tenderNumber,
            isOpen: catId === OPEN_CATEGORY
          });
        }

        if (items.length < 100) break;
        page++;
        await sleep(DELAY_MS);
      } catch (err) {
        console.warn(`Fetch failed for category ${catId} page ${page}:`, err.message);
        break;
      }
    }
  }

  const entries = [...seen.values()]
    .sort((a, b) => (b.advertised || '').localeCompare(a.advertised || ''))
    .slice(0, limit);

  const csvRows = entries.map(e => ({
    'Category': 'Municipal',
    'Tender Number': e.tenderNumber || '',
    'Tender Description': (e.title || 'Mbhashe tender').slice(0, 500),
    'Advertised': e.advertised || '',
    'Closing': e.closingDate || '',
    'Organ Of State': 'Mbhashe Local Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'Dutywa, Willowvale, Elliotdale',
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
    'Source URL': e.link || TENDERS_URL,
    'Tender ID': String(e.id || ''),
    'Source': 'Mbhashe'
  }));

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
