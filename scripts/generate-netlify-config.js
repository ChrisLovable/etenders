#!/usr/bin/env node
/**
 * Auto-generates netlify.toml from municipal_scrapers.js (source of truth).
 * Also runs merge-municipal-csvs.js so all_municipal_tenders.csv stays in sync.
 * Run: node scripts/generate-netlify-config.js
 * Or: npm run generate-config
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');

// Run merge so all_municipal_tenders.csv includes all municipalities from municipal_scrapers.js
try {
  execSync('node scripts/merge-municipal-csvs.js', { cwd: projectRoot, stdio: 'inherit' });
} catch (_) {
  console.warn('merge-municipal-csvs.js failed (may be ok if no municipal CSVs exist yet)');
}
const { listScrapers } = require(path.join(projectRoot, 'municipal_scrapers.js'));

const scrapers = listScrapers();
const csvFilenames = scrapers.map(s => s.csvFilename).filter(Boolean);
const scraperModules = scrapers.map(s => {
  const mod = s.module || '';
  const base = mod.replace(/^\.\//, '');
  return base ? `${base}.js` : null;
}).filter(Boolean);

// Build the inline node script for copying CSVs (use single quotes to avoid TOML escaping)
const csvArray = `['${csvFilenames.join("','")}']`;
const copyScript = `const fs=require('fs'); fs.mkdirSync('web/data',{recursive:true}); fs.mkdirSync('web/assets',{recursive:true}); fs.copyFileSync('advertised_tenders.csv','web/data/advertised_tenders.csv'); if(fs.existsSync('etender_gov_data.csv')) fs.copyFileSync('etender_gov_data.csv','web/data/etender_gov_data.csv'); if(fs.existsSync('ai_opportunities.csv')) fs.copyFileSync('ai_opportunities.csv','web/data/ai_opportunities.csv'); ${csvArray}.forEach(f=>{if(fs.existsSync(f))fs.copyFileSync(f,'web/data/'+f)}); const p192=fs.existsSync('public/proper192.png')?'public/proper192.png':(fs.existsSync('public/PROPER192.png')?'public/PROPER192.png':null); const p512=fs.existsSync('public/proper512.png')?'public/proper512.png':(fs.existsSync('public/PROPER512.png')?'public/PROPER512.png':null); if(p192) fs.copyFileSync(p192,'web/assets/proper192.png'); if(p512) fs.copyFileSync(p512,'web/assets/proper512.png');`;

// Escape " for TOML (only the outer node -e quotes)
const buildCommand = `node scripts/generate_etender_gov_data.js && node scripts/merge-municipal-csvs.js && node -e \\"${copyScript}\\"`;

// included_files for Netlify serverless functions
const includedFiles = [
  './advertised_tenders.csv',
  './ai_opportunities.csv',
  './lib',
  './municipal_scrapers.js',
  ...scraperModules.map(f => `./${f}`)
];

const netlifyToml = `[build]
  functions = "netlify/functions"
  publish = "web"
  command = "${buildCommand}"

[functions]
  included_files = ${JSON.stringify(includedFiles)}

# Serve static files from CDN; only proxy API and dynamic routes to the serverless function
# Use :splat to preserve path so Express can route /api/scrape/municipal etc.
[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/server/api/:splat"
  status = 200
  force = true

[[redirects]]
  from = "/tender/*"
  to = "/.netlify/functions/server"
  status = 200
  force = true

[[redirects]]
  from = "/tender-lookup"
  to = "/.netlify/functions/server"
  status = 200
  force = true

# /data/* served from CDN (web/data/) - no function needed for static CSV
`;

const outPath = path.join(projectRoot, 'netlify.toml');
fs.writeFileSync(outPath, netlifyToml, 'utf8');

console.log('✅ netlify.toml updated with', scrapers.length, 'municipalities');
console.log('   CSV files:', csvFilenames.length);
console.log('   Scraper modules:', scraperModules.length);
