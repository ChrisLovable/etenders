const { runGenericScraper } = require('./scrape_municipal_generic');

const CFG = {
  id: 'princealbert',
  shortName: 'Prince Albert',
  organOfState: 'Prince Albert Municipality',
  place: 'Prince Albert',
  baseUrl: 'http://pamun.gov.za',
  urls: ['http://pamun.gov.za/index.php/bids'],
  csvFilename: 'princealbert_tenders.csv',
  linkSelector: 'a[href], [data-document-card], [data-document-card-heading]',
  contextSelector: '[data-document-card], article, li, div'
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
