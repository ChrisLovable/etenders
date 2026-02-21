const { runGenericScraper } = require('./scrape_municipal_generic');

const CFG = {
  id: 'westcoastdm',
  shortName: 'West Coast DM',
  organOfState: 'West Coast District Municipality',
  place: 'West Coast District',
  baseUrl: 'https://westcoastdm.co.za',
  urls: ['https://westcoastdm.co.za/tenders-quotations/'],
  csvFilename: 'westcoastdm_tenders.csv',
  linkSelector: 'a[href]',
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
