/**
 * Phumelela Local Municipality tender scraper
 * Scrapes tenders from phumelela.gov.za/document-category/formal-tenders/
 * Articles with title, date (Month Day, Year), link to document page
 * Output: phumelela_tenders.csv (Source: Phumelela)
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://phumelela.gov.za';
const TENDERS_URL = `${BASE_URL}/document-category/formal-tenders/`;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    limit: (() => {
      const idx = args.indexOf('--limit');
      return idx >= 0 && args[idx + 1] ? parseInt(args[idx + 1], 10) : null;
    })()
  };
}

function formatDate(text) {
  if (!text) return '';
  const m = String(text).match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const [, monthName, day, year] = m;
    const mi = MONTHS.findIndex(mo => mo.toLowerCase().startsWith(String(monthName).toLowerCase().substring(0, 3)));
    const month = mi >= 0 ? String(mi + 1).padStart(2, '0') : '01';
    return `${String(day).padStart(2, '0')}/${month}/${year}`;
  }
  const ddmm = String(text).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return ddmm ? ddmm[0] : text.trim();
}

function extractTenderNumber(title) {
  if (!title) return '';
  const m = title.match(/PLMT\s*\d{2}-\d{2}\/\d+/i) || title.match(/PLMT\d{2}-\d{2}\/\d+/i);
  return m ? m[0].replace(/\s+/g, ' ').trim() : '';
}

async function scrapeFormalTendersPage() {
  const entries = [];
  try {
    const { data: html } = await axios.get(TENDERS_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15000
    });
    const $ = cheerio.load(html);

    $('article').each((_, el) => {
      const $art = $(el);
      const titleEl = $art.find('h2 a, h3 a, .entry-title a').first();
      const title = titleEl.text().trim();
      const link = titleEl.attr('href');
      if (!title || title.length < 5) return;

      const fullText = $art.text();
      const dateMatch = fullText.match(/([A-Za-z]+\s+\d{1,2},?\s+\d{4})/);
      const advertised = formatDate(dateMatch ? dateMatch[1] : '');

      const tenderNumber = extractTenderNumber(title) || title.substring(0, 30);
      const sourceUrl = link && link.startsWith('http') ? link : (link ? BASE_URL + link.replace(/^\//, '') : TENDERS_URL);

      entries.push({
        tenderNumber,
        description: title,
        closingDate: '',
        documentDate: advertised,
        sourceUrl
      });
    });
  } catch (err) {
    console.warn('Failed to fetch formal tenders page:', err.message);
  }
  return entries;
}

function toCsvRow(row) {
  const desc = (row.description || '').trim();
  const finalDesc = desc.length > 10 ? desc : `Phumelela tender ${row.tenderNumber || ''} - see document for details`;
  const truncated = finalDesc.length > 500 ? finalDesc.substring(0, 497) + '...' : finalDesc;

  return {
    'Category': 'Municipal',
    'Tender Number': row.tenderNumber || '',
    'Tender Description': truncated,
    'Advertised': row.documentDate || '',
    'Closing': row.closingDate || '',
    'Organ Of State': 'Phumelela Local Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Free State',
    'Place where goods, works or services are required': 'Vrede, Warden, Memel, Kestell',
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
    'Source': 'Phumelela'
  };
}

async function runScraper(opts = {}) {
  const { limit = null, outDir = __dirname, csvFilename = 'phumelela_tenders.csv' } = opts;
  const outPath = path.join(outDir, csvFilename);

  console.log('\n🔍 SCRAPING PHUMELELA LOCAL MUNICIPALITY TENDERS');
  console.log('=================================================');

  const entries = await scrapeFormalTendersPage();
  if (entries.length === 0) {
    return { rows: 0, data: [], message: 'No tenders found.' };
  }

  const seen = new Set();
  const unique = [];
  for (const e of entries) {
    const key = (e.sourceUrl || e.tenderNumber || e.description || '').trim();
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
  console.log('Phumelela municipal scraper');
  const { rows, message } = await runScraper({ limit });
  console.log(message);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Scrape failed:', err.message);
    process.exit(1);
  });
}

module.exports = { runScraper, scrapeFormalTendersPage };
