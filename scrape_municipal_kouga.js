/**
 * Kouga Municipality tender scraper
 * Scrapes tenders from kouga.gov.za/tenders/ (pages 1 and 2 only)
 * Structure: Title | Ref No | Start Date | Closing Date | Find Out More link
 * Output: Same CSV format as other municipal scrapers (Source: Kouga)
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://www.kouga.gov.za';
const TENDERS_BASE = 'https://www.kouga.gov.za/tenders';
const MAX_PAGES = 2; // First 2 pages only (user requested)
const DELAY_MS = 800;

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    limit: (() => {
      const idx = args.indexOf('--limit');
      return idx >= 0 && args[idx + 1] ? parseInt(args[idx + 1], 10) : null;
    })()
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateSA(text) {
  if (!text) return '';
  const match = String(text).match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (match) {
    const [, day, monthName, year] = match;
    const mi = MONTHS.findIndex(m => m.toLowerCase() === String(monthName).toLowerCase().substring(0, 3));
    const month = mi >= 0 ? String(mi + 1).padStart(2, '0') : '01';
    return `${String(day).padStart(2, '0')}/${month}/${year}`;
  }
  const slashMatch = String(text).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (slashMatch) return slashMatch[0];
  return '';
}

/**
 * Parse a single tenders listing page
 */
async function scrapeTendersPage(pageNum) {
  const url = pageNum === 1 ? `${TENDERS_BASE}/page/1` : `${TENDERS_BASE}/page/${pageNum}`;
  const entries = [];
  try {
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 20000
    });
    const $ = cheerio.load(html);

    // Find tender blocks: a[href*="/tender/"] with Ref No in text; title from preceding h3
    $('a[href*="/tender/"]').each((_, a) => {
      const link = $(a);
      const href = link.attr('href') || '';
      const linkText = link.text().trim();
      const refMatch = linkText.match(/Ref\s+No:\s*(\d+\/\d{4})/i);
      const startMatch = linkText.match(/Start\s+Date:\s*(\d{1,2}\s+\w+\s+\d{4})/i);
      const closeMatch = linkText.match(/Closing\s+Date:\s*(\d{1,2}\s+\w+\s+\d{4})/i);
      if (!refMatch) return;

      const title = link.prev('h3').text().trim() || link.parent().prev('h3').text().trim() || link.closest('div, article, section').find('h3').first().text().trim() || `Kouga tender ${refMatch[1]}`;
      const tenderNumber = refMatch[1];
      const startDate = startMatch ? startMatch[1] : '';
      const closingDate = closeMatch ? closeMatch[1] : '';

      const sourceUrl = href && (href.startsWith('http') || href.startsWith('//')) ? href : (href ? `https://www.kouga.gov.za${href.startsWith('/') ? '' : '/'}${href}` : TENDERS_BASE);

      entries.push({
        tenderNumber,
        description: title,
        openingDate: formatDateSA(startDate),
        closingDate: formatDateSA(closingDate),
        sourceUrl
      });
    });

    // Fallback: look for links with Ref No pattern in any structure
    if (entries.length === 0) {
      const text = $('body').text();
      const refMatches = text.matchAll(/Ref\s+No:\s*(\d+\/\d{4})\s*Start\s+Date:\s*(\d{1,2}\s+\w+\s+\d{4})\s*Closing\s+Date:\s*(\d{1,2}\s+\w+\s+\d{4})/gi);
      for (const m of refMatches) {
        const [, ref, start, close] = m;
        const idx = text.indexOf(m[0]);
        const before = text.slice(Math.max(0, idx - 300), idx);
        const titleMatch = before.match(/([A-Z][\w\s\-\(\)\.&:]+?)(?=\s*Ref\s+No:|$)/);
        const title = titleMatch ? titleMatch[1].trim() : `Kouga tender ${ref}`;
        entries.push({
          tenderNumber: ref,
          description: title,
          openingDate: formatDateSA(start),
          closingDate: formatDateSA(close),
          sourceUrl: TENDERS_BASE
        });
      }
    }
  } catch (err) {
    console.warn(`Failed to fetch page ${pageNum}:`, err.message);
  }
  return entries;
}

function toCsvRow(row) {
  const desc = (row.description || '').trim();
  const finalDesc = desc.length > 10 ? desc : `Kouga tender ${row.tenderNumber || ''} - see document for details`;
  const truncated = finalDesc.length > 500 ? finalDesc.substring(0, 497) + '...' : finalDesc;

  return {
    'Category': 'Municipal',
    'Tender Number': row.tenderNumber || '',
    'Tender Description': truncated,
    'Advertised': row.openingDate || '',
    'Closing': row.closingDate || '',
    'Organ Of State': 'Kouga Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'Jeffreys Bay, Humansdorp, St Francis Bay, Hankey',
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
    'Source URL': TENDERS_BASE,
    'Tender ID': '',
    'Source': 'Kouga'
  };
}

async function runScraper(opts = {}) {
  const { limit = null, outDir = __dirname, csvFilename = 'kouga_tenders.csv' } = opts;
  const outPath = path.join(outDir, csvFilename);

  console.log('\n🔍 SCRAPING KOUGA MUNICIPALITY TENDERS');
  console.log('=======================================');

  const allEntries = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageEntries = await scrapeTendersPage(page);
    allEntries.push(...pageEntries);
    if (page < MAX_PAGES) await sleep(DELAY_MS);
  }

  const seenBids = new Set();
  const unique = [];
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
  const { limit } = parseArgs();
  const outPath = path.join(__dirname, 'kouga_tenders.csv');
  console.log('Kouga municipal scraper (pages 1-2)');
  console.log('Output:', outPath);
  const { rows, message } = await runScraper({ limit });
  console.log(message);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Scrape failed:', err.message);
    process.exit(1);
  });
}

module.exports = { runScraper, scrapeTendersPage };
