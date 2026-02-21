const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');
const https = require('https');

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

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

function toAbsUrl(baseUrl, href) {
  if (!href) return baseUrl;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return `${baseUrl.replace(/\/+$/, '')}${href}`;
  return `${baseUrl.replace(/\/+$/, '')}/${href.replace(/^\/+/, '')}`;
}

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function parseDateSA(text) {
  const t = normalizeWhitespace(text);
  if (!t) return '';
  const ddmmyyyy = t.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (ddmmyyyy) return ddmmyyyy[0];
  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const m = t.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{4})\b/i);
  if (!m) return '';
  const monthMap = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12'
  };
  const day = String(m[1]).padStart(2, '0');
  const month = monthMap[m[2].slice(0, 4).toLowerCase().replace('.', '')] || '01';
  return `${day}/${month}/${m[3]}`;
}

function extractBidNumber(text) {
  const t = normalizeWhitespace(text);
  const patterns = [
    /\b(?:RFQ|RFP|BID|TENDER|SCM|SMT|SMQ|Q|TN|SC)\s*[:#-]?\s*[A-Z0-9./-]{2,}\b/i,
    /\b[A-Z]{2,}\/[A-Z0-9.-]{2,}\/\d{2,4}(?:-\d{2,4})?\b/i,
    /\b\d{1,4}[A-Z]?\/\d{2,4}(?:-\d{2,4})?\b/
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) return normalizeWhitespace(m[0]).replace(/\s{2,}/g, ' ');
  }
  return '';
}

function looksTenderLike(text, href) {
  const t = normalizeWhitespace(text).toLowerCase();
  const h = String(href || '').toLowerCase();
  if (h.match(/\.(pdf|doc|docx|xlsx?)($|\?)/)) return true;
  return /(tender|bid|rfq|quotation|procurement|scm|supply chain)/.test(t);
}

function isNavigationNoise(text, href) {
  const t = normalizeWhitespace(text).toLowerCase();
  const h = String(href || '').toLowerCase();
  if (!t && !h) return true;
  if (t.includes('login | register') || t.includes('a-z index') || t.includes('faqs about us')) return true;
  if (t.length > 220 && !/\b(rfq|bid|quotation|closing|deadline|scm)\b/.test(t)) return true;
  const navWords = /(leadership|services|investor relations|gallery|news|careers|contact us|tourism|about us|home|login|register|a-z|faqs|events)/;
  const navHrefs = /(\/leadership|\/services|\/investor-relations|\/galleries?|\/news|\/careers|\/contact|\/about|\/tourism|\/events|\/login|\/register)/;
  if (navWords.test(t) && !/(tender|bid|rfq|quotation|procurement|scm)/.test(t)) return true;
  if (navHrefs.test(h) && !/(tender|bid|rfq|quotation|procurement|scm)/.test(h)) return true;
  return false;
}

function isRealTenderRow({ tenderNumber, description, sourceUrl }) {
  const d = normalizeWhitespace(description);
  const u = String(sourceUrl || '').toLowerCase();
  if (!u) return false;
  if (u === 'http://' || u === 'https://') return false;
  if (u.endsWith('/')) {
    if (!/(tender|bid|rfq|quotation|procurement|scm)/.test(u)) return false;
  }
  if (u.match(/\.(pdf|doc|docx|xlsx?)($|\?)/)) return true;
  if (u.includes('/sites/default/files/') || u.includes('/wp-content/uploads/')) return true;
  if (/(download|document|docman)/.test(u) && /(tender|bid|rfq|quotation|procurement|scm)/.test(u)) return true;
  if (tenderNumber && tenderNumber.length >= 3) return true;
  if (/(tender|bid|rfq|quotation|procurement|scm)/i.test(d) && d.length >= 15 && /(tender|bid|rfq|quotation|procurement|scm)/.test(u)) return true;
  return false;
}

function buildCsvRow(entry, cfg) {
  const forcedSourceUrl = cfg.forceSourceUrl || '';
  return {
    'Category': 'Municipal',
    'Tender Number': entry.tenderNumber || '',
    'Tender Description': (entry.description || `${cfg.shortName} tender (see document)`).slice(0, 500),
    'Advertised': entry.advertised || '',
    'Closing': entry.closing || '',
    'Organ Of State': cfg.organOfState,
    'Tender Type': 'Request for Bid',
    'Province': 'Western Cape',
    'Place where goods, works or services are required': cfg.place || cfg.shortName,
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
    'Source URL': forcedSourceUrl || entry.sourceUrl || cfg.urls[0] || '',
    'Tender ID': '',
    'Source': cfg.shortName
  };
}

async function scrapeHtmlUrl(url, cfg) {
  const res = await axios.get(url, {
    timeout: cfg.timeoutMs || 25000,
    headers: DEFAULT_HEADERS,
    httpsAgent: cfg.insecure ? new https.Agent({ rejectUnauthorized: false }) : undefined
  });
  const $ = cheerio.load(res.data);
  const rows = [];
  const seen = new Set();
  const selector = cfg.linkSelector || 'a[href]';
  $(selector).each((_, a) => {
    const href = $(a).attr('href');
    const linkText = normalizeWhitespace($(a).text());
    const contextText = normalizeWhitespace($(a).closest(cfg.contextSelector || 'li, tr, article, section, .document__item, .docman_document, p').text());
    const text = normalizeWhitespace(`${linkText} ${contextText}`);
    if (!looksTenderLike(text, href)) return;
    if (isNavigationNoise(text, href)) return;
    const tenderNumber = extractBidNumber(text);
    const closing = parseDateSA(text.match(/(?:close|closing|deadline|end date)[^.\n]{0,60}/i)?.[0] || text);
    const advertised = parseDateSA(text.match(/(?:open|advert|publish|posted|start date)[^.\n]{0,60}/i)?.[0] || '');
    const description = linkText.length >= 8 ? linkText : text.slice(0, 260);
    const sourceUrl = toAbsUrl(cfg.baseUrl, href);
    if (!isRealTenderRow({ tenderNumber, description, sourceUrl })) return;
    const key = `${tenderNumber}|${sourceUrl}|${description}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ tenderNumber, description, advertised, closing, sourceUrl });
  });
  return rows;
}

async function runGenericScraper(cfg, opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || cfg.csvFilename;
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : null;
  let all = [];
  for (const url of cfg.urls) {
    try {
      const rows = await scrapeHtmlUrl(url, cfg);
      all = all.concat(rows);
    } catch (err) {
      console.warn(`[${cfg.id}] Failed URL: ${url} -> ${err.message}`);
    }
  }
  const dedup = [];
  const seen = new Set();
  for (const row of all) {
    const key = `${row.tenderNumber}|${row.sourceUrl}|${row.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(row);
  }
  const sliced = limit ? dedup.slice(0, limit) : dedup;
  const csvRows = sliced.map(r => buildCsvRow(r, cfg));
  const csvWriter = createCsvWriter({ path: outPath, header: CSV_HEADER });
  await csvWriter.writeRecords(csvRows);
  return { rows: csvRows.length, data: csvRows, message: `Wrote ${csvRows.length} rows to ${csvFilename}` };
}

module.exports = { runGenericScraper };
