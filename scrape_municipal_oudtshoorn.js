const { runGenericScraper } = require('./scrape_municipal_generic');

const CFG = {
  id: 'oudtshoorn',
  shortName: 'Oudtshoorn',
  organOfState: 'Oudtshoorn Municipality',
  place: 'Oudtshoorn',
  baseUrl: 'https://www.oudtshoorn.gov.za',
  forceSourceUrl: 'https://www.oudtshoorn.gov.za/procurement/',
  urls: ['https://www.oudtshoorn.gov.za/procurement/'],
  csvFilename: 'oudtshoorn_tenders.csv',
  linkSelector: 'a[href], tr, li',
  contextSelector: 'tr, table, article, li, div'
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
