const { runGenericScraper } = require('./scrape_municipal_generic');

const CFG = {
  id: 'swellendam',
  shortName: 'Swellendam',
  organOfState: 'Swellendam Municipality',
  place: 'Swellendam',
  baseUrl: 'https://swellendam.gov.za',
  urls: ['https://swellendam.gov.za/business/procurement/'],
  csvFilename: 'swellendam_tenders.csv',
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
