/**
 * Emalahleni Local Municipality (Mpumalanga) tender scraper
 * Listing: emalahleni.gov.za/v2/elm-business/tenders
 * Structure: K2 itemContainer cards with ELM XX/YYYY ref, title, dates, OPEN PERIOD
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const LISTING_URL = 'https://emalahleni.gov.za/v2/elm-business/tenders';
const BASE_URL = 'https://emalahleni.gov.za';

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
  const m = String(text || '').match(/ELM\s*\d+\/\d{4}/i);
  return m ? m[0].replace(/\s+/g, ' ') : '';
}

function parseOpenPeriod(text) {
  const m = String(text || '').match(/OPEN\s*PERIOD:\s*[\d\w\s,]+\s*-\s*(\d{1,2})\s+(\w+)\s+(\d{4})/i);
  if (!m) return '';
  return formatDate(`${m[1]} ${m[2]} ${m[3]}`);
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || 'emalahleni_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : 500;

  console.log('\n🔍 SCRAPING EMALAHLENI LOCAL MUNICIPALITY TENDERS');
  console.log('=================================================');

  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
  const { data: html } = await axios.get(LISTING_URL, { timeout: 60000, headers });

  const $ = cheerio.load(html);
  const entries = [];

  $('.itemContainer').each((_, el) => {
    const $el = $(el);
    const blockText = $el.text().replace(/\s+/g, ' ');
    const $titleLink = $el.find('.catItemTitle a').first();
    const titleText = $titleLink.text().trim();
    const href = $titleLink.attr('href') || '';
    const detailUrl = href.startsWith('http') ? href : `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;

    const tenderNumber = extractTenderNumber(titleText) || extractTenderNumber(blockText);
    const title = titleText.replace(/ELM\s*\d+\/\d{4}\s*-::-?\s*/i, '').trim() || 'Emalahleni tender (see source)';
    const advertised = formatDate($el.find('.itemDateCreated').text().trim()) || formatDate(blockText);
    const closing = parseOpenPeriod(blockText);

    if (tenderNumber || title.length > 20) {
      entries.push({
        tenderNumber,
        description: title.slice(0, 500),
        advertised,
        closing,
        detailUrl
      });
    }
  });

  const sliced = entries.slice(0, limit);
  const csvRows = sliced.map((e, i) => ({
    'Category': 'Municipal',
    'Tender Number': e.tenderNumber || `ELM-${String(i + 1).padStart(3, '0')}`,
    'Tender Description': e.description,
    'Advertised': e.advertised || '',
    'Closing': e.closing || '',
    'Organ Of State': 'Emalahleni Local Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Mpumalanga',
    'Place where goods, works or services are required': 'Emalahleni (Witbank)',
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
    'Source URL': LISTING_URL,
    'Tender ID': '',
    'Source': 'Emalahleni'
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
