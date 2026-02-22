const advertisedCsvUrl = '/data/advertised_tenders.csv';
const aiCsvUrl = '/data/ai_opportunities.csv';
const CUSTOM_CRITERIA_KEY = 'etenders_custom_criteria';
const MATCH_MODE_KEY = 'etenders_match_mode';
const ASSIGNED_USERS = ['', 'Jan', 'Paul', 'Meghan', 'Chris'];

function getMatchMode(){ return localStorage.getItem(MATCH_MODE_KEY) || 'expansive'; }
function getCurrentUser(){ return ''; }
function setMatchMode(v){ localStorage.setItem(MATCH_MODE_KEY, v); }

const $ = (id) => document.getElementById(id);
const gridScroll = $('gridScroll');
const gridContainer = $('gridContainer');
const stats = $('stats');
const qInput = $('q');
const provinceSel = $('province');
const provinceRadios = $('provinceRadios');
const organSel = $('organ');
const categorySel = $('category');
const advRange = $('advRange');
const loadingOverlay = $('loadingOverlay');
const loadingMessage = $('loadingMessage');
// AI toggle removed per request

function resizeGridViewport() {
  if (!gridScroll) return;
  // Use normal document scrolling; do not constrain card area height.
  gridScroll.style.maxHeight = '';
}

function syncHeroOffset() {
  const sticky = document.querySelector('.sticky-header-tabs');
  const root = document.documentElement;
  if (!sticky || !root) return;
  const h = Math.ceil(sticky.getBoundingClientRect().height || 0);
  root.style.setProperty('--hero-offset', `${Math.max(0, h)}px`);
}

// Loading indicator functions
function showLoading(message = 'Loading...') {
  const overlay = loadingOverlay;
  const messageEl = loadingMessage;
  if (overlay) {
    if (messageEl) messageEl.textContent = message;
    overlay.classList.add('active');
  }
}

function hideLoading() {
  const overlay = loadingOverlay;
  if (overlay) {
    overlay.classList.remove('active');
  }
}

// Add spinner to button while loading
function setButtonLoading(button, isLoading, text = null) {
  if (!button) return;
  if (isLoading) {
    button.disabled = true;
    const originalText = button.textContent;
    button.setAttribute('data-original-text', originalText);
    button.innerHTML = `<span class="spinner"></span>${text || originalText}`;
  } else {
    button.disabled = false;
    const originalText = button.getAttribute('data-original-text');
    if (originalText) button.textContent = originalText;
  }
}

async function runWithBusy(text, fn, button = null, buttonText = null) {
  if (button) setButtonLoading(button, true, buttonText);
  showLoading(text);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try {
    return await fn();
  } finally {
    if (button) setButtonLoading(button, false);
    hideLoading();
  }
}

function getSearchValue() {
  return qInput ? String(qInput.value || '').trim() : '';
}

function setSearchValue(value) {
  const v = String(value || '');
  if (qInput) qInput.value = v;
}

let rows = [];
let aiMap = new Map();
let serverFlags = {};
let displayedData = [];
let municipalScrapeView = null; // When set, we show ONLY this municipality's data; filterRows cannot override

function isLikelyMunicipalSourceRow(r){
  const src = String(r['Source'] || '').trim();
  const category = String(r['Category'] || '').trim().toLowerCase();
  if (category === 'municipal' && municipalSourceSet.has(src)) return true;
  const url = String(r['Source URL'] || '').toLowerCase().trim();
  const desc = String(r['Tender Description'] || '').toLowerCase();
  const num = String(r['Tender Number'] || '').trim();
  if (!url) return false;
  if (/\/(leadership|services|investor-relations|galleries?|news|careers|contact|about|tourism|events)\b/.test(url)) return false;
  if (/login \| register|a-z index|faqs about us/.test(desc)) return false;
  const urlLooksTender = /(tender|bid|rfq|quotation|procurement|scm|details|docman|document|download|sites\/default\/files|wp-content\/uploads|\.pdf($|\?))/i.test(url);
  if (urlLooksTender) return true;
  if (num && desc.length > 12) return true;
  return false;
}

async function loadCsv(url){
  return new Promise((resolve,reject)=>{
    Papa.parse(url,{download:true,header:true,skipEmptyLines:true,complete:({data})=>resolve(data),error:reject});
  });
}

function buildFilters(data){
  const unique = (key)=>[...new Set(data.map(r=>r[key]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b)));
  for(const [sel, key, label] of [[provinceSel,'Province','All provinces'],[organSel,'Organ Of State','All organs'],[categorySel,'Category','All categories']]){
    if (!sel) continue;
    sel.innerHTML = '';
    const opt0 = document.createElement('option'); opt0.value=''; opt0.textContent=label; sel.appendChild(opt0);
    const values = unique(key).filter(v => !(key === 'Province' && String(v).toLowerCase() === 'national'));
    for(const v of values){
      const o=document.createElement('option'); o.value=v; o.textContent=v; sel.appendChild(o);
    }
  }
  renderProvinceRadios();
}

function setProvinceRadioValue(value){
  if (!provinceRadios) return;
  const selected = String(value || '');
  provinceRadios.querySelectorAll('input[name="provinceFilter"]').forEach(r => {
    r.checked = (r.value === selected);
  });
}

function renderProvinceRadios(){
  if (!provinceRadios || !provinceSel) return;
  const current = provinceSel.value || '';
  provinceRadios.innerHTML = '';
  const addRadio = (value, labelText) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'provinceFilter';
    input.value = value;
    input.checked = (value === current);
    input.addEventListener('change', async () => {
      if (!input.checked) return;
      await runWithBusy('Updating province filters...', async () => {
        provinceSel.value = value;
        await loadMunicipalScrapers(value);
        onFilterChange();
      });
    });
    label.appendChild(input);
    label.appendChild(document.createTextNode(labelText));
    provinceRadios.appendChild(label);
  };
  [...provinceSel.options]
    .map(o => o.value)
    .filter(v => !!v && String(v).toLowerCase() !== 'national')
    .forEach(v => addRadio(v, v));
}

function getUniqueValues(key){
  return [...new Set(rows.map(r=>r[key]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b)));
}

function getServiceValues(){
  return getUniqueValues('Category').filter(c=>String(c).startsWith('Services:'));
}

