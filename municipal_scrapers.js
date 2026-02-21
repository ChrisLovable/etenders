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
    htmlOnly: true,
    forceSourceUrl: 'https://www.kouga.gov.za/tenders'
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
  amahlathi: {
    id: 'amahlathi',
    name: 'Amahlathi Local Municipality',
    shortName: 'Amahlathi',
    module: './scrape_municipal_amahlathi',
    csvFilename: 'amahlathi_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true,
    forceSourceUrl: 'https://amahlathi.gov.za/tenders-rfqs/'
  },
  drabxuma: {
    id: 'drabxuma',
    name: 'Dr AB Xuma Local Municipality',
    shortName: 'Dr AB Xuma',
    module: './scrape_municipal_drabxuma',
    csvFilename: 'drabxuma_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true,
    forceSourceUrl: 'https://drabxumalm.gov.za/tenders/'
  },
  beyersnaude: {
    id: 'beyersnaude',
    name: 'Beyers Naude Local Municipality',
    shortName: 'Beyers Naude',
    module: './scrape_municipal_beyersnaude',
    csvFilename: 'beyersnaude_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true,
    forceSourceUrl: 'https://bnlm.gov.za/documents/tenders/'
  },
  elundini: {
    id: 'elundini',
    name: 'Elundini Local Municipality',
    shortName: 'Elundini',
    module: './scrape_municipal_elundini',
    csvFilename: 'elundini_tenders.csv',
    defaultLimit: 50,
    htmlOnly: true,
    forceSourceUrl: 'https://elundini.gov.za/category/supplychain/tenders/'
  },
  emalahleni: {
    id: 'emalahleni',
    name: 'Emalahleni Local Municipality',
    shortName: 'Emalahleni',
    module: './scrape_municipal_emalahleni',
    csvFilename: 'emalahleni_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true,
    forceSourceUrl: 'https://emalahleni.gov.za/v2/elm-business/tenders'
  },
  greatkei: {
    id: 'greatkei',
    name: 'Great Kei Municipality',
    shortName: 'Great Kei',
    module: './scrape_municipal_greatkei',
    csvFilename: 'greatkei_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true,
    forceSourceUrl: 'https://greatkeilm.gov.za/web/category/tenders/open-tenders/'
  },
  ingquzahill: {
    id: 'ingquzahill',
    name: 'Ingquza Hill Local Municipality',
    shortName: 'Ingquza Hill',
    module: './scrape_municipal_ingquzahill',
    csvFilename: 'ingquzahill_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true,
    forceSourceUrl: 'https://www.ihlm.gov.za/tenders/'
  },
  intsikayethu: {
    id: 'intsikayethu',
    name: 'Intsika Yethu Local Municipality',
    shortName: 'Intsika Yethu',
    module: './scrape_municipal_intsikayethu',
    csvFilename: 'intsikayethu_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true,
    forceSourceUrl: 'https://intsikayethu.gov.za/cat_doc/tenders/'
  },
  inxubayethemba: {
    id: 'inxubayethemba',
    name: 'Inxuba Yethemba Local Municipality',
    shortName: 'Inxuba Yethemba',
    module: './scrape_municipal_inxubayethemba',
    csvFilename: 'inxubayethemba_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true,
    forceSourceUrl: 'https://iym.gov.za/index.php/notices/tender-advertisements/'
  },
  joegqabi: {
    id: 'joegqabi',
    name: 'Joe Gqabi District Municipality',
    shortName: 'Joe Gqabi',
    module: './scrape_municipal_joegqabi',
    csvFilename: 'joegqabi_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true,
    forceSourceUrl: 'https://jgdm.gov.za/tenders/tender-quotation-advertisements/'
  },
  ksd: {
    id: 'ksd',
    name: 'King Sabata Dalindyebo Local Municipality',
    shortName: 'King Sabata Dalindyebo',
    module: './scrape_municipal_ksd',
    csvFilename: 'ksd_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true,
    forceSourceUrl: 'https://ksd.gov.za/procurements/tenders/'
  },
  koukamma: {
    id: 'koukamma',
    name: 'Kou-Kamma Local Municipality',
    shortName: 'Kou-Kamma',
    module: './scrape_municipal_koukamma',
    csvFilename: 'koukamma_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true,
    forceSourceUrl: 'https://koukammamunicipality.gov.za/tenders-and-rfq/'
  },
  bluecrane: {
    id: 'bluecrane',
    name: 'Blue Crane Route Municipality',
    shortName: 'Blue Crane Route',
    module: './scrape_municipal_bluecrane',
    csvFilename: 'bluecrane_tenders.csv',
    defaultLimit: 500,
    htmlOnly: false
  },
  mhlontlo: {
    id: 'mhlontlo',
    name: 'Kumkani Mhlontlo Local Municipality',
    shortName: 'Kumkani Mhlontlo',
    module: './scrape_municipal_mhlontlo',
    csvFilename: 'mhlontlo_tenders.csv',
    defaultLimit: 500,
    htmlOnly: false,
    forceSourceUrl: 'https://mhlontlolm.gov.za/current-tenders/'
  },
  mbhashe: {
    id: 'mbhashe',
    name: 'Mbhashe Local Municipality',
    shortName: 'Mbhashe',
    module: './scrape_municipal_mbhashe',
    csvFilename: 'mbhashe_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true,
    forceSourceUrl: 'https://mbhashemun.gov.za/procurement/tenders/'
  },
  ntabankulu: {
    id: 'ntabankulu',
    name: 'Ntabankulu Local Municipality',
    shortName: 'Ntabankulu',
    module: './scrape_municipal_ntabankulu',
    csvFilename: 'ntabankulu_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true,
    forceSourceUrl: 'https://ntabankulu.gov.za/category/tenders/open-tenders/'
  },
  senqu: {
    id: 'senqu',
    name: 'Senqu Local Municipality',
    shortName: 'Senqu',
    module: './scrape_municipal_senqu',
    csvFilename: 'senqu_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true,
    forceSourceUrl: 'https://senqu.gov.za/formal-tenders-2025-2026/'
  },
  sakhisizwe: {
    id: 'sakhisizwe',
    name: 'Sakhisizwe Local Municipality',
    shortName: 'Sakhisizwe',
    module: './scrape_municipal_sakhisizwe',
    csvFilename: 'sakhisizwe_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true,
    forceSourceUrl: 'https://slm.gov.za/supply-chain-management/tenders/'
  },
  nyandeni: {
    id: 'nyandeni',
    name: 'Nyandeni Local Municipality',
    shortName: 'Nyandeni',
    module: './scrape_municipal_nyandeni',
    csvFilename: 'nyandeni_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true,
    forceSourceUrl: 'https://nyandenilm.gov.za/tenders-index'
  },
  ortambo: {
    id: 'ortambo',
    name: 'O.R. Tambo District Municipality',
    shortName: 'O.R. Tambo',
    module: './scrape_municipal_ortambo',
    csvFilename: 'ortambo_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true,
    forceSourceUrl: 'https://ortambodm.gov.za/tenders/'
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
  },
  capetown: {
    id: 'capetown',
    name: 'City of Cape Town',
    shortName: 'Cape Town',
    module: './scrape_municipal_capetown',
    csvFilename: 'capetown_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true,
    forceSourceUrl: 'https://web1.capetown.gov.za/web1/tenderportal/Tender'
  },
  westcoastdm: {
    id: 'westcoastdm',
    name: 'West Coast District Municipality',
    shortName: 'West Coast DM',
    module: './scrape_municipal_westcoastdm',
    csvFilename: 'westcoastdm_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true
  },
  beaufortwest: {
    id: 'beaufortwest',
    name: 'Beaufort West Municipality',
    shortName: 'Beaufort West',
    module: './scrape_municipal_beaufortwest',
    csvFilename: 'beaufortwest_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true
  },
  bergrivier: {
    id: 'bergrivier',
    name: 'Bergrivier Municipality',
    shortName: 'Bergrivier',
    module: './scrape_municipal_bergrivier',
    csvFilename: 'bergrivier_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true
  },
  cederberg: {
    id: 'cederberg',
    name: 'Cederberg Municipality',
    shortName: 'Cederberg',
    module: './scrape_municipal_cederberg',
    csvFilename: 'cederberg_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true
  },
  laingsburg: {
    id: 'laingsburg',
    name: 'Laingsburg Municipality',
    shortName: 'Laingsburg',
    module: './scrape_municipal_laingsburg',
    csvFilename: 'laingsburg_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true
  },
  langeberg: {
    id: 'langeberg',
    name: 'Langeberg Municipality',
    shortName: 'Langeberg',
    module: './scrape_municipal_langeberg',
    csvFilename: 'langeberg_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true
  },
  oudtshoorn: {
    id: 'oudtshoorn',
    name: 'Oudtshoorn Municipality',
    shortName: 'Oudtshoorn',
    module: './scrape_municipal_oudtshoorn',
    csvFilename: 'oudtshoorn_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true
  },
  overstrand: {
    id: 'overstrand',
    name: 'Overstrand Municipality',
    shortName: 'Overstrand',
    module: './scrape_municipal_overstrand',
    csvFilename: 'overstrand_tenders.csv',
    defaultLimit: 40,
    htmlOnly: true
  },
  princealbert: {
    id: 'princealbert',
    name: 'Prince Albert Municipality',
    shortName: 'Prince Albert',
    module: './scrape_municipal_princealbert',
    csvFilename: 'princealbert_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true
  },
  saldanhabay: {
    id: 'saldanhabay',
    name: 'Saldanha Bay Municipality',
    shortName: 'Saldanha Bay',
    module: './scrape_municipal_saldanhabay',
    csvFilename: 'saldanhabay_tenders.csv',
    defaultLimit: 45,
    htmlOnly: true
  },
  stellenbosch: {
    id: 'stellenbosch',
    name: 'Stellenbosch Municipality',
    shortName: 'Stellenbosch',
    module: './scrape_municipal_stellenbosch',
    csvFilename: 'stellenbosch_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true
  },
  sundaysrivervalley: {
    id: 'sundaysrivervalley',
    name: 'Sundays River Valley Local Municipality',
    shortName: 'Sundays River Valley',
    module: './scrape_municipal_sundaysrivervalley',
    csvFilename: 'sundaysrivervalley_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true,
    forceSourceUrl: 'https://srvm.gov.za/tenders/'
  },
  umzimvubu: {
    id: 'umzimvubu',
    name: 'Umzimvubu Local Municipality',
    shortName: 'Umzimvubu',
    module: './scrape_municipal_umzimvubu',
    csvFilename: 'umzimvubu_tenders.csv',
    defaultLimit: 100,
    htmlOnly: false,
    forceSourceUrl: 'https://umzimvubu.gov.za/rfq-adverts/'
  },
  swartland: {
    id: 'swartland',
    name: 'Swartland Municipality',
    shortName: 'Swartland',
    module: './scrape_municipal_swartland',
    csvFilename: 'swartland_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true
  },
  swellendam: {
    id: 'swellendam',
    name: 'Swellendam Municipality',
    shortName: 'Swellendam',
    module: './scrape_municipal_swellendam',
    csvFilename: 'swellendam_tenders.csv',
    defaultLimit: 45,
    htmlOnly: true
  },
  winniemadikizelamandela: {
    id: 'winniemadikizelamandela',
    name: 'Winnie Madikizela-Mandela Local Municipality',
    shortName: 'Winnie Madikizela-Mandela',
    module: './scrape_municipal_winniemadikizelamandela',
    csvFilename: 'winniemadikizelamandela_tenders.csv',
    defaultLimit: 500,
    htmlOnly: true,
    forceSourceUrl: 'https://winniemmlm.gov.za/tenders/'
  }
};

function getScraper(id) {
  return SCRAPERS[id] || null;
}

function listScrapers() {
  return Object.values(SCRAPERS);
}

module.exports = { SCRAPERS, getScraper, listScrapers };
