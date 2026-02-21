/**
 * Mangaung Metropolitan Municipality tender scraper
 * Scrapes "List of Available BIDS" pages from mangaung.co.za
 * Output: Same CSV format as other municipal scrapers (Source: Mangaung)
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://www.mangaung.co.za';
const CATEGORY_URL = `${BASE_URL}/category/tenders-bids/`;
const DELAY_MS = 800;

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    limit: (() => {
      const idx = args.indexOf('--limit');
      return idx >= 0 && args[idx + 1] ? parseInt(args[idx + 1], 10) : null;
    })(),
    maxPages: (() => {
      const idx = args.indexOf('--max-pages');
      return idx >= 0 && args[idx + 1] ? parseInt(args[idx + 1], 10) : 3;
    })()
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDateSA(d) {
  if (!d) return '';
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const match = String(d).match(/Date:\s*(\d{1,2})\s+(\w+)\s+(\d{4})/i) || String(d).match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (match) {
    const [, day, monthName, year] = match;
    const mi = months.findIndex(m => m.toLowerCase().startsWith(String(monthName).toLowerCase()));
    const month = mi >= 0 ? String(mi + 1).padStart(2, '0') : '01';
    return `${String(day).padStart(2, '0')}/${month}/${year}`;
  }
  const slashMatch = String(d).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (slashMatch) return slashMatch[0];
  return '';
}

function parseClosingTime(text) {
  const m = String(text || '').match(/Time:\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i);
  return m ? m[1].trim() : '';
}

/**
 * Find links to "List of Available BIDS: XXX" pages (exclude notices, cancellations, etc.)
 */
async function scrapeBidListUrls(maxPages = 3) {
  const listUrls = [];
  const seen = new Set();

  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? CATEGORY_URL : `${CATEGORY_URL}page/${page}/`;
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15000
    });
    const $ = cheerio.load(html);
    $('a[href*="list-of-available-bids"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !href.includes('cancelled') && !href.includes('withdrawn') && !href.includes('notice') && !seen.has(href)) {
        seen.add(href);
        listUrls.push(href.startsWith('http') ? href : BASE_URL + href);
      }
    });
    await sleep(DELAY_MS);
  }
  return listUrls;
}

/**
 * Parse a single "List of Available BIDS" page - extract table rows
 */
async function scrapeBidListPage(pageUrl, documentDate) {
  const { data: html } = await axios.get(pageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    timeout: 15000
  });
  const $ = cheerio.load(html);
  const entries = [];

  // Table: BID NUMBER | DESCRIPTION | CLOSING DATE AND TIME
  $('table tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 3) return;
    const bidNumber = $(cells[0]).text().trim();
    const description = $(cells[1]).text().trim();
    const closingRaw = $(cells[2]).text().trim();
    if (!bidNumber || !description || bidNumber.toLowerCase().includes('bid number')) return;
    if (!/MMM\/BID|BID\s*\d+/i.test(bidNumber)) return; // Must look like a bid number

    const closingDate = formatDateSA(closingRaw);
    const closingTime = parseClosingTime(closingRaw);

    entries.push({
      pdfUrl: pageUrl,
      tenderNumber: bidNumber,
      description: description.replace(/\s+/g, ' ').trim(),
      closingDate,
      closingTime,
      documentDate: documentDate || ''
    });
  });

  // Fallback: some pages may use divs or different structure
  if (entries.length === 0) {
    const text = $('article, .entry-content, .post-content').text();
    const rows = text.match(/MMM\/BID[^|]+/g);
    if (rows) {
      const blocks = text.split(/(?=MMM\/BID)/i);
      for (const block of blocks) {
        const bidMatch = block.match(/^(MMM\/BID[^.\n]+?)(?:\s{2,}|\n)/);
        const descMatch = block.match(/(?:MMM\/BID[^.\n]+)\s+([\s\S]+?)(?=Date:|MMM\/BID|$)/);
        const dateMatch = block.match(/Date:\s*(\d{1,2}\s+\w+\s+\d{4})[^]*?Time:\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i);
        if (bidMatch) {
          entries.push({
            pdfUrl: pageUrl,
            tenderNumber: bidMatch[1].trim(),
            description: (descMatch ? descMatch[1] : '').replace(/\s+/g, ' ').trim(),
            closingDate: dateMatch ? formatDateSA(dateMatch[1]) : '',
            closingTime: dateMatch ? dateMatch[2].trim() : '',
            documentDate: documentDate || ''
          });
        }
      }
    }
  }

  return entries;
}

/**
 * Extract document date from page URL (e.g. /2026/01/23/ -> 23/01/2026)
 */
function documentDateFromUrl(url) {
  const m = String(url || '').match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return '';
}

function toCsvRow(row) {
  const desc = (row.description || '').trim();
  const finalDesc = desc.length > 10 ? desc : `Mangaung tender ${row.tenderNumber || ''} - see document for details`;
  const truncated = finalDesc.length > 500 ? finalDesc.substring(0, 497) + '...' : finalDesc;

  return {
    'Category': 'Municipal',
    'Tender Number': row.tenderNumber || '',
    'Tender Description': truncated,
    'Advertised': row.documentDate || '',
    'Closing': row.closingDate || '',
    'Organ Of State': 'Mangaung Metropolitan Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Free State',
    'Place where goods, works or services are required': 'Bloemfontein',
    'Special Conditions': '',
    'Contact Person': '',
    'Email': '',
    'Telephone number': '',
    'FAX Number': '',
    'Is there a briefing session?': '',
    'Is it compulsory?': '',
    'Briefing Date and Time': row.closingTime || '',
    'Briefing Venue': '',
    'eSubmission': '',
    'Two Envelope Submission': '',
    'Source URL': row.pdfUrl || '',
    'Tender ID': '',
    'Source': 'Mangaung'
  };
}

async function runScraper(opts = {}) {
  const { limit = null, maxPages = 3, outDir = __dirname, csvFilename = 'mangaung_tenders.csv' } = opts;
  const outPath = path.join(outDir, csvFilename);

  console.log('\n🔍 SCRAPING MANGAUNG METROPOLITAN MUNICIPALITY TENDERS');
  console.log('======================================================');

  const listUrls = await scrapeBidListUrls(maxPages);
  console.log(`Found ${listUrls.length} bid list pages`);

  const allEntries = [];
  for (const url of listUrls) {
    const docDate = documentDateFromUrl(url);
    const entries = await scrapeBidListPage(url, docDate);
    allEntries.push(...entries);
    await sleep(DELAY_MS);
  }

  const unique = [];
  const seenBids = new Set();
  for (const e of allEntries) {
    const key = (e.tenderNumber || '').trim();
    if (key && !seenBids.has(key)) {
      seenBids.add(key);
      unique.push(e);
    }
  }

  const toProcess = limit ? unique.slice(0, limit) : unique;
  const results = toProcess.map(row => toCsvRow(row));

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

  return { rows: results.length, data: results, message: `Wrote ${results.length} rows to ${csvFilename}` };
}

async function main() {
  const { limit, maxPages } = parseArgs();
  const outPath = path.join(__dirname, 'mangaung_tenders.csv');
  console.log('Mangaung municipal scraper');
  console.log('Output:', outPath);
  const { rows, message } = await runScraper({ limit, maxPages });
  console.log(message);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Scrape failed:', err.message);
    process.exit(1);
  });
}

module.exports = { runScraper, scrapeBidListUrls, scrapeBidListPage };
