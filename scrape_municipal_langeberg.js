const { runGenericScraper } = require('./scrape_municipal_generic');

const CFG = {
  id: 'langeberg',
  shortName: 'Langeberg',
  organOfState: 'Langeberg Municipality',
  place: 'Langeberg',
  baseUrl: 'https://langeberg.gov.za',
  forceSourceUrl: 'https://langeberg.gov.za/notices/procurement/tender-advertisements.html',
  urls: ['https://langeberg.gov.za/notices/procurement/tender-advertisements.html'],
  csvFilename: 'langeberg_tenders.csv',
  linkSelector: 'a[href], .docman_document',
  contextSelector: '.docman_document, article, li, div'
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
