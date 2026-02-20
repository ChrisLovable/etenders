const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const qs = require('querystring');

async function fetchCancelledTendersPage(page = 1) {
	// Cancelled tenders listing (HTML fallback only)
	const url = `https://www.etenders.gov.za/Home/opportunities?id=3&page=${page}`;
	const response = await axios.get(url, {
		headers: {
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
		}
	});
	return { html: response.data, url };
}

function parseTenderRows(html) {
	const $ = cheerio.load(html);
	const rows = [];

	// Find the table that contains a header "Tender Description"
	const tables = $('table');
	tables.each((_, table) => {
		const headerCells = $(table).find('thead th');
		if (headerCells.length === 0) return;
		const headers = headerCells
			.map((i, th) => $(th).text().trim().replace(/\s+/g, ' '))
			.get();
		const lower = headers.map(h => h.toLowerCase());
		const hasTenderDescription = lower.includes('tender description');
		if (!hasTenderDescription) return;

		const idxCategory = Math.max(0, lower.indexOf('category'));
		const idxDescription = lower.indexOf('tender description');
		const idxAdvertised = lower.indexOf('advertised');
		const idxCancelled = lower.indexOf('cancelled');

		$(table)
			.find('tbody tr')
			.each((__, tr) => {
				const cells = $(tr).find('td');
				if (cells.length === 0) return;
				const safeText = (i) =>
					i >= 0 && i < cells.length
						? $(cells[i]).text().trim().replace(/\s+/g, ' ')
						: '';
				const category = safeText(idxCategory);
				const description = safeText(idxDescription);
				const advertised = safeText(idxAdvertised);
				const cancelled = safeText(idxCancelled);
				if (description) {
					rows.push({ category, description, advertised, cancelled });
				}
			});
	});

	return rows;
}

async function scrapeAllPages(maxPages = 1, status = 4) {
	console.log('Starting scrape, trying API first...');
	// Primary path: hit the site's server-side pagination API directly
	try {
		const all = await scrapeViaApi(status);
		console.log(`API returned ${all.length} rows`);
		if (all.length > 0) return all;
		console.warn('API scrape returned 0; falling back to static HTML parsing.');
	} catch (e) {
		console.warn('API scrape failed, falling back to HTML parsing:', e.message);
	}

	// Fallback: parse static HTML (may be empty due to JS rendering)
	let results = [];
	for (let page = 1; page <= maxPages; page++) {
		const { html, url } = await fetchCancelledTendersPage(page);
		if (page === 1) {
			try { require('fs').writeFileSync('debug_cancelled_tenders.html', html); } catch (_) {}
		}
		const pageRows = parseTenderRows(html);
		if (pageRows.length === 0 && page > 1) break;
		console.log(`Parsed ${pageRows.length} tenders from ${url}`);
		results = results.concat(pageRows);
	}
	return results;
}

function opportunityIdForStatus(status) {
	return status === 1 ? 1 : status === 2 ? 2 : status === 3 ? 4 : 3;
}

