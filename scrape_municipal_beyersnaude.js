/**
 * Beyers Naude Local Municipality tender scraper
 * Scrapes document list from bnlm.gov.za/documents/tenders/
 * Structure: File [name].pdf, date, Download link
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const TENDERS_URL = 'https://bnlm.gov.za/documents/tenders/';
const BASE_URL = 'https://bnlm.gov.za';

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

function filenameToDescription(filename) {
  if (!filename) return 'Beyers Naude tender (see source)';
  const base = filename.replace(/\.(pdf|docx?|xlsx?)$/i, '').replace(/[-_]+/g, ' ');
  return base.length > 10 ? base : `Beyers Naude tender ${base}`;
}

function extractTenderNumber(filename) {
  const m = String(filename || '').match(/(BEY-SCM-\d+|[A-Za-z]+-\d+-\d{4})/i);
  return m ? m[1] : '';
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || 'beyersnaude_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : 500;

  console.log('\n🔍 SCRAPING BEYERS NAUDE LOCAL MUNICIPALITY TENDERS');
  console.log('====================================================');

  const { data: html } = await axios.get(TENDERS_URL, {
    timeout: 30000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });

  const $ = cheerio.load(html);
  const entries = [];
  const seenIds = new Set();

  $('a[href*="upf=dl"]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const idMatch = href.match(/id=(\d+)/);
    if (!idMatch || seenIds.has(idMatch[1])) return;

    let container = $(a).closest('div, li, tr, article');
    for (let i = 0; i < 5 && container.length; i++) {
      const blockText = container.first().text().replace(/\s+/g, ' ');
      const fileMatch = blockText.match(/File\s+([^\s]+\.(?:pdf|docx?|xlsx?))/i);
      if (fileMatch) {
        const filename = fileMatch[1].trim();
        const dateMatch = blockText.match(/(\w+\s+\d{1,2},\s*\d{4})/);
        seenIds.add(idMatch[1]);
        entries.push({
          tenderNumber: extractTenderNumber(filename) || filename.replace(/\.[^.]+$/, ''),
          description: filenameToDescription(filename),
          closing: dateMatch ? formatDate(dateMatch[1]) : ''
        });
        return;
      }
      container = container.parent();
    }
  });

  const sliced = limit ? entries.slice(0, limit) : entries;
  const csvRows = sliced.map((e, i) => ({
    'Category': 'Municipal',
    'Tender Number': e.tenderNumber || `BEY-${String(i + 1).padStart(3, '0')}`,
    'Tender Description': e.description.slice(0, 500),
    'Advertised': '',
    'Closing': e.closing || '',
    'Organ Of State': 'Beyers Naude Local Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'Graaff-Reinet, Jansenville, Klipplaat',
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
    'Source URL': TENDERS_URL,
    'Tender ID': '',
    'Source': 'Beyers Naude'
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