function loadCustomCriteria(){
  try {
    const raw = localStorage.getItem(CUSTOM_CRITERIA_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) { return {}; }
}

function saveCustomCriteria(criteria){
  localStorage.setItem(CUSTOM_CRITERIA_KEY, JSON.stringify(criteria));
}

function renderCustomCriteriaSummary() {
  const el = $('customCriteriaSummary');
  if (!el) return;
  const saved = loadCustomCriteria();
  const categories = Array.isArray(saved.categories) ? saved.categories : [];
  const services = Array.isArray(saved.services) ? saved.services : [];
  const provinces = Array.isArray(saved.provinces) ? saved.provinces : [];
  const organs = Array.isArray(saved.organs) ? saved.organs : [];
  const words = Array.isArray(saved.customWords) ? saved.customWords : [];
  const advRange = saved.advRange || 'any';
  const mode = saved.matchMode || getMatchMode();
  const hasAny = categories.length || services.length || provinces.length || organs.length || words.length || advRange !== 'any';

  if (!hasAny) {
    el.textContent = 'No custom criteria set';
    return;
  }

  const rangeLabelMap = {
    any: 'Any time',
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
    '90d': 'Last 90 days',
    this_month: 'This month',
    last_month: 'Last month',
    this_year: 'This year',
    last_year: 'Last year'
  };
  const compact = (arr) => arr.length ? arr.join(', ') : 'None';
  const modeLabel = (mode === 'all' || mode === 'exact') ? 'Match all (AND)' : 'Inclusive (OR)';
  const section = (label, value) =>
    `<span class="custom-criteria-heading">${label.toUpperCase()}</span>: ${escapeHtml(value)}`;

  el.innerHTML = [
    section('Keywords', compact(words)),
    section('Categories', compact(categories)),
    section('Services', compact(services)),
    section('Provinces', compact(provinces)),
    section('Organs', compact(organs)),
    section('Date range', rangeLabelMap[advRange] || 'Any time'),
    section('Mode', modeLabel)
  ].join(' | ');
}

function populateCriteriaModal(){
  const container = (id) => $(id);
  const renderCheckboxes = (containerId, key, values) => {
    const box = container(containerId);
    if (!box) return;
    box.innerHTML = '';
    const saved = loadCustomCriteria();
    const selected = new Set(saved[key] || []);
    const vals = values || getUniqueValues(key === 'categories' ? 'Category' : key === 'provinces' ? 'Province' : 'Organ Of State');
    for (const v of vals) {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = v;
      cb.checked = selected.has(v);
      label.appendChild(cb);
      label.appendChild(document.createTextNode(v));
      box.appendChild(label);
    }
  };
  renderCheckboxes('categoryCheckboxes', 'categories');
  renderCheckboxes('servicesCheckboxes', 'services', getServiceValues());
  renderCheckboxes('provinceCheckboxes', 'provinces');
  renderCheckboxes('organCheckboxes', 'organs');
  const wordsInput = $('customWords');
  if (wordsInput) {
    const saved = loadCustomCriteria();
    wordsInput.value = (saved.customWords || []).join(', ');
  }
  const advRangeSel = $('criteriaAdvRange');
  if (advRangeSel) {
    const saved = loadCustomCriteria();
    advRangeSel.value = saved.advRange || 'any';
  }
  const matchModeRadios = document.querySelectorAll('input[name="matchMode"]');
  const savedMatchMode = loadCustomCriteria().matchMode || getMatchMode();
  const mode = savedMatchMode === 'exact' || savedMatchMode === 'many' ? 'all' : savedMatchMode;
  matchModeRadios.forEach(r => { r.checked = (r.value === mode); });
}

function openCriteriaModal(){
  populateCriteriaModal();
  const modal = $('customCriteriaModal');
  if (modal) { modal.setAttribute('aria-hidden', 'false'); }
}

function closeCriteriaModal(){
  const modal = $('customCriteriaModal');
  if (modal) { modal.setAttribute('aria-hidden', 'true'); }
}

function applySearchMyCriteria(){
  hideDashboard();
  const saved = loadCustomCriteria();
  if (!saved || (Object.keys(saved).length === 0) || (
    (!saved.categories || saved.categories.length === 0) &&
    (!saved.services || saved.services.length === 0) &&
    (!saved.provinces || saved.provinces.length === 0) &&
    (!saved.organs || saved.organs.length === 0) &&
    (!saved.customWords || saved.customWords.length === 0) &&
    (!saved.advRange || saved.advRange === 'any')
  )) {
    if (stats) stats.textContent = 'No saved criteria. Click "Custom criteria" to set up.';
    displayedData = [];
    if (gridContainer) gridContainer.innerHTML = '';
    return;
  }
  filterByCustomCriteria();
}

function filterByCustomCriteria(dateRangeOverride){
  const saved = loadCustomCriteria();
  const matchMode = saved.matchMode || getMatchMode();
  const useExpansive = matchMode === 'expansive' || matchMode === 'many';
  const tq = tokensFromQuery(saved.customWords ? saved.customWords.join(' ') : '');
  const provinces = new Set(saved.provinces || []);
  const organs = new Set(saved.organs || []);
  const categories = new Set(saved.categories || []);
  const services = new Set(saved.services || []);
  const { from, to } = rangeToDates(dateRangeOverride || saved.advRange || 'any');

  const filtered = rows.filter(r=>{
    const matches = [];
    const hasNonTimeFilters = provinces.size || organs.size || categories.size || services.size || tq.length;
    if (useExpansive && (from || to)) {
      const d = parseCsvDate(r['Advertised']);
      if ((from && d < startOfDay(from)) || (to && d > endOfDay(to))) return false;
    }
    if (provinces.size) matches.push(provinces.has(r['Province']));
    if (organs.size) matches.push(organs.has(r['Organ Of State']));
    if (categories.size) matches.push(categories.has(r['Category']));
    if (services.size) matches.push(services.has(r['Category']));
    if (from || to) {
      if (!useExpansive) {
        const d = parseCsvDate(r['Advertised']);
        matches.push((!from || d >= startOfDay(from)) && (!to || d <= endOfDay(to)));
      }
    }
    if (tq.length) {
      const hay = normalizeText(`${r['Tender Number']} ${r['Tender Description']} ${r['Category']} ${r['Organ Of State']} ${r['Province']} ${r['Special Conditions']}`);
      matches.push(useExpansive ? tq.some(t=>hay.includes(t)) : tq.every(t=>hay.includes(t)));
    }
    if (matches.length === 0) return !hasNonTimeFilters;
    return useExpansive ? matches.some(m=>m) : matches.every(m=>m);
  });

  const scored = filtered.map(r=>{
    const text = normalizeText(`${r['Tender Number']} ${r['Tender Description']} ${r['Category']}`);
    const score = tq.reduce((acc,t)=>acc+(text.includes(t)?1:0),0);
    return {row:r, score};
  }).sort((a,b)=>b.score-a.score);

  render(scored.map(x=>x.row));
}

function hasCustomCriteria(){
  const saved = loadCustomCriteria();
  if (!saved || Object.keys(saved).length === 0) return false;
  const has = (saved.categories?.length || 0) + (saved.services?.length || 0) + (saved.provinces?.length || 0) + (saved.organs?.length || 0) + (saved.customWords?.length || 0);
  return has > 0;
}

function renderWatchAlerts(){
  const emptyEl = $('watchAlertsEmpty');
  const rangeSel = $('watchAlertsRange');
  const range = rangeSel?.value || '7d';
  if (!hasCustomCriteria()) {
    if (emptyEl) { emptyEl.style.display = 'block'; }
    displayedData = [];
    if (gridContainer) gridContainer.innerHTML = '';
    if (stats) stats.textContent = 'Set up custom criteria to see watch alerts.';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  filterByCustomCriteria(range);
}

function normalizeText(s){
  return String(s||'')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi,' ')
    .trim();
}

function tokensFromQuery(q){
  return String(q||'')
    .toLowerCase()
    .split(/[\s,]+/)
    .map(t=>t.trim())
    .filter(Boolean);
}

function getTenderFlags(tenderNumber, localSaved){
  const saved = localSaved || JSON.parse(localStorage.getItem('tenderFlags')||'{}');
  const sv = serverFlags[tenderNumber] || {};
  return {
    interested: (sv.interested !== undefined) ? sv.interested : saved[`int_${tenderNumber}`],
    reviewed: (sv.reviewed !== undefined) ? sv.reviewed : saved[`rev_${tenderNumber}`],
    tendered: (sv.tendered !== undefined) ? sv.tendered : saved[`ten_${tenderNumber}`],
    notInterested: (sv.notInterested !== undefined) ? sv.notInterested : saved[`nint_${tenderNumber}`]
  };
}

function clearMunicipalViewAndFilter() {
  municipalScrapeView = null;
  filterRows();
}
function filterRows(){
  if (municipalScrapeView) {
    const searchVal = getSearchValue();
    const tq = tokensFromQuery(searchVal);
    const province = provinceSel?.value;
    const organ = organSel?.value;
    const category = categorySel?.value;
    const { from, to } = rangeToDates(advRange ? advRange.value : 'any');
    const showAll = $('showAll')?.checked;
    const showInterested = $('showInterested')?.checked;
    const showReviewed = $('showReviewed')?.checked;
    const showTendered = $('showTendered')?.checked;
    const showNotInterested = $('showNotInterested')?.checked;
    const showAny = !showAll && (showInterested || showReviewed || showTendered || showNotInterested);
    const localSaved = showAny ? JSON.parse(localStorage.getItem('tenderFlags')||'{}') : null;
    let filtered = municipalScrapeView.data;
    filtered = filtered.filter(r => {
      if (province && r['Province'] !== province) return false;
      if (organ && r['Organ Of State'] !== organ) return false;
      if (category && r['Category'] !== category) return false;
      if (from || to) {
        const d = parseCsvDate(r['Advertised']);
        if (from && d < startOfDay(from)) return false;
        if (to && d > endOfDay(to)) return false;
      }
      if (showAny) {
        const f = getTenderFlags(r['Tender Number'], localSaved);
        const match = (showInterested && f.interested) || (showReviewed && f.reviewed) || (showTendered && f.tendered) || (showNotInterested && f.notInterested);
        if (!match) return false;
      }
      return true;
    });
    if (tq.length) {
      filtered = filtered.filter(r => {
        const hay = normalizeText(`${r['Tender Number']} ${r['Tender Description']} ${r['Category']} ${r['Organ Of State']} ${r['Province']} ${r['Special Conditions']}`);
        return tq.some(t => hay.includes(t));
      });
    }
    const scored = filtered.map(r => {
      const text = normalizeText(`${r['Tender Number']} ${r['Tender Description']} ${r['Category']}`);
      const score = tq.length ? tq.reduce((acc, t) => acc + (text.includes(t) ? 1 : 0), 0) : 0;
      return { row: r, score };
    }).sort((a, b) => b.score - a.score);
    render(scored.map(x => x.row));
    if (stats) stats.textContent = `${filtered.length} ${municipalScrapeView.source} tenders`;
    requestAnimationFrame(resizeGridViewport);
    return;
  }
  const searchVal = getSearchValue();
  const tq = tokensFromQuery(searchVal);
  const province = provinceSel?.value;
  const organ = organSel?.value;
  const category = categorySel?.value;
  const wantAI = false;
  const { from, to } = rangeToDates(advRange ? advRange.value : 'any');
  const showAll = $('showAll')?.checked;
  const showInterested = $('showInterested')?.checked;
  const showReviewed = $('showReviewed')?.checked;
  const showTendered = $('showTendered')?.checked;
  const showNotInterested = $('showNotInterested')?.checked;
  const showAny = !showAll && (showInterested || showReviewed || showTendered || showNotInterested);

  const matchMode = document.querySelector('input[name="mainMatchMode"]:checked')?.value || getMatchMode();
  const useExpansive = matchMode === 'expansive';
  const localSaved = showAny ? JSON.parse(localStorage.getItem('tenderFlags')||'{}') : null;

  const hasFilters = !!(province || organ || category || tq.length || (from || to));
  if (!hasFilters && !showAny) {
    const filtered = rows;
    render(filtered);
    return;
  }

  const filtered = rows.filter(r=>{
    if (showAny){
      const f = getTenderFlags(r['Tender Number'], localSaved);
      const match = (showInterested && f.interested) || (showReviewed && f.reviewed) || (showTendered && f.tendered) || (showNotInterested && f.notInterested);
      if (!match) return false;
    }

    if (wantAI && !aiMap.get(r['Tender Number'])) return false;

    if (useExpansive) {
      const matches = [];
      const hasNonTimeFilters = !!(province || organ || category || tq.length);
      if (from || to) {
        const d = parseCsvDate(r['Advertised']);
        if ((from && d < startOfDay(from)) || (to && d > endOfDay(to))) return false;
      }
      if (province) matches.push(r['Province']===province);
      if (organ) matches.push(r['Organ Of State']===organ);
      if (category) matches.push(r['Category']===category);
      if (tq.length) {
        const hay = normalizeText(`${r['Tender Number']} ${r['Tender Description']} ${r['Category']} ${r['Organ Of State']} ${r['Province']} ${r['Special Conditions']}`);
        matches.push(tq.some(t=>hay.includes(t)));
      }
      if (matches.length === 0) return !hasNonTimeFilters;
      return matches.some(m=>m);
    } else {
      if (province && r['Province']!==province) return false;
      if (organ && r['Organ Of State']!==organ) return false;
      if (category && r['Category']!==category) return false;
      if (from || to){
        const d = parseCsvDate(r['Advertised']);
        if (from && d < startOfDay(from)) return false;
        if (to && d > endOfDay(to)) return false;
      }
      if (!tq.length) return true;
      const hay = normalizeText(`${r['Tender Number']} ${r['Tender Description']} ${r['Category']} ${r['Organ Of State']} ${r['Province']} ${r['Special Conditions']}`);
      return tq.every(t=>hay.includes(t));
    }
  });

  const scored = filtered.map(r=>{
    const text = normalizeText(`${r['Tender Number']} ${r['Tender Description']} ${r['Category']}`);
    const score = tq.reduce((acc,t)=>acc+(text.includes(t)?1:0),0);
    return {row:r, score};
  }).sort((a,b)=>b.score-a.score);

  render(scored.map(x=>x.row));
  requestAnimationFrame(resizeGridViewport);
}

function badge(text){
  const s=document.createElement('span');s.className='badge';s.textContent=text;return s;
}

function createCard(r){
    const card=document.createElement('div');
    card.className = 'card';

    const title=document.createElement('div');title.className='title';
    title.textContent=r['Tender Description'];
    card.appendChild(title);

    const meta=document.createElement('div');meta.className='meta';
    meta.appendChild(badge(r['Tender Number']||''));
    meta.appendChild(badge(r['Category']||''));
    if (r['Source']) meta.appendChild(badge(r['Source']));
    if (aiMap.get(r['Tender Number'])) meta.appendChild(badge('AI/Data'));
    const tenderId = r['Tender ID'];
    const tenderNumber = r['Tender Number'] || '';
    const src = (r['Source'] || '').trim();
    const rawSourceUrl = (r['Source URL'] || '').trim();
    const hasSourceUrl = !!rawSourceUrl;
    const isEtendersSourceUrl = /etenders\.gov\.za/i.test(rawSourceUrl) || /^\/tender(\/|$)/i.test(rawSourceUrl) || /^\/tender-lookup/i.test(rawSourceUrl);
    const isMunicipal = municipalSourceSet.has(src) || (r['Category'] === 'Municipal');
    // Municipal rows must open municipality source pages, never eTenders lookup pages.
    const ETENDERS_OPPORTUNITIES_URL = 'https://www.etenders.gov.za/Home/opportunities?id=1';
    const sourceUrl = isMunicipal
      ? ((hasSourceUrl && !isEtendersSourceUrl) ? rawSourceUrl : '#')
      : ETENDERS_OPPORTUNITIES_URL;
    const viewBtn = document.createElement('a');
    viewBtn.href = sourceUrl;
    viewBtn.target = '_blank';
    viewBtn.rel = 'noopener noreferrer';
    viewBtn.className = 'btn primary sm view-source';
    const municipalHasValidSource = isMunicipal && hasSourceUrl && !isEtendersSourceUrl;
    const viewText = isMunicipal ? (municipalHasValidSource ? 'View source details' : 'Source unavailable') : 'View on eTenders';
    viewBtn.innerHTML = `<i class="fa-solid fa-up-right-from-square" aria-hidden="true"></i> ${viewText}`;
    if (isMunicipal && !municipalHasValidSource) {
      viewBtn.classList.add('btn-disabled');
      viewBtn.addEventListener('click', (e) => e.preventDefault());
      viewBtn.title = 'No municipality source URL available for this row';
    }
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn secondary sm';
    copyBtn.innerHTML = '<i class="fa-solid fa-copy" aria-hidden="true"></i> <span class="copy-btn-text">Copy tender number</span>';
    copyBtn.title = 'Copy to clipboard';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(tenderNumber);
        const textSpan = copyBtn.querySelector('.copy-btn-text');
        const t = textSpan?.textContent || 'Copy tender number';
        if (textSpan) textSpan.textContent = 'Copied!';
        setTimeout(() => { if (textSpan) textSpan.textContent = t; }, 1500);
      } catch (_) {}
    });
    const metaActions = document.createElement('div');
    metaActions.className = 'meta-actions';
    metaActions.appendChild(viewBtn);
    metaActions.appendChild(copyBtn);
    meta.appendChild(metaActions);
    card.appendChild(meta);

    const kv=document.createElement('div');kv.className='kv';
    const add=(k,v)=>{const a=document.createElement('div');a.textContent=k;const b=document.createElement('div');b.textContent=v||'';kv.appendChild(a);kv.appendChild(b);} 
    add('Advertised', r['Advertised']);
    add('Closing', r['Closing']);
    add('Organ', r['Organ Of State']);
    add('Province', r['Province']);
    add('Contact', r['Contact Person']);
    add('Email', r['Email']);
    add('Telephone', r['Telephone number']);
    add('Briefing', r['Is there a briefing session?']);
    add('Compulsory', r['Is it compulsory?']);
    add('Venue', r['Briefing Venue']);
    add('Where', r['Place where goods, works or services are required']);
    card.appendChild(kv);

    // Flags: Assigned to, Interested / Reviewed / Tendered / Not interested (persist to localStorage keyed by tender number)
    const localSaved = JSON.parse(localStorage.getItem('tenderFlags')||'{}');
    const sv = serverFlags[r['Tender Number']] || {};
    const flags=document.createElement('div');flags.className='flags';
    const interestedId = `int_${r['Tender Number']}`;
    const reviewedId = `rev_${r['Tender Number']}`;
    const tenderedId = `ten_${r['Tender Number']}`;
    const notInterestedId = `nint_${r['Tender Number']}`;
    const interested = document.createElement('input'); interested.type='checkbox'; interested.id=interestedId;
    const reviewed = document.createElement('input'); reviewed.type='checkbox'; reviewed.id=reviewedId;
    const tendered = document.createElement('input'); tendered.type='checkbox'; tendered.id=tenderedId;
    const notInterested = document.createElement('input'); notInterested.type='checkbox'; notInterested.id=notInterestedId;

    // Load persisted (server first, fallback to localStorage)
    const initialInterested = (sv.interested !== undefined) ? sv.interested : localSaved[interestedId];
    const initialReviewed = (sv.reviewed !== undefined) ? sv.reviewed : localSaved[reviewedId];
    const initialTendered = (sv.tendered !== undefined) ? sv.tendered : localSaved[tenderedId];
    const initialNotInterested = (sv.notInterested !== undefined) ? sv.notInterested : localSaved[notInterestedId];
    if (initialInterested) { interested.checked = true; card.classList.add('interested'); }
    if (initialReviewed) { reviewed.checked = true; card.classList.add('reviewed'); }
    if (initialTendered) { tendered.checked = true; card.classList.add('tendered'); }
    if (initialNotInterested) { notInterested.checked = true; card.classList.add('not-interested'); }

    const reviewedBySpan = document.createElement('span');
    reviewedBySpan.className = 'reviewed-by-text';
    reviewedBySpan.textContent = (sv.reviewedBy || localSaved[`revby_${r['Tender Number']}`] || '') ? `Reviewed by: ${sv.reviewedBy || localSaved[`revby_${r['Tender Number']}`]}` : '';
    const saveFlags = ()=>{
      const obj = JSON.parse(localStorage.getItem('tenderFlags')||'{}');
      obj[interestedId] = interested.checked;
      obj[reviewedId] = reviewed.checked;
      obj[tenderedId] = tendered.checked;
      obj[notInterestedId] = notInterested.checked;
      const tn = r['Tender Number'];
      const reviewedBy = getCurrentUser();
      obj[`revby_${tn}`] = reviewedBy;
      localStorage.setItem('tenderFlags', JSON.stringify(obj));
      serverFlags[tn] = { ...(serverFlags[tn]||{}), interested: interested.checked, reviewed: reviewed.checked, tendered: tendered.checked, notInterested: notInterested.checked, reviewedBy };
      fetch('/api/flags', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tenderNumber: tn, interested: interested.checked, reviewed: reviewed.checked, tendered: tendered.checked, notInterested: notInterested.checked, reviewedBy }) }).catch(()=>{});
      if (interested.checked) card.classList.add('interested'); else card.classList.remove('interested');
      if (reviewed.checked) card.classList.add('reviewed'); else card.classList.remove('reviewed');
      if (tendered.checked) card.classList.add('tendered'); else card.classList.remove('tendered');
      if (notInterested.checked) card.classList.add('not-interested'); else card.classList.remove('not-interested');
      reviewedBySpan.textContent = reviewedBy ? `Reviewed by: ${reviewedBy}` : '';
    };
    interested.addEventListener('change', saveFlags);
    reviewed.addEventListener('change', saveFlags);
    tendered.addEventListener('change', saveFlags);
    notInterested.addEventListener('change', saveFlags);

    const iLabel=document.createElement('label'); iLabel.htmlFor=interestedId; iLabel.innerHTML='<span>Interested</span>'; iLabel.prepend(interested);
    const rLabel=document.createElement('label'); rLabel.htmlFor=reviewedId; rLabel.innerHTML='<span>Reviewed</span>'; rLabel.prepend(reviewed);
    const tLabel=document.createElement('label'); tLabel.htmlFor=tenderedId; tLabel.innerHTML='<span>Tendered</span>'; tLabel.prepend(tendered);
    const niLabel=document.createElement('label'); niLabel.htmlFor=notInterestedId; niLabel.innerHTML='<span>Not interested</span>'; niLabel.prepend(notInterested);
    iLabel.addEventListener('click', ()=>{ const willBe=!interested.checked; if(willBe) card.classList.add('interested'); else card.classList.remove('interested'); });
    rLabel.addEventListener('click', ()=>{ const willBe=!reviewed.checked; if(willBe) card.classList.add('reviewed'); else card.classList.remove('reviewed'); });
    tLabel.addEventListener('click', ()=>{ const willBe=!tendered.checked; if(willBe) card.classList.add('tendered'); else card.classList.remove('tendered'); });
    niLabel.addEventListener('click', ()=>{ const willBe=!notInterested.checked; if(willBe) card.classList.add('not-interested'); else card.classList.remove('not-interested'); });
    // Assigned to dropdown
    const assignedWrap = document.createElement('div');
    assignedWrap.className = 'assigned-to-wrap';
    const assignedSpan = document.createElement('span');
    assignedSpan.className = 'assigned-label';
    assignedSpan.textContent = 'Assigned to ';
    const assignedSelect = document.createElement('select');
    assignedSelect.className = 'select assigned-select';
    ASSIGNED_USERS.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name || '—';
      assignedSelect.appendChild(opt);
    });
    const initialAssigned = sv.assignedTo || localSaved[`assigned_${r['Tender Number']}`] || '';
    assignedSelect.value = ASSIGNED_USERS.includes(initialAssigned) ? initialAssigned : '';
    assignedWrap.appendChild(assignedSpan);
    assignedWrap.appendChild(assignedSelect);
    const reviewedByWrap = document.createElement('div');
    reviewedByWrap.className = 'reviewed-by-wrap';
    reviewedByWrap.appendChild(reviewedBySpan);
    assignedSelect.addEventListener('change', ()=>{
      const val = assignedSelect.value;
      const tn = r['Tender Number'];
      const obj = JSON.parse(localStorage.getItem('tenderFlags')||'{}');
      obj[`assigned_${tn}`] = val;
      const reviewedBy = getCurrentUser();
      obj[`revby_${tn}`] = reviewedBy;
      localStorage.setItem('tenderFlags', JSON.stringify(obj));
      serverFlags[r['Tender Number']] = { ...(serverFlags[r['Tender Number']]||{}), assignedTo: val, reviewedBy };
      fetch('/api/flags', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tenderNumber: r['Tender Number'], assignedTo: val, reviewedBy }) }).catch(()=>{});
      reviewedBySpan.textContent = reviewedBy ? `Reviewed by: ${reviewedBy}` : '';
    });
    flags.appendChild(assignedWrap); flags.appendChild(reviewedByWrap);
    // Add comment button inline with flags
    const commentBtn = document.createElement('button');
    commentBtn.className='btn primary sm';
    commentBtn.innerHTML='<i class="fa-solid fa-comment" aria-hidden="true"></i> Add comment';
    flags.appendChild(iLabel); flags.appendChild(rLabel); flags.appendChild(tLabel); flags.appendChild(niLabel); flags.appendChild(commentBtn);
    card.appendChild(flags);

    // Add comment section (toggleable)
    const commentWrap = document.createElement('div');
    commentWrap.className='comment';
    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Write a short note for this tender...';
    const commentActions = document.createElement('div');
    commentActions.className='actions';
    const saveComment = document.createElement('button'); saveComment.className='btn primary'; saveComment.innerHTML='<i class="fa-solid fa-check" aria-hidden="true"></i> Save';
    const cancelComment = document.createElement('button'); cancelComment.className='btn'; cancelComment.innerHTML='<i class="fa-solid fa-xmark" aria-hidden="true"></i> Cancel';
    commentActions.appendChild(saveComment); commentActions.appendChild(cancelComment);
    commentWrap.appendChild(textarea); commentWrap.appendChild(commentActions);
    card.appendChild(commentWrap);

    // Populate from server/local if exists
    const existingComment = (serverFlags[r['Tender Number']]||{}).comment || localSaved[`com_${r['Tender Number']}`] || '';
    if (existingComment) { textarea.value = existingComment; }

    commentBtn.addEventListener('click', ()=>{
      commentWrap.style.display = commentWrap.style.display==='flex' ? 'none' : 'flex';
    });
    cancelComment.addEventListener('click', ()=>{ commentWrap.style.display='none'; });
    saveComment.addEventListener('click', ()=>{
      const tn = r['Tender Number'];
      const obj = JSON.parse(localStorage.getItem('tenderFlags')||'{}');
      obj[`com_${tn}`] = textarea.value;
      const reviewedBy = getCurrentUser();
      obj[`revby_${tn}`] = reviewedBy;
      localStorage.setItem('tenderFlags', JSON.stringify(obj));
      serverFlags[tn] = { ...(serverFlags[tn]||{}), comment: textarea.value, reviewedBy };
      fetch('/api/flags', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tenderNumber: r['Tender Number'], comment: textarea.value, reviewedBy }) }).catch(()=>{});
      reviewedBySpan.textContent = reviewedBy ? `Reviewed by: ${reviewedBy}` : '';
      commentWrap.style.display='none';
    });

    return card;
}

