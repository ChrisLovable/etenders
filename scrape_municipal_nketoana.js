/**
 * Nketoana Local Municipality tender scraper
 * Scrapes tenders from nketoanalm.gov.za/generic-page.php?page=tenders
 * Stage 1: Scrape listing (Title, Advert Date, Closing Date, PDF link)
 * Stage 2: Download and parse PDFs - extract multiple tenders per PDF (BID NO, Description, etc.)
 * Output: nketoana_tenders.csv (Source: Nketoana)
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://nketoanalm.gov.za';
const TENDERS_URL = `${BASE_URL}/generic-page.php?page=tenders`;
const PDF_CONCURRENCY = 3;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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

function formatDate(text) {
  if (text == null || text === undefined || String(text).trim() === '') return '';
  const m = String(text).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return m[0];
  const dayMonthMatch = text.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (dayMonthMatch) {
    const [, day, monthName, year] = dayMonthMatch;
    const mi = MONTHS.findIndex(m => m.toLowerCase().startsWith(String(monthName).toLowerCase().substring(0, 3)));
    const month = mi >= 0 ? String(mi + 1).padStart(2, '0') : '01';
    return `${String(day).padStart(2, '0')}/${month}/${year}`;
  }
  const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[2]}/${isoMatch[3]}/${isoMatch[1]}`;
  return text.replace(/\s+@\s+[\d:]+$/, '').trim();
}

async function scrapeListingPage() {
  const entries = [];
  try {
    const { data: html } = await axios.get(TENDERS_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15000
    });
    const $ = cheerio.load(html);

    $('table a[href*=".pdf"], table a[href*="docs/SCM"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const row = $(el).closest('tr');
      const cells = row.find('td');
      if (cells.length < 4) return;
      const title = $(cells[1]).text().trim();
      const advertDate = $(cells[2]).text().trim();
      const closingDate = $(cells[3]).text().trim();
      let absUrl = href.startsWith('http') ? href : BASE_URL + (href.startsWith('/') ? '' : '/') + href;
      absUrl = absUrl.replace(/\/\.\.\//g, '/').replace(/\/\.\.$/g, '').replace(/ /g, '%20');
      entries.push({
        pdfUrl: absUrl,
        title,
        advertDate: formatDate(advertDate) || advertDate,
        closingDate: formatDate(closingDate) || closingDate
      });
    });

    if (entries.length === 0) {
      $('a[href*=".pdf"]').each((_, a) => {
        const href = $(a).attr('href');
        if (!href) return;
        const row = $(a).closest('tr');
        const cells = row.find('td');
        const title = cells.length >= 2 ? $(cells[1]).text().trim() : $(a).closest('table').find('td').first().next().text().trim();
        const absUrl = href.startsWith('http') ? href : BASE_URL + (href.startsWith('/') ? '' : '/') + href;
        entries.push({
          pdfUrl: absUrl,
          title: title || decodeURIComponent((absUrl.split('/').pop() || '').replace(/\.pdf$/i, '')),
          advertDate: '',
          closingDate: ''
        });
      });
    }
  } catch (err) {
    console.warn('Failed to fetch tenders page:', err.message);
  }
  return entries;
}

function parsePdfTenderBlocks(text, listingFallback) {
  const blocks = [];
  const beforeTerms = text.split(/BID\s+TERMS\s+AND\s+CONDITIONS/i)[0] || text;
  const bidNoRegex = /NKT\s*\d+\s*\/\s*\d+/gi;
  const parts = beforeTerms.split(bidNoRegex);
  const matches = beforeTerms.matchAll(/NKT\s*(\d+)\s*\/\s*(\d+)/gi);
  const bidNos = [...matches].map(m => `NKT ${m[1]}/${m[2]}`);

  if (bidNos.length === 0) return blocks;

  const garbage = /BID\s+TERMS|Municipality reserves|Late bids will not|Bill of quantities|persons in the service of the state/i;

  for (let i = 0; i < bidNos.length; i++) {
    const block = (parts[i + 1] || '').trim();
    if (block.length < 20) continue;

    const descMatch = block.match(/^(.+?)(?=\s*80\/20|\s*90\/10|R\d|Evaluation|Bid Fee|$)/is);
    let description = descMatch ? descMatch[1].replace(/\s+/g, ' ').trim().substring(0, 350) : block.substring(0, 200);
    if (garbage.test(description) || description.length < 15) continue;

    const closeMatch = block.match(/Closing\s+date(?:\s+and\s+time)?[:\s]*(\d{1,2}\s+\w+\s+\d{4}|\d{2}\/\d{2}\/\d{4})/i) ||
                       block.match(/(\d{1,2}\s+\w+\s+\d{4})\s+@\s+12:00pm/i) ||
                       block.match(/(\d{2}\/\d{2}\/\d{4})\s+Reitz/i);
    const closingDate = closeMatch ? formatDate(closeMatch[1]) : (listingFallback?.closingDate || '');

    const contactMatch = block.match(/Technical\s+Contact\s+Person[:\s]*([^\n]+(?:\n[^\n]+)*?)(?=NKT\s*\d|BID\s+TERMS|$)/i) ||
                        block.match(/((?:Manager|Acting)[^@]+(?:Mr|Ms|Me)\s+[A-Z][^@]+)@\s*[\d\s\-]+/i);
    const contactPerson = contactMatch ? contactMatch[1].replace(/\s+/g, ' ').trim().substring(0, 120) : '';

    const telMatch = block.match(/(\d{3}\s+\d{3}\s+\d{4})/);
    const telephone = telMatch ? telMatch[1].replace(/\s+/g, ' ').trim() : '';

    blocks.push({
      tenderNumber: bidNos[i],
      description: description || listingFallback?.title || 'Nketoana tender - see document',
      closingDate,
      contactPerson,
      telephone
    });
  }
  return blocks;
}

async function downloadAndParsePdf(pdfUrl, listingRow) {
  try {
    const { data } = await axios.get(pdfUrl, {
      responseType: 'arraybuffer',
      timeout: 25000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const pdfParse = require('pdf-parse');
    const result = await pdfParse(Buffer.from(data));
    const text = (result && result.text) || '';
    const blocks = parsePdfTenderBlocks(text, listingRow);
    if (blocks.length > 0) {
      return blocks.map(b => ({ ...b, sourceUrl: pdfUrl }));
    }
    return [{
      tenderNumber: listingRow?.title?.match(/NKT\s*\d+\/\d+|RFQ\s*\d+|Tender\s*\d+/i)?.[0] || 'NKT-1',
      description: listingRow?.title || 'Nketoana tender - see document',
      closingDate: listingRow?.closingDate || '',
      contactPerson: '',
      telephone: '',
      sourceUrl: pdfUrl
    }];
  } catch (err) {
    console.warn(`Failed to fetch PDF ${pdfUrl}:`, err.message);
    return [{
      tenderNumber: listingRow?.title?.substring(0, 30) || 'NKT-1',
      description: listingRow?.title || 'Nketoana tender - see document',
      closingDate: listingRow?.closingDate || '',
      contactPerson: '',
      telephone: '',
      sourceUrl: pdfUrl
    }];
  }
}

function toCsvRow(row) {
  const desc = (row.description || '').trim();
  const finalDesc = desc.length > 10 ? desc : `Nketoana tender ${row.tenderNumber || ''} - see document for details`;
  const truncated = finalDesc.length > 500 ? finalDesc.substring(0, 497) + '...' : finalDesc;

  return {
    'Category': 'Municipal',
    'Tender Number': row.tenderNumber || '',
    'Tender Description': truncated,
    'Advertised': row.advertDate || '',
    'Closing': row.closingDate || '',
    'Organ Of State': 'Nketoana Local Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Free State',
    'Place where goods, works or services are required': 'Reitz, Kestell, Lindley',
    'Special Conditions': '',
    'Contact Person': row.contactPerson || '',
    'Email': '',
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
    'Source': 'Nketoana'
  };
}

async function runScraper(opts = {}) {
  const { htmlOnly = false, limit = null, outDir = __dirname, csvFilename = 'nketoana_tenders.csv' } = opts;
  const outPath = path.join(outDir, csvFilename);

  console.log('\n🔍 SCRAPING NKETOANA LOCAL MUNICIPALITY TENDERS');
  console.log('================================================');

  const listingEntries = await scrapeListingPage();
  if (listingEntries.length === 0) {
    return { rows: 0, data: [], message: 'No tenders found.' };
  }

  const toProcess = limit ? listingEntries.slice(0, limit) : listingEntries;
  const allRows = [];

  if (htmlOnly) {
    for (const e of toProcess) {
      allRows.push({
        tenderNumber: e.title?.match(/NKT\s*\d+\/\d+|RFQ\s*\d+/i)?.[0] || e.title?.substring(0, 30),
        description: e.title || 'Nketoana tender - see document',
        closingDate: e.closingDate,
        advertDate: e.advertDate,
        contactPerson: '',
        telephone: '',
        sourceUrl: e.pdfUrl
      });
    }
  } else {
    for (let i = 0; i < toProcess.length; i += PDF_CONCURRENCY) {
      const batch = toProcess.slice(i, i + PDF_CONCURRENCY);
      const batchResults = await Promise.all(batch.map(e => downloadAndParsePdf(e.pdfUrl, e)));
      for (const rows of batchResults) {
        for (const r of rows) {
          if (!r.advertDate && batch.find(b => b.pdfUrl === r.sourceUrl)) {
            r.advertDate = batch.find(b => b.pdfUrl === r.sourceUrl).advertDate;
          }
          allRows.push(r);
        }
      }
    }
  }

  const seen = new Set();
  const unique = [];
  for (const r of allRows) {
    const key = (r.tenderNumber || '').trim();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(r);
    } else {
      unique.push(r);
    }
  }

  const results = unique.map(toCsvRow);

  try {
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
  } catch (writeErr) {
    console.warn('CSV write failed (file may be open):', writeErr.message);
  }

  return { rows: results.length, data: results, message: `Wrote ${results.length} rows to ${csvFilename}` };
}

async function main() {
  const { htmlOnly, limit } = parseArgs();
  console.log('Nketoana municipal scraper (PDF parsing)');
  const { rows, message } = await runScraper({ htmlOnly, limit });
  console.log(message);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Scrape failed:', err.message);
    process.exit(1);
  });
}

module.exports = { runScraper, scrapeListingPage };
