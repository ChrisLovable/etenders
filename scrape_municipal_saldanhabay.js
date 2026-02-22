/**
 * Saldanha Bay Municipality tender/quotation scraper
 * Parses table pages: Quotations below R30k, above R30k, Tenders R300k+
 * Source: https://sbm.gov.za/
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://sbm.gov.za';
const URLS = [
  'https://sbm.gov.za/quotations-r30000-below/',
  'https://sbm.gov.za/quotations-above-r30000/',
  'https://sbm.gov.za/tenders-r300-000-and-more/'
];

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

function parseTable($, table, seen, rows) {
  const ths = $(table).find('thead th, tr:first-child th').map((_, el) => normalizeWhitespace($(el).text()).toLowerCase()).get();
  const tds = $(table).find('thead td, tr:first-child td').map((_, el) => normalizeWhitespace($(el).text()).toLowerCase()).get();
  const headers = ths.length ? ths : tds;
  const colMap = {};
  headers.forEach((h, i) => {
    if (/(?:quotation|rfq|bid)\s*number|^q\s|tender\s*no/i.test(h)) colMap.num = i;
    else if (/description|title/i.test(h)) colMap.desc = i;
    else if (/closing|date|deadline/i.test(h)) colMap.closing = i;
    else if (/contact\s*person/i.test(h)) colMap.contact = i;
    else if (/contact\s*number|tel|phone/i.test(h)) colMap.phone = i;
  });
  if (colMap.num === undefined && colMap.desc === undefined) return;

  const dataRows = $(table).find('tbody tr, tr').slice(headers.length ? 1 : 0);
  dataRows.each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 2) return;
    const cellTexts = cells.map((_, c) => normalizeWhitespace($(c).text())).get();
    const firstLink = $(tr).find('a[href]').first();
    const href = firstLink.attr('href');
    const linkText = firstLink.text().trim();
    if (!href || !/\.(pdf|doc|docx)($|\?)/i.test(href)) return;

    const url = toAbsUrl(href);
    if (seen.has(url)) return;
    seen.add(url);

    const tenderNumber = linkText || cellTexts[colMap.num ?? 0] || '';
    const description = cellTexts[colMap.desc ?? 1] || linkText || tenderNumber;
    const closing = colMap.closing !== undefined ? parseDate(cellTexts[colMap.closing]) : '';
    const contact = colMap.contact !== undefined ? cellTexts[colMap.contact] : '';
    const phone = colMap.phone !== undefined ? cellTexts[colMap.phone] : '';

    if (!tenderNumber && !description) return;
    rows.push({
      tenderNumber: tenderNumber || description.slice(0, 50),
      description: description.slice(0, 500),
      closing,
      contact,
      phone,
      sourceUrl: url
    });
  });
}

function parseCardStyle($, pageUrl, seen, rows) {
  $('a[href*=".pdf"], a[href*=".doc"]').each((_, a) => {
    const href = $(a).attr('href');
    if (!href || !/\.(pdf|doc|docx)($|\?)/i.test(href)) return;
    const url = toAbsUrl(href);
    if (seen.has(url)) return;
    const linkText = normalizeWhitespace($(a).text());
    if (!/^(RFQ|Q|BID|TENDER|SCM)\d/i.test(linkText) && !/\d{2,4}\/\d{2,4}/.test(linkText)) return;

    const block = $(a).closest('tr, li, div, p, article, section').first();
    const blockText = normalizeWhitespace(block.text());
    const dateMatch = blockText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const closing = dateMatch ? parseDate(dateMatch[0]) : '';
    const descMatch = blockText.replace(linkText, '').replace(closing, '').trim();
    const description = descMatch.length > 10 ? descMatch.slice(0, 500) : linkText;
    const tenderNumber = linkText.match(/^(RFQ|Q|BID|SCM)[\d\/-]+/i)?.[0] || linkText;

    seen.add(url);
    rows.push({
      tenderNumber: tenderNumber || linkText,
      description: description || 'Saldanha Bay quotation (see document)',
      closing,
      contact: '',
      phone: '',
      sourceUrl: url
    });
  });
}

async function scrapeUrl(url, seen, rows) {
  const { data: html } = await axios.get(url, {
    timeout: 25000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const $ = cheerio.load(html);
  const before = rows.length;
  $('table').each((_, table) => parseTable($, table, seen, rows));
  if (rows.length === before) parseCardStyle($, url, seen, rows);
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir ?? __dirname;
  const csvFilename = opts.csvFilename ?? 'saldanhabay_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const seen = new Set();
  const rows = [];

  for (const url of URLS) {
    try {
      await scrapeUrl(url, seen, rows);
    } catch (err) {
      console.warn(`Failed ${url}:`, err.message);
    }
  }

  const dedup = [];
  const seenKey = new Set();
  for (const r of rows) {
    const key = `${r.tenderNumber}|${r.sourceUrl}`;
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    dedup.push(r);
    if (dedup.length >= 200) break;
  }

  const csvRows = dedup.map(r => ({
    'Category': 'Municipal',
    'Tender Number': r.tenderNumber,
    'Tender Description': (r.description || 'Saldanha Bay quotation (see document)').slice(0, 500),
    'Advertised': '',
    'Closing': r.closing,
    'Organ Of State': 'Saldanha Bay Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Western Cape',
    'Place where goods, works or services are required': 'Saldanha Bay',
    'Special Conditions': '',
    'Contact Person': r.contact,
    'Email': '',
    'Telephone number': r.phone,
    'FAX Number': '',
    'Is there a briefing session?': '',
    'Is it compulsory?': '',
    'Briefing Date and Time': '',
    'Briefing Venue': '',
    'eSubmission': '',
    'Two Envelope Submission': '',
    'Source URL': r.sourceUrl,
    'Tender ID': '',
    'Source': 'Saldanha Bay'
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
