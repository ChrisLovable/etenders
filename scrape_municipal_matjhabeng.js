/**
 * Matjhabeng Municipality tender scraper (test)
 * Stage 1: Scrape tender listing HTML
 * Stage 2: Download and parse PDF bid documents
 * Output: matjhabeng_tenders.csv (separate from main advertised_tenders.csv)
 */
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const BASE_URL = 'https://matjhabengmunicipality.co.za';
const TENDERS_URL = `${BASE_URL}/Tenders.html`;
const DELAY_MS = 1500;

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
  return new Promise(resolve => setTimeout(resolve, ms));
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
  
  // Handle DD/MM/YYYY format
  const slashMatch = String(d).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (slashMatch) return d;
  
  return '';
}

function extractBidFromUrl(href) {
  if (!href) return '';
  const m = href.match(/BID[_\-\s]?(\d+)[_\-\s]?(\d{4})[_\-\s]?(\d{2})/i) || href.match(/BID\/([\d\-]+)\/(\d{4})[\-]?(\d{2})/i);
  if (m) return `BID/${m[1]}/${m[2]}-${m[3]}`.replace(/-(\d{2})$/, '-$1');
  const m2 = href.match(/BID[_\-\s]?(\d+)[_\-\s]?(\d{4}[\-_]\d{2})/i);
  if (m2) return `BID/${m2[1]}/${m2[2].replace('_', '-')}`;
  return '';
}

function extractDescriptionFromUrl(href) {
  if (!href) return '';
  try {
    const decoded = decodeURIComponent(href);
    const filename = decoded.split('/').pop() || decoded;
    const base = filename.replace(/\.pdf$/i, '');
    const m = base.match(/BID[_\-\s]?\d+[_\-\s]?\d{4}[\-_]?\d{2}\s*[-–—]\s*(.+)/i);
    if (m && m[1] && m[1].length > 15) return m[1].replace(/_/g, ' ').trim();
  } catch (_) {}
  return '';
}

const WEAK_DESCRIPTIONS = /^(basis\.?|document|bid\s*document|tender\s*document|as\s+and\s+when\s+required\s+basis\.?)$/i;
const GARBAGE_DESCRIPTION = /(?:Supply Chain|Tel:\s*\d|E-mail:|NAME OF BIDDER|PHYSICAL ADDRESS|Finance Dept|Page\s+\d+|CIDB GRADING)/i;

function parseLinkText(text) {
  const t = String(text || '').trim();
  const out = { tenderNumber: '', description: '', closingDate: '', documentDate: '' };
  const bidMatch = t.match(/Bid No\s*:\s*([^\s]+(?:\s+[^\s]+)*?)(?=\s+Closing|$)/i) || t.match(/(BID\/[\d\-]+\/[\d\-]+)/i);
  if (bidMatch) out.tenderNumber = (bidMatch[1] || bidMatch[0] || '').trim();
  const closeMatch = t.match(/Closing Date\s*:\s*(\d{1,2}\s+\w+\s+\d{4}|N\/A)/i);
  if (closeMatch) out.closingDate = closeMatch[1] === 'N/A' ? '' : formatDateSA(closeMatch[1]);
  const descMatch = t.match(/Closing Date\s*:\s*(?:[\d\w\s\/]+\s+)(.+?)(?=\s+Size:|\s+Size\s|$)/is);
  if (descMatch) out.description = descMatch[1].replace(/\s+/g, ' ').trim();
  const docMatch = t.match(/(\w+\s+\d{1,2},?\s+\d{4})/);
  if (docMatch) out.documentDate = formatDateSA(docMatch[1].replace(',', ''));
  return out;
}

