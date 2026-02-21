const { runGenericScraper } = require('./scrape_municipal_generic');

const CFG = {
  id: 'laingsburg',
  shortName: 'Laingsburg',
  organOfState: 'Laingsburg Municipality',
  place: 'Laingsburg',
  baseUrl: 'http://laingsburg.gov.za',
  urls: ['http://laingsburg.gov.za/tenders-available'],
  csvFilename: 'laingsburg_tenders.csv',
  linkSelector: 'a[href], p',
  contextSelector: 'p, .table-wrap, article, div'
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
