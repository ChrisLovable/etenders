require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const XLSX = require('xlsx');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true })); // Allow same-origin; CORS for any origin in dev
app.use((req, res, next) => { console.log(`📨 ${req.method} ${req.url}`); next(); });

// Serverless (Netlify, Lambda, etc.): filesystem is read-only except /tmp - ALWAYS use /tmp explicitly
const IS_SERVERLESS = !!(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
const TMP_CSV = '/tmp/advertised_tenders.csv';
const TMP_ETENDER_GOV = '/tmp/etender_gov_data.csv';
const TMP_FLAGS = '/tmp/flags.json';
const TMP_EMPLOYEES = '/tmp/employees.json';
const EMPLOYEES_FILENAME = 'employees.json';
const CSV_FILENAME = 'advertised_tenders.csv';
const ETENDER_GOV_FILENAME = 'etender_gov_data.csv';
const TENDER_ALERTS_FILENAME = 'tender_alerts.csv';
const FLAGS_FILENAME = 'flags.json';
const MUNICIPALITIES_WORKBOOK_CANDIDATES = [
	path.join(__dirname, 'public', 'municipalities.xlsx'),
	path.join(__dirname, 'public', 'Municipalities.xlsx'),
	path.join(__dirname, 'public', 'municipalities.xls'),
	path.join(__dirname, 'public', 'Municipalities.xls'),
	path.join(__dirname, '..', 'public', 'municipalities.xlsx'),
	path.join(__dirname, '..', 'public', 'Municipalities.xlsx'),
	path.join(__dirname, '..', 'public', 'municipalities.xls'),
	path.join(__dirname, '..', 'public', 'Municipalities.xls')
];
const DEFAULT_PROVINCE_BY_ID = new Map([
	['matjhabeng', 'Free State'],
	['mangaung', 'Free State'],
	['masilonyana', 'Free State'],
	['mohokare', 'Free State'],
	['moqhaka', 'Free State'],
	['nketoana', 'Free State'],
	['phumelela', 'Free State'],
	['nelsonmandelabay', 'Eastern Cape'],
	['buffalocity', 'Eastern Cape'],
	['sarahbaartman', 'Eastern Cape'],
	['kouga', 'Eastern Cape'],
	['amathole', 'Eastern Cape'],
	['capetown', 'Western Cape'],
	['westcoastdm', 'Western Cape'],
	['beaufortwest', 'Western Cape'],
	['bergrivier', 'Western Cape'],
	['cederberg', 'Western Cape'],
	['laingsburg', 'Western Cape'],
	['langeberg', 'Western Cape'],
	['oudtshoorn', 'Western Cape'],
	['overstrand', 'Western Cape'],
	['princealbert', 'Western Cape'],
	['saldanhabay', 'Western Cape'],
	['stellenbosch', 'Western Cape'],
	['swartland', 'Western Cape'],
	['swellendam', 'Western Cape']
]);

app.use(express.json());
// Netlify rewrites /api/* to /.netlify/functions/server/api/:splat - normalize so /api/* routes match
app.use((req, res, next) => {
	if (req.path.startsWith('/.netlify/functions/server/api/')) {
		req.url = req.url.replace('/.netlify/functions/server', '') || '/';
	}
	next();
});
app.use(express.static(path.join(__dirname, 'web')));

// Serve advertised_tenders.csv - /tmp if updated (serverless), else project root (local)
app.get('/data/advertised_tenders.csv', (req, res) => {
	const p = (IS_SERVERLESS && fs.existsSync(TMP_CSV)) ? TMP_CSV : path.join(__dirname, CSV_FILENAME);
	res.type('text/csv').sendFile(path.resolve(p));
});

// Serve etender_gov_data.csv - eTenders.gov.za numbers + descriptions only (no municipal data)
app.get('/data/etender_gov_data.csv', (req, res) => {
	const p = (IS_SERVERLESS && fs.existsSync(TMP_ETENDER_GOV)) ? TMP_ETENDER_GOV : path.join(__dirname, ETENDER_GOV_FILENAME);
	if (!fs.existsSync(p)) return res.status(404).send('etender_gov_data.csv not found');
	res.type('text/csv').sendFile(path.resolve(p));
});

// Serve other data files from project root (local only; /data/* served by CDN in prod)
app.use('/data', express.static(__dirname));

function normalizeMunicipalityToken(value) {
	return String(value || '')
		.toLowerCase()
		.replace(/municipality|local|district|metropolitan|metro/g, '')
		.replace(/[^a-z0-9]+/g, '')
		.trim();
}

function getMunicipalWorkbookPath() {
	for (const p of MUNICIPALITIES_WORKBOOK_CANDIDATES) {
		if (fs.existsSync(p)) return p;
	}
	return '';
}

function normalizeProvinceToken(value) {
	return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
}

function toCanonicalProvince(value) {
	const token = normalizeProvinceToken(value);
	const map = {
		easterncape: 'Eastern Cape',
		freestate: 'Free State',
		gauteng: 'Gauteng',
		kwazulunatal: 'KwaZulu-Natal',
		limpopo: 'Limpopo',
		mpumalanga: 'Mpumalanga',
		northerncape: 'Northern Cape',
		northwest: 'North West',
		westerncape: 'Western Cape',
		wc: 'Western Cape',
		fs: 'Free State',
		ec: 'Eastern Cape',
		gp: 'Gauteng',
		kzn: 'KwaZulu-Natal',
		lp: 'Limpopo',
		mp: 'Mpumalanga',
		nc: 'Northern Cape',
		nw: 'North West'
	};
	return map[token] || '';
}

function extractProvinceFromWorkbookRow(row) {
	const entries = Object.entries(row || {});
	for (const [k, v] of entries) {
		if (!/province/i.test(String(k || ''))) continue;
		const p = toCanonicalProvince(v);
		if (p) return p;
	}
	for (const [, v] of entries) {
		const p = toCanonicalProvince(v);
		if (p) return p;
	}
	return '';
}

function getWorkbookMunicipalityConfig(scrapers) {
	const workbookPath = getMunicipalWorkbookPath();
	if (!workbookPath) return null;
	try {
		const wb = XLSX.readFile(workbookPath);
		const sheetName = wb.SheetNames[0];
		if (!sheetName) return null;
		const sheet = wb.Sheets[sheetName];
		const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
		if (!Array.isArray(rows) || rows.length === 0) return null;

		const byId = new Map(scrapers.map(s => [String(s.id || '').toLowerCase(), s.id]));
		const byName = new Map();
		for (const s of scrapers) {
			const keys = [s.shortName, s.name, s.id];
			for (const k of keys) {
				const nk = normalizeMunicipalityToken(k);
				if (nk) byName.set(nk, s.id);
			}
		}

		const allowed = new Set();
		const provinceById = new Map();
		for (const row of rows) {
			let matchedId = '';
			const values = Object.values(row);
			for (const raw of values) {
				const val = String(raw || '').trim();
				if (!val) continue;
				const asId = val.toLowerCase();
				if (byId.has(asId)) {
					matchedId = byId.get(asId);
					break;
				}
				const nk = normalizeMunicipalityToken(val);
				if (byName.has(nk)) {
					matchedId = byName.get(nk);
					break;
				}
			}
			if (!matchedId) continue;
			allowed.add(matchedId);
			const province = extractProvinceFromWorkbookRow(row);
			if (province) provinceById.set(matchedId, province);
		}

		if (!allowed.size) return null;
		return { allowedIds: allowed, provinceById };
	} catch (err) {
		console.warn('Could not parse municipalities.xlsx:', err.message);
		return null;
	}
}

function parseCsvDate(value) {
	if (!value) return new Date('1900-01-01');
	const [dd, mm, yyyy] = String(value).split('/');
	return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
}

function formatDate(d) {
	const dd = String(d.getDate()).padStart(2, '0');
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const yyyy = d.getFullYear();
	return `${dd}/${mm}/${yyyy}`;
}

function parseIsoDateTimeToCsv(value) {
	const raw = String(value || '').trim();
	if (!raw || /^n\/a$/i.test(raw)) return '';
	const d = new Date(raw);
	if (isNaN(d.getTime())) return raw;
	return formatDate(d);
}

async function fetchAdvertisedAll() {
	const baseUrl = 'https://www.etenders.gov.za/Home/PaginatedTenderOpportunities';
	const headers = {
		'User-Agent': 'Mozilla/5.0',
		'X-Requested-With': 'XMLHttpRequest',
		'Referer': 'https://www.etenders.gov.za/Home/opportunities?id=1'
	};
	let start = 0;
	const length = 200;
	let all = [];
	while (true) {
		const { data } = await axios.get(baseUrl, { params: { status: 1, start, length, draw: start / length + 1 }, headers });
		const rows = (data && Array.isArray(data.data)) ? data.data : [];
		if (rows.length === 0) break;
		all = all.concat(rows);
		start += rows.length;
		if (typeof data.recordsTotal === 'number' && start >= data.recordsTotal) break;
		if (start > 5000) break; // safety cap
	}
	const baseSourceUrl = 'https://www.etenders.gov.za/Home/opportunities?id=1';
	return all.map(r => {
		const id = r.id;
		const tenderNumber = r.tender_No || '';
		const sourceUrl = id
			? `/tender/${id}`
			: (tenderNumber ? `${baseSourceUrl}&search=${encodeURIComponent(tenderNumber)}` : baseSourceUrl);
		return {
			category: r.category,
			tenderNumber,
			tenderId: id ? String(id) : '',
			sourceUrl,
			description: r.description,
			advertised: formatDate(new Date(r.date_Published)),
			closing: r.closing_Date ? formatDate(new Date(r.closing_Date)) : '',
			organOfState: r.organ_of_State || '',
			tenderType: r.type || '',
			province: r.province || '',
			placeWhereRequired: [r.streetname, r.surburb, r.town, r.code].filter(Boolean).join(', '),
			specialConditions: r.conditions || '',
			contactPerson: r.contactPerson || '',
			email: r.email || '',
			telephone: r.telephone || '',
			fax: r.fax || '',
			briefingSession: r.briefingSession === true ? 'Yes' : (r.briefingSession === false ? 'No' : ''),
			briefingCompulsory: r.briefingCompulsory === true ? 'Yes' : (r.briefingCompulsory === false ? 'No' : ''),
			briefingDateTime: '',
			briefingVenue: r.briefingVenue || '',
			eSubmission: r.eSubmission === true ? 'Yes' : (r.eSubmission === false ? 'No' : ''),
			twoEnvelopeSubmission: r.twoEnvelopeSubmission === true ? 'Yes' : (r.twoEnvelopeSubmission === false ? 'No' : '')
		};
	});
}

function normalizeWhitespace(s) {
	return String(s || '').replace(/\s+/g, ' ').trim();
}

function parseTenderAlertCards(html) {
	const $ = cheerio.load(html);
	const items = [];
	const cards = $('h6').toArray();
	for (const h of cards) {
		const title = normalizeWhitespace($(h).text());
		if (!title) continue;
		const container = $(h).closest('article, .card, .search-result, .result, .row, li, div');
		const blockText = normalizeWhitespace(container.text() || '');
		if (!/Tender no:/i.test(blockText) || !/Province where service required:/i.test(blockText)) continue;
		const tenderNo = (blockText.match(/Tender no:\s*([^\n\r]+?)\s*(Province where service required:|Closing date & time:|Briefing date & time:|$)/i) || [])[1] || '';
		const province = (blockText.match(/Province where service required:\s*([^\n\r]+?)\s*(Closing date & time:|Briefing date & time:|Tender no:|$)/i) || [])[1] || '';
		const closingRaw = (blockText.match(/Closing date & time:\s*([^\n\r]+?)\s*(Briefing date & time:|Tender no:|$)/i) || [])[1] || '';
		const briefingRaw = (blockText.match(/Briefing date & time:\s*([^\n\r]+?)\s*(Tender no:|$)/i) || [])[1] || '';
		const tenderNumber = normalizeWhitespace(tenderNo);
		const description = normalizeWhitespace(title);
		if (!tenderNumber || !description) continue;
		items.push({
			'Category': 'TenderAlerts',
			'Tender Number': tenderNumber,
			'Tender Description': description,
			'Advertised': '',
			'Closing': parseIsoDateTimeToCsv(closingRaw),
			'Organ Of State': '',
			'Tender Type': '',
			'Province': normalizeWhitespace(province),
			'Place where goods, works or services are required': '',
			'Special Conditions': '',
			'Contact Person': '',
			'Email': '',
			'Telephone number': '',
			'FAX Number': '',
			'Is there a briefing session?': '',
			'Is it compulsory?': '',
			'Briefing Date and Time': normalizeWhitespace(briefingRaw),
			'Briefing Venue': '',
			'eSubmission': '',
			'Two Envelope Submission': '',
			'Source URL': 'https://tenderalerts.co.za/tenders/all',
			'Tender ID': ''
		});
	}
	return items;
}

async function fetchTenderAlertsAll(maxPages = 8) {
	const out = [];
	const seen = new Set();
	for (let page = 1; page <= maxPages; page++) {
		const url = page === 1
			? 'https://tenderalerts.co.za/tenders/all'
			: `https://tenderalerts.co.za/tenders/all?page=${page}`;
		const { data: html } = await axios.get(url, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
		const rows = parseTenderAlertCards(html);
		if (rows.length === 0) break;
		for (const r of rows) {
			const key = `${r['Tender Number']}|${r['Tender Description']}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(r);
		}
	}
	return out;
}

app.get('/api/update', async (req, res) => {
	try {
		// Serverless: use /tmp ONLY - never /var/task. Bootstrap from CDN if /tmp empty.
		let readPath = TMP_CSV;
		if (IS_SERVERLESS && !fs.existsSync(TMP_CSV)) {
			try {
				const base = req.headers['x-forwarded-proto'] ? `${req.headers['x-forwarded-proto']}://${req.headers['x-forwarded-host'] || req.headers.host}` : `https://${req.headers.host || 'localhost'}`;
				const { data } = await axios.get(`${base}/data/advertised_tenders.csv`, { timeout: 10000 });
				fs.writeFileSync(TMP_CSV, data);
			} catch (_) { /* start with empty */ }
		} else if (!IS_SERVERLESS) {
			readPath = path.join(__dirname, CSV_FILENAME);
		}

		let existing = [];
		let lastMax = new Date('1900-01-01');
		let seenNumbers = new Set();
		if (fs.existsSync(readPath)) {
			const raw = fs.readFileSync(readPath, 'utf8');
			existing = parse(raw, { columns: true, skip_empty_lines: true });
			for (const r of existing) {
				if (r['Tender Number']) seenNumbers.add(r['Tender Number']);
				const d = parseCsvDate(r['Advertised']);
				if (d > lastMax) lastMax = d;
			}
		}

		const allRemote = await fetchAdvertisedAll();
		const newOnes = allRemote.filter(r => parseCsvDate(r.advertised) > lastMax && !seenNumbers.has(r.tenderNumber));
		const added = newOnes.length;
		let merged = existing.map(r => ({
			...r,
			'Source URL': r['Source URL'] || '',
			'Tender ID': r['Tender ID'] || ''
		}));
		let csv = '';
		if (added > 0) {
			merged = [...newOnes.map(r => ({
				'Category': r.category,
				'Tender Number': r.tenderNumber,
				'Tender Description': r.description,
				'Advertised': r.advertised,
				'Closing': r.closing,
				'Organ Of State': r.organOfState,
				'Tender Type': r.tenderType,
				'Province': r.province,
				'Place where goods, works or services are required': r.placeWhereRequired,
				'Special Conditions': r.specialConditions,
				'Contact Person': r.contactPerson,
				'Email': r.email,
				'Telephone number': r.telephone,
				'FAX Number': r.fax,
				'Is there a briefing session?': r.briefingSession,
				'Is it compulsory?': r.briefingCompulsory,
				'Briefing Date and Time': r.briefingDateTime,
				'Briefing Venue': r.briefingVenue,
				'eSubmission': r.eSubmission,
				'Two Envelope Submission': r.twoEnvelopeSubmission,
				'Source URL': r.sourceUrl || '',
				'Tender ID': r.tenderId || ''
			})), ...merged];
			csv = stringify(merged, { header: true });
			const outCsvPath = IS_SERVERLESS ? TMP_CSV : path.join(__dirname, CSV_FILENAME);
			fs.writeFileSync(outCsvPath, csv);
		}
		// Always refresh etender_gov_data.csv from the currently known national dataset.
		const govRows = merged.map(r => ({ 'Tender Number': r['Tender Number'] || '', 'Tender Description': r['Tender Description'] || '' }));
		const govCsv = stringify(govRows, { header: true });
		const govPath = IS_SERVERLESS ? TMP_ETENDER_GOV : path.join(__dirname, ETENDER_GOV_FILENAME);
		fs.writeFileSync(govPath, govCsv);

		// Tender Alerts scrape/update (best-effort, does not fail whole update).
		let tenderAlertsAdded = 0;
		try {
			const alertsPath = path.join(__dirname, TENDER_ALERTS_FILENAME);
			const existingAlerts = fs.existsSync(alertsPath)
				? parse(fs.readFileSync(alertsPath, 'utf8'), { columns: true, skip_empty_lines: true })
				: [];
			const alertSeen = new Set(existingAlerts.map(r => `${(r['Tender Number'] || '').trim()}|${(r['Tender Description'] || '').trim()}`));
			const fetchedAlerts = await fetchTenderAlertsAll();
			const newAlerts = fetchedAlerts.filter(r => !alertSeen.has(`${(r['Tender Number'] || '').trim()}|${(r['Tender Description'] || '').trim()}`));
			tenderAlertsAdded = newAlerts.length;
			const mergedAlerts = [...newAlerts, ...existingAlerts];
			const alertsCsv = stringify(mergedAlerts, { header: true });
			fs.writeFileSync(alertsPath, alertsCsv);
		} catch (alertErr) {
			console.warn('TenderAlerts update failed:', alertErr.message);
		}

		const message = `${added} eTenders update(s), ${tenderAlertsAdded} TenderAlerts update(s)`;
		res.json({
			added,
			lastAdvertised: formatDate(lastMax),
			tenderAlertsAdded,
			message,
			...(csv ? { csv } : {})
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Flags: Supabase (when configured) or JSON file fallback
const FLAGS_PATH = IS_SERVERLESS ? TMP_FLAGS : path.join(__dirname, FLAGS_FILENAME);
const supabase = require('./lib/supabase');

async function loadFlags() {
	if (supabase.isEnabled()) {
		const fromDb = await supabase.getAllFlags();
		if (fromDb !== null) return fromDb;
	}
	try {
		if (fs.existsSync(FLAGS_PATH)) {
			const raw = fs.readFileSync(FLAGS_PATH, 'utf8');
			return JSON.parse(raw);
		}
	} catch (e) {}
	return {};
}

async function saveFlag(tenderNumber, data) {
	if (supabase.isEnabled()) {
		const ok = await supabase.upsertFlag(tenderNumber, data);
		if (ok) return true;
	}
	try {
		const flags = await loadFlags();
		flags[tenderNumber] = data;
		fs.writeFileSync(FLAGS_PATH, JSON.stringify(flags, null, 2));
		return true;
	} catch (e) {
		if (e.code === 'EROFS') return true;
		return false;
	}
}

// Lookup tender by number - searches API and redirects to /tender/:id when found
app.get('/tender-lookup', async (req, res) => {
	const tenderNumber = (req.query.tenderNumber || '').trim();
	if (!tenderNumber) return res.status(400).send('tenderNumber required');
	const baseUrl = 'https://www.etenders.gov.za/Home/PaginatedTenderOpportunities';
	const headers = {
		'User-Agent': 'Mozilla/5.0',
		'X-Requested-With': 'XMLHttpRequest',
		'Referer': 'https://www.etenders.gov.za/Home/opportunities?id=1'
	};
	const normalize = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
	const want = normalize(tenderNumber);
	for (const status of [1, 3, 2, 4]) {
		let start = 0;
		const length = 200;
		while (true) {
			try {
				const { data } = await axios.get(baseUrl, { params: { status, start, length, draw: Math.floor(start / length) + 1 }, headers });
				const rows = (data && Array.isArray(data.data)) ? data.data : [];
				if (rows.length === 0) break;
				const found = rows.find(r => normalize(r.tender_No || r.tenderNo || '') === want);
				if (found && found.id) return res.redirect(302, `/tender/${found.id}`);
				start += rows.length;
				if (typeof data.recordsTotal === 'number' && start >= data.recordsTotal) break;
				if (start > 2000) break;
			} catch (e) {
				break;
			}
		}
	}
	const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Tender not found</title>
<style>body{font-family:system-ui,sans-serif;background:#000000;color:#e6edf3;padding:40px;text-align:center}
a{color:#00e5a8}a:hover{text-decoration:underline}.btn{display:inline-block;background:#00e5a8;color:#02120e;font-weight:700;padding:12px 20px;border-radius:8px;margin-top:16px;text-decoration:none;min-height:48px;line-height:24px;box-sizing:border-box}
@media(max-width:600px){body{padding:24px 16px}.btn{display:block;text-align:center;padding:14px}}
</style></head><body>
<h1>Tender not found</h1>
<p>Could not find tender "${tenderNumber.replace(/</g,'&lt;')}" on eTenders. It may have been closed, cancelled, or removed.</p>
<a href="https://www.etenders.gov.za/Home/opportunities?id=1" class="btn" target="_blank">Open eTenders portal</a>
<p style="margin-top:24px"><a href="/">← Back to Explorer</a></p>
</body></html>`;
	res.type('html').send(html);
});

// Tender detail page - fetches specific tender from etenders API
app.get('/tender/:id', async (req, res) => {
	try {
		const id = req.params.id;
		const { data } = await axios.get(`https://www.etenders.gov.za/Home/TenderDetails/${id}`, {
			headers: {
				'User-Agent': 'Mozilla/5.0',
				'X-Requested-With': 'XMLHttpRequest',
				'Referer': 'https://www.etenders.gov.za/Home/opportunities?id=1'
			}
		});
		const tenders = Array.isArray(data) ? data : (data && data.data ? data.data : [data]);
		const t = tenders[0];
		if (!t) return res.status(404).send('Tender not found');
		const fmt = (d) => d ? formatDate(new Date(d)) : '';
		const docs = (t.supportDocument || []).map(d => {
			const blob = (d.supportDocumentID || '') + (d.extension || '.pdf');
			return {
				name: d.fileName || 'document',
				url: `https://www.etenders.gov.za/Home/Download/?blobName=${encodeURIComponent(blob)}&downloadedFileName=${encodeURIComponent(d.fileName || 'document.pdf')}`
			};
		});
		const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${(t.tender_No || t.description || 'Tender').substring(0, 60)} - eTenders</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box}body{margin:0;font-family:Inter,sans-serif;background:#000000;color:#e6edf3;padding:24px;line-height:1.5}
.container{max-width:720px;margin:0 auto}
h1{font-size:1.25rem;font-weight:700;margin:0 0 8px;color:#e6edf3}
.meta{color:#98a2b3;font-size:0.875rem;margin-bottom:20px}
.section{background:#121722;border:1px solid #1f2630;border-radius:12px;padding:16px;margin-bottom:12px}
.section h2{font-size:0.875rem;color:#98a2b3;margin:0 0 10px;text-transform:uppercase;letter-spacing:0.5px}
.section p,.section div{margin:0 0 8px;white-space:pre-wrap;word-break:break-word}
a{color:#00e5a8;text-decoration:none}a:hover{text-decoration:underline}
.btn{display:inline-block;background:linear-gradient(90deg,#00e5a8,#18b1ff);color:#02120e;font-weight:700;padding:10px 16px;border-radius:8px;margin-top:12px}
.btn:hover{opacity:0.9}
.doc-list{list-style:none;padding:0;margin:0}
.doc-list li{margin:8px 0;padding:8px;background:#0c121a;border-radius:6px}
.doc-list a{color:#00e5a8;display:block;padding:4px 0}
.back{margin-bottom:20px;color:#98a2b3;font-size:0.875rem}
@media(max-width:600px){html,body{overflow-x:hidden;max-width:100vw}body{padding:16px}h1{font-size:1.1rem}.section{padding:12px}.container{max-width:100%}.btn{display:block;text-align:center;padding:14px;min-height:48px}}
</style>
</head>
<body>
<div class="container">
<a href="/" class="back">← Back to Explorer</a>
<h1>${(t.tender_No || '').trim() || 'Tender'}</h1>
<div class="meta">${t.category || ''} · ${t.organ_of_State || t.department || ''} · ${t.province || ''}</div>
<div class="section">
<h2>Description</h2>
<p>${(t.description || '').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
</div>
<div class="section">
<h2>Details</h2>
<div><strong>Type:</strong> ${t.type || ''}</div>
<div><strong>Advertised:</strong> ${fmt(t.date_Published)}</div>
<div><strong>Closing:</strong> ${fmt(t.closing_Date)}</div>
<div><strong>Delivery:</strong> ${(t.delivery || '').replace(/ - /g, ', ')}</div>
<div><strong>Contact:</strong> ${t.contactPerson || ''}</div>
<div><strong>Email:</strong> <a href="mailto:${t.email || ''}">${t.email || ''}</a></div>
<div><strong>Telephone:</strong> ${t.telephone || ''}</div>
${t.briefingVenue ? `<div><strong>Briefing Venue:</strong> ${t.briefingVenue}</div>` : ''}
</div>
${docs.length > 0 ? `
<div class="section">
<h2>Documents</h2>
<ul class="doc-list">
${docs.map(d => `<li><a href="${d.url}" target="_blank" rel="noopener">${d.name}</a></li>`).join('')}
</ul>
</div>
` : ''}
<a href="https://www.etenders.gov.za/Home/opportunities?id=1" target="_blank" rel="noopener" class="btn">Open full eTenders portal</a>
</div>
</body>
</html>`;
		res.type('html').send(html);
	} catch (err) {
		res.status(500).send('Failed to load tender: ' + (err.message || 'Unknown error'));
	}
});

app.get('/api/flags', async (req, res) => {
	const flags = await loadFlags();
	res.json(flags);
});

// Employee group: Supabase or JSON file fallback
const EMPLOYEES_PATH = IS_SERVERLESS ? TMP_EMPLOYEES : path.join(__dirname, EMPLOYEES_FILENAME);

async function loadEmployees() {
	if (supabase.isEnabled()) {
		const fromDb = await supabase.getAllEmployees();
		if (fromDb !== null) return fromDb;
	}
	try {
		if (fs.existsSync(EMPLOYEES_PATH)) {
			const raw = fs.readFileSync(EMPLOYEES_PATH, 'utf8');
			return JSON.parse(raw);
		}
	} catch (e) {}
	return [];
}

async function saveEmployee(emp) {
	if (supabase.isEnabled()) {
		const added = await supabase.addEmployee(emp);
		if (added) return added;
	}
	try {
		const list = await loadEmployees();
		const id = 'emp_' + Date.now() + '_' + Math.random().toString(36).slice(2);
		const row = { id, name: emp.name || '', email: (emp.email || '').trim().toLowerCase(), phone: emp.phone || '', employeeNumber: emp.employeeNumber || '' };
		list.push(row);
		fs.writeFileSync(EMPLOYEES_PATH, JSON.stringify(list, null, 2));
		return row;
	} catch (e) {
		if (e.code === 'EROFS') return { id: 'local', ...emp };
		return null;
	}
}

async function removeEmployee(id) {
	if (supabase.isEnabled()) {
		const ok = await supabase.deleteEmployee(id);
		if (ok) return true;
	}
	try {
		const list = await loadEmployees();
		const filtered = list.filter(e => e.id !== id);
		if (filtered.length === list.length) return false;
		fs.writeFileSync(EMPLOYEES_PATH, JSON.stringify(filtered, null, 2));
		return true;
	} catch (e) {
		return false;
	}
}

app.get('/api/employees', async (req, res) => {
	try {
		const list = await loadEmployees();
		res.json(list);
	} catch (e) {
		res.status(500).json({ error: e.message });
	}
});

app.post('/api/employees', async (req, res) => {
	const { name, email, phone, employeeNumber } = req.body || {};
	if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
	const added = await saveEmployee({ name, email, phone, employeeNumber });
	if (!added) return res.status(500).json({ error: 'Failed to add member' });
	res.json(added);
});

app.delete('/api/employees/:id', async (req, res) => {
	const id = req.params.id;
	if (!id) return res.status(400).json({ error: 'id required' });
	const ok = await removeEmployee(id);
	if (!ok) return res.status(404).json({ error: 'Member not found' });
	res.json({ ok: true });
});

// Municipal scrapers - routes to correct scraper by municipality id
app.get('/api/scrape/municipal/list', (req, res) => {
	const { listScrapers } = require('./municipal_scrapers');
	const scrapers = listScrapers();
	const workbookCfg = getWorkbookMunicipalityConfig(scrapers);
	const selectedProvince = toCanonicalProvince(req.query.province || '');
	let filtered = workbookCfg?.allowedIds ? scrapers.filter(s => workbookCfg.allowedIds.has(s.id)) : scrapers;
	const provinceById = (workbookCfg?.provinceById && workbookCfg.provinceById.size)
		? workbookCfg.provinceById
		: DEFAULT_PROVINCE_BY_ID;
	const canProvinceFilter = !!(selectedProvince && provinceById && provinceById.size);
	if (canProvinceFilter) {
		filtered = filtered.filter(s => provinceById.get(s.id) === selectedProvince);
	}
	res.json({
		ok: true,
		scrapers: filtered,
		workbookApplied: !!workbookCfg?.allowedIds,
		provinceFilterApplied: canProvinceFilter,
		selectedProvince: selectedProvince || '',
		provinceSource: (workbookCfg?.provinceById && workbookCfg.provinceById.size) ? 'workbook' : 'fallback'
	});
});

// Explicit scraper map - no dynamic require, avoids cache returning wrong scraper
const municipalScrapers = {
	matjhabeng: require('./scrape_municipal_matjhabeng'),
	mangaung: require('./scrape_municipal_mangaung'),
	nelsonmandelabay: require('./scrape_municipal_nelsonmandelabay'),
	buffalocity: require('./scrape_municipal_buffalocity'),
	sarahbaartman: require('./scrape_municipal_sarahbaartman'),
	kouga: require('./scrape_municipal_kouga'),
	amathole: require('./scrape_municipal_amathole'),
	masilonyana: require('./scrape_municipal_masilonyana'),
	mohokare: require('./scrape_municipal_mohokare'),
	moqhaka: require('./scrape_municipal_moqhaka'),
	nketoana: require('./scrape_municipal_nketoana'),
	phumelela: require('./scrape_municipal_phumelela'),
	capetown: require('./scrape_municipal_capetown'),
	westcoastdm: require('./scrape_municipal_westcoastdm'),
	beaufortwest: require('./scrape_municipal_beaufortwest'),
	bergrivier: require('./scrape_municipal_bergrivier'),
	cederberg: require('./scrape_municipal_cederberg'),
	laingsburg: require('./scrape_municipal_laingsburg'),
	langeberg: require('./scrape_municipal_langeberg'),
	oudtshoorn: require('./scrape_municipal_oudtshoorn'),
	overstrand: require('./scrape_municipal_overstrand'),
	princealbert: require('./scrape_municipal_princealbert'),
	saldanhabay: require('./scrape_municipal_saldanhabay'),
	stellenbosch: require('./scrape_municipal_stellenbosch'),
	swartland: require('./scrape_municipal_swartland'),
	swellendam: require('./scrape_municipal_swellendam')
};

app.post('/api/scrape/municipal', async (req, res) => {
	try {
		const municipality = req.query.municipality || req.body?.municipality;
		if (!municipality) {
			return res.status(400).json({ ok: false, error: 'municipality parameter required' });
		}
		const { getScraper } = require('./municipal_scrapers');
		const config = getScraper(municipality);
		if (!config) {
			return res.status(400).json({ ok: false, error: `Unknown municipality: ${municipality}` });
		}
		const scraper = municipalScrapers[municipality];
		if (!scraper || !scraper.runScraper) {
			return res.status(500).json({ ok: false, error: `No scraper for ${municipality}` });
		}
		const htmlOnly = req.query.htmlOnly === 'true' || req.body?.htmlOnly === true || config.htmlOnly;
		const limit = parseInt(req.query.limit || req.body?.limit || config.defaultLimit, 10) || config.defaultLimit;
		const outDir = IS_SERVERLESS ? '/tmp' : __dirname;
		const csvFilename = config.csvFilename || `${config.id}_tenders.csv`;
		console.log(`📥 Scrape request: municipality=${municipality} -> ${config.shortName}, limit=${limit}`);
		const { rows, data, message } = await scraper.runScraper({ htmlOnly, limit, outDir, csvFilename });
		const resultData = data || [];
		const expectedSource = config.shortName;
		const bad = resultData.filter(r => ((r && r.Source) || '').trim() !== expectedSource);
		if (bad.length > 0) {
			console.error(`❌ Scraper returned wrong Source: expected ${expectedSource}, got`, bad[0]?.Source, '- rejecting');
			return res.status(500).json({ ok: false, error: `Scraper returned wrong data (expected ${expectedSource}, got ${bad[0]?.Source})` });
		}
		console.log(`✅ ${config.shortName}: ${message}`);
		res.json({ ok: true, rows, data: resultData, message, municipality: config.id, csvFilename: config.csvFilename });
	} catch (err) {
		console.error('❌ SCRAPE ERROR:', err);
		res.status(500).json({
			ok: false,
			error: err.message || 'Scrape failed',
			stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
		});
	}
});

app.post('/api/flags', async (req, res) => {
	const { tenderNumber, interested, reviewed, tendered, notInterested, comment, assignedTo, reviewedBy } = req.body || {};
	if (!tenderNumber) return res.status(400).json({ error: 'tenderNumber required' });
	const flags = await loadFlags();
	const prev = flags[tenderNumber] || {};
	const data = {
		interested: interested !== undefined ? !!interested : !!prev.interested,
		reviewed: reviewed !== undefined ? !!reviewed : !!prev.reviewed,
		tendered: tendered !== undefined ? !!tendered : !!prev.tendered,
		notInterested: notInterested !== undefined ? !!notInterested : !!prev.notInterested,
		comment: comment !== undefined ? String(comment) : (prev.comment || ''),
		assignedTo: assignedTo !== undefined ? String(assignedTo) : (prev.assignedTo || ''),
		reviewedBy: reviewedBy !== undefined ? String(reviewedBy) : (prev.reviewedBy || '')
	};
	if (!(await saveFlag(tenderNumber, data))) return res.status(500).json({ error: 'Failed to save' });
	res.json({ ok: true });
});

if (require.main === module) {
	app.listen(PORT, () => {
		console.log(`Web app running on http://localhost:${PORT}`);
		console.log(`  Open the URL above in your browser.`);
		// Open browser after a short delay (only when run directly)
		setTimeout(() => {
			try {
				const url = `http://localhost:${PORT}`;
				const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
				require('child_process').spawn(cmd, [url], { shell: true, stdio: 'ignore' });
			} catch (_) {}
		}, 1500);
	});
}

module.exports = app;