async function scrapeListingPage() {
  console.log('Fetching', TENDERS_URL, '...');
  const { data: html } = await axios.get(TENDERS_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    timeout: 15000
  });
  const $ = cheerio.load(html);
  const entries = [];
  const seenUrls = new Set();

  $('a[href*=".pdf"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.includes('Extension') || href.includes('Annexure') || href.includes('ANNEXURE') || href.toLowerCase().includes('erratum')) return;
    const absUrl = href.startsWith('http') ? href : (href.startsWith('/') ? BASE_URL + href : BASE_URL + '/' + href);
    if (seenUrls.has(absUrl)) return;
    seenUrls.add(absUrl);

    const linkText = $(el).text().trim();
    const fromUrl = extractBidFromUrl(href);
    const fromText = parseLinkText(linkText);

    const tenderNumber = fromText.tenderNumber || fromUrl || '';
    let rawDesc = fromText.description || (linkText.length > 50 ? linkText : '');
    rawDesc = rawDesc.replace(/\s+/g, ' ').trim();
    if (!rawDesc || rawDesc.length < 15 || WEAK_DESCRIPTIONS.test(rawDesc)) {
      rawDesc = extractDescriptionFromUrl(href) || rawDesc;
    }
    if (!rawDesc || rawDesc.length < 10) {
      rawDesc = tenderNumber ? `${tenderNumber} (see document)` : 'Matjhabeng tender (see document)';
    }
    const description = rawDesc.substring(0, 500);
    const closingDate = fromText.closingDate || '';
    const documentDate = fromText.documentDate || '';

    entries.push({
      pdfUrl: absUrl,
      tenderNumber,
      description,
      closingDate,
      documentDate,
      linkText: linkText.substring(0, 200)
    });
  });

  console.log('Found', entries.length, 'tender PDF links');
  return entries;
}