function render(data){
  displayedData = data || [];
  if (stats) stats.textContent = `${displayedData.length} results · ${rows.length} total`;
  if (!gridContainer) return;

  gridContainer.innerHTML = '';
  if (displayedData.length === 0) return;

  for (const row of displayedData) {
    gridContainer.appendChild(createCard(row));
  }
}

function getFlagsForRow(r){
  const localSaved = JSON.parse(localStorage.getItem('tenderFlags')||'{}');
  const tn = r['Tender Number'];
  const sv = serverFlags[tn] || {};
  return {
    interested: (sv.interested !== undefined) ? sv.interested : localSaved[`int_${tn}`],
    reviewed: (sv.reviewed !== undefined) ? sv.reviewed : localSaved[`rev_${tn}`],
    tendered: (sv.tendered !== undefined) ? sv.tendered : localSaved[`ten_${tn}`],
    notInterested: (sv.notInterested !== undefined) ? sv.notInterested : localSaved[`nint_${tn}`],
    assignedTo: sv.assignedTo || localSaved[`assigned_${tn}`] || ''
  };
}

function isActive(r){
  const closing = r['Closing'];
  if (!closing) return true;
  return parseCsvDate(closing) >= startOfDay(new Date());
}

function daysUntilClosing(r){
  const closing = r['Closing'];
  if (!closing) return 999;
  const d = parseCsvDate(closing);
  const today = startOfDay(new Date());
  return Math.ceil((d - today) / (24*60*60*1000));
}

