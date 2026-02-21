const { runGenericScraper } = require('./scrape_municipal_generic');

const CFG = {
  id: 'cederberg',
  shortName: 'Cederberg',
  organOfState: 'Cederberg Municipality',
  place: 'Cederberg',
  baseUrl: 'http://cederbergmun.gov.za',
  forceSourceUrl: 'http://cederbergmun.gov.za/tenders-quotations-available-0',
  urls: ['http://cederbergmun.gov.za/tenders-quotations-available-0'],
  csvFilename: 'cederberg_tenders.csv',
  linkSelector: 'a[href]',
  contextSelector: '.document__item, article, li, div'
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