async function parsePdfFields(pdfBuffer) {
  let pdfParse;
  try {
    pdfParse = require('pdf-parse');
  } catch (e) {
    console.warn('pdf-parse not available, skipping PDF extraction');
    return null;
  }
  
  try {
    const data = await pdfParse(pdfBuffer);
    const text = (data && data.text) || '';
    
    // If no text extracted, PDF might be scanned/image-based
    if (!text || text.length < 50) {
      console.warn('⚠️  PDF has little or no extractable text - may be scanned');
      return null;
    }

    const extract = (pattern) => {
      const m = text.match(pattern);
      return m && m[1] ? String(m[1]).trim() : '';
    };

    // Get tender number
    const tenderNumber = extract(/TENDER NUMBER:\s*([^\n]+)/i) || 
                        extract(/(BID\/[\d\-]+\/[\d\-]+)/);

    // ----- ENHANCED MULTI-LINE DESCRIPTION CAPTURE -----
    let description = '';
    
    // Pattern 1: Look for text between TENDER NUMBER and EVALUATION CRITERIA / MANDATORY
    const descMatch1 = text.match(/TENDER NUMBER:.*?\n\s*([\s\S]+?)(?=\d\.\s+MANDATORY|EVALUATION CRITERIA|R\s+[\d,]+\.\d{2}|CLOSING DATE)/i);
    if (descMatch1) {
      let d = descMatch1[1]
        .replace(/\s+/g, ' ')
        .replace(/^DESCRIPTION:\s*/i, '')
        .trim();
      if (d.length > 15 && !GARBAGE_DESCRIPTION.test(d)) description = d;
    }
    
    // Pattern 2: Look for text after BID/XX/YYYY-ZZ
    if (!description) {
      const tableDescMatch = text.match(/BID\/[\d\-]+\/[\d\-]+\s+([\s\S]+?)(?=\s*1\.\s+MANDATORY|\s*2\.\s+FUNCTIONALITY|\s*R\s+\d[\d\s,]+\.\d{2}|\s*SUBMISSION OF BID)/i);
      if (tableDescMatch && tableDescMatch[1]) {
        const d = String(tableDescMatch[1]).replace(/\s+/g, ' ').trim();
        if (d.length > 15 && !GARBAGE_DESCRIPTION.test(d)) description = d;
      }
    }
    
    // Pattern 3: Line-by-line - collect lines after tender number
    if (!description) {
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(tenderNumber) || lines[i].includes('TENDER NUMBER')) {
          let descLines = [];
          for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
            const line = lines[j].trim();
            if (!line || line.match(/^\d\.\s+MANDATORY|EVALUATION|R\s+\d|CLOSING|Page\s+\d|TEL:|EMAIL:/i)) break;
            descLines.push(line);
          }
          if (descLines.length > 0) {
            const d = descLines.join(' ').replace(/\s+/g, ' ').trim();
            if (d.length > 15 && !GARBAGE_DESCRIPTION.test(d)) description = d;
            break;
          }
        }
      }
    }
    
    // Pattern 4: Look for common tender description starters
    if (!description) {
      const patterns = [
        /(PANEL OF[^.]+\.[^.]*)/i,
        /(APPOINTMENT OF[^.]+\.[^.]*)/i,
        /(SUPPLY[, ]+(?:AND DELIVERY|OF)[^.]+\.[^.]*)/i,
        /(DISPOSAL OF[^.]+\.[^.]*)/i,
        /(PROVISION OF[^.]+\.[^.]*)/i
      ];
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
          const d = match[1].replace(/\s+/g, ' ').trim();
          if (d.length > 15 && !GARBAGE_DESCRIPTION.test(d)) {
            description = d;
            break;
          }
        }
      }
    }
    
    // Clean up description
    if (description) {
      // Fix common OCR/encoding errors
      description = description
        .replace(/MAINHOLES/gi, 'MANHOLES')
        .replace(/SDP['`\u2019\u2018]S/gi, "SDP'S")   // Fix encoding: SDPâ€™S → SDP'S
        .replace(/\s+/g, ' ')
        .trim();
      
      // Remove trailing punctuation or garbage
      description = description.replace(/[,\s]+$/, '');
      
      // Truncate if too long
      if (description.length > 350) {
        description = description.substring(0, 347).replace(/\s+\S*$/, '') + '…';
      }
    }

    // Extract closing date - multiple formats
    let closingDate = '';
    let closingTime = '';
    
    // Try DD/MM/YYYY format (from BID/17)
    const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})\s+(?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY)/i);
    if (dateMatch) {
      closingDate = dateMatch[1];
      const timeMatch = text.match(/\d{2}\/\d{2}\/\d{4}\s+(?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY)\s+(\d{2}:\d{2})/i);
      if (timeMatch) closingTime = timeMatch[1];
    }
    
    // Try CLOSING DATE: format
    if (!closingDate) {
      const dateTextMatch = text.match(/CLOSING DATE[:\s]*(\d{1,2}\s+\w+\s+\d{4})/i);
      if (dateTextMatch) closingDate = formatDateSA(dateTextMatch[1]);
    }
    
    // Try Date: format
    if (!closingDate) {
      const dayMatch = extract(/Date:\s*(\w+day\s+\d{1,2}\s+\w+\s+\d{4})/i);
      if (dayMatch) closingDate = formatDateSA(dayMatch);
    }
    
    // Last resort: find any DD/MM/YYYY
    if (!closingDate) {
      const ddmmyy = text.match(/(\d{2}\/\d{2}\/\d{4})/);
      if (ddmmyy) closingDate = ddmmyy[1];
    }

    // Extract advertised/document date
    let documentDate = '';
    const advMatch = text.match(/(?:Advertised|Date of issue|Published)\s*[:\s]*(\d{2}\/\d{2}\/\d{4}|\d{1,2}\s+\w+\s+\d{4})/i);
    if (advMatch) {
      documentDate = advMatch[1].includes('/') ? advMatch[1] : formatDateSA(advMatch[1]);
    }

    // Extract venue
    let venue = extract(/Venue:\s*([^\n]+)/i);
    if (!venue) {
      const venueMatch = text.match(/C\/O\s+([^\n]+WELKOM\s+\d+)/i) ||
                        text.match(/(CIVIC CENTRE[^\n]*(?:WELKOM)?\s*\d*)/i);
      if (venueMatch) venue = venueMatch[1].trim();
    }
    if (!venue) venue = 'Municipal Civic Centre, 319 Stateway, Welkom, 9460';

    // Extract contact person - handle MR. P MATHEBULA, DR. F KRUGER format
    let contactPerson = '';
    
    // Look for CONTACT PERSON section
    const contactMatch = text.match(/CONTACT PERSON(?:\s*\(TECHNICAL\))?:\s*([^\n]+)/i) ||
                        text.match(/(MR\.?\s+[A-Z]\s+[A-Z]+)(?=\s+TEL:)/i) ||
                        text.match(/(DR\.?\s+[A-Z]\.[\sA-Z]+)(?=\s+TEL:)/i) ||
                        text.match(/(MS\.?\s+[A-Z]\s+[A-Z]+)(?=\s+TEL:)/i) ||
                        text.match(/BIDDING RELATED ENQUIRIES[\s\S]*?([A-Z][A-Z\s.]+?)(?=\s+TEL:)/i);
    if (contactMatch) {
      contactPerson = contactMatch[1]
        .replace(/\s+/g, ' ')
        .replace(/^CONTACT PERSON(?:\s*\(TECHNICAL\))?:\s*/i, '')
        .trim();
    }

    // Extract telephone
    let telephone = '';
    const telMatch = text.match(/TEL:\s*([\d\s\-/]+?)(?=\s+EMAIL:|$)/i) ||
                    text.match(/TEL[:\s]*([\d\s\-/]+?)(?=\s+EMAIL:|$)/i) ||
                    text.match(/(\d{3}\s+\d{3}\s+\d{4})/);
    if (telMatch) {
      telephone = telMatch[1]
        .replace(/\s+/g, ' ')
        .replace(/[^\d\s-]/g, '')
        .trim();
    }

    // Extract email
    let email = '';
    const emailMatch = text.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
    if (emailMatch) {
      email = emailMatch[1].replace(/\s+/g, '').toLowerCase();
    }

    return {
      tenderNumber: tenderNumber || '',
      title: description || '',
      description: description || '',
      closingDate,
      closingTime,
      documentDate,
      venue,
      contactPerson,
      telephone,
      email
    };
  } catch (err) {
    console.error('❌ PDF parse error:', err.message);
    return null;
  }
}