function buildDashboard(){
  let interested = [], reviewed = [], tendered = [], needsReview = [], closingSoon = [], byAssigned = {};

  for (const r of rows) {
    const f = getFlagsForRow(r);
    if (!f.interested && !f.reviewed && !f.tendered && !f.notInterested) continue;
    if (f.notInterested) continue;

    const active = isActive(r);
    const days = daysUntilClosing(r);

    if (f.interested) interested.push(r);
    if (f.reviewed) reviewed.push(r);
    if (f.tendered) tendered.push(r);
    if (f.interested && !f.reviewed && active) needsReview.push(r);
    if ((f.interested || f.reviewed) && days >= 0 && days <= 7) closingSoon.push(r);
    if (f.assignedTo) {
      if (!byAssigned[f.assignedTo]) byAssigned[f.assignedTo] = [];
      byAssigned[f.assignedTo].push(r);
    }
  }

  needsReview.sort((a,b)=> daysUntilClosing(a) - daysUntilClosing(b));
  closingSoon.sort((a,b)=> daysUntilClosing(a) - daysUntilClosing(b));

  return { interested, reviewed, tendered, needsReview, closingSoon, byAssigned };
}

let dashboardFilter = 'all';

function renderDashboard(){
  const statsEl = $('dashboardStats');
  const sectionsEl = $('dashboardSections');
  if (!statsEl || !sectionsEl) return;

  const { interested, reviewed, tendered, needsReview, closingSoon, byAssigned } = buildDashboard();
  const total = new Set([...needsReview,...closingSoon,...interested,...reviewed,...tendered,...Object.values(byAssigned).flat()]).size;

  const filters = [
    { key: 'all', num: total, label: 'All' },
    { key: 'needsReview', num: needsReview.length, label: 'Needs review' },
    { key: 'closingSoon', num: closingSoon.length, label: 'Closing in 7 days' },
    { key: 'interested', num: interested.length, label: 'Interested' },
    { key: 'reviewed', num: reviewed.length, label: 'Reviewed' },
    { key: 'tendered', num: tendered.length, label: 'Tendered' }
  ];

  statsEl.innerHTML = '';
  for (const f of filters) {
    const card = document.createElement('div');
    card.className = 'stat-card' + (dashboardFilter === f.key ? ' stat-card-active' : '');
    card.setAttribute('data-filter', f.key);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.innerHTML = `<span class="stat-num">${f.num}</span><span class="stat-label">${f.label}</span>`;
    card.addEventListener('click', () => { dashboardFilter = f.key; renderDashboard(); });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dashboardFilter = f.key; renderDashboard(); } });
    statsEl.appendChild(card);
  }

  sectionsEl.innerHTML = '';
  const addSection = (title, data, emptyMsg) => {
    const sec = document.createElement('div');
    sec.className = 'dashboard-section';
    const h3 = document.createElement('h3');
    h3.textContent = `${title} (${data.length})`;
    sec.appendChild(h3);
    const grid = document.createElement('div');
    grid.className = 'grid-container';
    if (data.length === 0) {
      grid.innerHTML = `<p class="muted">${emptyMsg}</p>`;
    } else {
      for (const r of data) grid.appendChild(createCard(r));
    }
    sec.appendChild(grid);
    sectionsEl.appendChild(sec);
  };

  if (dashboardFilter === 'all') {
    const seen = new Set();
    const allTenders = [];
    for (const r of [...needsReview, ...closingSoon, ...interested, ...reviewed, ...tendered, ...Object.values(byAssigned).flat()]) {
      const tn = r['Tender Number'];
      if (tn && !seen.has(tn)) { seen.add(tn); allTenders.push(r); }
    }
    allTenders.sort((a, b) => daysUntilClosing(a) - daysUntilClosing(b));
    addSection('All', allTenders, 'No tenders to display.');
  } else {
    const showSection = (key, title, data, emptyMsg) => {
      if (dashboardFilter !== key) return;
      addSection(title, data, emptyMsg);
    };
    showSection('needsReview', 'Needs review', needsReview, 'No tenders marked Interested awaiting review.');
    showSection('closingSoon', 'Closing soon', closingSoon, 'No Interested or Reviewed tenders closing in the next 7 days.');
    showSection('interested', 'Interested', interested, 'No tenders marked Interested.');
    showSection('reviewed', 'Reviewed', reviewed, 'No tenders marked Reviewed.');
    showSection('tendered', 'Tendered', tendered, 'No tenders marked Tendered.');
  }

  const dashboardEl = $('dashboardSection');
  if (dashboardEl) {
    if (dashboardFilter === 'all') dashboardEl.classList.add('dashboard-filter-all');
    else dashboardEl.classList.remove('dashboard-filter-all');
  }
}