async function scrapeViaApi(status = 4) {
	const oppId = opportunityIdForStatus(status);
	const baseUrl = 'https://www.etenders.gov.za/Home/PaginatedTenderOpportunities';
	const headers = {
		'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
		'Accept': 'application/json, text/javascript, */*; q=0.01',
		'X-Requested-With': 'XMLHttpRequest',
		'Referer': 'https://www.etenders.gov.za/Home/opportunities?id=3'
	};

	const length = 200; // fetch 200 rows per request
	let start = 0;
	let draw = 1;
	let all = [];
	while (true) {
		const params = { status, start, length, draw };
		const { data } = await axios.get(baseUrl, { params, headers });
		const payload = typeof data === 'string' ? JSON.parse(data) : data;
		if (start === 0) {
			try { require('fs').writeFileSync('debug_api_response.json', JSON.stringify(payload, null, 2)); } catch (_) {}
		}
		const rows = Array.isArray(payload.data) ? payload.data : [];
		if (rows.length === 0) break;
		// DataTables rows may be arrays of HTML strings per column
		console.log(`Fetched ${rows.length} items (start=${start})`);
		for (const row of rows) {
			// Normalize whether row is array or object
			let category = '', description = '', advertised = '', cancelled = '', tenderNumber = '';
			let organOfState = '', tenderType = '', province = '', placeWhereRequired = '', specialConditions = '';
			let contactPerson = '', email = '', telephone = '', fax = '';
			let briefingSession = '', briefingCompulsory = '', briefingDateTime = '', briefingVenue = '';
			let eSubmission = '', twoEnvelopeSubmission = '';
			let tenderId = '', sourceUrl = 'https://www.etenders.gov.za/Home/opportunities?id=1';
			if (Array.isArray(row)) {
				// Columns expected:
				// 0: plus icon, 1: Category, 2: Tender Description, 3: eSubmission, 4: Advertised, 5: Cancelled, 6: icons
				category = stripText(row[1]);
				description = stripText(row[2]);
				advertised = stripText(row[4]);
				cancelled = stripText(row[5]);
			} else if (row && typeof row === 'object') {
				category = stripText(row.category || row.Category || '');
				description = stripText(row.description || row.TenderDescription || row['Tender Description'] || '');
				advertised = formatDate(row.advertised || row.Advertised || row.date_Published || '');
				cancelled = formatDate(row.cancelled_Date || row.cancelled || row.Cancelled || '');
				tenderNumber = stripText(row.tender_No || row.tenderNo || row['tender_No'] || row['Tender No'] || '');
				tenderId = row.id ? String(row.id) : '';
				const baseOppUrl = `https://www.etenders.gov.za/Home/opportunities?id=${oppId}`;
				sourceUrl = tenderId
					? `/tender/${tenderId}`
					: (tenderNumber ? `${baseOppUrl}&search=${encodeURIComponent(tenderNumber)}` : baseOppUrl);
				organOfState = stripText(row.organ_of_State || row.organOfState || '');
				tenderType = stripText(row.type || '');
				province = stripText(row.province || '');
				placeWhereRequired = stripText([row.streetname, row.surburb, row.town, row.code].filter(Boolean).join(', '));
				specialConditions = stripText(row.conditions || '');
				contactPerson = stripText(row.contactPerson || '');
				email = stripText(row.email || '');
				telephone = stripText(row.telephone || '');
				fax = stripText(row.fax || '');
				briefingSession = yesNo(row.briefingSession);
				briefingCompulsory = yesNo(row.briefingCompulsory || row.compulsory_briefing_session);
				briefingVenue = stripText(row.briefingVenue || '');
				eSubmission = yesNo(row.eSubmission);
				twoEnvelopeSubmission = yesNo(row.twoEnvelopeSubmission);
			}
			if (description) {
				const closing = formatDate(row && row.closing_Date ? row.closing_Date : '');
				all.push({ category, tenderNumber, description, advertised, cancelled, closing,
					organOfState, tenderType, province, placeWhereRequired, specialConditions,
					contactPerson, email, telephone, fax, briefingSession, briefingCompulsory,
					briefingDateTime, briefingVenue, eSubmission, twoEnvelopeSubmission,
					tenderId, sourceUrl });
			}
		}
		start += rows.length;
		if (typeof payload.recordsTotal === 'number' && start >= payload.recordsTotal) {
			break;
		}
		draw += 1;
	}
	return all;
}

