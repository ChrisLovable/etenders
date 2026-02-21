/**
 * Amathole District Municipality tender scraper
 * Scrapes tenders from amathole.co.za/index.php/procurement/current-tenders
 * Table: Title | Author (contact) | Hits
 * Output: Same CSV format as other municipal scrapers (Source: Amathole)
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://amathole.co.za';
const TENDERS_URL = `${BASE_URL}/index.php/procurement/current-tenders`;
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

function extractContactInfo(authorText) {
  const phoneMatch = authorText.match(/(?:Tel\.?\s*No\.?:?\s*|contact\s*no\.?\s*|on\s+)?(\d{3}\s*\d{3}\s*\d{4}|\d{2,3}\s*\d{3}\s*\d{4})/i);
  const emailMatch = authorText.match(/Email:\s*([^\s,]+@[^\s,]+)/i) || authorText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  return {
    contactPerson: authorText.split(/on\s+Tel|contact\s+no|Email:/i)[0].trim().replace(/\s*,\s*$/, '') || authorText.trim().substring(0, 100),
    telephone: phoneMatch ? phoneMatch[1].replace(/\s/g, ' ').trim() : '',
    email: emailMatch ? emailMatch[1].trim() : ''
  };
}

/**
 * Parse current tenders listing page
 */
async function scrapeTendersPage(url) {
  const entries = [];
  try {
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 20000
    });
    const $ = cheerio.load(html);

    $('table tbody tr, table tr').each((_, tr) => {
      const link = $(tr).find('a[href*="/procurement/current-tenders/"][href*="-"]').first();
      const href = link.attr('href') || '';
      const tenderIdMatch = href.match(/\/(\d+)-[^/]+$/);
      if (!tenderIdMatch) return;

      const title = link.text().trim();
      if (!title || title.length < 5) return;

      const cells = $(tr).find('td');
      let authorText = '';
      for (let i = 0; i < cells.length; i++) {
        const t = $(cells[i]).text().trim();
        if (t && !/^\d+$/.test(t) && (t.includes('@') || t.includes('Tel') || t.includes('contact') || /(?:Mr|Ms|Mrs|Dr)\s+\w/i.test(t))) {
          authorText = t;
          break;
        }
      }
      const { contactPerson, telephone, email } = extractContactInfo(authorText);

      const sourceUrl = href && (href.startsWith('http') || href.startsWith('//')) ? href : (href ? BASE_URL + (href.startsWith('/') ? '' : '/') + href : TENDERS_URL);

      entries.push({
        tenderNumber: `ADM-${tenderIdMatch[1]}`,
        description: title,
        openingDate: '',
        closingDate: '',
        sourceUrl,
        contactPerson,
        telephone,
        email
      });
    });

    if (entries.length === 0) {
      $('a[href*="/procurement/current-tenders/"]').each((_, a) => {
        const link = $(a);
        const href = link.attr('href') || '';
        const title = link.text().trim();
        if (!title || !href.match(/\/(\d+)-/)) return;
        const tenderIdMatch = href.match(/\/(\d+)-[^/]+$/);
        if (!tenderIdMatch) return;
        entries.push({
          tenderNumber: `ADM-${tenderIdMatch[1]}`,
          description: title,
          openingDate: '',
          closingDate: '',
          sourceUrl: href.startsWith('http') ? href : BASE_URL + (href.startsWith('/') ? '' : '/') + href,
          contactPerson: '',
          telephone: '',
          email: ''
        });
      });
    }
  } catch (err) {
    console.warn(`Failed to fetch ${url}:`, err.message);
  }
  return entries;
}

function toCsvRow(row) {
  const desc = (row.description || '').trim();
  const finalDesc = desc.length > 10 ? desc : `Amathole tender ${row.tenderNumber || ''} - see document for details`;
  const truncated = finalDesc.length > 500 ? finalDesc.substring(0, 497) + '...' : finalDesc;

  return {
    'Category': 'Municipal',
    'Tender Number': row.tenderNumber || '',
    'Tender Description': truncated,
    'Advertised': row.openingDate || '',
    'Closing': row.closingDate || '',
    'Organ Of State': 'Amathole District Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'East London, King William\'s Town, Mdantsane',
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
    'Source': 'Amathole'
  };
}

async function runScraper(opts = {}) {
  const { limit = null, outDir = __dirname, csvFilename = 'amathole_tenders.csv' } = opts;
  const outPath = path.join(outDir, csvFilename);

  console.log('\n🔍 SCRAPING AMATHOLE DISTRICT MUNICIPALITY TENDERS');
  console.log('==================================================');

  const allEntries = await scrapeTendersPage(TENDERS_URL);
  const seenBids = new Set();
  const unique = [];
  for (const e of allEntries) {
    const key = (e.tenderNumber || e.description || '').trim();
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
  const outPath = path.join(__dirname, 'amathole_tenders.csv');
  console.log('Amathole municipal scraper');
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
