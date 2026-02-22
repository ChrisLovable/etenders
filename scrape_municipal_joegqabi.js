/**
 * Joe Gqabi District Municipality tender scraper
 * Listing: jgdm.gov.za/tenders/tender-quotation-advertisements/
 * Structure: h3 titles with Download links to /download/... pages
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const LISTING_URL = 'https://jgdm.gov.za/tenders/tender-quotation-advertisements/';

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
  const m = String(text || '').match(/JGDM\d{4}\/\d{2}-\d{3}|Tender\s*No:?\s*([A-Z0-9\/\-]+)/i);
  if (m) return m[1] || m[0];
  const m2 = text.match(/Notice:\s*(\d+\/\d{4})/i);
  if (m2) return `Notice ${m2[1]}`;
  return '';
}

function extractClosingDate(text) {
  const m = String(text || '').match(/(?:CLOSING\s*DATE|closing\s*date):\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (m) return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`;
  return '';
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || 'joegqabi_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : 500;

  console.log('\n🔍 SCRAPING JOE GQABI DISTRICT MUNICIPALITY TENDERS');
  console.log('===================================================');

  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
  const { data: html } = await axios.get(LISTING_URL, { timeout: 30000, headers });

  const $ = cheerio.load(html);
  const entries = [];

  $('h3').each((_, el) => {
    const title = $(el).text().trim().replace(/\s+/g, ' ');
    if (!title || (!title.includes('Advert') && !title.includes('Notice'))) return;

    const $parent = $(el).closest('div, article, li');
    const $link = $parent.find('a[href*="/download/"]').first();
    const href = $link.attr('href');
    if (!href) return;

    const link = href.startsWith('http') ? href : `https://jgdm.gov.za${href.startsWith('/') ? '' : '/'}${href}`;
    const tenderNumber = extractTenderNumber(title);
    const closing = extractClosingDate(title);

    entries.push({
      tenderNumber: tenderNumber || `JGDM-${String(entries.length + 1).padStart(3, '0')}`,
      description: title.slice(0, 500),
      closing,
      link
    });
  });

  const sliced = entries.slice(0, limit);
  const csvRows = sliced.map((e, i) => ({
    'Category': 'Municipal',
    'Tender Number': e.tenderNumber || `JGDM-${String(i + 1).padStart(3, '0')}`,
    'Tender Description': e.description,
    'Advertised': '',
    'Closing': e.closing || '',
    'Organ Of State': 'Joe Gqabi District Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'Barkly East, Aliwal North, Lady Grey',
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
    'Source': 'Joe Gqabi'
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
