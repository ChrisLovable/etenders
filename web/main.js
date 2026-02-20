const advertisedCsvUrl = '/data/advertised_tenders.csv';
const aiCsvUrl = '/data/ai_opportunities.csv';
const CUSTOM_CRITERIA_KEY = 'etenders_custom_criteria';

const $ = (id) => document.getElementById(id);
const grid = $('grid');
const stats = $('stats');
const qInput = $('q');
const provinceSel = $('province');
const organSel = $('organ');
const categorySel = $('category');
const advRange = $('advRange');
// AI toggle removed per request

let rows = [];
let aiMap = new Map();
let serverFlags = {};

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
    for(const v of unique(key)){
      const o=document.createElement('option'); o.value=v; o.textContent=v; sel.appendChild(o);
    }
  }
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
    grid.innerHTML = '';
    return;
  }
  filterByCustomCriteria();
}

function filterByCustomCriteria(){
  const saved = loadCustomCriteria();
  const tq = tokensFromQuery(saved.customWords ? saved.customWords.join(' ') : '');
  const provinces = new Set(saved.provinces || []);
  const organs = new Set(saved.organs || []);
  const categories = new Set(saved.categories || []);
  const services = new Set(saved.services || []);
  const { from, to } = rangeToDates(saved.advRange || 'any');

  const filtered = rows.filter(r=>{
    if (provinces.size && !provinces.has(r['Province'])) return false;
    if (organs.size && !organs.has(r['Organ Of State'])) return false;
    if (categories.size && !categories.has(r['Category'])) return false;
    if (services.size && !services.has(r['Category'])) return false;
    if (from || to){
      const d = parseCsvDate(r['Advertised']);
      if (from && d < startOfDay(from)) return false;
      if (to && d > endOfDay(to)) return false;
    }
    if (!tq.length) return true;
    const hay = normalizeText(`${r['Tender Number']} ${r['Tender Description']} ${r['Category']} ${r['Organ Of State']} ${r['Province']} ${r['Special Conditions']}`);
    return tq.every(t=>hay.includes(t));
  });

  const scored = filtered.map(r=>{
    const text = normalizeText(`${r['Tender Number']} ${r['Tender Description']} ${r['Category']}`);
    const score = tq.reduce((acc,t)=>acc+(text.includes(t)?1:0),0);
    return {row:r, score};
  }).sort((a,b)=>b.score-a.score);

  render(scored.map(x=>x.row));
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

function getTenderFlags(tenderNumber){
  const localSaved = JSON.parse(localStorage.getItem('tenderFlags')||'{}');
  const sv = serverFlags[tenderNumber] || {};
  return {
    interested: (sv.interested !== undefined) ? sv.interested : localSaved[`int_${tenderNumber}`],
    reviewed: (sv.reviewed !== undefined) ? sv.reviewed : localSaved[`rev_${tenderNumber}`],
    tendered: (sv.tendered !== undefined) ? sv.tendered : localSaved[`ten_${tenderNumber}`],
    notInterested: (sv.notInterested !== undefined) ? sv.notInterested : localSaved[`nint_${tenderNumber}`]
  };
}

function filterRows(){
  const tq = tokensFromQuery(qInput.value);
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

  const filtered = rows.filter(r=>{
    if (province && r['Province']!==province) return false;
    if (organ && r['Organ Of State']!==organ) return false;
    if (category && r['Category']!==category) return false;
    if (wantAI && !aiMap.get(r['Tender Number'])) return false;

    if (showAny){
      const f = getTenderFlags(r['Tender Number']);
      const match = (showInterested && f.interested) || (showReviewed && f.reviewed) || (showTendered && f.tendered) || (showNotInterested && f.notInterested);
      if (!match) return false;
    }

    if (from || to){
      const d = parseCsvDate(r['Advertised']); // expects DD/MM/YYYY
      if (from && d < startOfDay(from)) return false;
      if (to && d > endOfDay(to)) return false;
    }
    if (!tq.length) return true;
    const hay = normalizeText(`${r['Tender Number']} ${r['Tender Description']} ${r['Category']} ${r['Organ Of State']} ${r['Province']} ${r['Special Conditions']}`);
    return tq.every(t=>hay.includes(t));
  });

  const scored = filtered.map(r=>{
    const text = normalizeText(`${r['Tender Number']} ${r['Tender Description']} ${r['Category']}`);
    const score = tq.reduce((acc,t)=>acc+(text.includes(t)?1:0),0);
    return {row:r, score};
  }).sort((a,b)=>b.score-a.score);

  render(scored.map(x=>x.row));
}

function badge(text){
  const s=document.createElement('span');s.className='badge';s.textContent=text;return s;
}

function render(data){
  grid.innerHTML='';
  stats.textContent = `${data.length} results · ${rows.length} total`;

  for(const r of data){
    const card=document.createElement('div');
    card.className = 'card';

    const title=document.createElement('div');title.className='title';
    title.textContent=r['Tender Description'];
    card.appendChild(title);

    const meta=document.createElement('div');meta.className='meta';
    meta.appendChild(badge(r['Tender Number']||''));
    meta.appendChild(badge(r['Category']||''));
    if (aiMap.get(r['Tender Number'])) meta.appendChild(badge('AI/Data'));
    const tenderId = r['Tender ID'];
    const tenderNumber = r['Tender Number'] || '';
    const sourceUrl = tenderId ? `/tender/${tenderId}` : (r['Source URL'] && r['Source URL'].startsWith('/') ? r['Source URL'] : (tenderNumber ? `/tender-lookup?tenderNumber=${encodeURIComponent(tenderNumber)}` : 'https://www.etenders.gov.za/Home/opportunities?id=1'));
    const viewBtn = document.createElement('a');
    viewBtn.href = sourceUrl;
    viewBtn.target = '_blank';
    viewBtn.rel = 'noopener noreferrer';
    viewBtn.className = 'btn primary sm view-source';
    viewBtn.textContent = 'View on eTenders';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn primary sm';
    copyBtn.textContent = 'Copy tender number';
    copyBtn.title = 'Copy to clipboard';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(tenderNumber);
        const t = copyBtn.textContent; copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = t; }, 1500);
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

    // Flags: Interested / Reviewed / Tendered / Not interested (persist to localStorage keyed by tender number)
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
    const localSaved = JSON.parse(localStorage.getItem('tenderFlags')||'{}');
    const sv = serverFlags[r['Tender Number']] || {};
    const initialInterested = (sv.interested !== undefined) ? sv.interested : localSaved[interestedId];
    const initialReviewed = (sv.reviewed !== undefined) ? sv.reviewed : localSaved[reviewedId];
    const initialTendered = (sv.tendered !== undefined) ? sv.tendered : localSaved[tenderedId];
    const initialNotInterested = (sv.notInterested !== undefined) ? sv.notInterested : localSaved[notInterestedId];
    if (initialInterested) { interested.checked = true; card.classList.add('interested'); }
    if (initialReviewed) { reviewed.checked = true; card.classList.add('reviewed'); }
    if (initialTendered) { tendered.checked = true; card.classList.add('tendered'); }
    if (initialNotInterested) { notInterested.checked = true; card.classList.add('not-interested'); }

    const saveFlags = ()=>{
      const obj = JSON.parse(localStorage.getItem('tenderFlags')||'{}');
      obj[interestedId] = interested.checked;
      obj[reviewedId] = reviewed.checked;
      obj[tenderedId] = tendered.checked;
      obj[notInterestedId] = notInterested.checked;
      localStorage.setItem('tenderFlags', JSON.stringify(obj));
      const tn = r['Tender Number'];
      serverFlags[tn] = { ...(serverFlags[tn]||{}), interested: interested.checked, reviewed: reviewed.checked, tendered: tendered.checked, notInterested: notInterested.checked };
      fetch('/api/flags', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tenderNumber: tn, interested: interested.checked, reviewed: reviewed.checked, tendered: tendered.checked, notInterested: notInterested.checked }) }).catch(()=>{});
      if (interested.checked) card.classList.add('interested'); else card.classList.remove('interested');
      if (reviewed.checked) card.classList.add('reviewed'); else card.classList.remove('reviewed');
      if (tendered.checked) card.classList.add('tendered'); else card.classList.remove('tendered');
      if (notInterested.checked) card.classList.add('not-interested'); else card.classList.remove('not-interested');
      filterRows();
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
    // Add comment button inline with flags
    const commentBtn = document.createElement('button');
    commentBtn.className='btn primary sm';
    commentBtn.textContent='Add comment';
    flags.appendChild(iLabel); flags.appendChild(rLabel); flags.appendChild(tLabel); flags.appendChild(niLabel); flags.appendChild(commentBtn);
    card.appendChild(flags);

    // Add comment section (toggleable)
    const commentWrap = document.createElement('div');
    commentWrap.className='comment';
    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Write a short note for this tender...';
    const commentActions = document.createElement('div');
    commentActions.className='actions';
    const saveComment = document.createElement('button'); saveComment.className='btn primary'; saveComment.textContent='Save';
    const cancelComment = document.createElement('button'); cancelComment.className='btn'; cancelComment.textContent='Cancel';
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
      const obj = JSON.parse(localStorage.getItem('tenderFlags')||'{}');
      obj[`com_${r['Tender Number']}`] = textarea.value;
      localStorage.setItem('tenderFlags', JSON.stringify(obj));
      fetch('/api/flags', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tenderNumber: r['Tender Number'], comment: textarea.value }) }).catch(()=>{});
      commentWrap.style.display='none';
    });

    grid.appendChild(card);
  }
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

