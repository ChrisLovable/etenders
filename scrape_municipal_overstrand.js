const axios = require('axios');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const API_URL = 'http://overstrand.gov.za/document/supply-chain-management/tenders/?format=json';

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

function formatDateIso(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function extractTenderNumber(text) {
  const t = String(text || '');
  const m = t.match(/\b(?:SC|RFQ|BID|TENDER)\s*[-:/]?\s*[A-Z0-9./-]{2,}\b/i) || t.match(/\b\d{1,4}\/\d{2,4}\b/);
  return m ? m[0].replace(/\s+/g, ' ').trim() : '';
}

function toCsvRow(row) {
  return {
    'Category': 'Municipal',
    'Tender Number': row.tenderNumber || '',
    'Tender Description': (row.description || 'Overstrand tender (see document)').slice(0, 500),
    'Advertised': row.advertised || '',
    'Closing': '',
    'Organ Of State': 'Overstrand Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Western Cape',
    'Place where goods, works or services are required': 'Overstrand',
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
    'Source URL': row.sourceUrl || API_URL,
    'Tender ID': '',
    'Source': 'Overstrand'
  };
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || 'overstrand_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : 40; // first two pages equivalent

  const res = await axios.get(API_URL, { timeout: 25000 });
  const payload = res.data || {};
  const included = Array.isArray(payload.included) ? payload.included : [];
  const docs = included.filter(i => i && i.type === 'documents');
  const mapped = docs.map(d => {
    const attrs = d.attributes || {};
    const title = attrs.title || attrs.name || '';
    const description = String(attrs.description || title || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const sourceUrl = attrs.download_url || attrs.url || attrs.link || API_URL;
    return {
      tenderNumber: extractTenderNumber(`${title} ${description}`),
      description: description || title || 'Overstrand tender (see document)',
      advertised: formatDateIso(attrs.created || attrs.publish_up || attrs.modified),
      sourceUrl
    };
  }).slice(0, limit);

  const csvRows = mapped.map(toCsvRow);
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
