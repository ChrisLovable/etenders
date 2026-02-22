/**
 * Ingquza Hill Local Municipality tender scraper
 * Uses WP Job Manager REST API: wp-json/wp/v2/job-listings
 * Listing page: ihlm.gov.za/tenders/ (content loaded via JS)
 */
const axios = require('axios');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const API_URL = 'https://www.ihlm.gov.za/wp-json/wp/v2/job-listings';
const TENDERS_URL = 'https://www.ihlm.gov.za/tenders/';

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

function formatDate(isoDate) {
  if (!isoDate) return '';
  const m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

async function fetchAllListings(limit) {
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
  const all = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const { data } = await axios.get(API_URL, {
      timeout: 20000,
      headers,
      params: { per_page: perPage, page }
    });
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    if (data.length < perPage || all.length >= limit) break;
    page++;
  }
  return all.slice(0, limit);
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || 'ingquzahill_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : 500;

  console.log('\n🔍 SCRAPING INGQUZA HILL LOCAL MUNICIPALITY TENDERS');
  console.log('=====================================================');

  const listings = await fetchAllListings(limit);

  const csvRows = listings.map((job, i) => {
    const title = (job.title && job.title.rendered) ? job.title.rendered.trim() : '';
    const link = job.link || '';
    const advertised = formatDate(job.date);
    const tenderNumber = `IHLM-${job.id || i + 1}`;
    return {
      'Category': 'Municipal',
      'Tender Number': tenderNumber,
      'Tender Description': title.slice(0, 500),
      'Advertised': advertised,
      'Closing': '',
      'Organ Of State': 'Ingquza Hill Local Municipality',
      'Tender Type': 'Request for Bid',
      'Province': 'Eastern Cape',
      'Place where goods, works or services are required': 'Ingquza Hill (Flagstaff, Lusikisiki)',
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
      'Source URL': link || TENDERS_URL,
      'Tender ID': String(job.id || ''),
      'Source': 'Ingquza Hill'
    };
  });

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
