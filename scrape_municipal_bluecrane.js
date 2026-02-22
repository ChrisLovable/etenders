/**
 * Blue Crane Route Municipality tender scraper
 * Scrapes SCM Tender/FWQ listings and parses linked PDFs for key fields.
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://www.bcrm.gov.za';
const LISTING_BASE = `${BASE_URL}/index.php/Documents/11`;
const PAGE_SIZE = 10;
const REQUEST_DELAY_MS = 600;

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

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function toAbsUrl(href) {
  const h = String(href || '').trim();
  if (!h) return '';
  if (/^https?:\/\//i.test(h)) return h;
  if (h.startsWith('/')) return `${BASE_URL}${h}`;
  return `${BASE_URL}/${h.replace(/^\/+/, '')}`;
}

function formatDateYYYYMMDDToCsv(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
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

  const tenderNumber = get(/(?:TENDER|BID)\s+NUMBER\s*[:\-]?\s*([A-Z0-9\/\-_]+)/i) ||
    get(/\b(T\d{1,3}\/\d{4})\b/i) ||
    get(/\b(ALM[-\/]SCM\/[A-Z0-9\/\-_]+)\b/i) ||
    get(/\b(FWQ\d{1,3}\/\d{4})\b/i);

  let description = get(/PROJECT\s+NAME\s*[:\-]?\s*(.+?)(?=\s+(?:TENDER|BID)\s+NUMBER\b)/i);
  if (!description) {
    description = get(/(?:BID\s+ADVERT|TENDER)\s*[-:]\s*(.+?)(?=\s+(?:BID|TENDER)\s+NUMBER\b)/i);
  }
  if (!description) {
    description = '';
  }
  description = normalizeWhitespace(description);
  if (/(80\/20|90\/10|preference point system|to be completed by the organ of state|lowest\/\s*highest acceptable tender)/i.test(description)) {
    description = '';
  }
  if (description.length > 260) description = '';

  const closingDate = formatDateFromText(get(/CLOSING\s+DATE\s*[:\-]?\s*([0-9]{1,2}\s+[A-Z]+\s+[0-9]{4}|[0-9]{2}\/[0-9]{2}\/[0-9]{4})/i));
  return {
    tenderNumber: String(tenderNumber || '').toUpperCase(),
    description,
    closingDate
  };
}

function extractTenderNumberFromTitle(title) {
  const t = normalizeWhitespace(title).toUpperCase();
  const patterns = [
    /\bT\d{1,3}\/\d{4}\b/,
    /\bFWQ\d{1,3}\/\d{4}\b/,
    /\bALM[-\/]SCM\/[A-Z0-9\/\-_]{4,}\b/,
    /\bOTP\/STR\/ALM-SCM\/[A-Z0-9\/\-_]{4,}\b/
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) return m[0];
  }
  const proj = t.match(/\bPROJECT\s+NUMBER[_:\s-]*([A-Z0-9\/_-]{3,})\b/i);
  if (proj && proj[1]) return normalizeWhitespace(proj[1]).replace(/_/g, '/').toUpperCase();
  return '';
}

function sanitizeTenderNumber(value) {
  const n = normalizeWhitespace(value).replace(/[.,;:]+$/, '').toUpperCase();
  if (!n) return '';
  if (/^(BID|TENDER|FWQ|RFQ|RFP|NUMBER)$/i.test(n)) return '';
  if (!/\d/.test(n)) return '';
  if (n.length > 40) return '';
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

async function scrapeListingPage(offset = 0) {
  const url = offset > 0 ? `${LISTING_BASE}/${offset}` : LISTING_BASE;
  const { data: html } = await axios.get(url, {
    timeout: 25000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const $ = cheerio.load(html);
  const rows = [];

  $('table tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 4) return;
    const a = $(tr).find('a[href*="downloadFile"]').first();
    const href = a.attr('href');
    if (!href) return;

    const title = normalizeWhitespace(a.text());
    const uploadDateRaw = normalizeWhitespace($(cells[cells.length - 1]).text());
    const uploadDate = formatDateYYYYMMDDToCsv(uploadDateRaw);
    const sourceUrl = toAbsUrl(href);
    const tenderIdMatch = sourceUrl.match(/downloadFile\/(\d+)/i);
    const tenderId = tenderIdMatch ? tenderIdMatch[1] : '';

    rows.push({
      title,
      uploadDate,
      sourceUrl,
      tenderId
    });
  });

  const maxOffsets = [...new Set(
    $('a[href*="/Documents/11/"]').map((_, a) => {
      const href = String($(a).attr('href') || '');
      const m = href.match(/\/Documents\/11\/(\d+)/);
      return m ? Number(m[1]) : 0;
    }).get().filter(n => Number.isFinite(n))
  )];
  const maxOffset = maxOffsets.length ? Math.max(...maxOffsets) : offset;

  return { rows, maxOffset };
}

function toCsvRow(item, index) {
  const fallbackTenderNo = `BCRM-${String(index + 1).padStart(3, '0')}`;
  const tenderNo = item.tenderNumber || fallbackTenderNo;
  const parsedDesc = normalizeWhitespace(item.description || '');
  const useTitle = !parsedDesc || /(80\/20|90\/10|preference point system|to be completed by the organ of state)/i.test(parsedDesc) || parsedDesc.length > 260;
  const desc = normalizeWhitespace((useTitle ? item.title : parsedDesc) || `Blue Crane Route tender ${tenderNo}`);
  return {
    'Category': 'Municipal',
    'Tender Number': tenderNo,
    'Tender Description': desc.length > 500 ? `${desc.slice(0, 497)}...` : desc,
    'Advertised': item.uploadDate || '',
    'Closing': item.closingDate || '',
    'Organ Of State': 'Blue Crane Route Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'Somerset East, Cookhouse, Pearston',
    'Special Conditions': '',
    'Contact Person': '',
    'Email': '',
    'Telephone number': '042 243 6400',
    'FAX Number': '',
    'Is there a briefing session?': '',
    'Is it compulsory?': '',
    'Briefing Date and Time': '',
    'Briefing Venue': '',
    'eSubmission': '',
    'Two Envelope Submission': '',
    'Source URL': item.sourceUrl || LISTING_BASE,
    'Tender ID': item.tenderId || '',
    'Source': 'Blue Crane Route'
  };
}

async function runScraper(opts = {}) {
  const { limit = null, outDir = __dirname, csvFilename = 'bluecrane_tenders.csv' } = opts;
  const outPath = path.join(outDir, csvFilename);

  console.log('\n🔍 SCRAPING BLUE CRANE ROUTE MUNICIPALITY TENDERS');
  console.log('==================================================');

  let offset = 0;
  let maxOffset = 0;
  const collected = [];
  const seenUrls = new Set();

  do {
    let page;
    try {
      page = await scrapeListingPage(offset);
    } catch (err) {
      console.warn(`Failed listing page offset ${offset}: ${err.message}`);
      break;
    }
    maxOffset = Math.max(maxOffset, page.maxOffset || 0);
    for (const row of page.rows) {
      if (!row.sourceUrl || seenUrls.has(row.sourceUrl)) continue;
      seenUrls.add(row.sourceUrl);
      collected.push(row);
      if (limit && collected.length >= limit) break;
    }
    if (limit && collected.length >= limit) break;
    offset += PAGE_SIZE;
    if (offset <= maxOffset) await sleep(REQUEST_DELAY_MS);
  } while (offset <= maxOffset);

  const withPdf = [];
  for (const row of collected) {
    const parsed = await parsePdfMetadata(row.sourceUrl);
    const titleTenderNo = extractTenderNumberFromTitle(row.title);
    const finalTenderNo = sanitizeTenderNumber(parsed.tenderNumber) || sanitizeTenderNumber(titleTenderNo);
    withPdf.push({
      ...row,
      tenderNumber: finalTenderNo || '',
      description: row.title,
      closingDate: parsed.closingDate || ''
    });
    if (limit && withPdf.length >= limit) break;
    await sleep(REQUEST_DELAY_MS);
  }

  const csvRows = withPdf.map((r, idx) => toCsvRow(r, idx));
  const csvWriter = createCsvWriter({ path: outPath, header: CSV_HEADER });
  await csvWriter.writeRecords(csvRows);
  return { rows: csvRows.length, data: csvRows, message: `Wrote ${csvRows.length} rows to ${csvFilename}` };
}

async function main() {
  const { limit } = parseArgs();
  const outPath = path.join(__dirname, 'bluecrane_tenders.csv');
  console.log('Blue Crane Route municipal scraper');
  console.log('Output:', outPath);
  const { message } = await runScraper({ limit });
  console.log(message);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Scrape failed:', err.message);
    process.exit(1);
  });
}

module.exports = { runScraper };