function hideDashboard(){
  const tendersTab = document.querySelector('.tab-btn[data-tab="tenders"]');
  if (tendersTab) tendersTab.click();
  requestAnimationFrame(resizeGridViewport);
}

function exportCsv(data){
  const csv = Papa.unparse(data);
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='search_results.csv'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),500);
}
function parseCsvDate(v){
  if (!v) return new Date('1900-01-01');
  const [dd,mm,yyyy] = String(v).split('/');
  return new Date(Number(yyyy), Number(mm)-1, Number(dd));
}
function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d){ const x=new Date(d); x.setHours(23,59,59,999); return x; }
function rangeToDates(value){
  const now = new Date();
  const todayStart = startOfDay(now);
  switch(value){
    case '7d':
      return { from: new Date(todayStart.getTime() - 7*24*60*60*1000), to: endOfDay(now) };
    case '30d':
      return { from: new Date(todayStart.getTime() - 30*24*60*60*1000), to: endOfDay(now) };
    case '90d':
      return { from: new Date(todayStart.getTime() - 90*24*60*60*1000), to: endOfDay(now) };
    case 'this_month': {
      const f = new Date(now.getFullYear(), now.getMonth(), 1);
      const t = endOfDay(now);
      return { from: f, to: t };
    }
    case 'last_month': {
      const f = new Date(now.getFullYear(), now.getMonth()-1, 1);
      const t = new Date(now.getFullYear(), now.getMonth(), 0, 23,59,59,999);
      return { from: f, to: t };
    }
    case 'this_year': {
      const f = new Date(now.getFullYear(), 0, 1);
      const t = endOfDay(now);
      return { from: f, to: t };
    }
    case 'last_year': {
      const f = new Date(now.getFullYear()-1, 0, 1);
      const t = new Date(now.getFullYear()-1, 11, 31, 23,59,59,999);
      return { from: f, to: t };
    }
    default:
      return { from: null, to: null };
  }
}

