/**
 * Sundays River Valley Local Municipality tender scraper
 * Uses WordPress ajde_events API (event_type_2: 104=open-tenders, 114=bid-register)
 * Source: https://srvm.gov.za/tenders/
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://srvm.gov.za';
const TENDERS_URL = `${BASE_URL}/tenders/`;
const API_URL = `https://www.srvm.gov.za/wp-json/wp/v2/ajde_events`;
const OPEN_TENDERS_TYPE = 104;
const BID_REGISTER_TYPE = 114;
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

function extractPdfUrl(content) {
  if (!content) return '';
  const $ = cheerio.load(content);
  const href = $('a[href*=".pdf"]').first().attr('href') || $('a[href*="uploads"]').first().attr('href');
  return href ? (href.startsWith('http') ? href : `https://www.srvm.gov.za${href.startsWith('/') ? '' : '/'}${href}`) : '';
}

function extractPdfFromClassList(classList) {
  const arr = Array.isArray(classList) ? classList : [];
  const tagClass = arr.find(c => /^tag-https.*srvm.*uploads/i.test(String(c)));
  if (!tagClass) return '';
  let slug = String(tagClass).replace(/^tag-/, '');
  const m = slug.match(/^https-www-srvm-gov-za-wp-content-uploads-(\d{4})-(\d{2})-(.+)-pdf$/);
  if (!m) return '';
  return `https://www.srvm.gov.za/wp-content/uploads/${m[1]}/${m[2]}/${m[3]}.pdf`;
}

function extractTenderNumber(content, title) {
  const text = `${content || ''} ${title || ''}`;
  const m = text.match(/(?:BID\s+(?:NUMBER|NO\.?):?\s*)?(SRVM[- ]?(?:RFQ\s*)?\d+\s*\/?\s*\d{4})/i) ||
    text.match(/\b(SRVM\s*\d{2,3}\s*\/\s*\d{4})\b/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

function parseClosingDate(content) {
  const text = String(content || '');
  const m = text.match(/(?:not\s+later\s+than|by|before)\s+(\d{1,2})\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i) ||
    text.match(/(\d{1,2})\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
  if (!m) return '';
  const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  const mm = months[m[2].slice(0, 3).toLowerCase()] || '01';
  return `${String(m[1]).padStart(2, '0')}/${mm}/${m[2]}`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchEvents(page = 1) {
  const { data } = await axios.get(API_URL, {
    params: { per_page: 100, page, status: 'publish', orderby: 'date', order: 'desc' },
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  return Array.isArray(data) ? data : [];
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || 'sundaysrivervalley_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : 500;

  console.log('\n🔍 SCRAPING SUNDAYS RIVER VALLEY LOCAL MUNICIPALITY TENDERS');
  console.log('================================================================');

  const entries = [];
  let page = 1;

  while (true) {
    try {
      const items = await fetchEvents(page);
      if (!items.length) break;

      for (const item of items) {
        const eventTypes = Array.isArray(item.event_type_2) ? item.event_type_2 : [];
        const isTender = eventTypes.includes(OPEN_TENDERS_TYPE) || eventTypes.includes(BID_REGISTER_TYPE);
        if (!isTender) continue;

        const title = stripHtml(item.title?.rendered || '');
        if (!title || title.length < 5) continue;
        if (/bids awarded for.*month/i.test(title) && !/individual|tender|bid/i.test(title)) continue;

        const content = item.content?.rendered || '';
        const link = item.link || `https://www.srvm.gov.za/events/?p=${item.id}`;
        const pdfUrl = extractPdfUrl(content) || extractPdfFromClassList(item.class_list || []);
        const sourceUrl = pdfUrl || link;
        const advertised = formatDateIso(item.date || item.date_gmt);
        const tenderNumber = extractTenderNumber(content, title) || `SRVM-${String(item.id)}`;
        const closing = parseClosingDate(content);

        entries.push({
          id: item.id,
          title,
          link,
          sourceUrl,
          advertised,
          closing,
          tenderNumber
        });

        if (entries.length >= limit) break;
      }

      if (entries.length >= limit || items.length < 100) break;
      page++;
      await sleep(DELAY_MS);
    } catch (err) {
      console.warn(`Fetch failed page ${page}:`, err.message);
      break;
    }
  }

  const seen = new Set();
  const unique = [];
  for (const e of entries) {
    const key = `${e.tenderNumber}|${e.title}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(e);
  }

  const csvRows = unique.slice(0, limit).map(e => ({
    'Category': 'Municipal',
    'Tender Number': e.tenderNumber || '',
    'Tender Description': (e.title || 'Sundays River Valley tender').slice(0, 500),
    'Advertised': e.advertised || '',
    'Closing': e.closing || '',
    'Organ Of State': 'Sundays River Valley Local Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'Kirkwood, Paterson, Addo, Sundays River Valley',
    'Special Conditions': '',
    'Contact Person': '',
    'Email': '',
    'Telephone number': '042 230 7700',
    'FAX Number': '',
    'Is there a briefing session?': '',
    'Is it compulsory?': '',
    'Briefing Date and Time': '',
    'Briefing Venue': '',
    'eSubmission': '',
    'Two Envelope Submission': '',
    'Source URL': e.sourceUrl || e.link || TENDERS_URL,
    'Tender ID': String(e.id || ''),
    'Source': 'Sundays River Valley'
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
