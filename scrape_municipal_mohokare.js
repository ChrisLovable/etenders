/**
 * Mohokare Local Municipality tender scraper
 * Scrapes tenders from mohokare.gov.za/procurements.html
 * Table: No | Description | Reference# | Closing Date | Uploaded Date
 * Output: mohokare_tenders.csv (Source: Mohokare)
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://mohokare.gov.za';
const TENDERS_URL = `${BASE_URL}/procurements.html`;

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    limit: (() => {
      const idx = args.indexOf('--limit');
      return idx >= 0 && args[idx + 1] ? parseInt(args[idx + 1], 10) : null;
    })()
  };
}

function formatClosingDate(text) {
  if (!text) return '';
  const m = String(text).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? m[0] : text.replace(/\s+at\s+[\d:]+$/, '').trim();
}

function formatUploadedDate(text) {
  if (!text) return '';
  const m = String(text).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? m[0] : text.trim();
}

async function scrapeProcurementsPage() {
  const entries = [];
  try {
    const { data: html } = await axios.get(TENDERS_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15000
    });
    const $ = cheerio.load(html);

    $('table').each((_, tbl) => {
      $(tbl).find('tr').each((_, row) => {
        const cells = $(row).find('td, th');
        if (cells.length < 5) return;
        const no = $(cells[0]).text().trim();
        const desc = $(cells[1]).text().trim();
        const refCell = $(cells[2]);
        const refText = refCell.text().trim();
        const closing = $(cells[3]).text().trim();
        const uploaded = $(cells[4]).text().trim();
        if (no === 'No' || desc === 'No Adverts for the Month') return;
        if (!refText || refText === '.') return;

        const link = refCell.find('a').attr('href') || $(cells[1]).find('a').attr('href');
        let sourceUrl = BASE_URL + '/procurements.html';
        if (link) {
          const abs = link.startsWith('http') ? link : BASE_URL + '/' + link.replace(/^\//, '');
          sourceUrl = abs.split('?')[0].replace(/ /g, '%20');
        }

        entries.push({
          tenderNumber: refText,
          description: desc,
          closingDate: formatClosingDate(closing),
          documentDate: formatUploadedDate(uploaded),
          sourceUrl
        });
      });
    });
  } catch (err) {
    console.warn('Failed to fetch procurements page:', err.message);
  }
  return entries;
}

function toCsvRow(row) {
  const desc = (row.description || '').trim();
  const finalDesc = desc.length > 10 ? desc : `Mohokare tender ${row.tenderNumber || ''} - see document for details`;
  const truncated = finalDesc.length > 500 ? finalDesc.substring(0, 497) + '...' : finalDesc;

  return {
    'Category': 'Municipal',
    'Tender Number': row.tenderNumber || '',
    'Tender Description': truncated,
    'Advertised': row.documentDate || '',
    'Closing': row.closingDate || '',
    'Organ Of State': 'Mohokare Local Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Free State',
    'Place where goods, works or services are required': 'Zastron, Rouxville, Smithfield',
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
    'Source URL': row.sourceUrl || '',
    'Tender ID': '',
    'Source': 'Mohokare'
  };
}

async function runScraper(opts = {}) {
  const { limit = null, outDir = __dirname, csvFilename = 'mohokare_tenders.csv' } = opts;
  const outPath = path.join(outDir, csvFilename);

  console.log('\n🔍 SCRAPING MOHOKARE LOCAL MUNICIPALITY TENDERS');
  console.log('================================================');

  const entries = await scrapeProcurementsPage();
  if (entries.length === 0) {
    return { rows: 0, data: [], message: 'No tenders found.' };
  }

  const seen = new Set();
  const unique = [];

  for (const e of entries) {
    const key = (e.tenderNumber || '').trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      unique.push(e);
    }
  }

  const toProcess = limit ? unique.slice(0, limit) : unique;
  const results = toProcess.map(row => toCsvRow(row));

  try {
    const csvWriter = createCsvWriter({
      path: outPath,
      header: [
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
      ]
    });
    await csvWriter.writeRecords(results);
  } catch (writeErr) {
    console.warn('CSV write failed (file may be open):', writeErr.message);
  }

  return { rows: results.length, data: results, message: `Wrote ${results.length} rows to ${csvFilename}` };
}

async function main() {
  const { limit } = parseArgs();
  console.log('Mohokare municipal scraper');
  const { rows, message } = await runScraper({ limit });
  console.log(message);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Scrape failed:', err.message);
    process.exit(1);
  });
}

module.exports = { runScraper, scrapeProcurementsPage };
