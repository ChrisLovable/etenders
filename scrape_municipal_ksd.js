/**
 * King Sabata Dalindyebo (KSD) Local Municipality tender scraper
 * Listing: ksd.gov.za/procurements/tenders/
 * Structure: Links to bid opening registers, awarded tenders, addendums, cancelled tenders
 * Note: Open tender adverts may be JS-rendered; this scraper collects all procurement documents
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const LISTING_URL = 'https://ksd.gov.za/procurements/tenders/';

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

function extractTenderNumber(text) {
  const m = String(text || '').match(/SCM\s*NO:?\s*(\d+\/\d{4}\/\d{2})|(\d{3}\/\d{4}\/\d{2})|BID\s*NO\.?\s*(\d+\/\d+)/i);
  if (m) return (m[1] || m[2] || m[3] || '').trim();
  return '';
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || 'ksd_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : 500;

  console.log('\n🔍 SCRAPING KING SABATA DALINDYEBO MUNICIPALITY TENDERS');
  console.log('=======================================================');

  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
  const { data: html } = await axios.get(LISTING_URL, { timeout: 30000, headers });

  const $ = cheerio.load(html);
  const seen = new Set();
  const entries = [];

  $('a[href*="/download/procurements/"]').each((_, a) => {
    const href = $(a).attr('href');
    const title = $(a).text().trim().replace(/\s+/g, ' ');
    if (!href || !title || title.length < 8 || seen.has(href)) return;
    seen.add(href);

    const link = href.startsWith('http') ? href : `https://ksd.gov.za${href.startsWith('/') ? '' : '/'}${href}`;
    const tenderNumber = extractTenderNumber(title);

    entries.push({
      tenderNumber: tenderNumber || `KSD-${String(entries.length + 1).padStart(3, '0')}`,
      description: title.slice(0, 500),
      link
    });
  });

  const sliced = entries.slice(0, limit);
  const csvRows = sliced.map((e, i) => ({
    'Category': 'Municipal',
    'Tender Number': e.tenderNumber || `KSD-${String(i + 1).padStart(3, '0')}`,
    'Tender Description': e.description,
    'Advertised': '',
    'Closing': '',
    'Organ Of State': 'King Sabata Dalindyebo Local Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'Mthatha, Mqanduli',
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
    'Source URL': e.link,
    'Tender ID': '',
    'Source': 'King Sabata Dalindyebo'
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
