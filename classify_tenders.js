const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { stringify } = require('csv-stringify');
require('dotenv').config();
const OpenAI = require('openai');

const openaiApiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
if (!openaiApiKey) {
	console.error('Missing OPENAI_API_KEY (or VITE_OPENAI_API_KEY) in environment.');
	process.exit(1);
}

const client = new OpenAI({ apiKey: openaiApiKey });

const FAST_KEYWORDS = [
	// data/AI related
	' AI ', ' artificial intelligence ', ' machine learning ', ' ML ', ' data science ', ' data analytics ', ' analytics ', ' data platform ', ' data warehouse ', ' warehousing ', ' big data ', ' data engineering ', ' ETL ', ' ELT ', ' data lake ', ' datalake ', ' predictive ', ' forecasting ', ' NLP ', ' natural language ', ' computer vision ', ' model training ', ' LLM ', ' chatbot ', ' business intelligence ', ' BI ', ' Power BI ', ' Tableau ', ' Qlik ', ' data visual', ' digitization ', ' digitisation ', ' OCR ', ' data migration ', ' data integration ', ' API development ', ' API integration ', ' integration platform ', ' RPA ', ' robotic process ', ' process automation ', ' automation ', ' telemetry ', ' IoT ', ' telemetry ', ' data quality ', ' master data ', ' MDM ', ' cloud data ', ' data governance ', ' data catalog ', ' data catalogue ', ' SQL ', ' database ', ' PostgreSQL ', ' MySQL ', ' Snowflake ', ' Databricks ', ' Spark ', ' Hadoop ', ' Kafka '
];

function keywordLikely(text) {
	const hay = ` ${text.toLowerCase()} `;
	return FAST_KEYWORDS.some(k => hay.includes(k.trim().toLowerCase()));
}

async function classifyBatch(rows) {
	// rows: [{description, tenderNumber, category, advertised, cancelled|closing}]
	const prompt = [
		{
			role: 'system',
			content: 'You are a strict procurement classifier. For each tender description, decide if it primarily relates to data services or can plausibly be executed with AI/ML/NLP/computer vision, analytics, BI, data engineering, or automation. Return a JSON object with key "results" whose value is an array of objects with fields: index, ai_related (true/false), reason (short). Be conservative.'
		},
		{
			role: 'user',
			content: rows.map((r, i) => `#${i}: ${r.description}`).join('\n')
		}
	];

	const resp = await client.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: prompt,
		response_format: { type: 'json_object' },
		temperature: 0
	});

	let parsed = { results: [] };
	try {
		const raw = resp.choices[0].message.content || '{}';
		const json = JSON.parse(raw);
		parsed = Array.isArray(json) ? { results: json } : json;
	} catch (_) {}
	const byIndex = new Map();
	(parsed.results || []).forEach(r => byIndex.set(Number(r.index), r));
	return rows.map((r, i) => ({
		...r,
		ai_related: byIndex.get(i)?.ai_related === true,
		ai_reason: byIndex.get(i)?.reason || ''
	}));
}

async function main() {
	const input = process.argv[2] || 'tenders.csv';
	const output = process.argv[3] || 'tenders_ai_filter.csv';
	const includeNonMatches = (process.argv[4] || 'false').toLowerCase() === 'true';

	const records = await new Promise((resolve, reject) => {
		const acc = [];
		fs.createReadStream(path.resolve(input))
			.pipe(parse({ columns: true, skip_empty_lines: true }))
			.on('data', row => acc.push(row))
			.on('end', () => resolve(acc))
			.on('error', reject);
	});

	// Normalize column names
	const normalized = records.map(r => ({
		category: r['Category'] || r['category'] || '',
		tenderNumber: r['Tender Number'] || r['tenderNumber'] || r['TenderNumber'] || '',
		description: r['Tender Description'] || r['description'] || r['TenderDescription'] || '',
		advertised: r['Advertised'] || '',
		closing: r['Closing'] || '',
		cancelled: r['Cancelled'] || ''
	}));

	// Fast keyword prefilter
	const candidates = normalized
		.map((r, i) => ({ ...r, _rowIndex: i }))
		.filter(r => keywordLikely(r.description));

	// Chunk to keep token usage low
	const CHUNK = 25;
	let results = [];
	for (let i = 0; i < candidates.length; i += CHUNK) {
		const batch = candidates.slice(i, i + CHUNK);
		const classified = await classifyBatch(batch);
		results = results.concat(classified);
	}

	// Merge back to full list if needed
	const aiSet = new Set(results.filter(r => r.ai_related).map(r => r._rowIndex));
	const finalRows = includeNonMatches
		? normalized.map((r, i) => ({ ...r, AI_Related: aiSet.has(i), AI_Reason: results.find(x => x._rowIndex === i)?.ai_reason || '' }))
		: normalized.filter((r, i) => aiSet.has(i)).map((r, i) => ({ ...r, AI_Related: true, AI_Reason: results.find(x => x._rowIndex === (candidates[i]?._rowIndex))?.ai_reason || '' }));

	await new Promise((resolve, reject) => {
		stringify(finalRows, { header: true }, (err, csv) => {
			if (err) return reject(err);
			fs.writeFileSync(path.resolve(output), csv);
			resolve();
		});
	});

	console.log(`Analyzed ${normalized.length} rows. Candidates: ${candidates.length}. AI-related: ${finalRows.length}${includeNonMatches ? ' (including non-matches)' : ''}.`);
}

main().catch(err => {
	console.error('Classification failed:', err.message);
	process.exit(1);
});


