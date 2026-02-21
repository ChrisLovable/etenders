const { runGenericScraper } = require('./scrape_municipal_generic');

const CFG = {
  id: 'swartland',
  shortName: 'Swartland',
  organOfState: 'Swartland Municipality',
  place: 'Swartland',
  baseUrl: 'https://swartland.org.za',
  urls: ['https://swartland.org.za/tenders?status=open&tender_type=formal'],
  csvFilename: 'swartland_tenders.csv',
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