let employees = [];
async function loadEmployees(){
  try {
    const res = await fetch('/api/employees');
    if (res.ok) employees = await res.json();
    else employees = [];
  } catch (_) { employees = []; }
  renderEmployeeList();
}
function renderEmployeeList(){
  const list = $('employeeList');
  const count = $('employeeCount');
  if (!list || !count) return;
  count.textContent = employees.length;
  list.innerHTML = '';
  for (const e of employees) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="emp-info">
        <div class="emp-name">${escapeHtml(e.name)}</div>
        <div class="emp-details">${escapeHtml(e.email)}${e.phone ? ' · ' + escapeHtml(e.phone) : ''}${e.employeeNumber ? ' · #' + escapeHtml(e.employeeNumber) : ''}</div>
      </div>
      <button type="button" class="btn primary sm emp-remove" data-id="${escapeHtml(e.id)}" title="Remove"><i class="fa-solid fa-trash" aria-hidden="true"></i> Remove</button>
    `;
    li.querySelector('.emp-remove').addEventListener('click', async () => {
      try {
        const r = await fetch(`/api/employees/${e.id}`, { method: 'DELETE' });
        if (r.ok) { employees = employees.filter(x => x.id !== e.id); renderEmployeeList(); }
      } catch (_) {}
    });
    list.appendChild(li);
  }
}
function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }
$('employeeGroupForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('empName')?.value?.trim();
  const email = $('empEmail')?.value?.trim();
  const phone = $('empPhone')?.value?.trim() || '';
  const employeeNumber = $('empNumber')?.value?.trim() || '';
  if (!name || !email) return;
  try {
    const res = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, employeeNumber })
    });
    if (res.ok) {
      const added = await res.json();
      employees.push(added);
      renderEmployeeList();
      $('empName').value = ''; $('empEmail').value = ''; $('empPhone').value = ''; $('empNumber').value = '';
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Failed to add member');
    }
  } catch (_) { alert('Failed to add member'); }
});
$('searchBtn')?.addEventListener('click', async ()=>{ await runWithBusy('Searching tenders...', async ()=>{ hideDashboard(); municipalScrapeView = null; if (provinceSel) provinceSel.value = ''; setProvinceRadioValue(''); const muniSel = $('municipalScraperSel'); if (muniSel) muniSel.value = ''; if (typeof updateMunicipalSearchButtonState === 'function') updateMunicipalSearchButtonState(); filterRows(); }, $('searchBtn'), 'Searching...'); });

$('showAllBtn')?.addEventListener('click', async () => {
  await runWithBusy('Showing all tenders...', () => {
    hideDashboard();
    municipalScrapeView = null;
    setSearchValue('');
    if (qInput) qInput.value = '';
    if (organSel) organSel.value = '';
    if (categorySel) categorySel.value = '';
    if (advRange) advRange.value = 'any';
    if (provinceSel) provinceSel.value = '';
    setProvinceRadioValue('');
    const muniSel = $('municipalScraperSel');
    if (muniSel) muniSel.value = '';
    if (typeof updateMunicipalSearchButtonState === 'function') updateMunicipalSearchButtonState();
    const inputWrap = document.querySelector('.input-clearable');
    if (inputWrap) inputWrap.classList.remove('has-text');
    filterRows();
  }, $('showAllBtn'), 'Show all');
});

{
  const searchClearBtn = $('searchClearBtn');
  const inputWrap = document.querySelector('.input-clearable');
  const updateClearVisibility = () => {
    if (inputWrap) inputWrap.classList.toggle('has-text', !!getSearchValue());
  };
  qInput?.addEventListener('input', updateClearVisibility);
  qInput?.addEventListener('focus', updateClearVisibility);
  searchClearBtn?.addEventListener('click', () => {
    setSearchValue('');
    if (qInput) qInput.value = '';
    updateClearVisibility();
    filterRows();
  });
  updateClearVisibility();
}

$('customCriteriaBtn')?.addEventListener('click', openCriteriaModal);
$('searchMyCriteriaBtn')?.addEventListener('click', async ()=>{ await runWithBusy('Searching custom criteria...', async ()=> applySearchMyCriteria(), $('searchMyCriteriaBtn'), 'Searching...'); });

$('refreshWatchAlertsBtn')?.addEventListener('click', ()=>{ renderWatchAlerts(); });
$('watchAlertsRange')?.addEventListener('change', ()=>{ renderWatchAlerts(); });

$('customCriteriaModal')?.querySelector('.modal-backdrop')?.addEventListener('click', closeCriteriaModal);
$('customCriteriaModal')?.querySelector('.modal-close')?.addEventListener('click', closeCriteriaModal);
$('customCriteriaModal')?.querySelector('.modal-close-btn')?.addEventListener('click', closeCriteriaModal);
function clearCustomCriteria(){
  saveCustomCriteria({});
  populateCriteriaModal();
  renderCustomCriteriaSummary();
  filterRows();
}
$('clearCustomCriteriaBtn')?.addEventListener('click', clearCustomCriteria);
$('clearCustomCriteriaBtnMain')?.addEventListener('click', clearCustomCriteria);
document.addEventListener('keydown', (e)=>{
  if (e.key === 'Escape' && $('customCriteriaModal')?.getAttribute('aria-hidden') === 'false') closeCriteriaModal();
});

$('customCriteriaForm')?.addEventListener('submit', (e)=>{
  e.preventDefault();
  const getChecked = (containerId) => {
    const box = $(containerId);
    if (!box) return [];
    return [...box.querySelectorAll('input[type="checkbox"]')].filter(cb=>cb.checked).map(cb=>cb.value);
  };
  const wordsRaw = ($('customWords')?.value || '').trim();
  const customWords = wordsRaw ? wordsRaw.split(/[\s,]+/).map(w=>w.trim()).filter(Boolean) : [];
  const criteria = {
    categories: getChecked('categoryCheckboxes'),
    services: getChecked('servicesCheckboxes'),
    provinces: getChecked('provinceCheckboxes'),
    organs: getChecked('organCheckboxes'),
    customWords,
    advRange: $('criteriaAdvRange')?.value || 'any',
    matchMode: document.querySelector('input[name="matchMode"]:checked')?.value || getMatchMode()
  };
  let mode = criteria.matchMode || 'expansive';
  if (mode === 'many') mode = 'expansive';
  if (mode === 'exact') mode = 'all';
  criteria.matchMode = mode;
  saveCustomCriteria(criteria);
  renderCustomCriteriaSummary();
  setMatchMode(mode);
  document.querySelectorAll('input[name="mainMatchMode"]').forEach(r => { r.checked = (r.value === mode); });
  closeCriteriaModal();
});
// removed Export CSV button

// removed AI toggle listener
// When in municipalScrapeView, filter changes must NOT clear it - we show that municipality's data only.
// Use a wrapper that only clears when NOT in municipal view, or when user explicitly wants to filter.
function onFilterChange() {
  if (municipalScrapeView) return; // Keep showing municipal data - don't switch to global filter
  clearMunicipalViewAndFilter();
}
provinceSel?.addEventListener('change', async ()=>{ await runWithBusy('Updating province filters...', async ()=>{ setProvinceRadioValue(provinceSel.value); await loadMunicipalScrapers(provinceSel.value); onFilterChange(); }); });
organSel?.addEventListener('change', onFilterChange);
categorySel?.addEventListener('change', onFilterChange);
if (advRange) advRange.addEventListener('change', onFilterChange);
document.querySelectorAll('input[name="mainMatchMode"]').forEach(r=> r?.addEventListener('change', ()=>{
  setMatchMode(r.value);
  onFilterChange();
}));
// Show tickboxes (Interested/Reviewed/Tendered filter)
{
  let showFilterDebounce;
  const onShowChange = (e)=>{
    const showAll = $('showAll');
    const others = [$('showInterested'), $('showReviewed'), $('showTendered'), $('showNotInterested')];
    if (e?.target?.id === 'showAll') {
      if (showAll?.checked) others.forEach(o=> { if(o) o.checked = true; });
    } else {
      if (others.some(o=> o?.checked)) showAll.checked = false;
    }
    clearTimeout(showFilterDebounce);
    showFilterDebounce = setTimeout(()=> requestAnimationFrame(onFilterChange), 50);
  };
  [$('showAll'), $('showInterested'), $('showReviewed'), $('showTendered'), $('showNotInterested')].forEach(cb=> cb?.addEventListener('change', onShowChange));
}
qInput?.addEventListener('keydown', async (e)=>{ if(e.key==='Enter'){ await runWithBusy('Searching tenders...', async ()=>{ hideDashboard(); municipalScrapeView = null; if (provinceSel) provinceSel.value = ''; setProvinceRadioValue(''); const muniSel = $('municipalScraperSel'); if (muniSel) muniSel.value = ''; if (typeof updateMunicipalSearchButtonState === 'function') updateMunicipalSearchButtonState(); filterRows(); }, $('searchBtn'), 'Searching...'); }});
window.addEventListener('resize', () => {
  requestAnimationFrame(resizeGridViewport);
  requestAnimationFrame(syncHeroOffset);
});
window.addEventListener('load', () => requestAnimationFrame(syncHeroOffset));

// Tab switching: Tenders | Add a Tender | Employee groups | Dashboard | My tenders
const tabToPanel = { tenders: 'tabTenders', add: 'tabAdd', employees: 'tabEmployees', dashboard: 'tabDashboard', mytenders: 'tabMyTenders', watchalerts: 'tabWatchAlerts', notifications: 'tabNotifications' };
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const tab = btn.dataset.tab;
    showLoading('Loading...');
    const start = performance.now();
    const minSpinMs = 150;

    document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    document.querySelectorAll('.tab-panel').forEach(p => { p.classList.remove('active'); p.setAttribute('aria-hidden', 'true'); });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    const panelId = tabToPanel[tab];
    const panel = panelId ? document.getElementById(panelId) : null;
    if (panel) { panel.classList.add('active'); panel.setAttribute('aria-hidden', 'false'); }
    const resultsSection = $('resultsSection');
    if (resultsSection) resultsSection.style.display = (tab === 'tenders' || tab === 'mytenders' || tab === 'watchalerts') ? '' : 'none';
    if (tab === 'dashboard') renderDashboard();
    if (tab === 'employees') await loadEmployees();
    if (tab === 'watchalerts') renderWatchAlerts();
    if (tab === 'mytenders' || tab === 'tenders' || tab === 'watchalerts') requestAnimationFrame(resizeGridViewport);

    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const elapsed = performance.now() - start;
    if (elapsed < minSpinMs) await new Promise(r => setTimeout(r, minSpinMs - elapsed));
    hideLoading();
  });
});

document.querySelectorAll('.collapsible-header').forEach(btn => {
  btn.addEventListener('click', () => {
    const collapsible = btn.closest('.collapsible');
    if (collapsible) {
      collapsible.classList.toggle('collapsed');
      btn.setAttribute('aria-expanded', collapsible.classList.contains('collapsed') ? 'false' : 'true');
    }
  });
});

const updateBtn = document.getElementById('updateBtn');
const updateMsg = document.getElementById('updateMsg');
const municipalScraperSel = $('municipalScraperSel');
const municipalSourceById = {
  matjhabeng: 'Matjhabeng',
  mangaung: 'Mangaung',
  nelsonmandelabay: 'Nelson Mandela Bay',
  buffalocity: 'Buffalo City',
  sarahbaartman: 'Sarah Baartman',
  kouga: 'Kouga',
  amathole: 'Amathole',
  amahlathi: 'Amahlathi',
  drabxuma: 'Dr AB Xuma',
  beyersnaude: 'Beyers Naude',
  elundini: 'Elundini',
  emalahleni: 'Emalahleni',
  greatkei: 'Great Kei',
  ingquzahill: 'Ingquza Hill',
  intsikayethu: 'Intsika Yethu',
  inxubayethemba: 'Inxuba Yethemba',
  joegqabi: 'Joe Gqabi',
  ksd: 'King Sabata Dalindyebo',
  koukamma: 'Kou-Kamma',
  bluecrane: 'Blue Crane Route',
  mhlontlo: 'Kumkani Mhlontlo',
  mbhashe: 'Mbhashe',
  ntabankulu: 'Ntabankulu',
  sakhisizwe: 'Sakhisizwe',
  senqu: 'Senqu',
  nyandeni: 'Nyandeni',
  ortambo: 'O.R. Tambo',
  masilonyana: 'Masilonyana',
  mohokare: 'Mohokare',
  moqhaka: 'Moqhaka',
  nketoana: 'Nketoana',
  phumelela: 'Phumelela',
  capetown: 'Cape Town',
  westcoastdm: 'West Coast DM',
  beaufortwest: 'Beaufort West',
  bergrivier: 'Bergrivier',
  cederberg: 'Cederberg',
  laingsburg: 'Laingsburg',
  langeberg: 'Langeberg',
  oudtshoorn: 'Oudtshoorn',
  overstrand: 'Overstrand',
  princealbert: 'Prince Albert',
  saldanhabay: 'Saldanha Bay',
  stellenbosch: 'Stellenbosch',
  sundaysrivervalley: 'Sundays River Valley',
  umzimvubu: 'Umzimvubu',
  swartland: 'Swartland',
  swellendam: 'Swellendam',
  winniemadikizelamandela: 'Winnie Madikizela-Mandela'
};
const municipalCsvFallback = [
  'matjhabeng_tenders.csv',
  'mangaung_tenders.csv',
  'nelsonmandelabay_tenders.csv',
  'buffalocity_tenders.csv',
  'sarahbaartman_tenders.csv',
  'kouga_tenders.csv',
  'amathole_tenders.csv',
  'amahlathi_tenders.csv',
  'drabxuma_tenders.csv',
  'beyersnaude_tenders.csv',
  'elundini_tenders.csv',
  'emalahleni_tenders.csv',
  'greatkei_tenders.csv',
  'ingquzahill_tenders.csv',
  'intsikayethu_tenders.csv',
  'inxubayethemba_tenders.csv',
  'joegqabi_tenders.csv',
  'ksd_tenders.csv',
  'koukamma_tenders.csv',
  'bluecrane_tenders.csv',
  'mhlontlo_tenders.csv',
  'mbhashe_tenders.csv',
  'ntabankulu_tenders.csv',
  'sakhisizwe_tenders.csv',
  'senqu_tenders.csv',
  'nyandeni_tenders.csv',
  'ortambo_tenders.csv',
  'masilonyana_tenders.csv',
  'mohokare_tenders.csv',
  'moqhaka_tenders.csv',
  'nketoana_tenders.csv',
  'phumelela_tenders.csv',
  'capetown_tenders.csv',
  'westcoastdm_tenders.csv',
  'beaufortwest_tenders.csv',
  'bergrivier_tenders.csv',
  'cederberg_tenders.csv',
  'laingsburg_tenders.csv',
  'langeberg_tenders.csv',
  'oudtshoorn_tenders.csv',
  'overstrand_tenders.csv',
  'princealbert_tenders.csv',
  'saldanhabay_tenders.csv',
  'stellenbosch_tenders.csv',
  'sundaysrivervalley_tenders.csv',
  'umzimvubu_tenders.csv',
  'swartland_tenders.csv',
  'swellendam_tenders.csv',
  'winniemadikizelamandela_tenders.csv'
];
const municipalOrgans = Object.values(municipalSourceById);
const municipalSourceSet = new Set(municipalOrgans);

// Lazy-load: cache municipal data per municipality; csvFilename map from API
const municipalDataCache = new Map();
let municipalIdToCsv = new Map();
let advMunicipal = new Map(); // Built on init for merging municipal rows with advertised data

async function loadMunicipalData(municipalityId) {
  if (municipalDataCache.has(municipalityId)) {
    return municipalDataCache.get(municipalityId);
  }
  const csvFilename = municipalIdToCsv.get(municipalityId) || `${municipalityId}_tenders.csv`;
  try {
    const data = await loadCsv(`/data/${csvFilename}`).catch(() => []);
    const filtered = Array.isArray(data) ? data.filter(isLikelyMunicipalSourceRow) : [];
    municipalDataCache.set(municipalityId, filtered);
    return filtered;
  } catch (err) {
    console.warn(`Failed to load ${municipalityId} data:`, err);
    return [];
  }
}

function municipalityToken(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function updateMunicipalSearchButtonState() {}

// Load municipal scrapers list and populate dropdown
async function loadMunicipalScrapers(province = '') {
  try {
    const currentValue = municipalScraperSel?.value || '';
    const p = String(province || '').trim();
    const url = p
      ? `/api/scrape/municipal/list?province=${encodeURIComponent(p)}`
      : '/api/scrape/municipal/list';
    const res = await fetch(url);
    const data = await res.json();
    if (res.ok && data.ok && municipalScraperSel) {
      municipalScraperSel.innerHTML = '<option value="">Select Municipality</option>';
      const scrapers = data.scrapers || [];
      scrapers.forEach(s => {
        municipalIdToCsv.set(s.id, s.csvFilename || `${s.id}_tenders.csv`);
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.shortName;
        municipalScraperSel.appendChild(opt);
      });
      if (currentValue && scrapers.some(s => s.id === currentValue)) {
        municipalScraperSel.value = currentValue;
      }
      updateMunicipalSearchButtonState();
    }
  } catch (_) {}
}
loadMunicipalScrapers(provinceSel?.value || '');

if (municipalScraperSel) {
  municipalScraperSel.addEventListener('change', async () => {
    updateMunicipalSearchButtonState();
    const municipality = municipalScraperSel?.value || '';
    if (municipality) {
      await runWithBusy('Searching municipality tenders...', async ()=> runMunicipalScopedSearch());
    } else if (municipalScrapeView) {
      clearMunicipalViewAndFilter();
    }
  });
}

async function runMunicipalScopedSearch() {
  const municipality = municipalScraperSel?.value || '';
  const selectedProvince = provinceSel?.value || '';
  const sourceName = municipality
    ? (municipalSourceById[municipality] || municipalScraperSel?.selectedOptions?.[0]?.textContent || municipality)
    : '';

  if (!municipality) return;

  // Lazy-load: fetch this municipality's data on demand
  let municipal = await loadMunicipalData(municipality);

  // Merge with advertised data when tender number matches (enrich with eTenders details)
  municipal = municipal.map(m => {
    const n = (m['Tender Number'] || '').trim();
    const a = advMunicipal.get(n);
    const source = m['Source'] || sourceName;
    if (a && a['Tender Description'] && !String(a['Tender Description'] || '').includes('(see document)')) {
      return { ...a, 'Source URL': m['Source URL'] || a['Source URL'], 'Source': source };
    }
    return m;
  });

  if (selectedProvince) {
    municipal = municipal.filter(r => String(r['Province'] || '') === selectedProvince);
  }

  if (municipal.length === 0) {
    municipalScrapeView = null;
    if (updateMsg) updateMsg.textContent = '';
    render([]);
    if (stats) stats.textContent = '0 municipal tenders';
    return;
  }
  hideDashboard();
  municipalScrapeView = {
    source: sourceName || (selectedProvince ? `${selectedProvince} municipalities` : 'Municipality'),
    data: municipal
  };
  filterRows();
  if (updateMsg) updateMsg.textContent = '';
}


if (updateBtn) {
  updateBtn.addEventListener('click', async () => {
    setButtonLoading(updateBtn, true, 'Updating...');
    showLoading('Checking for updates...');
    try {
      const res = await fetch('/api/update');
      const data = await res.json();
      if (res.ok) {
        updateMsg.textContent = data.message || `${data.added} new record(s) added`;
        if (data.added > 0 && !data.readOnly) {
          const csvText = data.csv || (await (await fetch('/data/advertised_tenders.csv')).text());
          Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            complete: ({ data }) => {
              rows = data;
              advMunicipal.clear();
              rows.filter(r => municipalOrgans.some(name => (r['Organ Of State'] || '').includes(name))).forEach(r => {
                const n = (r['Tender Number'] || '').trim();
                if (n) advMunicipal.set(n, r);
              });
              buildFilters(rows);
              filterRows();
            }
          });
        }
      } else {
        updateMsg.textContent = data.error || 'Update failed';
      }
    } catch (e) {
      updateMsg.textContent = 'Update failed';
    } finally {
      setButtonLoading(updateBtn, false);
      hideLoading();
      setTimeout(() => { if (updateMsg) updateMsg.textContent = ''; }, 5000);
    }
  });
}

// Register service worker (required for PWA install prompt)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(reg => reg.update()).catch(()=>{});
}

(async function init(){
  showLoading('Loading tender data...');
  try {
  let adv = [];
  try {
    adv = await loadCsv(advertisedCsvUrl);
    console.log(`Loaded ${adv.length} advertised tenders`);
  } catch (e) {
    console.warn('Could not load advertised_tenders.csv - using empty array', e);
    adv = [];
  }

  // Load all-inclusive municipal CSV (merged from all municipalities - searchable in "Search all")
  let municipal = [];
  try {
    const data = await loadCsv('/data/all_municipal_tenders.csv').catch(() => []);
    municipal = Array.isArray(data) ? data.filter(isLikelyMunicipalSourceRow) : [];
    console.log(`Loaded ${municipal.length} municipal tenders (all municipalities)`);
  } catch (e) {
    console.warn('Could not load all_municipal_tenders.csv - Search all will exclude municipal tenders', e);
  }

  // Build map of advertised municipal tenders for merging
  advMunicipal.clear();
  if (adv.length) {
    adv.filter(r => {
      const organ = (r['Organ Of State'] || '');
      return municipalOrgans.some(name => organ.includes(name));
    }).forEach(r => {
      const n = (r['Tender Number'] || '').trim();
      if (n) advMunicipal.set(n, r);
    });
  }

  // Municipal rows: use advertised data when available, but keep municipal Source URL and Source
  const municipalMerged = municipal.map(m => {
    const n = (m['Tender Number'] || '').trim();
    const a = advMunicipal.get(n);
    const source = m['Source'] || '';
    if (a && a['Tender Description'] && !String(a['Tender Description'] || '').includes('(see document)')) {
      return { ...a, 'Source URL': m['Source URL'] || a['Source URL'], 'Source': source };
    }
    return m;
  });

  const municipalTenderNumbers = new Set(municipalMerged.map(m => (m['Tender Number'] || '').trim()).filter(Boolean));
  const advNonMunicipal = adv.length ? adv.filter(r => {
    const organ = (r['Organ Of State'] || '');
    return !municipalOrgans.some(name => organ.includes(name));
  }) : [];
  const advMunicipalFiltered = adv.length ? adv.filter(r => {
    const organ = (r['Organ Of State'] || '');
    const isMunicipal = municipalOrgans.some(name => organ.includes(name));
    return isMunicipal && !municipalTenderNumbers.has((r['Tender Number'] || '').trim());
  }) : [];

  rows = [...advNonMunicipal, ...advMunicipalFiltered, ...municipalMerged];
  console.log(`Total rows loaded: ${rows.length} (advertised + municipal)`);

  const mode = getMatchMode();
  document.querySelectorAll('input[name="mainMatchMode"]').forEach(r => { r.checked = (r.value === mode); });

  // Load server flags if available
  try {
    const res = await fetch('/api/flags').catch(() => null);
    if (res && res.ok) serverFlags = await res.json();
  } catch (_) {}

  buildFilters(rows);
  syncHeroOffset();
  resizeGridViewport();
  renderCustomCriteriaSummary();
  filterRows();
  } catch (error) {
    console.error('Failed to load data:', error);
    if (stats) stats.textContent = 'Error loading data';
  } finally {
    hideLoading();
  }
})();
