/**
 * Inxuba Yethemba Local Municipality tender scraper
 * Listing: iym.gov.za/index.php/notices/tender-advertisements/
 * Structure: EmbedPress embeds PDFs - extract from file= param and a[href*=".pdf"]
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const LISTING_URL = 'https://iym.gov.za/index.php/notices/tender-advertisements/';
const BASE = 'https://iym.gov.za';

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

function filenameToTitle(filename) {
  if (!filename) return 'Inxuba Yethemba tender (see source)';
  const base = filename.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ');
  if (base.match(/^BID\s*NO\s*\.?/i)) return base;
  if (base.match(/^RFQ\b/i)) return base;
  if (base.match(/^\d+_/)) return base.replace(/^\d+_/, '');
  return base.length > 15 ? base : `Inxuba Yethemba tender: ${base}`;
}

function extractTenderNumber(filename) {
  const m = String(filename || '').match(/BID\s*NO\.?\s*([A-Z0-9_]+)/i);
  if (m) return `BID NO. ${m[1]}`;
  const m2 = filename.match(/RFQ[-A-Za-z]+/i);
  if (m2) return m2[0];
  const m3 = filename.match(/^(\d+_[A-Z0-9]+)/);
  return m3 ? m3[1] : '';
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || 'inxubayethemba_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : 500;

  console.log('\n🔍 SCRAPING INXUBA YETHEMBA LOCAL MUNICIPALITY TENDERS');
  console.log('======================================================');

  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
  const { data: html } = await axios.get(LISTING_URL, { timeout: 45000, headers });

  const $ = cheerio.load(html);
  const seen = new Set();
  const entries = [];

  for (const re of [
    /file=https%3A%2F%2F([^&"'\s]+)/g,
    /https?:\/\/iym\.gov\.za\/wp-content\/uploads\/[^\s"']+\.pdf/g
  ]) {
    let m;
    while ((m = re.exec(html)) !== null) {
      let url;
      if (m[1]) {
        try {
          url = 'https://' + decodeURIComponent(m[1].replace(/%2F/g, '/'));
        } catch (_) { continue; }
      } else {
        url = m[0].replace(/&#038;.*$/, '');
      }
      if (!url.endsWith('.pdf') || seen.has(url)) continue;
      seen.add(url);
      const filename = url.split('/').pop() || '';
      entries.push({
        url,
        filename,
        title: filenameToTitle(filename),
        tenderNumber: extractTenderNumber(filename)
      });
    }
  }

  $('a[href*=".pdf"]').each((_, a) => {
    const href = $(a).attr('href');
    if (!href || !href.includes('uploads') || seen.has(href)) return;
    seen.add(href);
    const fullUrl = href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`;
    const filename = fullUrl.split('/').pop() || '';
    entries.push({
      url: fullUrl,
      filename,
      title: $(a).text().trim() || filenameToTitle(filename),
      tenderNumber: extractTenderNumber(filename)
    });
  });

  const sliced = entries.slice(0, limit);
  const csvRows = sliced.map((e, i) => ({
    'Category': 'Municipal',
    'Tender Number': e.tenderNumber || `IYM-${String(i + 1).padStart(3, '0')}`,
    'Tender Description': e.title.slice(0, 500),
    'Advertised': '',
    'Closing': '',
    'Organ Of State': 'Inxuba Yethemba Local Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'Cradock, Middelburg',
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
    'Source URL': e.url,
    'Tender ID': '',
    'Source': 'Inxuba Yethemba'
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
