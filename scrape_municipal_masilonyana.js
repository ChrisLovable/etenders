/**
 * Masilonyana Municipality tender scraper
 * Scrapes tenders from masilonyana.co.za/tenders
 * Stage 1: Scrape tender listing (table of PDFs and DOCX)
 * Stage 2: Download and parse PDF/DOCX bid documents
 * Output: masilonyana_tenders.csv (Source: Masilonyana)
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const BASE_URL = 'https://masilonyana.co.za';
const TENDERS_URL = `${BASE_URL}/tenders`;
const PDF_CONCURRENCY = 5;  // Process 5 PDFs in parallel to avoid timeout

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

function formatDateSA(d) {
  if (!d) return '';
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const match = String(d).match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (match) {
    const [, day, monthName, year] = match;
    const mi = months.findIndex(m => m.toLowerCase().startsWith(monthName.toLowerCase()));
    const month = mi >= 0 ? String(mi + 1).padStart(2, '0') : '01';
    return `${day.padStart(2, '0')}/${month}/${year}`;
  }
  const slashMatch = String(d).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (slashMatch) return slashMatch[0];
  return '';
}

function descriptionFromFilename(filename) {
  if (!filename) return '';
  const base = filename.replace(/\.(pdf|docx?)$/i, '').replace(/\s*\(\d+\)\s*$/, '');
  let desc = base
    .replace(/(?:ADVERT[- ]?|RE[- ]?ADVERT[- ]?|PROJECT[- ]?SPECIFICATION[- ]?)/gi, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const m = desc.match(/^(\d+)km\s+(\w+)$/i);
  if (m) desc = `${m[1]}km paved roads and stormwater - ${m[2]}`;
  return desc;
}

const GARBAGE_DESCRIPTION = /(?:Supply Chain|Tel:\s*\d|E-mail:|NAME OF BIDDER|PHYSICAL ADDRESS|Page\s+\d+|CIDB GRADING)/i;

async function scrapeListingPage() {
  const entries = [];
  try {
    const { data: html } = await axios.get(TENDERS_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15000
    });
    const $ = cheerio.load(html);
    const seenUrls = new Set();

    $('a[href*=".pdf"], a[href*=".docx"], a[href*=".doc"], a[href*="uploads/tenders"]').each((_, el) => {
      const href = $(el).attr('href');
      const lower = (href || '').toLowerCase();
      if (!href || (!lower.includes('.pdf') && !lower.includes('.docx') && !lower.includes('.doc'))) return;
      const absUrl = href.startsWith('http') ? href : (href.startsWith('/') ? BASE_URL + href : BASE_URL + '/' + href);
      if (seenUrls.has(absUrl)) return;
      seenUrls.add(absUrl);

      const filename = decodeURIComponent((absUrl.split('/').pop() || '').split('?')[0]);
      const descFromFile = descriptionFromFilename(filename);
      const ext = filename.match(/\.(pdf|docx?)$/i)?.[1] || '';
      const baseName = filename ? filename.replace(/\.(pdf|docx?)$/i, '').replace(/[-_]/g, ' ') : '';
      const desc = descFromFile.length > 10 ? descFromFile : (baseName || 'Masilonyana tender - see document');

      entries.push({
        docUrl: absUrl,
        pdfUrl: absUrl,
        tenderNumber: '',
        description: desc,
        closingDate: '',
        documentDate: '',
        filename
      });
    });
  } catch (err) {
    console.warn('Failed to fetch tenders page:', err.message);
  }
  return entries;
}

function extractFieldsFromText(text) {
  if (!text || text.length < 30) return null;
  const extract = (pattern) => {
      const m = text.match(pattern);
      return m && m[1] ? String(m[1]).trim() : '';
    };

    let tenderNumber = extract(/Ref\s+No\.?\s*:\s*([^\n]+)/i) ||
                      extract(/REFERENCE\s*(?:NO|NUMBER)[:\s]*([^\n]+)/i) ||
                      extract(/TENDER\s*(?:NO|NUMBER)[:\s]*([^\n]+)/i) ||
                      extract(/BID\s*(?:NO|NUMBER)[:\s]*([^\n]+)/i) ||
                      extract(/(\d+KM\s+THN\s+CONTRACTOR\s*-\s*\d{4}\/\d{2}\/\d{3})/i) ||
                      extract(/(BID\/[\d\-]+\/[\d\-]+)/i);
    if (tenderNumber) tenderNumber = tenderNumber.replace(/\s+/g, ' ').replace(/\*\*/g, '').trim();

    let description = '';
    const descMatch = text.match(/TENDER\s*(?:NO|NUMBER)[:\s]*[^\n]+\s*\n\s*([\s\S]+?)(?=\d\.\s+MANDATORY|EVALUATION|CLOSING DATE|R\s+[\d,]+\.\d{2})/i) ||
                     text.match(/DESCRIPTION[:\s]*([^\n]+(?:\n[^\n]+)*?)(?=\n\s*(?:CLOSING|CLOSURE|SUBMISSION|1\.\s+MANDATORY))/i);
    if (descMatch && descMatch[1]) {
      const d = descMatch[1].replace(/\s+/g, ' ').trim();
      if (d.length > 15 && !GARBAGE_DESCRIPTION.test(d)) description = d.substring(0, 350);
    }
    if (!description) {
      const patterns = [
        /(Appointment of a service provider[^:]+?)(?=\s*:\s*Ref\s+No|$)/i,
        /(?:for the below mentioned[:\s]*)?(Appointment of a service provider[^.]+\.[^.]*)/i,
        /(?:services\/commodities\/products[:\s]*)?(Appointment of[^.]+\.[^.]*)/i,
        /(PANEL OF[^.]+\.[^.]*)/i,
        /(APPOINTMENT OF[^.]+\.[^.]*)/i,
        /(SUPPLY[, ]+(?:AND DELIVERY|OF)[^.]+\.[^.]*)/i,
        /(PROVISION OF[^.]+\.[^.]*)/i
      ];
      for (const p of patterns) {
        const m = text.match(p);
        if (m && m[1] && m[1].length > 15 && !GARBAGE_DESCRIPTION.test(m[1])) {
          description = m[1].replace(/\s+/g, ' ').trim().substring(0, 350);
          break;
        }
      }
    }

    let closingDate = '';
    const closeMatch = text.match(/CLOSING\s+DATE[:\s]*(\d{1,2}\s+\w+\s+\d{4}|\d{2}\/\d{2}\/\d{4})/i) ||
                      text.match(/(\d{2}\/\d{2}\/\d{4})\s+(?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY)/i);
    if (closeMatch) closingDate = closeMatch[1].includes('/') ? closeMatch[1] : formatDateSA(closeMatch[1]);
    if (!closingDate) {
      const ddmmyy = text.match(/(\d{2}\/\d{2}\/\d{4})/);
      if (ddmmyy) closingDate = ddmmyy[1];
    }

    let documentDate = '';
    const advMatch = text.match(/(?:Advertised|Date of issue|Published)\s*[:\s]*(\d{2}\/\d{2}\/\d{4}|\d{1,2}\s+\w+\s+\d{4})/i);
    if (advMatch) documentDate = advMatch[1].includes('/') ? advMatch[1] : formatDateSA(advMatch[1]);

    const techContact = extract(/Technical\s+Enquiries[:\s]*([^\n]+)/i);
    const scmContact = extract(/SCM\s+Enquiries[:\s]*([^\n]+)/i);
    let contactPerson = extract(/CONTACT\s+PERSON[:\s]*([^\n]+)/i) ||
                        (techContact && scmContact ? `Technical: ${techContact.trim()}; SCM: ${scmContact.trim()}` : (techContact || scmContact || '')) ||
                        extract(/(?:MR|MS|MRS|DR)\.?\s+[A-Z][^\n]+(?=\s+Tel:)/i);
    const telMatches = text.match(/(\d{2,3}\s+\d{3}\s+\d{4})/g) || [];
    let telephone = extract(/Tel[:\s]*(\d{2,3}\s+\d{3}\s+\d{4})/i) ||
                   extract(/TEL[:\s]*([\d\s\-/]+?)(?=\s+Email|$)/i) ||
                   (telMatches[0] || '');
    telephone = String(telephone).replace(/\s+/g, ' ').trim();
    const emails = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi) || [];
    let email = emails[0] ? emails[0].replace(/\s+/g, '').toLowerCase() : '';
    if (emails.length > 1 && emails.some(e => /@masilonyana\.co\.za/i.test(e))) {
      email = emails.find(e => /@masilonyana\.co\.za/i.test(e)).replace(/\s+/g, '').toLowerCase();
    }

  return {
    tenderNumber: tenderNumber || '',
    title: description || '',
    description: description || '',
    closingDate,
    documentDate,
    contactPerson: contactPerson || '',
    telephone: telephone || '',
    email: email || ''
  };
}