async function downloadAndParsePdf(pdfUrl, htmlData) {
  try {
    const { data } = await axios.get(pdfUrl, {
      responseType: 'arraybuffer',
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const buffer = Buffer.from(data);
    const pdfData = await parsePdfFields(buffer);
    if (!pdfData) return htmlData;

    // PDF data FIRST (preferred), then fallback to HTML - explicit merge ensures PDF wins
    return {
      tenderNumber: (pdfData.tenderNumber && String(pdfData.tenderNumber).trim()) || htmlData.tenderNumber,
      title: (pdfData.title && String(pdfData.title).trim()) || htmlData.title,
      description: (pdfData.description && String(pdfData.description).trim()) || htmlData.description,
      closingDate: (pdfData.closingDate && String(pdfData.closingDate).trim()) || htmlData.closingDate,
      closingTime: (pdfData.closingTime && String(pdfData.closingTime).trim()) || htmlData.closingTime,
      documentDate: (pdfData.documentDate && String(pdfData.documentDate).trim()) || htmlData.documentDate,
      venue: (pdfData.venue && String(pdfData.venue).trim()) || htmlData.venue,
      contactPerson: (pdfData.contactPerson && String(pdfData.contactPerson).trim()) || htmlData.contactPerson,
      telephone: (pdfData.telephone && String(pdfData.telephone).trim()) || htmlData.telephone,
      email: (pdfData.email && String(pdfData.email).trim()) || htmlData.email,
      pdfUrl: htmlData.pdfUrl
    };
  } catch (e) {
    console.warn('  ❌ PDF fetch/parse failed:', e.message);
    return htmlData;
  }
}

function loadAdvertisedLookup(outDir) {
  const advPath = path.join(outDir, 'advertised_tenders.csv');
  if (!fs.existsSync(advPath)) return new Map();
  try {
    const raw = fs.readFileSync(advPath, 'utf8');
    const rows = parse(raw, { columns: true, relax_column_count: true, skip_empty_lines: true });
    const map = new Map();
    for (const r of rows) {
      const n = (r['Tender Number'] || '').trim();
      const organ = (r['Organ Of State'] || '');
      if (n && organ.includes('Matjhabeng')) {
        const desc = (r['Tender Description'] || '').trim();
        if (desc && desc.length > 15 && !desc.includes('(see document)')) {
          map.set(n, {
            description: desc,
            advertised: (r['Advertised'] || '').trim(),
            closing: (r['Closing'] || '').trim(),
            venue: (r['Place where goods, works or services are required'] || '').trim(),
            contactPerson: (r['Contact Person'] || '').trim(),
            email: (r['Email'] || '').trim(),
            telephone: (r['Telephone number'] || '').trim()
          });
        }
      }
    }
    console.log(`  Loaded ${map.size} advertised Matjhabeng tenders for enrichment`);
    return map;
  } catch (_) {
    return new Map();
  }
}

function toCsvRow(row) {
  let desc = '';
  
  // Prioritize title from PDF, then description, then fallback
  if (row.title && row.title.length > 10 && !row.title.includes('(see document)') && !GARBAGE_DESCRIPTION.test(row.title)) {
    desc = row.title;
  } else if (row.description && row.description.length > 10 && !row.description.includes('(see document)') && !GARBAGE_DESCRIPTION.test(row.description)) {
    desc = row.description;
  } else {
    desc = `Matjhabeng tender ${row.tenderNumber || ''} - see document for details`;
  }
  
  // Clean up description
  desc = desc
    .replace(/\s+/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .replace(/MAINHOLES/g, 'MANHOLES');
    
  if (desc.length > 500) desc = desc.substring(0, 497) + '...';

  return {
    'Category': 'Municipal',
    'Tender Number': row.tenderNumber || '',
    'Tender Description': desc,
    'Advertised': row.documentDate || '',
    'Closing': row.closingDate || '',
    'Organ Of State': 'Matjhabeng Local Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Free State',
    'Place where goods, works or services are required': row.venue || 'Municipal Civic Centre, Welkom',
    'Special Conditions': '',
    'Contact Person': row.contactPerson || '',
    'Email': row.email || '',
    'Telephone number': row.telephone || '',
    'FAX Number': '',
    'Is there a briefing session?': '',
    'Is it compulsory?': '',
    'Briefing Date and Time': row.closingTime || '',
    'Briefing Venue': row.venue || '',
    'eSubmission': '',
    'Two Envelope Submission': '',
    'Source URL': row.pdfUrl || '',
    'Tender ID': '',
    'Source': 'Matjhabeng'
  };
}

async function runScraper(opts = {}) {
  const { htmlOnly = false, limit = null, outDir = __dirname, csvFilename = 'matjhabeng_tenders.csv' } = opts;
  const outPath = path.join(outDir, csvFilename);

  console.log('\n🔍 SCRAPING MATJHABENG MUNICIPALITY TENDERS');
  console.log('===========================================');
  
  const entries = await scrapeListingPage();
  if (entries.length === 0) {
    return { rows: 0, data: [], message: 'No tenders found.' };
  }

  const toProcess = limit ? entries.slice(0, limit) : entries;
  console.log(`\n📄 Processing ${toProcess.length} tenders...`);

  const advertisedLookup = loadAdvertisedLookup(outDir);

  const results = [];
  for (let i = 0; i < toProcess.length; i++) {
    console.log(`\n--- Tender ${i + 1}/${toProcess.length} ---`);
    const e = toProcess[i];
    const row = {
      pdfUrl: e.pdfUrl,
      tenderNumber: e.tenderNumber,
      description: e.description,
      closingDate: e.closingDate,
      documentDate: e.documentDate,
      title: '',
      venue: '',
      contactPerson: '',
      telephone: '',
      email: ''
    };
    
    if (!htmlOnly && e.pdfUrl) {
      const enriched = await downloadAndParsePdf(e.pdfUrl, row);
      Object.assign(row, enriched);
      await sleep(DELAY_MS);
    }
    
    // Prefer advertised_tenders data when available
    const adv = advertisedLookup.get((row.tenderNumber || '').trim());
    if (adv) {
      console.log(`  ✨ Enriching with advertised data for ${row.tenderNumber}`);
      if (adv.description && adv.description.length > 10) row.title = adv.description;
      if (adv.description && adv.description.length > 10) row.description = adv.description;
      if (adv.closing) row.closingDate = adv.closing;
      if (adv.advertised) row.documentDate = adv.advertised;
      if (adv.venue) row.venue = adv.venue;
      if (adv.contactPerson) row.contactPerson = adv.contactPerson;
      if (adv.email) row.email = adv.email;
      if (adv.telephone) row.telephone = adv.telephone;
    }
    
    results.push(toCsvRow(row));
  }

  console.log(`\n💾 Writing ${results.length} rows to ${outPath}`);
  const csvHeader = [
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
  const csvWriter = createCsvWriter({ path: outPath, header: csvHeader });
  
  try {
    await csvWriter.writeRecords(results);
    console.log(`✅ Success! Wrote ${results.length} rows to ${csvFilename}`);
    return { rows: results.length, data: results, message: `Wrote ${results.length} rows to ${csvFilename}` };
  } catch (err) {
    if (err.code === 'EBUSY') {
      const backupPath = outPath.replace('.csv', `_${Date.now()}.csv`);
      console.log(`⚠️  File locked, saving to ${backupPath}`);
      const backupWriter = createCsvWriter({ path: backupPath, header: csvHeader });
      await backupWriter.writeRecords(results);
      return { rows: results.length, data: results, message: `File locked! Saved to ${path.basename(backupPath)} instead` };
    } else {
      throw err;
    }
  }
}

async function main() {
  const { htmlOnly, limit } = parseArgs();
  const outPath = path.join(__dirname, 'matjhabeng_tenders.csv');
  console.log('Matjhabeng municipal scraper (test)');
  console.log('Output:', outPath);
  if (htmlOnly) console.log('Mode: HTML only (no PDF parsing)');
  if (limit) console.log(`Limit: ${limit} tenders`);
  
  try {
    const { rows, message } = await runScraper({ htmlOnly, limit });
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

module.exports = { runScraper, scrapeListingPage, parsePdfFields };