function stripText(value) {
	if (!value) return '';
	// Remove HTML tags and normalize whitespace
	const text = String(value)
		.replace(/<[^>]*>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#x2013;|&ndash;/g, '–')
		.replace(/\s+/g, ' ')
		.trim();
	return text;
}

function formatDate(value) {
	if (!value) return '';
	try {
		const d = new Date(value);
		if (isNaN(d.getTime())) return stripText(value);
		const dd = String(d.getDate()).padStart(2, '0');
		const mm = String(d.getMonth() + 1).padStart(2, '0');
		const yyyy = d.getFullYear();
		return `${dd}/${mm}/${yyyy}`;
	} catch (_e) {
		return stripText(value);
	}
}

function yesNo(value) {
	if (value === true) return 'Yes';
	if (value === false) return 'No';
	return String(value || '').trim();
}

async function writeCsv(records, outPath, status = 4) {
	const csvWriter = createCsvWriter({
		path: outPath,
		header: (status === 1)
			? [
				{ id: 'category', title: 'Category' },
				{ id: 'tenderNumber', title: 'Tender Number' },
				{ id: 'description', title: 'Tender Description' },
				{ id: 'advertised', title: 'Advertised' },
				{ id: 'closing', title: 'Closing' },
				{ id: 'organOfState', title: 'Organ Of State' },
				{ id: 'tenderType', title: 'Tender Type' },
				{ id: 'province', title: 'Province' },
				{ id: 'placeWhereRequired', title: 'Place where goods, works or services are required' },
				{ id: 'specialConditions', title: 'Special Conditions' },
				{ id: 'contactPerson', title: 'Contact Person' },
				{ id: 'email', title: 'Email' },
				{ id: 'telephone', title: 'Telephone number' },
				{ id: 'fax', title: 'FAX Number' },
				{ id: 'briefingSession', title: 'Is there a briefing session?' },
				{ id: 'briefingCompulsory', title: 'Is it compulsory?' },
				{ id: 'briefingDateTime', title: 'Briefing Date and Time' },
				{ id: 'briefingVenue', title: 'Briefing Venue' },
				{ id: 'eSubmission', title: 'eSubmission' },
				{ id: 'twoEnvelopeSubmission', title: 'Two Envelope Submission' },
				{ id: 'sourceUrl', title: 'Source URL' },
				{ id: 'tenderId', title: 'Tender ID' }
			]
			: [
				{ id: 'category', title: 'Category' },
				{ id: 'tenderNumber', title: 'Tender Number' },
				{ id: 'description', title: 'Tender Description' },
				{ id: 'advertised', title: 'Advertised' },
				{ id: 'cancelled', title: 'Cancelled' },
				{ id: 'sourceUrl', title: 'Source URL' },
				{ id: 'tenderId', title: 'Tender ID' }
			]
	});
	await csvWriter.writeRecords(records.map(r => ({
		category: r.category ?? '',
		tenderNumber: r.tenderNumber ?? '',
		description: (r.description || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim(),
		advertised: r.advertised ?? '',
		closing: r.closing ?? '',
		organOfState: r.organOfState ?? '',
		tenderType: r.tenderType ?? '',
		province: r.province ?? '',
		placeWhereRequired: r.placeWhereRequired ?? '',
		specialConditions: r.specialConditions ?? '',
		contactPerson: r.contactPerson ?? '',
		email: r.email ?? '',
		telephone: r.telephone ?? '',
		fax: r.fax ?? '',
		briefingSession: r.briefingSession ?? '',
		briefingCompulsory: r.briefingCompulsory ?? '',
		briefingDateTime: r.briefingDateTime ?? '',
		briefingVenue: r.briefingVenue ?? '',
		eSubmission: r.eSubmission ?? '',
		twoEnvelopeSubmission: r.twoEnvelopeSubmission ?? '',
		sourceUrl: r.sourceUrl ?? '',
		tenderId: r.tenderId ?? '',
		cancelled: r.cancelled ?? ''
	})));
	console.log(`Wrote ${records.length} rows to ${outPath}`);
}

async function main() {
	try {
		const maxPages = Number(process.argv[2] || '1');
		const out = process.argv[3] || 'tenders.csv';
		const statusArg = (process.argv[4] || 'cancelled').toLowerCase();
		const status = statusArg === 'active' || statusArg === 'advertised' ? 1
			: statusArg === 'awarded' ? 2
			: statusArg === 'closed' ? 3
			: 4; // cancelled default
		const records = await scrapeAllPages(maxPages, status);
		await writeCsv(records, out, status);
	} catch (err) {
		console.error('Scrape failed:', err.message);
		process.exit(1);
	}
}

if (require.main === module) {
	main();
}