$('searchBtn').addEventListener('click', filterRows);
$('clearBtn').addEventListener('click', ()=>{qInput.value=''; if(advRange) advRange.value='any'; provinceSel.value=''; organSel.value=''; categorySel.value=''; filterRows();});

$('customCriteriaBtn')?.addEventListener('click', openCriteriaModal);
$('searchMyCriteriaBtn')?.addEventListener('click', applySearchMyCriteria);

$('customCriteriaModal')?.querySelector('.modal-backdrop')?.addEventListener('click', closeCriteriaModal);
$('customCriteriaModal')?.querySelector('.modal-close')?.addEventListener('click', closeCriteriaModal);
$('customCriteriaModal')?.querySelector('.modal-close-btn')?.addEventListener('click', closeCriteriaModal);
function clearCustomCriteria(){
  saveCustomCriteria({});
  populateCriteriaModal();
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
    advRange: $('criteriaAdvRange')?.value || 'any'
  };
  saveCustomCriteria(criteria);
  closeCriteriaModal();
});
// removed Export CSV button

// removed AI toggle listener
provinceSel?.addEventListener('change', filterRows);
organSel?.addEventListener('change', filterRows);
categorySel?.addEventListener('change', filterRows);
if (advRange) advRange.addEventListener('change', filterRows);
// Show dropdown (Interested/Reviewed/Tendered filter)
const showTrigger = $('showTrigger');
const showPanel = $('showPanel');
const showDropdown = $('showDropdown');
if (showTrigger && showPanel && showDropdown) {
  showTrigger.addEventListener('click', (e)=>{ e.stopPropagation(); const open = showPanel.getAttribute('aria-hidden')!=='false'; showPanel.setAttribute('aria-hidden', !open); });
  document.addEventListener('click', (e)=>{ if (!showDropdown.contains(e.target)) showPanel.setAttribute('aria-hidden','true'); });
  const showCbs = [$('showAll'), $('showInterested'), $('showReviewed'), $('showTendered'), $('showNotInterested')];
  showCbs.forEach(cb=> cb?.addEventListener('change', ()=>{
    if ($('showAll')?.checked) {
      $('showInterested').checked = true;
      $('showReviewed').checked = true;
      $('showTendered').checked = true;
      $('showNotInterested').checked = true;
    }
    filterRows();
  }));
}
qInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ filterRows(); }});
let searchDebounce;
qInput.addEventListener('input', ()=>{ clearTimeout(searchDebounce); searchDebounce=setTimeout(filterRows, 300); });
const updateBtn = document.getElementById('updateBtn');
const updateMsg = document.getElementById('updateMsg');
if (updateBtn) {
  updateBtn.addEventListener('click', async () => {
    updateBtn.disabled = true; updateMsg.textContent = 'Checking for updates...';
    try {
      const res = await fetch('/api/update');
      const data = await res.json();
      if (res.ok) {
        updateMsg.textContent = data.message || `${data.added} new record(s) added`;
        // reload dataset if we added anything (use returned csv or refetch)
        if (data.added > 0 && !data.readOnly) {
          const csvText = data.csv || (await (await fetch('/data/advertised_tenders.csv')).text());
          Papa.parse(csvText,{header:true,skipEmptyLines:true,complete:({data})=>{ rows=data; buildFilters(rows); filterRows(); }});
        }
      } else {
        updateMsg.textContent = data.error || 'Update failed';
      }
    } catch (e) {
      updateMsg.textContent = 'Update failed';
    } finally {
      updateBtn.disabled = false;
    }
  });
}

// Register service worker (required for PWA install prompt)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(()=>{});
}

// PWA Install button: visible when not installed; hide when running as installed app
const installBtn = $('installBtn');
let deferredPrompt;
if (installBtn) {
  const hideInstall = () => { installBtn.style.display = 'none'; };
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (isStandalone) hideInstall();
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; hideInstall(); });
  installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') { deferredPrompt = null; hideInstall(); }
    } else if (isIOS) {
      alert('To install: tap the Share button, then "Add to Home Screen"');
    } else {
      alert('To install: use your browser menu (⋮) and look for "Install app" or "Add to Home Screen"');
    }
  });
}

(async function init(){
  const adv = await loadCsv(advertisedCsvUrl);
  rows = adv;
  // Load server flags if available
  try {
    const res = await fetch('/api/flags');
    if (res.ok) serverFlags = await res.json();
  } catch (_) {}
  buildFilters(rows);
  filterRows();
})();
