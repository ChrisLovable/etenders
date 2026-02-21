/**
 * Sarah Baartman District Municipality tender scraper
 * Scrapes tenders from sarahbaartman.co.za (Open Tenders, Quotations)
 * Structure: OPENING DATE | TENDER | CLOSING DATE
 * Output: Same CSV format as other municipal scrapers (Source: Sarah Baartman)
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://www.sarahbaartman.co.za';
const TENDERS_URL = `${BASE_URL}/index.php?option=com_content&view=article&id=136&Itemid=1987`;
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

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatDateSA(text) {
  if (!text) return '';
  const match = String(text).match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (match) {
    const [, day, monthName, year] = match;
    const mi = MONTHS.findIndex(m => m.toLowerCase().startsWith(String(monthName).toLowerCase()));
    const month = mi >= 0 ? String(mi + 1).padStart(2, '0') : '01';
    return `${String(day).padStart(2, '0')}/${month}/${year}`;
  }
  const slashMatch = String(text).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (slashMatch) return slashMatch[0];
  return '';
}

function extractBidNumber(text) {
  const m = String(text || '').match(/(?:BID\s+NO\.?\s*|Bid\s+(?:No\.?|nr)\s*|Quote\s+)(\d+\/\d{4})/i);
  if (m) return m[1];
  const m2 = String(text || '').match(/(?:Intention to Award\s+)?Bid\s+(\d+)\/\d{4}/i);
  if (m2) return `${m2[1]}/${text.match(/\d{4}/)?.[0] || '2025'}`;
  const m3 = String(text || '').match(/Quote\s+(\d+)\/\d{4}/i);
  if (m3) return `Q${m3[1]}/${text.match(/\d{4}/)?.[0] || '2025'}`;
  return '';
}

/**
 * Parse tender listing page - Open Tenders and Quotations sections
 */
