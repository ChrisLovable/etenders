/**
 * Cederberg Municipality tender/quotation scraper
 * Parses .document__item blocks from tenders-quotations-available page
 * Source: http://cederbergmun.gov.za/tenders-quotations-available-0
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');
const https = require('https');

const BASE_URL = 'http://cederbergmun.gov.za';
const TENDERS_URL = 'http://cederbergmun.gov.za/tenders-quotations-available-0';

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
  if (h.startsWith('//')) return `http:${h}`;
  if (h.startsWith('/')) return `${BASE_URL}${h}`;
  return `${BASE_URL}/${h.replace(/^\/+/, '')}`;
}

function extractTenderNumber(h4Text) {
  // RFQ77/2025-2026, CED 17/2025-2026, Q72/2025-2026, CED13/2025 - 2026
  const colonMatch = h4Text.match(/^([A-Z]+\s*\d+[\/\d\s-]*\d{4})\s*[:–-]/i);
  if (colonMatch) return normalizeWhitespace(colonMatch[1]);
  const noticeMatch = h4Text.match(/NOTICE\s*NO:?\s*([\d\/]+)/i);
  if (noticeMatch) return `NOTICE NO: ${noticeMatch[1].trim()}`;
  return h4Text.slice(0, 50);
}

function parseDocumentItems($) {
  const rows = [];
  $('.document__item').each((_, el) => {
    const $item = $(el);
    const h4Text = normalizeWhitespace($item.find('h4').first().text());
    if (!h4Text || !/(RFQ|CED|Q\d|NOTICE|tender|quotation)/i.test(h4Text)) return;

    const tenderNumber = extractTenderNumber(h4Text);

    // Extract title/description (full h4 or part after colon)
    const colonIdx = h4Text.indexOf(':');
    let description = colonIdx >= 0 ? h4Text.slice(colonIdx + 1).replace(/^[\s–-]+/, '').trim() : h4Text;
    description = description.replace(/_+|\d+\/\d{4}\s*_+/g, ' ').replace(/\s+/g, ' ').trim();

    // Date opened and Closing Date from .item__info
    let advertised = '';
    let closing = '';
    $item.find('.item__info p').each((_, p) => {
      const txt = $(p).text();
      const openedMatch = txt.match(/Date\s*opened\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
      const closingMatch = txt.match(/Closing\s*Date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
      if (openedMatch) advertised = parseDate(openedMatch[1]);
      if (closingMatch) closing = parseDate(closingMatch[1]);
    });

    // Description paragraph (first p after item__info, not inside it)
    const descP = $item.find('p').filter((_, p) => !$(p).closest('.item__info').length).first();
    const descText = normalizeWhitespace(descP.text());
    const fullDescription = descText.length > 10 ? descText : description;

    // Use listing page as Source URL so "View source details" opens the tenders page (download_tender
    // links can fail when opened from HTTPS apps due to mixed content / cross-origin)
    const sourceUrl = TENDERS_URL;

    rows.push({
      tenderNumber,
      description: (fullDescription || description).slice(0, 500),
      advertised,
      closing,
      sourceUrl
    });
  });
  return rows;
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir ?? __dirname;
  const csvFilename = opts.csvFilename ?? 'cederberg_tenders.csv';
  const outPath = path.join(outDir, csvFilename);

  const { data: html } = await axios.get(TENDERS_URL, {
    timeout: 25000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    httpsAgent: new https.Agent({ rejectUnauthorized: false })
  });

  const $ = cheerio.load(html);
  const rows = parseDocumentItems($);

  const csvRows = rows.map(r => ({
    'Category': 'Municipal',
    'Tender Number': r.tenderNumber,
    'Tender Description': (r.description || 'Cederberg tender (see document)').slice(0, 500),
    'Advertised': r.advertised,
    'Closing': r.closing,
    'Organ Of State': 'Cederberg Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Western Cape',
    'Place where goods, works or services are required': 'Cederberg',
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
    'Source URL': r.sourceUrl,
    'Tender ID': '',
    'Source': 'Cederberg'
  }));

  const csvWriter = createCsvWriter({ path: outPath, header: CSV_HEADER });
  await csvWriter.writeRecords(csvRows);
  return { rows: csvRows.length, data: csvRows, message: `Wrote ${csvRows.length} rows to ${csvFilename}` };
}

if (require.main === module) {
  runScraper().then(r => console.log(r.message)).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { runScraper };
