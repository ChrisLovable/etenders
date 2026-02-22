/**
 * Intsika Yethu Local Municipality tender scraper
 * Listing: intsikayethu.gov.za/cat_doc/tenders/
 * Structure: ova_doc links with title (RFQ XX-TITLE), date in parent block
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const LISTING_URL = 'https://intsikayethu.gov.za/cat_doc/tenders/';

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
  const m = String(text || '').match(/(\w+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return '';
  const monthMap = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  const month = monthMap[m[1].slice(0, 3).toLowerCase()] || '01';
  return `${String(m[2]).padStart(2, '0')}/${month}/${m[3]}`;
}

function extractTenderNumber(text) {
  const m = String(text || '').match(/^(RFQ\s*\d+(?:-ANNUAL)?|BEO\s*\d+)/i);
  return m ? m[1].trim() : '';
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || 'intsikayethu_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : 500;

  console.log('\n🔍 SCRAPING INTSIKA YETHU LOCAL MUNICIPALITY TENDERS');
  console.log('====================================================');

  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
  const { data: html } = await axios.get(LISTING_URL, { timeout: 30000, headers });

  const $ = cheerio.load(html);
  const entries = [];

  $('a[href*="ova_doc"]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href') || '';
    const title = $a.text().trim().replace(/\s+/g, ' ');
    if (!title || title.length < 5) return;

    const $wrap = $a.closest('[class*="archive"], [class*="item"], div');
    const blockHtml = $wrap.length ? $.html($wrap.first()) : $a.parent().parent().html() || '';
    const dateMatch = blockHtml.match(/(\w+\s+\d{1,2},\s*\d{4})/);
    const advertised = dateMatch ? formatDate(dateMatch[1]) : '';

    const tenderNumber = extractTenderNumber(title);

    entries.push({
      tenderNumber: tenderNumber || title.split('-')[0].trim() || `IY-${entries.length + 1}`,
      description: title.slice(0, 500),
      advertised,
      link: href.startsWith('http') ? href : `https://www.intsikayethu.gov.za${href.startsWith('/') ? '' : '/'}${href}`
    });
  });

  const sliced = entries.slice(0, limit);
  const csvRows = sliced.map((e, i) => ({
    'Category': 'Municipal',
    'Tender Number': e.tenderNumber || `IY-${String(i + 1).padStart(3, '0')}`,
    'Tender Description': e.description,
    'Advertised': e.advertised || '',
    'Closing': '',
    'Organ Of State': 'Intsika Yethu Local Municipality',
    'Tender Type': 'Request for Quotation',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'Cofimvaba',
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
    'Source URL': e.link || LISTING_URL,
    'Tender ID': '',
    'Source': 'Intsika Yethu'
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
