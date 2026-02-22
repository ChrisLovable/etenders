/**
 * Umzimvubu Local Municipality tender scraper
 * Scrapes RFQ/Adverts page (PDF links) and parses PDFs for tender details
 * Source: https://umzimvubu.gov.za/rfq-adverts/
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://umzimvubu.gov.za';
const TENDERS_URL = `${BASE_URL}/rfq-adverts/`;
const REQUEST_DELAY_MS = 500;

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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function toAbsUrl(href) {
  const h = String(href || '').trim();
  if (!h) return '';
  if (/^https?:\/\//i.test(h)) return h;
  if (h.startsWith('//')) return `https:${h}`;
  if (h.startsWith('/')) return `https://www.umzimvubu.gov.za${h}`;
  return `https://www.umzimvubu.gov.za/${h.replace(/^\/+/, '')}`;
}

function formatDateFromText(value) {
  const t = normalizeWhitespace(value);
  const monthMap = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };
  const dmy = t.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
  if (dmy) {
    const month = monthMap[dmy[2].slice(0, 3).toLowerCase()] || '01';
    return `${String(dmy[1]).padStart(2, '0')}/${month}/${dmy[3]}`;
  }
  const slash = t.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (slash) return slash[0];
  return '';
}

function extractFromPdfText(text) {
  const t = normalizeWhitespace(text);
  const get = (re) => {
    const m = t.match(re);
    return m && m[1] ? normalizeWhitespace(m[1]) : '';
  };

  const tenderNumber = get(/(?:BID\s+NO|RFQ\s+NO|TENDER\s+NUMBER)\s*[:\-]?\s*([A-Z0-9\/\-_.]+)/i) ||
    get(/\b(UMZ\/[\d\-]+\/[A-Z]+\/RFQ\/\d+)\b/i) ||
    get(/\b(RFQ[-_]?[A-Z0-9\/\-_.]+)\b/i);

  let description = get(/(?:UMZIMVUBU\s+LOCAL\s+MUNICIPALITY\s+)([^:]+?)(?:\s*:\s*UMZ\/|\s*UMZ\/)/i);
  if (!description) {
    description = get(/(?:BID\s+NO|RFQ\s+NO)[^:]*:\s*[A-Z0-9\/\-.]+\s+([A-Z][^A-Z]*(?:\s+[A-Z][^A-Z]*){2,}?)(?=\s+NAME\s+OF\s+BIDDER|\s+CSD\s+NUMBER|\s+TENDER\s+AMOUNT|$)/is);
  }
  description = normalizeWhitespace(description);
  description = description.replace(/Sophia\s+Location[^A-Z]*/gi, '').trim();
  description = description.replace(/Kwa-Bhaca\s+\d+\s+Tel:.*$/i, '').trim();
  description = description.replace(/BID\s+CLOSING\s+DATE\s+[\d\sA-Z]+/gi, '').trim();
  if (/(80\/20|90\/10|preference point system|to be completed by the organ of state|lowest\/\s*highest acceptable tender)/i.test(description)) {
    description = '';
  }
  if (description.length > 400) description = description.slice(0, 397) + '...';

  const closingDate = formatDateFromText(get(/(?:BID\s+CLOSING\s+DATE|not\s+later\s+than[^0-9]*)(\d{1,2}\s+[A-Z]+\s+\d{4}|\d{2}\/\d{2}\/\d{4})/i)) ||
    formatDateFromText(get(/\b(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\b/i));

  return {
    tenderNumber: String(tenderNumber || '').toUpperCase().replace(/\s+/g, ' '),
    description,
    closingDate
  };
}

function extractTenderNumberFromTitle(title) {
  const t = normalizeWhitespace(title).toUpperCase();
  const m = t.match(/\b(UMZ\/[\d\-]+\/[A-Z]+\/RFQ\/\d+)\b/) ||
    t.match(/\b(RFQ[-_][A-Z0-9\-_.]+\.?\d*)\b/) ||
    t.match(/\b(RFQ[-_].+?)(?:\.\d{2,3})?$/);
  return m ? normalizeWhitespace(m[1]).replace(/_/g, '-') : '';
}

