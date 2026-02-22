/**
 * Senqu Local Municipality tender scraper
 * Parses formal tenders page (HTML table layout)
 * Source: https://senqu.gov.za/formal-tenders-2025-2026/
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://senqu.gov.za';
const TENDERS_URL = `${BASE_URL}/formal-tenders-2025-2026/`;

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

function parseAdvertisedDate(text) {
  const m = String(text || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return '';
  const [, d, mm, y] = m;
  return `${String(d).padStart(2, '0')}/${String(mm).padStart(2, '0')}/${y}`;
}

function parseClosingDate(text) {
  const m = String(text || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return '';
  const [, d, mm, y] = m;
  return `${String(d).padStart(2, '0')}/${String(mm).padStart(2, '0')}/${y}`;
}

function extractTenderNumber(linkTexts, hrefs) {
  const combined = [...linkTexts, ...hrefs].join(' ');
  const patterns = [
    /(?:Tender|Bid[- ]?(?:No\.?|Document)?)\s*[-]?\s*(\d+[\w\-_]*(?:\d{4}[\w\-_]*)+)/i,
    /(\d+[-_]\d{4}[-_]\d{4}[-_]?T?)(?:\.pdf|\b)/i,
    /(?:Advert|Bid)\s*[-]?\s*(\d+[\w\-_]*(?:\d{4}[\w\-_]*)+)/i
  ];
  for (const p of patterns) {
    const m = combined.match(p);
    if (m && m[1]) {
      const t = normalizeWhitespace(m[1]).replace(/\.$/, '');
      if (t.length >= 2 && t.length < 40) return t;
    }
  }
  return '';
}

function pickTenderUrl($, links) {
  const arr = links.toArray();
  for (const a of arr) {
    const href = $(a).attr('href') || '';
    const text = $(a).text() || '';
    if (/\.pdf$/i.test(href) && !/erratum|faq|notice|notice-93/i.test(href) && !/erratum|faq|notice/i.test(text)) {
      if (/\b(?:tender|bid[- ]?(?:document|no\.?))/i.test(text) || /tender|bid|bid-document/i.test(href)) {
        return href.startsWith('http') ? href : `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;
      }
    }
  }
  for (const a of arr) {
    const href = $(a).attr('href') || '';
    if (/\.pdf$/i.test(href) && !/erratum|faq|notice-93/i.test(href)) {
      return href.startsWith('http') ? href : `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;
    }
  }
  return '';
}

async function scrapeTendersPage() {
  const { data: html } = await axios.get(TENDERS_URL, {
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const $ = cheerio.load(html);
  const rows = [];

  $('.et_pb_row').each((_, el) => {
    const cols = $(el).find('.et_pb_column_1_4');
    if (cols.length < 4) return;
    const pdfLinks = $(el).find('a[href*=".pdf"]');
    if (!pdfLinks.length) return;

    const col1 = $(cols[0]).find('.et_pb_text_inner').text();
    const col2 = $(cols[1]).find('.et_pb_text_inner').text();
    const col3 = $(cols[2]).find('.et_pb_text_inner').text();
    const col4 = $(cols[3]).find('.et_pb_text_inner').text();

    const description = normalizeWhitespace(col2);
    if (!description || description.length < 5) return;
    if (/^(notice|erratum|faq|high-valued|fleet-list|laptop-list|insurance-claims)/i.test(description)) return;

    const advertised = parseAdvertisedDate(col3);
    const closing = parseClosingDate(col4);

    const linkTexts = pdfLinks.map((_, a) => $(a).text()).get();
    const hrefs = pdfLinks.map((_, a) => $(a).attr('href') || '').get();
    const tenderNumber = extractTenderNumber(linkTexts, hrefs);
    const sourceUrl = pickTenderUrl($, pdfLinks) || TENDERS_URL;

    rows.push({
      tenderNumber: tenderNumber || `SENQU-${rows.length + 1}`,
      description: description.slice(0, 500),
      advertised,
      closing,
      sourceUrl
    });
  });

  return rows;
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || 'senqu_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : 500;

  console.log('\n🔍 SCRAPING SENQU LOCAL MUNICIPALITY TENDERS');
  console.log('============================================');

  const entries = await scrapeTendersPage();

  const seen = new Set();
  const unique = [];
  for (const e of entries) {
    const key = `${e.tenderNumber}|${e.description}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(e);
  }

  const sliced = unique.slice(0, limit);
  const csvRows = sliced.map(e => ({
    'Category': 'Municipal',
    'Tender Number': e.tenderNumber || '',
    'Tender Description': e.description || 'Senqu tender',
    'Advertised': e.advertised || '',
    'Closing': e.closing || '',
    'Organ Of State': 'Senqu Local Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'Lady Grey, Barkly East, Sterkspruit',
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
    'Source': 'Senqu'
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
