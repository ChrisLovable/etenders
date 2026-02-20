const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const app = express();
const PORT = process.env.PORT || 5173;

// Serverless (Netlify, Lambda, etc.): filesystem is read-only except /tmp - ALWAYS use /tmp explicitly
const IS_SERVERLESS = !!(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
const TMP_CSV = '/tmp/advertised_tenders.csv';
const TMP_FLAGS = '/tmp/flags.json';
const CSV_FILENAME = 'advertised_tenders.csv';
const FLAGS_FILENAME = 'flags.json';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'web')));

// Serve advertised_tenders.csv - /tmp if updated (serverless), else project root (local)
app.get('/data/advertised_tenders.csv', (req, res) => {
	const p = (IS_SERVERLESS && fs.existsSync(TMP_CSV)) ? TMP_CSV : path.join(__dirname, CSV_FILENAME);
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
			// Return CSV in response so frontend can use it (CDN serves static file, not updated)
			return res.json({ added, lastAdvertised: formatDate(lastMax), csv });
		}
		res.json({ added, lastAdvertised: formatDate(lastMax) });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Tiny backend store for card flags (reviewed/tendered)
const FLAGS_PATH = IS_SERVERLESS ? TMP_FLAGS : path.join(__dirname, FLAGS_FILENAME);

function loadFlags() {
	try {
		if (fs.existsSync(FLAGS_PATH)) {
			const raw = fs.readFileSync(FLAGS_PATH, 'utf8');
			return JSON.parse(raw);
		}
	} catch (e) {}
	return {};
}

function saveFlags(obj) {
	try {
		fs.writeFileSync(FLAGS_PATH, JSON.stringify(obj, null, 2));
		return true;
	} catch (e) {
		if (e.code === 'EROFS') return true; // client uses localStorage as fallback
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

app.get('/api/flags', (req, res) => {
	const flags = loadFlags();
	res.json(flags);
});

app.post('/api/flags', (req, res) => {
	const { tenderNumber, interested, reviewed, tendered, notInterested, comment } = req.body || {};
	if (!tenderNumber) return res.status(400).json({ error: 'tenderNumber required' });
	const flags = loadFlags();
	const prev = flags[tenderNumber] || {};
	flags[tenderNumber] = {
		interested: interested !== undefined ? !!interested : !!prev.interested,
		reviewed: reviewed !== undefined ? !!reviewed : !!prev.reviewed,
		tendered: tendered !== undefined ? !!tendered : !!prev.tendered,
		notInterested: notInterested !== undefined ? !!notInterested : !!prev.notInterested,
		comment: comment !== undefined ? String(comment) : (prev.comment || '')
	};
	if (!saveFlags(flags)) return res.status(500).json({ error: 'Failed to save' });
	res.json({ ok: true });
});

if (require.main === module) {
	app.listen(PORT, () => {
		console.log(`Web app running on http://localhost:${PORT}`);
	});
}

module.exports = app;


