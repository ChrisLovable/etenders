// test-pdf-debug.js
const axios = require('axios');
const fs = require('fs');
const pdfParse = require('pdf-parse');

async function testPdf(url, name) {
  console.log(`\n🔍 TESTING: ${name}`);
  console.log(`URL: ${url}`);

  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const buffer = Buffer.from(response.data);
    console.log(`✅ Downloaded: ${buffer.length} bytes`);

    // Try to parse
    const data = await pdfParse(buffer);
    console.log(`📄 Text length: ${data.text.length} characters`);
    console.log(`📝 First 200 chars: "${data.text.substring(0, 200).replace(/\n/g, '\\n')}"`);
    // Search for key patterns
    const hasTenderNumber = /TENDER NUMBER|BID\/\d+/i.test(data.text);
    const hasDescription = /DESCRIPTION|PANEL OF|APPOINTMENT OF/i.test(data.text);
    console.log(`   TENDER NUMBER found: ${hasTenderNumber}`);
    console.log(`   DESCRIPTION/PANEL/APPOINTMENT found: ${hasDescription}`);
    if (data.text.length > 500 && data.text.length < 5000) {
      console.log(`📝 Full text (first 1500 chars):\n${data.text.substring(0, 1500)}`);
    }

    if (data.text.length < 100) {
      console.log('❌ PDF HAS NO TEXT - likely scanned image!');
    } else {
      console.log('✅ PDF HAS TEXT - parsing should work');
    }
  } catch (err) {
    console.error(`❌ Failed: ${err.message}`);
  }
}

// Test both types
async function run() {
  await testPdf(
    'https://matjhabengmunicipality.co.za/assets/resources/tenders/2025_26/BidDocuments/TENDER%20DOCUMENT%20-%20BID_09_2025-26%20-%20INTERMEDIARY%20FOR%20SHORT-TERM%20INSURANCE%20FOR%20THREE%20(3)%20YEARS.pdf',
    'BID/09 (Working)'
  );

  await testPdf(
    'https://matjhabengmunicipality.co.za/assets/resources/tenders/2025_26/BID_17_2025-26.pdf',
    'BID/17 (Failing)'
  );

  await testPdf(
    'https://matjhabengmunicipality.co.za/assets/resources/tenders/2025_26/BID_18_2025-26.pdf',
    'BID/18 (Failing)'
  );

  await testPdf(
    'https://matjhabengmunicipality.co.za/assets/resources/tenders/2025_26/BID_19_2025-26.pdf',
    'BID/19 (Failing)'
  );

  // Test parsePdfFields directly on BID/17
  console.log('\n🧪 PARSER TEST: Running parsePdfFields on BID/17...');
  const { parsePdfFields } = require('./scrape_municipal_matjhabeng');
  const resp = await axios.get(
    'https://matjhabengmunicipality.co.za/assets/resources/tenders/2025_26/BID_17_2025-26.pdf',
    { responseType: 'arraybuffer', timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } }
  );
  const result = await parsePdfFields(Buffer.from(resp.data));
  console.log('Result:', result ? JSON.stringify(result, null, 2) : 'null (parse failed)');
  console.log('\n📋 DIAGNOSIS: PDFs have text (not scanned). BID/17-19 use table format.');
}

run();
