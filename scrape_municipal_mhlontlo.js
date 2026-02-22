/**
 * Kumkani Mhlontlo Local Municipality tender scraper
 * Scrapes current-tenders page and parses linked PDFs for key fields.
 * Source: https://mhlontlolm.gov.za/current-tenders/
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://mhlontlolm.gov.za';
const TENDERS_URL = `${BASE_URL}/current-tenders/`;
const DELAY_MS = 800;

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
    htmlOnly: args.includes('--html-only'),
    limit: (() => {
      const idx = args.indexOf('--limit');
      return idx >= 0 && args[idx + 1] ? parseInt(args[idx + 1], 10) : null;
    })()
  };
}

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
  if (h.startsWith('/')) return `${BASE_URL}${h}`;
  return `${BASE_URL}/${h.replace(/^\/+/, '')}`;
}

function formatDateFromText(value) {
  const t = normalizeWhitespace(value);
  const monthMap = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };
  const dmy = t.match(/\b(?:Updated\s+)?(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
  if (dmy) {
    const month = monthMap[dmy[2].slice(0, 3).toLowerCase()] || '01';
    return `${String(dmy[1]).padStart(2, '0')}/${month}/${dmy[3]}`;
  }
  const slash = t.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (slash) return slash[0];
  return '';
}

function extractTenderNumberFromTitle(title) {
  const t = normalizeWhitespace(title).toUpperCase();
  const patterns = [
    /\b(?:BID|TENDER)\s*(?:NO\.?|NUMBER)\s*[:\-]?\s*([A-Z0-9\/\-_]+)/i,
    /\b(\d{2}\/\d{4})\b/,
    /\b(\d{2}\s*[-]\s*\d{4})\b/,
    /\b(T\d{1,3}\/\d{4})\b/,
    /\b(FWQ\d{1,3}\/\d{4})\b/,
    /\b(KMLM[-\/][A-Z0-9\/\-_]+)\b/i
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m && m[1]) return normalizeWhitespace(m[1]).replace(/\s+/g, ' ').toUpperCase();
  }
  return '';
}

function extractFromPdfText(text) {
  const t = normalizeWhitespace(text);
  const get = (re) => {
    const m = t.match(re);
    return m && m[1] ? normalizeWhitespace(m[1]) : '';
  };

  let tenderNumber = get(/\b(BID\/[\d\-]+\/[\d\-]+)\b/i) ||
    get(/\b(T\d{1,3}\/\d{4})\b/) ||
    get(/\b(\d{2}\/\d{4})\b/) ||
    get(/(?:TENDER|BID)\s*(?:NO\.?|NUMBER)\s*[:\-]?\s*([A-Z0-9\/\-_]{4,})/i);
  if (tenderNumber && tenderNumber.length < 4) tenderNumber = '';
  if (/^(TICE|DOC|NUMBER|BID|TENDER)$/i.test(tenderNumber)) tenderNumber = '';

  let description = get(/PROJECT\s+NAME\s*[:\-]?\s*(.+?)(?=\s+(?:TENDER|BID)\s*(?:NUMBER|NO\.?)\b)/i);
  if (!description) {
    description = get(/(?:BID\s+ADVERT|TENDER)\s*[-:]\s*(.+?)(?=\s+(?:BID|TENDER)\s*(?:NUMBER|NO\.?)\b)/i);
  }
  if (!description) {
    const descMatch = t.match(/(?:DESCRIPTION|SCOPE)\s*[:\-]?\s*(.+?)(?=\s+CLOSING\s+DATE|\s+SUBMISSION|\s+1\.\s+MANDATORY)/is);
    if (descMatch) description = normalizeWhitespace(descMatch[1]).slice(0, 400);
  }
  if (/(80\/20|90\/10|preference point system|to be completed by the organ of state)/i.test(description || '')) {
    description = '';
  }
  if ((description || '').length > 350) description = (description || '').slice(0, 347) + '…';

  const closingDate = formatDateFromText(get(/CLOSING\s+DATE\s*[:\-]?\s*([0-9]{1,2}\s+[A-Z]+\s+[0-9]{4}|[0-9]{2}\/[0-9]{2}\/[0-9]{4})/i));
  return {
    tenderNumber: String(tenderNumber || '').replace(/\s+/g, ' ').trim().toUpperCase(),
    description: description || '',
    closingDate: closingDate || ''
  };
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
      timeout: 25000,
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
  console.log('Fetching', TENDERS_URL, '...');
  const { data: html } = await axios.get(TENDERS_URL, {
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const $ = cheerio.load(html);
  const entries = [];
  const seenUrls = new Set();

  const mainContent = $('.entry-content, .post-content, .content, main, #content, .tenders-list, article').first();
  const searchRoot = mainContent.length ? mainContent : $.root();

  // Find links to PDFs or download buttons within main content
  searchRoot.find('a[href*=".pdf"], a[href*="download"], a[href*="Download"], a[download]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || seenUrls.has(href)) return;
    const absUrl = toAbsUrl(href);
    if (!absUrl || seenUrls.has(absUrl)) return;
    if (!/\.pdf$/i.test(absUrl) && !/download|file/i.test(absUrl)) return;
    seenUrls.add(absUrl);

    const linkText = $(el).text().trim();
    const parent = $(el).closest('div, li, tr, article, .tender-item, .document-item');
    let title = linkText;
    let updateDate = '';

    if (parent.length) {
      const parentText = parent.text();
      const titleEl = parent.find('h2, h3, h4, .title, .tender-title, a').first();
      if (titleEl.length && titleEl.attr('href') !== href) {
        const t = titleEl.text().trim();
        if (t && t.length > 10) title = t;
      }
      const dateMatch = parentText.match(/(?:Updated|Date|Advertised)\s+(\w+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+\w+\s+\d{4})/i);
      if (dateMatch) updateDate = formatDateFromText(dateMatch[1]);
    }

    if (!title || title.length < 5) {
      const filename = decodeURIComponent((href.split('/').pop() || '').replace(/\.pdf$/i, ''));
      if (filename && filename.length > 5) title = filename.replace(/_/g, ' ');
    }

    entries.push({
      pdfUrl: absUrl,
      title: normalizeWhitespace(title).slice(0, 500),
      updateDate,
      linkText: linkText.slice(0, 200)
    });
  });

  // Fallback: any a[href*=".pdf"] in the page
  if (entries.length === 0) {
    $('main a[href*=".pdf"], .content a[href*=".pdf"], .entry-content a[href*=".pdf"], a[href*=".pdf"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const absUrl = toAbsUrl(href);
      if (seenUrls.has(absUrl)) return;
      seenUrls.add(absUrl);

      const linkText = $(el).text().trim();
      const title = linkText || decodeURIComponent((href.split('/').pop() || '').replace(/\.pdf$/i, '')).replace(/_/g, ' ');
      if (!title || title.length < 3) return;

      entries.push({
        pdfUrl: absUrl,
        title: normalizeWhitespace(title).slice(0, 500),
        updateDate: '',
        linkText: linkText.slice(0, 200)
      });
    });
  }

  console.log('Found', entries.length, 'tender PDF links');
  return entries;
}

function toCsvRow(item, index) {
  const fallbackTenderNo = `KMLM-${String(index + 1).padStart(3, '0')}`;
  const tenderNo = item.tenderNumber || extractTenderNumberFromTitle(item.title) || fallbackTenderNo;
  const parsedDesc = normalizeWhitespace(item.description || '');
  const useTitle = !parsedDesc || /(80\/20|90\/10|preference point system)/i.test(parsedDesc) || parsedDesc.length > 350;
  const desc = normalizeWhitespace((useTitle ? item.title : parsedDesc) || `Kumkani Mhlontlo tender ${tenderNo}`);
  return {
    'Category': 'Municipal',
    'Tender Number': tenderNo,
    'Tender Description': desc.length > 500 ? `${desc.slice(0, 497)}...` : desc,
    'Advertised': item.updateDate || item.documentDate || '',
    'Closing': item.closingDate || '',
    'Organ Of State': 'Kumkani Mhlontlo Local Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'Qumbu, Tsolo, Mhlontlo area',
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
    'Source URL': item.pdfUrl || TENDERS_URL,
    'Tender ID': item.tenderId || '',
    'Source': 'Kumkani Mhlontlo'
  };
}

async function runScraper(opts = {}) {
  const { htmlOnly = false, limit = null, outDir = __dirname, csvFilename = 'mhlontlo_tenders.csv' } = opts;
  const outPath = path.join(outDir, csvFilename);

  console.log('\n🔍 SCRAPING KUMKANI MHLONTLO LOCAL MUNICIPALITY TENDERS');
  console.log('=======================================================');

  const entries = await scrapeListingPage();
  if (entries.length === 0) {
    return { rows: 0, data: [], message: 'No tenders found.' };
  }

  const toProcess = limit ? entries.slice(0, limit) : entries;
  console.log(`\n📄 Processing ${toProcess.length} tenders (${htmlOnly ? 'HTML only' : 'with PDF parsing'})...`);

  const results = [];
  for (let i = 0; i < toProcess.length; i++) {
    const e = toProcess[i];
    let row = {
      pdfUrl: e.pdfUrl,
      title: e.title,
      updateDate: e.updateDate,
      tenderNumber: '',
      description: '',
      closingDate: '',
      documentDate: e.updateDate,
      tenderId: ''
    };

    if (!htmlOnly && e.pdfUrl) {
      const parsed = await parsePdfMetadata(e.pdfUrl);
      if (parsed.tenderNumber) row.tenderNumber = parsed.tenderNumber;
      if (parsed.description) row.description = parsed.description;
      if (parsed.closingDate) row.closingDate = parsed.closingDate;
      await sleep(DELAY_MS);
    }

    row.tenderNumber = row.tenderNumber || extractTenderNumberFromTitle(e.title);
    results.push(toCsvRow(row, i));
  }

  const csvWriter = createCsvWriter({ path: outPath, header: CSV_HEADER });
  await csvWriter.writeRecords(results);

  console.log(`\n💾 Wrote ${results.length} rows to ${csvFilename}`);
  return { rows: results.length, data: results, message: `Wrote ${results.length} rows to ${csvFilename}` };
}

async function main() {
  const { htmlOnly, limit } = parseArgs();
  const outPath = path.join(__dirname, 'mhlontlo_tenders.csv');
  console.log('Kumkani Mhlontlo municipal scraper');
  console.log('Output:', outPath);
  if (htmlOnly) console.log('Mode: HTML only (no PDF parsing)');
  if (limit) console.log(`Limit: ${limit} tenders`);

  try {
    const { message } = await runScraper({ htmlOnly, limit });
    console.log('\n' + message);
  } catch (err) {
    console.error('\n❌ Scrape failed:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Scrape failed:', err.message);
    process.exit(1);
  });
}

module.exports = { runScraper, scrapeListingPage, parsePdfMetadata };
