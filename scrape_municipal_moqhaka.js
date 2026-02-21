/**
 * Moqhaka Local Municipality tender scraper
 * Scrapes tenders from moqhaka.gov.za/open-tenders/
 * Table: Description | SCM Contact Person | User Department Contacts
 * Output: moqhaka_tenders.csv (Source: Moqhaka)
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://moqhaka.gov.za';
const TENDERS_URL = `${BASE_URL}/open-tenders/`;

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
  const m = String(text).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return m[0];
  const dayMonthMatch = text.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (dayMonthMatch) {
    const [, day, monthName, year] = dayMonthMatch;
    const mi = MONTHS.findIndex(m => m.toLowerCase().startsWith(String(monthName).toLowerCase().substring(0, 3)));
    const month = mi >= 0 ? String(mi + 1).padStart(2, '0') : '01';
    return `${String(day).padStart(2, '0')}/${month}/${year}`;
  }
  return text.replace(/\s+@\s+[\d:]+$/, '').trim();
}

async function scrapeOpenTendersPage() {
  const entries = [];
  try {
    const { data: html } = await axios.get(TENDERS_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15000
    });
    const $ = cheerio.load(html);

    $('table').each((ti, tbl) => {
      const headers = $(tbl).find('tr').first().find('td, th').map((_, c) => $(c).text().trim().toLowerCase()).get();
      if (!headers.some(h => (h && (h.includes('description') || h.includes('scm') || h.includes('contact'))))) return;

      $(tbl).find('tr').slice(1).each((ri, row) => {
        const cells = $(row).find('td');
        if (cells.length < 2) return;
        const descCell = $(cells[0]);
        const descText = descCell.text().trim();
        const link = descCell.find('a[href*=".pdf"], a[href*="uploads"]').attr('href');

        const tenderNoMatch = descText.match(/Tender\s+No:\s*([\d\/\-]+)/i);
        const tenderNo = tenderNoMatch ? tenderNoMatch[1].trim() : '';

        const descMatch = descText.match(/Description:\s*([^.]+(?:\.[^T]*)?)(?=Tender\s+Document\s+Amount|$)/i) ||
                         descText.match(/Description:\s*(.+?)(?=Tender\s+Document|Preferential|CIDB|$)/is);
        const description = descMatch ? descMatch[1].trim().replace(/\s+/g, ' ').substring(0, 350) : descText.substring(0, 200);

        const closeMatch = descText.match(/Closing\s+Date:\s*([^.@]+?)(?=@|Venue|$)/i);
        const closingDate = formatDate(closeMatch ? closeMatch[1].trim() : '');

        const scmCell = $(cells[1]).text();
        const emailMatch = scmCell.match(/([a-zA-Z0-9._%+-]+@moqhaka\.gov\.za)/i) || scmCell.match(/([a-zA-Z0-9._%+-]+@[^\s]+)/);
        const telMatch = scmCell.match(/Tel:\s*(\d{3}\s+\d{3}\s+\d{4})/i);
        const contactMatch = scmCell.match(/(?:Mr|Ms|Mrs)\.?\s+[A-Z][^\n]+?(?=Tel:|$)/i);

        let sourceUrl = BASE_URL + '/open-tenders/';
        if (link) {
          sourceUrl = link.startsWith('http') ? link : BASE_URL + link.replace(/^\//, '');
        }

        if (!tenderNo && description.length < 10) return;

        entries.push({
          tenderNumber: tenderNo || `MOQ-${ti}-${ri}`,
          description: description || `Moqhaka tender - see document`,
          closingDate,
          contactPerson: contactMatch ? contactMatch[0].trim() : '',
          email: emailMatch ? emailMatch[1] : '',
          telephone: telMatch ? telMatch[1] : '',
          sourceUrl
        });
      });
    });
  } catch (err) {
    console.warn('Failed to fetch open tenders page:', err.message);
  }
  return entries;
}

function toCsvRow(row) {
  const desc = (row.description || '').trim();
  const finalDesc = desc.length > 10 ? desc : `Moqhaka tender ${row.tenderNumber || ''} - see document for details`;
  const truncated = finalDesc.length > 500 ? finalDesc.substring(0, 497) + '...' : finalDesc;

  return {
    'Category': 'Municipal',
    'Tender Number': row.tenderNumber || '',
    'Tender Description': truncated,
    'Advertised': '',
    'Closing': row.closingDate || '',
    'Organ Of State': 'Moqhaka Local Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Free State',
    'Place where goods, works or services are required': 'Kroonstad, Steynsrus, Viljoenskroon',
    'Special Conditions': '',
    'Contact Person': row.contactPerson || '',
    'Email': row.email || '',
    'Telephone number': row.telephone || '',
    'FAX Number': '',
    'Is there a briefing session?': '',
    'Is it compulsory?': '',
    'Briefing Date and Time': '',
    'Briefing Venue': '',
    'eSubmission': '',
    'Two Envelope Submission': '',
    'Source URL': row.sourceUrl || '',
    'Tender ID': '',
    'Source': 'Moqhaka'
  };
}

async function runScraper(opts = {}) {
  const { limit = null, outDir = __dirname, csvFilename = 'moqhaka_tenders.csv' } = opts;
  const outPath = path.join(outDir, csvFilename);

  console.log('\n🔍 SCRAPING MOQHAKA LOCAL MUNICIPALITY TENDERS');
  console.log('==============================================');

  const entries = await scrapeOpenTendersPage();
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
    } else if (!key && e.description.length > 20) {
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
  console.log('Moqhaka municipal scraper');
  const { rows, message } = await runScraper({ limit });
  console.log(message);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Scrape failed:', err.message);
    process.exit(1);
  });
}

module.exports = { runScraper, scrapeOpenTendersPage };
