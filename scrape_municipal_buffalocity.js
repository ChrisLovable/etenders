/**
 * Buffalo City Metropolitan Municipality tender scraper
 * Scrapes tenders from vendorportal.buffalocity.gov.za/Supplier/Tenders
 * Table: Tender Number | Name | Description | Attendance Register | Open Date | Close Date | Status
 * Output: Same CSV format as other municipal scrapers (Source: Buffalo City)
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://vendorportal.buffalocity.gov.za';
const TENDERS_URL = `${BASE_URL}/Supplier/Tenders`;
const DELAY_MS = 1000;

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

function formatCloseDate(text) {
  if (!text) return '';
  const m = String(text).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, d, mo, y] = m;
    return `${d.padStart(2, '0')}/${mo.padStart(2, '0')}/${y}`;
  }
  return '';
}

function formatOpenDate(text) {
  return formatCloseDate(text);
}

/**
 * Parse tender listing page - table: Tender Number | Name | Description | Attendance Register | Open Date | Close Date | Status
 */
async function scrapeTendersPage(url) {
  const entries = [];
  try {
    const { data: html } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-ZA,en;q=0.9'
      },
      timeout: 20000,
      maxRedirects: 5
    });
    const $ = cheerio.load(html);

    $('table tbody tr, table tr').each((_, tr) => {
      const cells = $(tr).find('td');
      if (cells.length < 5) return;

      const tenderNumber = $(cells[0]).text().trim();
      if (tenderNumber.toLowerCase() === 'tender number' || tenderNumber.toLowerCase() === 'tender no') return;
      const name = $(cells[1]).text().trim();
      const description = $(cells[2]).text().trim();
      const openDateRaw = cells.length >= 5 ? $(cells[4]).text().trim() : '';
      const closeDateRaw = cells.length >= 6 ? $(cells[5]).text().trim() : '';

      if (!tenderNumber || !/RFQ|RFP|TENDER|BID|\d{4}-\d{2}\/\d+/i.test(tenderNumber)) return;

      const openDate = formatOpenDate(openDateRaw);
      const closeDate = formatCloseDate(closeDateRaw);

      const link = $(cells[0]).find('a').attr('href');
      const sourceUrl = (link && link.startsWith('http') && !link.includes('javascript')) ? link : TENDERS_URL;

      const desc = description || name;
      entries.push({
        tenderNumber,
        name,
        description: desc,
        openDate,
        closeDate,
        sourceUrl
      });
    });

    if (entries.length === 0) {
      const text = $('body').text();
      const rfqMatches = text.match(/RFQ\/[A-Z]+\/\d{4}-\d{2}\/\d+/gi) || [];
      const seen = new Set();
      for (const rfq of rfqMatches) {
        if (seen.has(rfq)) continue;
        seen.add(rfq);
        const idx = text.indexOf(rfq);
        const chunk = text.slice(Math.max(0, idx - 50), idx + 600);
        const dateMatch = chunk.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s+\d{1,2}:\d{2}\s*(?:AM|PM)/i) || chunk.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        const closeDate = dateMatch ? formatCloseDate(dateMatch[1]) : '';
        const openMatch = chunk.match(/(\d{1,2}\/\d{1,2}\/\d{4})/g);
        const openDate = openMatch && openMatch.length >= 1 ? formatOpenDate(openMatch[0]) : '';
        const descMatch = chunk.match(new RegExp(rfq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?([A-Z][^.]+)', 'i'));
        const description = descMatch ? descMatch[1].replace(/\s+/g, ' ').trim().substring(0, 300) : '';
        entries.push({
          tenderNumber: rfq,
          name: '',
          description: description || `Buffalo City tender ${rfq}`,
          openDate,
          closeDate,
          sourceUrl: url
        });
      }
    }
  } catch (err) {
    console.warn(`Failed to fetch ${url}:`, err.message);
  }
  return entries;
}

function toCsvRow(row) {
  const desc = (row.description || row.name || '').trim();
  const finalDesc = desc.length > 10 ? desc : `Buffalo City tender ${row.tenderNumber || ''} - see document for details`;
  const truncated = finalDesc.length > 500 ? finalDesc.substring(0, 497) + '...' : finalDesc;

  return {
    'Category': 'Municipal',
    'Tender Number': row.tenderNumber || '',
    'Tender Description': truncated,
    'Advertised': row.openDate || '',
    'Closing': row.closeDate || '',
    'Organ Of State': 'Buffalo City Metropolitan Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'East London, Mdantsane, King William\'s Town',
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
    'Source': 'Buffalo City'
  };
}

async function runScraper(opts = {}) {
  const { limit = null, outDir = __dirname, csvFilename = 'buffalocity_tenders.csv' } = opts;
  const outPath = path.join(outDir, csvFilename);

  console.log('\n🔍 SCRAPING BUFFALO CITY METROPOLITAN MUNICIPALITY TENDERS');
  console.log('================================================================');

  const allEntries = await scrapeTendersPage(TENDERS_URL);
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
  const outPath = path.join(__dirname, 'buffalocity_tenders.csv');
  console.log('Buffalo City municipal scraper');
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
