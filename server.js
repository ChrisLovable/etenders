const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const app = express();
const PORT = process.env.PORT || 5173;

app.use(express.static(path.join(__dirname, 'web')));

// Serve CSV files from root for convenience
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
	return all.map(r => ({
		category: r.category,
		tenderNumber: r.tender_No,
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
	}));
}

app.get('/api/update', async (req, res) => {
	try {
		const csvPath = path.join(__dirname, 'advertised_tenders.csv');
		let existing = [];
		let lastMax = new Date('1900-01-01');
		let seenNumbers = new Set();
		if (fs.existsSync(csvPath)) {
			const raw = fs.readFileSync(csvPath, 'utf8');
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
				'Two Envelope Submission': r.twoEnvelopeSubmission
			})), ...existing];
			const csv = stringify(merged, { header: true });
			fs.writeFileSync(csvPath, csv);
		}
		res.json({ added, lastAdvertised: formatDate(lastMax) });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

app.listen(PORT, () => {
	console.log(`Web app running on http://localhost:${PORT}`);
});


