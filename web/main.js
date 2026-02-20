const advertisedCsvUrl = '/data/advertised_tenders.csv';
const aiCsvUrl = '/data/ai_opportunities.csv';

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
    sel.innerHTML = '';
    const opt0 = document.createElement('option'); opt0.value=''; opt0.textContent=label; sel.appendChild(opt0);
    for(const v of unique(key)){
      const o=document.createElement('option'); o.value=v; o.textContent=v; sel.appendChild(o);
    }
  }
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

function filterRows(){
  const tq = tokensFromQuery(qInput.value);
  const province = provinceSel.value;
  const organ = organSel.value;
  const category = categorySel.value;
  const wantAI = false;
  const { from, to } = rangeToDates(advRange ? advRange.value : 'any');

  const filtered = rows.filter(r=>{
    if (province && r['Province']!==province) return false;
    if (organ && r['Organ Of State']!==organ) return false;
    if (category && r['Category']!==category) return false;
    if (wantAI && !aiMap.get(r['Tender Number'])) return false;

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
    const isCivil = String(r['Category']||'').toLowerCase().includes('civil engineering');
    card.className = 'card' + (isCivil ? ' civil' : '');

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
    meta.appendChild(viewBtn);
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

    // Flags: Reviewed / Tendered (persist to localStorage keyed by tender number)
    const flags=document.createElement('div');flags.className='flags';
    const reviewedId = `rev_${r['Tender Number']}`;
    const tenderedId = `ten_${r['Tender Number']}`;
    const reviewed = document.createElement('input'); reviewed.type='checkbox'; reviewed.id=reviewedId;
    const tendered = document.createElement('input'); tendered.type='checkbox'; tendered.id=tenderedId;

    // Load persisted (server first, fallback to localStorage)
    const localSaved = JSON.parse(localStorage.getItem('tenderFlags')||'{}');
    const sv = serverFlags[r['Tender Number']] || {};
    const initialReviewed = (sv.reviewed !== undefined) ? sv.reviewed : localSaved[reviewedId];
    const initialTendered = (sv.tendered !== undefined) ? sv.tendered : localSaved[tenderedId];
    if (initialReviewed) reviewed.checked = true;
    if (initialTendered) { tendered.checked = true; card.classList.add('tendered'); }

    const saveFlags = ()=>{
      const obj = JSON.parse(localStorage.getItem('tenderFlags')||'{}');
      obj[reviewedId] = reviewed.checked;
      obj[tenderedId] = tendered.checked;
      localStorage.setItem('tenderFlags', JSON.stringify(obj));
      // Try to persist to server
      fetch('/api/flags', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tenderNumber: r['Tender Number'], reviewed: reviewed.checked, tendered: tendered.checked }) }).catch(()=>{});
      if (tendered.checked) card.classList.add('tendered'); else card.classList.remove('tendered');
    };
    reviewed.addEventListener('change', saveFlags);
    tendered.addEventListener('change', saveFlags);

    const rLabel=document.createElement('label'); rLabel.htmlFor=reviewedId; rLabel.innerHTML='<span>Reviewed</span>'; rLabel.prepend(reviewed);
    const tLabel=document.createElement('label'); tLabel.htmlFor=tenderedId; tLabel.innerHTML='<span>Tendered</span>'; tLabel.prepend(tendered);
    // Add comment button inline with flags
    const commentBtn = document.createElement('button');
    commentBtn.className='btn primary sm';
    commentBtn.textContent='Add comment';
    flags.appendChild(rLabel); flags.appendChild(tLabel); flags.appendChild(commentBtn);
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
    card.appendChild(commentBtn);
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
// removed Export CSV button

// removed AI toggle listener
provinceSel.addEventListener('change', filterRows);
organSel.addEventListener('change', filterRows);
categorySel.addEventListener('change', filterRows);
if (advRange) advRange.addEventListener('change', filterRows);
qInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ filterRows(); }});
const updateBtn = document.getElementById('updateBtn');
const updateMsg = document.getElementById('updateMsg');
if (updateBtn) {
  updateBtn.addEventListener('click', async () => {
    updateBtn.disabled = true; updateMsg.textContent = 'Checking for updates...';
    try {
      const res = await fetch('/api/update');
      const data = await res.json();
      if (res.ok) {
        updateMsg.textContent = `${data.added} new record(s) added`;
        // reload dataset if we added anything
        if (data.added > 0) {
          const adv = await (await fetch('/data/advertised_tenders.csv')).text();
          Papa.parse(adv,{header:true,skipEmptyLines:true,complete:({data})=>{ rows=data; buildFilters(rows); filterRows(); }});
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