function sanitizeTenderNumber(value) {
  const n = normalizeWhitespace(value).replace(/[.,;:]+$/, '').toUpperCase();
  if (!n) return '';
  if (/^(BID|TENDER|RFQ|RFP|NUMBER)$/i.test(n)) return '';
  if (!/\d/.test(n)) return '';
  if (n.length > 50) return '';
  return n;
}

async function parsePdfMetadata(pdfUrl) {
  let pdfParse;
  try {
    pdfParse = require('pdf-parse');
  } catch (_) {
    return {};
  }
  try {
    const response = await axios.get(pdfUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const data = await pdfParse(Buffer.from(response.data));
    const text = String(data?.text || '');
    if (!text || text.length < 40) return {};
    return extractFromPdfText(text);
  } catch (_) {
    return {};
  }
}

async function scrapeListingPage() {
  const { data: html } = await axios.get(TENDERS_URL, {
    timeout: 25000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const $ = cheerio.load(html);
  const urlToTitle = new Map();

  $('a[href*=".pdf"]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (!href || !text) return;
    const url = toAbsUrl(href);
    if (!url) return;
    if (text.toLowerCase() === 'download') return;
    const existing = urlToTitle.get(url);
    if (!existing || text.length > existing.length) {
      urlToTitle.set(url, text);
    }
  });

  return Array.from(urlToTitle.entries()).map(([url, title]) => ({ url, title }));
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || 'umzimvubu_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : 100;

  console.log('\n🔍 SCRAPING UMZIMVUBU LOCAL MUNICIPALITY TENDERS');
  console.log('=================================================');

  const listing = await scrapeListingPage();
  console.log(`Found ${listing.length} PDF links, parsing up to ${limit}...`);

  const withPdf = [];
  for (let i = 0; i < Math.min(listing.length, limit); i++) {
    const { url, title } = listing[i];
    const parsed = await parsePdfMetadata(url);
    const titleTenderNo = extractTenderNumberFromTitle(title);
    const finalTenderNo = sanitizeTenderNumber(parsed.tenderNumber) || sanitizeTenderNumber(titleTenderNo);
    let desc = parsed.description || '';
    if (!desc || /Sophia\s+Location|BID\s+CLOSING\s+DATE|Kwa-Bhaca\s+\d+/.test(desc)) {
      desc = normalizeWhitespace(title.replace(/^RFQ[-_]?/i, '').replace(/\.\d{2,3}$/, ''));
    }
    withPdf.push({
      title,
      sourceUrl: url,
      tenderNumber: finalTenderNo || extractTenderNumberFromTitle(title) || `UMZ-RFQ-${i + 1}`,
      description: desc,
      closingDate: parsed.closingDate || ''
    });
    await sleep(REQUEST_DELAY_MS);
  }

  const csvRows = withPdf.map(r => ({
    'Category': 'Municipal',
    'Tender Number': r.tenderNumber || '',
    'Tender Description': (r.description || r.title || 'Umzimvubu RFQ').slice(0, 500),
    'Advertised': '',
    'Closing': r.closingDate || '',
    'Organ Of State': 'Umzimvubu Local Municipality',
    'Tender Type': 'Request for Quotation',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'KwaBhaca, Mount Frere, Umzimvubu',
    'Special Conditions': '',
    'Contact Person': '',
    'Email': '',
    'Telephone number': '039 255 8500',
    'FAX Number': '',
    'Is there a briefing session?': '',
    'Is it compulsory?': '',
    'Briefing Date and Time': '',
    'Briefing Venue': '',
    'eSubmission': '',
    'Two Envelope Submission': '',
    'Source URL': r.sourceUrl || TENDERS_URL,
    'Tender ID': '',
    'Source': 'Umzimvubu'
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
