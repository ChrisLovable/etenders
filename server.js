require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
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
const FLAGS_FILENAME = 'flags.json';

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
		if (added > 0) {
			const merged = [...newOnes.map(r => ({
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
			})), ...existing.map(r => ({
				...r,
				'Source URL': r['Source URL'] || '',
				'Tender ID': r['Tender ID'] || ''
			}))];
			const csv = stringify(merged, { header: true });
			fs.writeFileSync(TMP_CSV, csv);
			// Write etender_gov_data.csv (numbers + descriptions only, eTenders.gov.za data)
			const govRows = merged.map(r => ({ 'Tender Number': r['Tender Number'] || '', 'Tender Description': r['Tender Description'] || '' }));
			const govCsv = stringify(govRows, { header: true });
			const govPath = IS_SERVERLESS ? TMP_ETENDER_GOV : path.join(__dirname, ETENDER_GOV_FILENAME);
			fs.writeFileSync(govPath, govCsv);
			// Return CSV in response so frontend can use it (CDN serves static file, not updated)
			return res.json({ added, lastAdvertised: formatDate(lastMax), csv });
		}
		res.json({ added, lastAdvertised: formatDate(lastMax) });
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
	res.json({ ok: true, scrapers: listScrapers() });
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


