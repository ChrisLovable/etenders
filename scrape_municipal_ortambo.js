/**
 * O.R. Tambo District Municipality tender scraper
 * Scrapes tenders from ortambodm.gov.za/tenders/
 * Table: Status | Contract No | Description | Closing Date | Date Posted | Download Document
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://ortambodm.gov.za';
const TENDERS_URL = `${BASE_URL}/tenders/`;

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

function formatDateYMD(d) {
  if (!d) return '';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

async function scrapeTendersPage() {
  const { data: html } = await axios.get(TENDERS_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    timeout: 20000
  });
  const $ = cheerio.load(html);
  const entries = [];

  $('table tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 5) return;

    const status = $(cells[0]).text().trim();
    const contractNo = $(cells[1]).text().trim();
    const description = $(cells[2]).text().trim();
    const closingDate = $(cells[3]).text().trim();
    const datePosted = $(cells[4]).text().trim();
    const downloadLink = $(cells[5]).find('a[href*=".pdf"]').attr('href') || $(cells[5]).find('a').attr('href') || '';

    if (!contractNo || !description) return;
    if (/^(Status|Contract No)$/i.test(contractNo)) return;

    const pdfUrl = downloadLink.startsWith('http') ? downloadLink : (downloadLink.startsWith('/') ? BASE_URL + downloadLink : BASE_URL + '/' + downloadLink);

    entries.push({
      tenderNumber: contractNo,
      description: description.replace(/\s+/g, ' ').trim(),
      closingDate: formatDateYMD(closingDate) || closingDate,
      datePosted: formatDateYMD(datePosted) || datePosted,
      sourceUrl: pdfUrl || TENDERS_URL
    });
  });

  return entries;
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || 'ortambo_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : 500;

  console.log('\n🔍 SCRAPING O.R. TAMBO DISTRICT MUNICIPALITY TENDERS');
  console.log('====================================================');

  const entries = await scrapeTendersPage();
  const sliced = entries.slice(0, limit);

  const csvRows = sliced.map(e => ({
    'Category': 'Municipal',
    'Tender Number': e.tenderNumber || '',
    'Tender Description': (e.description || 'O.R. Tambo tender').slice(0, 500),
    'Advertised': e.datePosted || '',
    'Closing': e.closingDate || '',
    'Organ Of State': 'O.R. Tambo District Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'Mthatha, O.R. Tambo District',
    'Special Conditions': '',
    'Contact Person': '',
    'Email': 'info@ortambodm.gov.za',
    'Telephone number': '060 752 0961',
    'FAX Number': '',
    'Is there a briefing session?': '',
    'Is it compulsory?': '',
    'Briefing Date and Time': '',
    'Briefing Venue': '',
    'eSubmission': '',
    'Two Envelope Submission': '',
    'Source URL': e.sourceUrl || TENDERS_URL,
    'Tender ID': '',
    'Source': 'O.R. Tambo'
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
