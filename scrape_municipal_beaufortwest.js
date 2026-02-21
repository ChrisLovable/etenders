const { runGenericScraper } = require('./scrape_municipal_generic');

const CFG = {
  id: 'beaufortwest',
  shortName: 'Beaufort West',
  organOfState: 'Beaufort West Municipality',
  place: 'Beaufort West',
  baseUrl: 'https://www.beaufortwestmun.co.za',
  forceSourceUrl: 'https://www.beaufortwestmun.co.za/tendersquotations-available',
  urls: ['https://www.beaufortwestmun.co.za/tendersquotations-available'],
  csvFilename: 'beaufortwest_tenders.csv',
  linkSelector: 'a[href]',
  contextSelector: '.document__item, article, li, div'
};

async function runScraper(opts = {}) {
  return runGenericScraper(CFG, { ...opts, csvFilename: opts.csvFilename || CFG.csvFilename, insecure: true });
}

if (require.main === module) {
  runScraper().then(r => console.log(r.message)).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { runScraper };
