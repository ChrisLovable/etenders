const { runGenericScraper } = require('./scrape_municipal_generic');

const CFG = {
  id: 'stellenbosch',
  shortName: 'Stellenbosch',
  organOfState: 'Stellenbosch Municipality',
  place: 'Stellenbosch',
  baseUrl: 'https://www.stellenbosch.gov.za',
  urls: ['https://www.stellenbosch.gov.za/open-tenders/'],
  csvFilename: 'stellenbosch_tenders.csv',
  linkSelector: 'a[href], article, tr',
  contextSelector: 'article, tr, li, div'
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
