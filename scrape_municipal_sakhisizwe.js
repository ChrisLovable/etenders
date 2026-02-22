/**
 * Sakhisizwe Local Municipality tender scraper
 * Uses WordPress ajde_events API (event_type 158 = tenders)
 * Source: https://slm.gov.za/supply-chain-management/tenders/
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://slm.gov.za';
const TENDERS_URL = `${BASE_URL}/supply-chain-management/tenders/`;
const API_URL = `${BASE_URL}/wp-json/wp/v2/ajde_events`;
const TENDERS_EVENT_TYPE = 158;
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
  return href ? (href.startsWith('http') ? href : `https://www.slm.gov.za${href.startsWith('/') ? '' : '/'}${href}`) : '';
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchEvents(page = 1) {
  const { data } = await axios.get(API_URL, {
    params: { event_type: TENDERS_EVENT_TYPE, per_page: 100, page, status: 'publish', orderby: 'date', order: 'desc' },
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  return Array.isArray(data) ? data : [];
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || 'sakhisizwe_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : 500;

  console.log('\n🔍 SCRAPING SAKHISIZWE LOCAL MUNICIPALITY TENDERS');
  console.log('==================================================');

  const entries = [];
  let page = 1;

  while (true) {
    try {
      const items = await fetchEvents(page);
      if (!items.length) break;

      for (const item of items) {
        const title = stripHtml(item.title?.rendered || '');
        if (!title || title.length < 5) continue;
        if (/^(ERRATUM|INTERNAL ADVERTISEMENT|EXTERNAL ADVERT)$/i.test(title) && !/tender|rfq|bid/i.test(title)) continue;

        const link = item.link || `https://www.slm.gov.za/Tenders/?p=${item.id}`;
        const pdfUrl = extractPdfUrl(item.content?.rendered || '');
        const sourceUrl = pdfUrl || link;
        const advertised = formatDateIso(item.date || item.date_gmt);
        const tenderNumber = `SLM-${String(item.id)}`;

        entries.push({
          id: item.id,
          title,
          link,
          sourceUrl,
          advertised,
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

  const csvRows = entries.slice(0, limit).map(e => ({
    'Category': 'Municipal',
    'Tender Number': e.tenderNumber || '',
    'Tender Description': (e.title || 'Sakhisizwe tender').slice(0, 500),
    'Advertised': e.advertised || '',
    'Closing': '',
    'Organ Of State': 'Sakhisizwe Local Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'Cala, Elliot, Sakhisizwe',
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
    'Source URL': e.sourceUrl || e.link || TENDERS_URL,
    'Tender ID': String(e.id || ''),
    'Source': 'Sakhisizwe'
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
