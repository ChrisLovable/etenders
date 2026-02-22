/**
 * Elundini Local Municipality tender scraper
 * Listing: elundini.gov.za/category/supplychain/tenders/
 * Details (publishing date, closing date) are on each tender's page
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const LISTING_URL = 'https://elundini.gov.za/category/supplychain/tenders/';
const BASE_URL = 'https://www.elundini.gov.za';
const DELAY_MS = 600;

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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function formatDate(text) {
  const m = String(text || '').match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (!m) return '';
  const monthMap = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  const month = monthMap[m[2].slice(0, 3).toLowerCase()] || '01';
  return `${String(m[1]).padStart(2, '0')}/${month}/${m[3]}`;
}

function extractTenderNumber(text) {
  const m = String(text || '').match(/ELM-\d+\/\d+\/\d{4}-\d{4}/i);
  return m ? m[0] : '';
}

async function fetchTenderDetails(url, headers) {
  try {
    const { data } = await axios.get(url, { timeout: 15000, headers });
    const $ = cheerio.load(data);
    const text = $('article, .post, .content, main').text().replace(/\s+/g, ' ');
    const allDates = text.match(/(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/gi) || [];
    const published = allDates.length >= 1 ? formatDate(allDates[0]) : '';
    const closing = allDates.length >= 2 ? formatDate(allDates[1]) : (allDates[0] ? formatDate(allDates[0]) : '');
    return { published, closing };
  } catch (err) {
    return { published: '', closing: '' };
  }
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || 'elundini_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : 50;

  console.log('\n🔍 SCRAPING ELUNDINI LOCAL MUNICIPALITY TENDERS');
  console.log('================================================');

  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
  const { data: html } = await axios.get(LISTING_URL, { timeout: 20000, headers });

  const $ = cheerio.load(html);
  const links = [];
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const text = $(a).text().trim();
    if (text && text.length > 25 && (text.includes('ELM-') || /PROVISION|RE-ADVERTISEMENT|SUPPLY|APPOINTMENT|HIRING|DELIVERY|MAINTENANCE/i.test(text)) && href.includes('elundini') && !/supplychain\/tenders\/?$/.test(href)) {
      const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;
      if (!links.some(l => l.url === fullUrl)) {
        links.push({ url: fullUrl, title: text });
      }
    }
  });

  const entries = [];
  for (let i = 0; i < Math.min(links.length, limit); i++) {
    const { url, title } = links[i];
    const { published, closing } = await fetchTenderDetails(url, headers);
    const tenderNumber = extractTenderNumber(title) || extractTenderNumber(url);
    entries.push({
      tenderNumber: tenderNumber || `ELM-${String(i + 1).padStart(3, '0')}`,
      description: title.replace(/\s+/g, ' ').slice(0, 500),
      advertised: published,
      closing
    });
    await sleep(DELAY_MS);
  }

  const csvRows = entries.map(e => ({
    'Category': 'Municipal',
    'Tender Number': e.tenderNumber || '',
    'Tender Description': e.description || 'Elundini tender (see source)',
    'Advertised': e.advertised || '',
    'Closing': e.closing || '',
    'Organ Of State': 'Elundini Local Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'Maclear, Ugie, Mt Fletcher',
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
    'Source': 'Elundini'
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