async function parsePdfFields(pdfBuffer) {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(pdfBuffer);
    return extractFieldsFromText((data && data.text) || '');
  } catch (err) {
    console.warn('PDF parse error:', err.message);
    return null;
  }
}

async function parseDocxFields(docxBuffer) {
  try {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer: docxBuffer });
    return extractFieldsFromText((result && result.value) || '');
  } catch (err) {
    console.warn('DOCX parse error:', err.message);
    return null;
  }
}

async function downloadAndParseDocument(docUrl, row) {
  try {
    const { data } = await axios.get(docUrl, {
      responseType: 'arraybuffer',
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const buffer = Buffer.from(data);
    const filename = (row.filename || '').toLowerCase();
    const enriched = filename.endsWith('.docx') || filename.endsWith('.doc')
      ? await parseDocxFields(buffer)
      : await parsePdfFields(buffer);
    const baseId = row.filename?.replace(/\.(pdf|docx?)$/i, '') || 'doc';
    if (enriched) {
      return {
        ...row,
        tenderNumber: enriched.tenderNumber || row.tenderNumber || `MSL-${baseId}`,
        description: enriched.description || row.description,
        closingDate: enriched.closingDate || row.closingDate,
        documentDate: enriched.documentDate || row.documentDate,
        contactPerson: enriched.contactPerson || '',
        telephone: enriched.telephone || '',
        email: enriched.email || ''
      };
    }
  } catch (err) {
    console.warn(`Failed to fetch document ${docUrl}:`, err.message);
  }
  return row;
}

function toCsvRow(row) {
  const desc = (row.description || '').trim();
  const finalDesc = desc.length > 10 ? desc : `Masilonyana tender ${row.tenderNumber || row.filename || ''} - see document`;
  const truncated = finalDesc.length > 500 ? finalDesc.substring(0, 497) + '...' : finalDesc;

  return {
    'Category': 'Municipal',
    'Tender Number': row.tenderNumber || '',
    'Tender Description': truncated,
    'Advertised': row.documentDate || '',
    'Closing': row.closingDate || '',
    'Organ Of State': 'Masilonyana Local Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Free State',
    'Place where goods, works or services are required': 'Theunissen, Winburg, Brandfort',
    'Special Conditions': '',
    'Contact Person': row.contactPerson || '',
    'Email': row.email || '',
    'Telephone number': row.telephone || '',
    'FAX Number': '',
    'Is there a briefing session?': '',
    'Is it compulsory?': '',
    'Briefing Date and Time': '',
    'Briefing Venue': '',
    'eSubmission': '',
    'Two Envelope Submission': '',
    'Source URL': row.docUrl || row.pdfUrl || '',
    'Tender ID': '',
    'Source': 'Masilonyana'
  };
}

async function runScraper(opts = {}) {
  const { htmlOnly = false, limit = null, outDir = __dirname, csvFilename = 'masilonyana_tenders.csv' } = opts;
  const outPath = path.join(outDir, csvFilename);

  console.log('\n🔍 SCRAPING MASILONYANA MUNICIPALITY TENDERS');
  console.log('============================================');

  const entries = await scrapeListingPage();
  if (entries.length === 0) {
    return { rows: 0, data: [], message: 'No tenders found.' };
  }

  const toProcess = limit ? entries.slice(0, limit) : entries;
  console.log(`\n📄 Processing ${toProcess.length} tenders (${htmlOnly ? 'HTML only' : `PDF/DOCX parsing, ${PDF_CONCURRENCY} parallel`})...`);

  const results = [];
  if (htmlOnly) {
    for (let i = 0; i < toProcess.length; i++) {
      const row = { ...toProcess[i], tenderNumber: toProcess[i].tenderNumber || `MSL-${i + 1}` };
      results.push(toCsvRow(row));
    }
  } else {
    for (let i = 0; i < toProcess.length; i += PDF_CONCURRENCY) {
      const batch = toProcess.slice(i, i + PDF_CONCURRENCY);
      const enriched = await Promise.all(batch.map((entry, j) => {
        const row = { ...entry, tenderNumber: entry.tenderNumber || `MSL-${i + j + 1}` };
        return (row.docUrl || row.pdfUrl) ? downloadAndParseDocument(row.docUrl || row.pdfUrl, row) : Promise.resolve(row);
      }));
      results.push(...enriched.map(toCsvRow));
    }
  }

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
  console.log('Masilonyana municipal scraper (PDF parsing)');
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
