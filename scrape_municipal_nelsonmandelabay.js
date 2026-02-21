/**
 * Nelson Mandela Bay Metropolitan Municipality tender scraper
 * Scrapes tenders from nelsonmandelabay.gov.za/tenders/
 * Table: SCM No | Tender Description | Tender Fee
 * Output: Same CSV format as other municipal scrapers (Source: Nelson Mandela Bay)
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://www.nelsonmandelabay.gov.za';
const TENDERS_URL = `${BASE_URL}/tenders/`;
const TENDERS_ASPX = `${BASE_URL}/Tenders.aspx`;
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

function extractClosingDate(description) {
  const m = String(description || '').match(/[Cc]losing[:\s]+(\d{1,2}\s+\w+\s+\d{4})/i) ||
    String(description || '').match(/(\d{1,2}\s+\w+\s+\d{4})\s*@?\s*\d{1,2}:\d{2}/);
  return m ? formatDateSA(m[1]) : '';
}

function extractClarificationMeeting(description) {
  const m = String(description || '').match(/(?:Compulsory\s+)?[Cc]larification\s+meeting[:\s]*([^.]+)/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

function extractBriefingTime(text) {
  const m = String(text || '').match(/(\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)?)/i);
  return m ? m[1].trim() : '';
}

/**
 * Parse tender listing page - table or list structure
 */
async function scrapeTendersPage(url) {
  const entries = [];
  try {
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 20000
    });
    const $ = cheerio.load(html);

    // Try table: SCM No | Tender Description | Tender Fee
    $('table tr').each((_, tr) => {
      const cells = $(tr).find('td');
      if (cells.length < 2) return;
      const scmNo = $(cells[0]).text().trim();
      const description = $(cells[1]).text().trim();
      const fee = cells.length >= 3 ? $(cells[2]).text().trim() : '';
      if (!scmNo || !/SCM\/\d+/i.test(scmNo)) return;
      if (scmNo.toLowerCase().includes('scm no')) return;

      const closingDate = extractClosingDate(description);
      const clarification = extractClarificationMeeting(description);
      const briefingTime = extractBriefingTime(clarification);

      entries.push({
        tenderNumber: scmNo,
        description: description.replace(/\s+/g, ' ').trim(),
        closingDate,
        clarification,
        briefingTime,
        tenderFee: fee,
        sourceUrl: url
      });
    });

    // Fallback: look for SCM/ pattern in any structure
    if (entries.length === 0) {
      const text = $('body').text();
      const scmMatches = text.match(/SCM\/[\d\/A-Z-]+\d{4}-\d{4}/g) || [];
      const seen = new Set();
      for (const scm of scmMatches) {
        if (seen.has(scm)) continue;
        seen.add(scm);
        const idx = text.indexOf(scm);
        const chunk = text.slice(idx, idx + 800);
        const descMatch = chunk.match(new RegExp(scm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?([^.]+(?:R\\d+|\\d+\\s+days)[^.]*)', 'i'));
        const description = descMatch ? descMatch[1].replace(/\s+/g, ' ').trim() : '';
        entries.push({
          tenderNumber: scm,
          description: description || `Nelson Mandela Bay tender ${scm}`,
          closingDate: extractClosingDate(chunk),
          clarification: extractClarificationMeeting(chunk),
          briefingTime: '',
          tenderFee: '',
          sourceUrl: url
        });
      }
    }

    // Try links/cards structure
    if (entries.length === 0) {
      $('a[href*="tender"], .tender-item, [class*="tender"]').each((_, el) => {
        const $el = $(el);
        const text = $el.text();
        const scmMatch = text.match(/SCM\/[\d\/A-Z-]+\d{4}-\d{4}/);
        if (scmMatch) {
          const href = $el.attr('href') || $el.find('a').attr('href');
          const fullUrl = href && !href.startsWith('http') ? BASE_URL + (href.startsWith('/') ? '' : '/') + href : (href || url);
          entries.push({
            tenderNumber: scmMatch[0],
            description: text.replace(/\s+/g, ' ').trim().substring(0, 400),
            closingDate: extractClosingDate(text),
            clarification: extractClarificationMeeting(text),
            briefingTime: extractBriefingTime(text),
            tenderFee: '',
            sourceUrl: fullUrl
          });
        }
      });
    }
  } catch (err) {
    console.warn(`Failed to fetch ${url}:`, err.message);
  }
  return entries;
}

function toCsvRow(row) {
  const desc = (row.description || '').trim();
  const finalDesc = desc.length > 10 ? desc : `Nelson Mandela Bay tender ${row.tenderNumber || ''} - see document for details`;
  const truncated = finalDesc.length > 500 ? finalDesc.substring(0, 497) + '...' : finalDesc;

  return {
    'Category': 'Municipal',
    'Tender Number': row.tenderNumber || '',
    'Tender Description': truncated,
    'Advertised': '',
    'Closing': row.closingDate || '',
    'Organ Of State': 'Nelson Mandela Bay Metropolitan Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'Gqeberha, Kariega, Uitenhage',
    'Special Conditions': row.clarification || '',
    'Contact Person': '',
    'Email': '',
    'Telephone number': '041 506 7531',
    'FAX Number': '041 5061969',
    'Is there a briefing session?': row.clarification ? 'Yes' : '',
    'Is it compulsory?': row.clarification && /compulsory/i.test(row.clarification) ? 'Yes' : '',
    'Briefing Date and Time': row.briefingTime || '',
    'Briefing Venue': '',
    'eSubmission': '',
    'Two Envelope Submission': '',
    'Source URL': row.sourceUrl || '',
    'Tender ID': '',
    'Source': 'Nelson Mandela Bay'
  };
}

async function runScraper(opts = {}) {
  const { limit = null, outDir = __dirname, csvFilename = 'nelsonmandelabay_tenders.csv' } = opts;
  const outPath = path.join(outDir, csvFilename);

  console.log('\n🔍 SCRAPING NELSON MANDELA BAY METROPOLITAN MUNICIPALITY TENDERS');
  console.log('==================================================================');

  const urlsToTry = [TENDERS_URL, TENDERS_ASPX, `${BASE_URL}/`];
  const allEntries = [];
  const seenBids = new Set();

  for (const url of urlsToTry) {
    const entries = await scrapeTendersPage(url);
    for (const e of entries) {
      const key = (e.tenderNumber || '').trim();
      if (key && !seenBids.has(key)) {
        seenBids.add(key);
        allEntries.push(e);
      }
    }
    if (allEntries.length > 0) break;
    await sleep(DELAY_MS);
  }

  const toProcess = limit ? allEntries.slice(0, limit) : allEntries;
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
  const outPath = path.join(__dirname, 'nelsonmandelabay_tenders.csv');
  console.log('Nelson Mandela Bay municipal scraper');
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
