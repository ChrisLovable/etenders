/**
 * Registry of municipal scrapers - maps municipality id to scraper module
 * CRITICAL RULES:
 * 1. All scrapers use defaultLimit: 500. Never use 5 or any low limit.
 * 2. Each municipality MUST show ONLY its own tenders - never Matjhabeng when Amathole requested.
 * 3. Server must require(config.module) for the REQUESTED municipality - never default to matjhabeng.
 */
const SCRAPERS = {
  matjhabeng: {
    id: 'matjhabeng',
    name: 'Matjhabeng Local Municipality',
    shortName: 'Matjhabeng',
    module: './scrape_municipal_matjhabeng',
    csvFilename: 'matjhabeng_tenders.csv',
    defaultLimit: 500,
    htmlOnly: false  // Matjhabeng parses PDFs
  },
  mangaung: {
    id: 'mangaung',
    name: 'Mangaung Metropolitan Municipality',
    shortName: 'Mangaung',
    module: './scrape_municipal_mangaung',
    csvFilename: 'mangaung_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true   // Mangaung is HTML-only (table pages)
  },
  nelsonmandelabay: {
    id: 'nelsonmandelabay',
    name: 'Nelson Mandela Bay Metropolitan Municipality',
    shortName: 'Nelson Mandela Bay',
    module: './scrape_municipal_nelsonmandelabay',
    csvFilename: 'nelsonmandelabay_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true
  },
  buffalocity: {
    id: 'buffalocity',
    name: 'Buffalo City Metropolitan Municipality',
    shortName: 'Buffalo City',
    module: './scrape_municipal_buffalocity',
    csvFilename: 'buffalocity_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true
  },
  sarahbaartman: {
    id: 'sarahbaartman',
    name: 'Sarah Baartman District Municipality',
    shortName: 'Sarah Baartman',
    module: './scrape_municipal_sarahbaartman',
    csvFilename: 'sarahbaartman_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true
  },
  kouga: {
    id: 'kouga',
    name: 'Kouga Municipality',
    shortName: 'Kouga',
    module: './scrape_municipal_kouga',
    csvFilename: 'kouga_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true
  },
  amathole: {
    id: 'amathole',
    name: 'Amathole District Municipality',
    shortName: 'Amathole',
    module: './scrape_municipal_amathole',
    csvFilename: 'amathole_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true
  },
  masilonyana: {
    id: 'masilonyana',
    name: 'Masilonyana Local Municipality',
    shortName: 'Masilonyana',
    module: './scrape_municipal_masilonyana',
    csvFilename: 'masilonyana_tenders.csv',
    defaultLimit: 20,
    htmlOnly: false  // Parse PDFs; uses parallel processing to avoid timeout
  },
  mohokare: {
    id: 'mohokare',
    name: 'Mohokare Local Municipality',
    shortName: 'Mohokare',
    module: './scrape_municipal_mohokare',
    csvFilename: 'mohokare_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true
  },
  moqhaka: {
    id: 'moqhaka',
    name: 'Moqhaka Local Municipality',
    shortName: 'Moqhaka',
    module: './scrape_municipal_moqhaka',
    csvFilename: 'moqhaka_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true
  },
  nketoana: {
    id: 'nketoana',
    name: 'Nketoana Local Municipality',
    shortName: 'Nketoana',
    module: './scrape_municipal_nketoana',
    csvFilename: 'nketoana_tenders.csv',
    defaultLimit: 15,
    htmlOnly: false
  },
  phumelela: {
    id: 'phumelela',
    name: 'Phumelela Local Municipality',
    shortName: 'Phumelela',
    module: './scrape_municipal_phumelela',
    csvFilename: 'phumelela_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true
  }
};

function getScraper(id) {
  return SCRAPERS[id] || null;
}

function listScrapers() {
  return Object.values(SCRAPERS);
}

module.exports = { SCRAPERS, getScraper, listScrapers };