async function scrapeTendersPage(url) {
  const entries = [];
  try {
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 20000
    });
    const $ = cheerio.load(html);
    const text = $('body').text();

    // Open Tenders: pattern is date, tender text, date (closing)
    const bidPattern = /(?:BID\s+NO\.?\s*\d+\/\d{4}|Intention to Award\s+Bid\s+\d+\/\d{4}|Bid\s+No\.?\s*\d+\/\d{4})[^]+?/gi;
    const datePattern = /\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/g;

    const openTendersSection = text.indexOf('Open Tenders') >= 0 ? text.slice(text.indexOf('Open Tenders'), text.indexOf('Closed Tenders') > 0 ? text.indexOf('Closed Tenders') : text.length) : text;
    const bidBlocks = openTendersSection.match(/(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\s*\n\s*((?:BID\s+NO\.?|Intention to Award\s+Bid|Bid\s+No\.?)\s*\d+\/\d{4}[^\n]+)\s*\n\s*(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/gi);
    if (bidBlocks) {
      for (const block of bidBlocks) {
        const m = block.match(/(\d{1,2}\s+\w+\s+\d{4})\s*\n\s*((?:BID\s+NO\.?|Intention to Award\s+Bid|Bid\s+No\.?)\s*(\d+\/\d{4})[^\n]+)\s*\n\s*(\d{1,2}\s+\w+\s+\d{4})/i);
        if (m) {
          const [, openRaw, fullDesc, tenderNum, closeRaw] = m;
          const desc = fullDesc.replace(/\s+/g, ' ').trim();
          entries.push({
            tenderNumber: `BID ${tenderNum}`,
            description: desc,
            openingDate: formatDateSA(openRaw),
            closingDate: formatDateSA(closeRaw),
            sourceUrl: TENDERS_URL
          });
        }
      }
    }
    if (entries.length === 0) {
      const altMatches = openTendersSection.matchAll(/(?:BID\s+NO\.?|Intention to Award\s+Bid|Bid\s+No\.?)\s*(\d+\/\d{4})[:\s]+([^\n]+?)(?=\n|$)/gi);
      const allDates = openTendersSection.match(/\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/g) || [];
      let dateIdx = 0;
      for (const m of altMatches) {
        const [, num, desc] = m;
        const openingDate = allDates[dateIdx] ? formatDateSA(allDates[dateIdx]) : '';
        const closingDate = allDates[dateIdx + 1] ? formatDateSA(allDates[dateIdx + 1]) : '';
        dateIdx += 2;
        entries.push({
          tenderNumber: `BID ${num}`,
          description: desc.replace(/\s+/g, ' ').trim(),
          openingDate,
          closingDate,
          sourceUrl: TENDERS_URL
        });
      }
    }

    // Quotations section
    const quoteSection = text.indexOf('Quotations') >= 0 ? text.slice(text.indexOf('Quotations')) : '';
    const quoteMatches = quoteSection.matchAll(/Quote\s+(\d+)\/(\d{4}):\s*([^\n]+?)\s*Closing\s+Date\s*[-–]\s*(\d{1,2}\s+\w+\s+\d{4})/gi);
    for (const m of quoteMatches) {
      const [, num, year, desc, closeRaw] = m;
      entries.push({
        tenderNumber: `Quote ${num}/${year}`,
        description: desc.replace(/\s+/g, ' ').trim(),
        openingDate: '',
        closingDate: formatDateSA(closeRaw),
        sourceUrl: TENDERS_URL
      });
    }

    // Table fallback: Opening Date | Tender | Closing Date with View links
    const viewLinks = [];
    $('a[href*="option=com_zoo"][href*="task=item"][href*="item_id="]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('Itemid=1987')) {
        viewLinks.push((href.startsWith('http') ? href : BASE_URL + href).replace(/&amp;/g, '&'));
      }
    });

    if (entries.length === 0 && viewLinks.length > 0) {
      const tableRows = $('table tr').filter((_, tr) => $(tr).find('a[href*="item_id="]').length > 0);
      tableRows.each((i, tr) => {
        const link = $(tr).find('a[href*="item_id="]').attr('href');
        const linkUrl = link ? (link.startsWith('http') ? link : BASE_URL + link).replace(/&amp;/g, '&') : TENDERS_URL;
        if (viewLinks[i]) {
          entries.push({
            tenderNumber: `SBDM-${i + 1}`,
            description: `Sarah Baartman tender - see document`,
            openingDate: '',
            closingDate: '',
            sourceUrl: viewLinks[i]
          });
        }
      });
    }

    if (entries.length === 0) {
      const bidNums = text.match(/(?:BID\s+NO\.?\s*|Bid\s+(?:No\.?|nr)\s*)(\d+\/\d{4})/gi) || [];
      const quoteNums = text.match(/Quote\s+(\d+\/\d{4})/gi) || [];
      const seen = new Set();
      for (const b of [...bidNums, ...quoteNums]) {
        const key = b.replace(/\s+/g, ' ').trim();
        if (seen.has(key)) continue;
        seen.add(key);
        const idx = text.indexOf(b);
        const chunk = text.slice(idx, idx + 500);
        const descMatch = chunk.match(new RegExp(b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s:]+([^\\n]+)', 'i'));
        const dateMatch = chunk.match(/(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/g);
        entries.push({
          tenderNumber: key.replace(/\s+/g, ' '),
          description: descMatch ? descMatch[1].replace(/\s+/g, ' ').trim().substring(0, 300) : '',
          openingDate: dateMatch && dateMatch[0] ? formatDateSA(dateMatch[0]) : '',
          closingDate: dateMatch && dateMatch[1] ? formatDateSA(dateMatch[1]) : (dateMatch && dateMatch[0] ? formatDateSA(dateMatch[0]) : ''),
          sourceUrl: TENDERS_URL
        });
      }
    }
  } catch (err) {
    console.warn(`Failed to fetch ${url}:`, err.message);
  }
  return entries;
}

function toCsvRow(row) {
  const desc = (row.description || '').trim();
  const finalDesc = desc.length > 10 ? desc : `Sarah Baartman tender ${row.tenderNumber || ''} - see document for details`;
  const truncated = finalDesc.length > 500 ? finalDesc.substring(0, 497) + '...' : finalDesc;

  return {
    'Category': 'Municipal',
    'Tender Number': row.tenderNumber || '',
    'Tender Description': truncated,
    'Advertised': row.openingDate || '',
    'Closing': row.closingDate || '',
    'Organ Of State': 'Sarah Baartman District Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'Grahamstown, Port Alfred, Kenton-on-Sea',
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
    'Source': 'Sarah Baartman'
  };
}

async function runScraper(opts = {}) {
  const { limit = null, outDir = __dirname, csvFilename = 'sarahbaartman_tenders.csv' } = opts;
  const outPath = path.join(outDir, csvFilename);

  console.log('\n🔍 SCRAPING SARAH BAARTMAN DISTRICT MUNICIPALITY TENDERS');
  console.log('=========================================================');

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
  const outPath = path.join(__dirname, 'sarahbaartman_tenders.csv');
  console.log('Sarah Baartman municipal scraper');
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
