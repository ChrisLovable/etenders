/**
 * Kou-Kamma Local Municipality tender scraper
 * Uses WP REST API media search - tenders page content is JS-rendered
 * Listing: koukammamunicipality.gov.za/tenders-and-rfq/
 */
const axios = require('axios');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');

const LISTING_URL = 'https://koukammamunicipality.gov.za/tenders-and-rfq/';
const API_URL = 'https://koukammamunicipality.gov.za/wp-json/wp/v2/media';

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

function formatDate(isoDate) {
  if (!isoDate) return '';
  const m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function extractTenderNumber(title) {
  const m = String(title || '').match(/R\.\d{3}-\d{3}-\d{4}[_\w]*|BID\s*NO\s*(\d+\/\d{4})|TENDER\s*(?:NO\.?|NUMBER)\s*(\d+[\-\/\d]*)|(\d{2}\/\d{4})/i);
  if (m) return (m[1] || m[2] || m[3] || m[0]).replace(/\s+/g, ' ').trim();
  const m2 = title.match(/TENDER\s+(\d{2})\s+(\d{4})|(\d{2})\/(\d{4})/);
  if (m2) return m2[1] && m2[2] ? `${m2[1]}/${m2[2]}` : (m2[3] && m2[4] ? `${m2[3]}/${m2[4]}` : '');
  return '';
}

async function fetchMedia(searchTerm, page = 1) {
  const { data } = await axios.get(API_URL, {
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    params: { search: searchTerm, per_page: 100, page }
  });
  return Array.isArray(data) ? data : [];
}

async function runScraper(opts = {}) {
  const outDir = opts.outDir || __dirname;
  const csvFilename = opts.csvFilename || 'koukamma_tenders.csv';
  const outPath = path.join(outDir, csvFilename);
  const limit = Number.isFinite(opts.limit) ? opts.limit : 500;

  console.log('\n🔍 SCRAPING KOU-KAMMA LOCAL MUNICIPALITY TENDERS');
  console.log('=================================================');

  const seen = new Map();
  const searchTerms = ['tender', 'bid', 'advert', 'R.062', 'BID NO'];
  for (const term of searchTerms) {
    let page = 1;
    while (true) {
      const items = await fetchMedia(term, page);
      if (items.length === 0) break;
      for (const item of items) {
        const url = item.source_url || item.guid?.rendered;
        if (!url || seen.has(item.id)) continue;
        const title = (item.title && item.title.rendered) ? item.title.rendered.replace(/&#8211;/g, '-').replace(/&#038;/g, '&').trim() : '';
        if (!title || title.length < 5) continue;
        seen.set(item.id, {
          id: item.id,
          title,
          url: url.startsWith('http') ? url : `https://www.koukammamunicipality.gov.za${url.startsWith('/') ? '' : '/'}${url}`,
          date: item.date,
          mime: item.mime_type || ''
        });
      }
      if (items.length < 100) break;
      page++;
    }
  }

  const entries = [...seen.values()]
    .filter(e => /\.pdf$/i.test(e.url) || e.mime === 'application/pdf' || /tender|bid|advert|R\.\d/i.test(e.title))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const sliced = entries.slice(0, limit);
  const csvRows = sliced.map((e, i) => ({
    'Category': 'Municipal',
    'Tender Number': extractTenderNumber(e.title) || `KKM-${String(i + 1).padStart(3, '0')}`,
    'Tender Description': e.title.slice(0, 500),
    'Advertised': formatDate(e.date),
    'Closing': '',
    'Organ Of State': 'Kou-Kamma Local Municipality',
    'Tender Type': 'Request for Bid',
    'Province': 'Eastern Cape',
    'Place where goods, works or services are required': 'Kou-Kamma (Kareedouw, Joubertina)',
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
    'Source URL': e.url,
    'Tender ID': String(e.id || ''),
    'Source': 'Kou-Kamma'
  }));

  const csvWriter = createCsvWriter({ path: outPath, header: CSV_HEADER });
  await csvWriter.writeRecords(csvRows);

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
