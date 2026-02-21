const { runGenericScraper } = require('./scrape_municipal_generic');

const CFG = {
  id: 'bergrivier',
  shortName: 'Bergrivier',
  organOfState: 'Bergrivier Municipality',
  place: 'Bergrivier',
  baseUrl: 'https://www.bergmun.org.za',
  forceSourceUrl: 'https://www.bergmun.org.za/tenders-quotations-available',
  urls: ['https://www.bergmun.org.za/tenders-quotations-available'],
  csvFilename: 'bergrivier_tenders.csv',
  linkSelector: 'a[href]',
  contextSelector: '.document__item, article, li, div',
  insecure: true
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
