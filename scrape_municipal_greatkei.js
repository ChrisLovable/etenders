/**
 * Great Kei Municipality tender scraper
 * Listing: greatkeilm.gov.za/web/category/tenders/open-tenders/
 * Structure: .box-content cards with h4 title, .entry-date, .entry-author (closing in red), Read More
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const LISTING_URL = 'https://greatkeilm.gov.za/web/category/tenders/open-tenders/';

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
  const m = String(text || '').match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (!m) return '';
  const monthMap = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  const month = monthMap[m[2].slice(0, 3).toLowerCase()] || '01';
  return `${String(m[1]).padStart(2, '0')}/${month}/${m[3]}`;
}

function extractTenderNumber(text) {
  const s = String(text || '');
  const m = s.match(/RFQ\s*NO:\s*([A-Z0-9\s\/]+\d{4}\/\d{2})/i);
  if (m) return `RFQ NO: ${m[1].trim()}`;
  const m2 = s.match(/RFQ\/[A-Z0-9\/]+\/\d{4}\/\d{2}|[A-Z]+\/\d+\/\d{4}\/\d{2}/i);
  if (m2) return m2[0];
  const m3 = s.match(/^([A-Z\s]+\d+\/\d{4}(?:\/\d{2})?)/);
  return m3 ? m3[1].trim() : '';
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || 'greatkei_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : 500;

  console.log('\n🔍 SCRAPING GREAT KEI MUNICIPALITY TENDERS');
  console.log('==========================================');

  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
  const { data: html } = await axios.get(LISTING_URL, { timeout: 30000, headers });

  const $ = cheerio.load(html);
  const entries = [];

  $('.box-content.col-lg-12.col-md-12').each((_, el) => {
    const $el = $(el);
    const $titleLink = $el.find('h4 a').first();
    const titleText = $titleLink.text().trim().replace(/\s+/g, ' ');
    if (!titleText || titleText.length < 5) return;

    const advertised = formatDate($el.find('.entry-date').first().text().trim());
    const authors = $el.find('.box-info .entry-author');
    let contactPerson = '';
    let closing = '';
    authors.each((_, a) => {
      const t = $(a).text().trim();
      if (/\d{1,2}\s+\w+\s+\d{4}\s*-\s*\d{1,2}:\d{2}/.test(t)) {
        closing = formatDate(t);
      } else if (t && !closing) {
        contactPerson = t;
      }
    });

    const desc = $el.find('p').first().text().trim().replace(/\s+/g, ' ') || titleText;
    const tenderNumber = extractTenderNumber(titleText);

    entries.push({
      tenderNumber: tenderNumber || titleText.split(':')[0].trim(),
      description: (desc.length > 20 ? desc : titleText).slice(0, 500),
      advertised,
      closing,
      contactPerson
    });
  });

  const sliced = entries.slice(0, limit);
  const csvRows = sliced.map((e, i) => ({
    'Category': 'Municipal',
    'Tender Number': e.tenderNumber || `GK-${String(i + 1).padStart(3, '0')}`,
    'Tender Description': e.description,
    'Advertised': e.advertised || '',
    'Closing': e.closing || '',
    'Organ Of State': 'Great Kei Municipality',
    'Tender Type': 'Request for Quotation',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'Great Kei (Komga, Kei Mouth)',
    'Special Conditions': '',
    'Contact Person': e.contactPerson || '',
    'Email': '',
    'Telephone number': '',
    'FAX Number': '',
    'Is there a briefing session?': '',
    'Is it compulsory?': '',
    'Briefing Date and Time': '',
    'Briefing Venue': '',
    'eSubmission': '',
    'Two Envelope Submission': '',
    'Source URL': LISTING_URL,
    'Tender ID': '',
    'Source': 'Great Kei'
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
