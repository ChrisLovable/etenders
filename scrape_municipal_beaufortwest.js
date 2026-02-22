/**
 * Beaufort West Municipality tender/quotation scraper
 * Parses .document__item blocks from tendersquotations-available page
 * Source: https://www.beaufortwestmun.co.za/tendersquotations-available
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');
const https = require('https');

const BASE_URL = 'https://www.beaufortwestmun.co.za';
const TENDERS_URL = 'https://www.beaufortwestmun.co.za/tendersquotations-available';

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
  if (h.startsWith('/')) return `${BASE_URL}${h}`;
  return `${BASE_URL}/${h.replace(/^\/+/, '')}`;
}

function parseDocumentItems($) {
  const rows = [];
  $('.document__item').each((_, el) => {
    const $item = $(el);
    const h4Text = normalizeWhitespace($item.find('h4').first().text());
    if (!h4Text || !/NOTICE\s*NO|SCM/i.test(h4Text)) return;

    // Extract tender number: NOTICE NO: 33/2026: SCM: 39/2026 or SCM 32/2026
    const noticeMatch = h4Text.match(/NOTICE\s*NO:\s*([\d\/]+)/i);
    const scmMatch = h4Text.match(/SCM\s*:?\s*([\d\/]+)/i);
    const tenderNumber = scmMatch ? `SCM ${scmMatch[1].trim()}` : (noticeMatch ? noticeMatch[1] : h4Text.slice(0, 50));

    // Extract title (after the dash)
    const dashIdx = h4Text.indexOf(' - ');
    const description = dashIdx >= 0 ? h4Text.slice(dashIdx + 3) : h4Text;

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

    // Download link
    const downloadLink = $item.find('a.download-document, a[href*="download_tender"]').first();
    const href = downloadLink.attr('href');
    const sourceUrl = href ? toAbsUrl(href) : TENDERS_URL;

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
  const csvFilename = opts.csvFilename ?? 'beaufortwest_tenders.csv';
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
    'Tender Description': (r.description || 'Beaufort West tender (see document)').slice(0, 500),
    'Advertised': r.advertised,
    'Closing': r.closing,
    'Organ Of State': 'Beaufort West Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Western Cape',
    'Place where goods, works or services are required': 'Beaufort West',
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
    'Source': 'Beaufort West'
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
