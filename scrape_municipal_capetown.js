const { runGenericScraper } = require('./scrape_municipal_generic');

const CFG = {
  id: 'capetown',
  shortName: 'Cape Town',
  organOfState: 'City of Cape Town',
  place: 'Cape Town',
  baseUrl: 'https://web1.capetown.gov.za',
  urls: ['https://web1.capetown.gov.za/web1/tenderportal/Tender'],
  csvFilename: 'capetown_tenders.csv',
  linkSelector: 'a[href], tr td',
  contextSelector: 'tr, table, section, div'
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
