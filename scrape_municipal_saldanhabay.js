const { runGenericScraper } = require('./scrape_municipal_generic');

const CFG = {
  id: 'saldanhabay',
  shortName: 'Saldanha Bay',
  organOfState: 'Saldanha Bay Municipality',
  place: 'Saldanha Bay',
  baseUrl: 'https://sbm.gov.za',
  urls: [
    'https://sbm.gov.za/quotations-r30000-below/',
    'https://sbm.gov.za/quotations-above-r30000/',
    'https://sbm.gov.za/tenders-r300-000-and-more/'
  ],
  csvFilename: 'saldanhabay_tenders.csv',
  linkSelector: 'a[href], article, li',
  contextSelector: 'article, li, div'
};

async function runScraper(opts = {}) {
  return runGenericScraper(CFG, { ...opts, csvFilename: opts.csvFilename || CFG.csvFilename });
}

if (require.main === module) {
  runScraper().then(r => console.log(r.message)).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { runScraper };
