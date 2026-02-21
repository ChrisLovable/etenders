/**
 * Winnie Madikizela-Mandela Local Municipality tender scraper
 * Parses tenders page (Open Tenders and Closed Tenders tables)
 * Source: https://winniemmlm.gov.za/tenders/
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://winniemmlm.gov.za';
const TENDERS_URL = `${BASE_URL}/tenders/`;

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

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function parseDate(text) {
  const m = String(text || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return '';
  const [, d, mm, y] = m;
  return `${String(d).padStart(2, '0')}/${String(mm).padStart(2, '0')}/${y}`;
}

function toAbsUrl(href) {
  const h = String(href || '').trim();
  if (!h) return '';
  if (/^https?:\/\//i.test(h)) return h;
  if (h.startsWith('//')) return `https:${h}`;
  if (h.startsWith('/')) return `https://www.winniemmlm.gov.za${h}`;
  return `https://www.winniemmlm.gov.za/${h.replace(/^\/+/, '')}`;
}

async function scrapeTendersPage() {
  const { data: html } = await axios.get(TENDERS_URL, {
    timeout: 25000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const $ = cheerio.load(html);
  const rows = [];
  const seenUrls = new Set();

  $('table').each((_, table) => {
    const headerCells = $(table).find('thead th, tr:first-child td').map((_, el) => $(el).text().trim().toLowerCase()).get();
    const colCount = headerCells.length;
    if (colCount < 2) return;

    $(table).find('tbody tr, tr').slice(1).each((_, tr) => {
      const cells = $(tr).find('td');
      if (cells.length < 2) return;

      const cellTexts = cells.map((_, c) => $(c).text().trim()).get();
      const pdfLink = $(tr).find('a[href*=".pdf"]').first();
      const href = pdfLink.attr('href');
      if (!href || !/\.pdf$/i.test(href)) return;

      const url = toAbsUrl(href);
      if (seenUrls.has(url)) return;
      seenUrls.add(url);

      const linkText = pdfLink.text().trim();
      let description = linkText || cellTexts[1] || cellTexts[0];
      let advertised = '';
      let closing = '';

      if (colCount >= 3) {
        const h0 = headerCells[0] || '';
        const h1 = headerCells[1] || '';
        const h2 = headerCells[2] || '';
        if (/advert|date|dated/i.test(h0) && /description|link/i.test(h1) && /closing|link/i.test(h2)) {
          advertised = parseDate(cellTexts[0]);
          description = linkText || cellTexts[1];
          closing = parseDate(cellTexts[2]) || (cellTexts[2] || '').trim();
        } else if (/advert|date/i.test(h0) && /description/i.test(h1) && /closing/i.test(h2)) {
          advertised = parseDate(cellTexts[0]);
          if (!advertised && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(cellTexts[0])) advertised = cellTexts[0];
          description = linkText || cellTexts[1];
          closing = parseDate(cellTexts[2]) || (cellTexts[2] || '').trim();
        } else {
          advertised = parseDate(cellTexts[0]);
          description = linkText || cellTexts[1] || cellTexts[0];
          closing = parseDate(cellTexts[2]) || parseDate(cellTexts[cellTexts.length - 1]) || '';
        }
      } else {
        description = linkText || cellTexts[0] || cellTexts[1];
        advertised = parseDate(cellTexts[0]) || parseDate(cellTexts[1]);
        closing = parseDate(cellTexts[2]) || parseDate(cellTexts[cellTexts.length - 1]) || '';
      }

      if (/^Various dates$/i.test(closing)) closing = '';
      if (/^AWARDED\s+TENDERS|^CLOSING\s+REGISTER|^AWARDED\s+BIDS/i.test(description)) return;
      if (description.length < 5) return;

      rows.push({
        description: normalizeWhitespace(description).slice(0, 500),
        advertised,
        closing: parseDate(closing) || closing,
        sourceUrl: url
      });
    });
  });

  return rows;
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || 'winniemadikizelamandela_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : 500;

  console.log('\n🔍 SCRAPING WINNIE MADIKIZELA-MANDELA LOCAL MUNICIPALITY TENDERS');
  console.log('=================================================================');

  const entries = await scrapeTendersPage();

  const seen = new Set();
  const unique = [];
  for (const e of entries) {
    const key = `${e.sourceUrl}|${e.description}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(e);
  }

  const sliced = unique.slice(0, limit);
  const csvRows = sliced.map((e, i) => ({
    'Category': 'Municipal',
    'Tender Number': `WMM-${i + 1}`,
    'Tender Description': e.description || 'Winnie Madikizela-Mandela tender',
    'Advertised': e.advertised || '',
    'Closing': e.closing || '',
    'Organ Of State': 'Winnie Madikizela-Mandela Local Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'Bizana, Winnie Madikizela-Mandela',
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
    'Source URL': e.sourceUrl || TENDERS_URL,
    'Tender ID': '',
    'Source': 'Winnie Madikizela-Mandela'
  }));

  const csvWriter = createCsvWriter({ path: outPath, header: CSV_HEADER });
  await csvWriter.writeRecords(csvRows);

  console.log(`\n💾 Wrote ${csvRows.length} rows to ${csvFilename}`);
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
