const V_KEY = 'toritetsu:vehicle-logs';
const S_KEY = 'toritetsu:visit-records';
const T_KEY = 'toritetsu:trip-notes';

let vehicleLogs = [];
let visitRecords = [];
let tripNotes = [];
let editingVehicleId = null;
let editingVisitId = null;
let editingTripId = null;

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

// --- IndexedDB helper (数百MB〜使える保存先。localStorageの5〜10MB上限を回避するため) ---
const IDB_NAME = 'toritetsu-db';
const IDB_STORE = 'kv';
let _idbPromise = null;

function openIDB(){
  if (_idbPromise) return _idbPromise;
  _idbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('IndexedDB unsupported')); return; }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _idbPromise;
}

async function idbGet(key){
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value){
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// 保存済みのJSON文字列を読み込む。優先順位: window.storage(Claude上) → IndexedDB → localStorage
// IndexedDBが空でlocalStorageに旧データがあれば、その場でIndexedDBへ移行する
async function loadKey(key){
  try{
    if (window.storage) {
      const r = await window.storage.get(key, false);
      if (r) return r.value;
    }
  }catch(e){ /* fall through */ }
  try{
    const idbVal = await idbGet(key);
    if (idbVal !== undefined) return idbVal;
    const lsVal = localStorage.getItem(key);
    if (lsVal) {
      await idbSet(key, lsVal); // 旧データをIndexedDBへ移行
      localStorage.removeItem(key);
      return lsVal;
    }
    return null;
  }catch(e){
    // IndexedDBが完全に使えない環境ではlocalStorageのみで動かす
    try{ return localStorage.getItem(key); }catch(e2){ return null; }
  }
}

async function saveKey(key, json){
  try{
    if (window.storage) {
      await window.storage.set(key, json, false);
      return;
    }
  }catch(e){ /* fall through */ }
  try{
    await idbSet(key, json);
    return;
  }catch(e){ /* fall through */ }
  try{
    localStorage.setItem(key, json);
  }catch(e){
    console.error('保存に失敗しました', e);
    alert('保存に失敗しました。ブラウザのプライベートモードや、ストレージをブロックする設定になっていないか確認してください。');
  }
}

async function loadAll(){
  try{
    const v = await loadKey(V_KEY);
    vehicleLogs = v ? JSON.parse(v) : [];
  }catch(e){ vehicleLogs = []; }
  try{
    const t = await loadKey(T_KEY);
    tripNotes = t ? JSON.parse(t) : [];
  }catch(e){ tripNotes = []; }
  try{
    const s = await loadKey(S_KEY);
    visitRecords = s ? JSON.parse(s) : [];
  }catch(e){ visitRecords = []; }
  renderVehicles();
  renderVisits();
  renderTrips();
}

async function saveVehicles(){
  await saveKey(V_KEY, JSON.stringify(vehicleLogs));
}
async function saveTrips(){
  await saveKey(T_KEY, JSON.stringify(tripNotes));
}
async function saveVisits(){
  await saveKey(S_KEY, JSON.stringify(visitRecords));
}

function toggleMenu(){
  document.getElementById('menu-panel').classList.toggle('open');
}

document.addEventListener('click', (e) => {
  const panel = document.getElementById('menu-panel');
  const btn = document.getElementById('menu-btn');
  if (!panel || !panel.classList.contains('open')) return;
  if (!panel.contains(e.target) && e.target !== btn) {
    panel.classList.remove('open');
  }
});

function setBackupStatus(msg, isError){
  const el = document.getElementById('backup-status');
  if(!el) return;
  el.textContent = msg;
  el.style.color = isError ? 'var(--vermillion)' : 'var(--indigo-soft)';
}

async function exportBackup(){
  try{
    const payload = {
      app: 'toritetsu',
      exportedAt: new Date().toISOString(),
      vehicleLogs, visitRecords, tripNotes
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `toritetsu-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    const total = vehicleLogs.length + visitRecords.length + tripNotes.length;
    setBackupStatus(`書き出しました（全${total}件）`, false);
  }catch(e){
    console.error('バックアップの書き出しに失敗しました', e);
    setBackupStatus('書き出しに失敗しました', true);
  }
}

function importBackup(event){
  const file = event.target.files[0];
  event.target.value = ''; // 同じファイルを選び直せるようにリセット
  if(!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try{
      const data = JSON.parse(e.target.result);
      const v = Array.isArray(data.vehicleLogs) ? data.vehicleLogs : [];
      const s = Array.isArray(data.visitRecords) ? data.visitRecords : [];
      const t = Array.isArray(data.tripNotes) ? data.tripNotes : [];
      const total = v.length + s.length + t.length;

      const ok = confirm(`このファイルには記録が${total}件あります。\n今の記録は上書きされます。読み込みますか？`);
      if(!ok) return;

      vehicleLogs = v;
      visitRecords = s;
      tripNotes = t;
      await saveVehicles();
      await saveVisits();
      await saveTrips();
      renderVehicles();
      renderVisits();
      renderTrips();
      setBackupStatus(`読み込みました（全${total}件）`, false);
    }catch(err){
      console.error('バックアップの読み込みに失敗しました', err);
      setBackupStatus('読み込みに失敗しました。ファイルを確認してください', true);
    }
  };
  reader.onerror = () => setBackupStatus('ファイルの読み込みに失敗しました', true);
  reader.readAsText(file);
}

function switchTab(name){
  document.getElementById('panel-vehicle').classList.toggle('active', name==='vehicle');
  document.getElementById('panel-visit').classList.toggle('active', name==='visit');
  document.getElementById('panel-trip').classList.toggle('active', name==='trip');
  document.getElementById('tabBtn-vehicle').classList.toggle('active', name==='vehicle');
  document.getElementById('tabBtn-visit').classList.toggle('active', name==='visit');
  document.getElementById('tabBtn-trip').classList.toggle('active', name==='trip');
}

function fmtDate(d){
  if(!d) return '----.--.--';
  const dt = new Date(d);
  if(isNaN(dt)) return d;
  return `${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,'0')}.${String(dt.getDate()).padStart(2,'0')}`;
}

async function addVehicle(){
  const kind = document.getElementById('v-type-kind').value;
  const date = document.getElementById('v-date').value;
  const line = document.getElementById('v-line').value.trim();
  const type = document.getElementById('v-type').value.trim();
  const formation = document.getElementById('v-formation').value.trim();
  const memo = document.getElementById('v-memo').value.trim();
  const fileInput = document.getElementById('v-photo');
  const file = fileInput.files[0];

  if(!type && !line){
    alert('路線・系統名か車両形式を入力してください');
    return;
  }

  let photo = null;
  if (file) {
    try{
      photo = await resizePhoto(file);
    }catch(e){
      console.error('写真の処理に失敗しました', e);
    }
  }

  if (editingVehicleId) {
    const idx = vehicleLogs.findIndex(v => v.id === editingVehicleId);
    if (idx !== -1) {
      vehicleLogs[idx] = {
        ...vehicleLogs[idx],
        kind, date, line, type, formation, memo,
        photo: photo || vehicleLogs[idx].photo
      };
    }
    cancelEditVehicle();
  } else {
    vehicleLogs.unshift({ id: uid(), kind, date, line, type, formation, memo, photo, ts: Date.now() });
  }
  document.getElementById('v-date').value='';
  document.getElementById('v-line').value='';
  document.getElementById('v-type').value='';
  document.getElementById('v-formation').value='';
  document.getElementById('v-memo').value='';
  fileInput.value='';
  await saveVehicles();
  renderVehicles();
}

function editVehicle(id){
  const v = vehicleLogs.find(x => x.id === id);
  if (!v) return;
  editingVehicleId = id;
  document.getElementById('v-type-kind').value = v.kind || '電車';
  document.getElementById('v-date').value = v.date || '';
  document.getElementById('v-line').value = v.line || '';
  document.getElementById('v-type').value = v.type || '';
  document.getElementById('v-formation').value = v.formation || '';
  document.getElementById('v-memo').value = v.memo || '';
  document.getElementById('v-submit-btn').textContent = '更新する';
  document.getElementById('v-cancel-btn').style.display = 'block';
  document.getElementById('panel-vehicle').scrollIntoView({behavior:'smooth', block:'start'});
}

function cancelEditVehicle(){
  editingVehicleId = null;
  document.getElementById('v-submit-btn').textContent = '記録に加える';
  document.getElementById('v-cancel-btn').style.display = 'none';
  document.getElementById('v-date').value='';
  document.getElementById('v-line').value='';
  document.getElementById('v-type').value='';
  document.getElementById('v-formation').value='';
  document.getElementById('v-memo').value='';
  document.getElementById('v-photo').value='';
}

async function deleteVehicle(id){
  vehicleLogs = vehicleLogs.filter(v => v.id !== id);
  await saveVehicles();
  renderVehicles();
}

function renderVehicles(){
  const list = document.getElementById('v-list');
  document.getElementById('v-count').textContent = vehicleLogs.length + '件';
  if(vehicleLogs.length === 0){
    list.innerHTML = `<div class="empty"><span class="big">まだ記録がありません</span>撮影した車両を記録していきましょう</div>`;
    return;
  }
  list.innerHTML = vehicleLogs.map(v => `
    <div class="ticket">
      <div class="ticket-main">
        <button class="del-btn" style="right:56px;" onclick="editVehicle('${v.id}')">編集</button>
        <button class="del-btn" onclick="deleteVehicle('${v.id}')">削除</button>
        <div class="ticket-line">${escapeHtml(v.kind || '電車')}${v.line ? ' ／ ' + escapeHtml(v.line) : ''}</div>
        <div class="ticket-title">${escapeHtml(v.type || '形式未記入')}</div>
        <div class="ticket-meta">${escapeHtml(v.formation ? '編成 '+v.formation : '')}</div>
        ${v.photo ? `<img src="${v.photo}" style="width:100%;border-radius:4px;margin:8px 0;display:block;">` : ''}
        ${v.memo ? `<div class="ticket-memo">${escapeHtml(v.memo)}</div>` : ''}
      </div>
      <div class="ticket-stub"><div class="date">${fmtDate(v.date)}</div></div>
    </div>
  `).join('');
}

function resizePhoto(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxW = 640;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function addVisit(){
  const type = document.getElementById('s-type').value;
  const name = document.getElementById('s-name').value.trim();
  const date = document.getElementById('s-date').value;
  const memo = document.getElementById('s-memo').value.trim();
  const fileInput = document.getElementById('s-photo');
  const file = fileInput.files[0];

  if(!name){
    alert('名前を入力してください');
    return;
  }

  let photo = null;
  if (file) {
    try{
      photo = await resizePhoto(file);
    }catch(e){
      console.error('写真の処理に失敗しました', e);
    }
  }

  if (editingVisitId) {
    const idx = visitRecords.findIndex(v => v.id === editingVisitId);
    if (idx !== -1) {
      visitRecords[idx] = {
        ...visitRecords[idx],
        type, name, date, memo,
        photo: photo || visitRecords[idx].photo
      };
    }
    cancelEditVisit();
  } else {
    visitRecords.unshift({ id: uid(), type, name, date, memo, photo, ts: Date.now() });
  }
  document.getElementById('s-name').value='';
  document.getElementById('s-date').value='';
  document.getElementById('s-memo').value='';
  fileInput.value='';
  await saveVisits();
  renderVisits();
}

function editVisit(id){
  const v = visitRecords.find(x => x.id === id);
  if (!v) return;
  editingVisitId = id;
  document.getElementById('s-type').value = v.type || '駅';
  document.getElementById('s-name').value = v.name || '';
  document.getElementById('s-date').value = v.date || '';
  document.getElementById('s-memo').value = v.memo || '';
  document.getElementById('s-submit-btn').textContent = '更新する';
  document.getElementById('s-cancel-btn').style.display = 'block';
  document.getElementById('panel-visit').scrollIntoView({behavior:'smooth', block:'start'});
}

function cancelEditVisit(){
  editingVisitId = null;
  document.getElementById('s-submit-btn').textContent = '記録に加える';
  document.getElementById('s-cancel-btn').style.display = 'none';
  document.getElementById('s-name').value='';
  document.getElementById('s-date').value='';
  document.getElementById('s-memo').value='';
  document.getElementById('s-photo').value='';
}

async function deleteVisit(id){
  visitRecords = visitRecords.filter(v => v.id !== id);
  await saveVisits();
  renderVisits();
}

function renderVisits(){
  const list = document.getElementById('s-list');
  document.getElementById('s-count').textContent = visitRecords.length + '件';
  if(visitRecords.length === 0){
    list.innerHTML = `<div class="empty"><span class="big">まだ記録がありません</span>訪れた駅・バス停を記録していきましょう</div>`;
    return;
  }
  list.innerHTML = visitRecords.map(v => `
    <div class="ticket">
      <div class="ticket-main">
        <button class="del-btn" style="right:56px;" onclick="editVisit('${v.id}')">編集</button>
        <button class="del-btn" onclick="deleteVisit('${v.id}')">削除</button>
        <div class="ticket-line">${escapeHtml(v.type)}</div>
        <div class="ticket-title">${escapeHtml(v.name)}</div>
        ${v.photo ? `<img src="${v.photo}" style="width:100%;border-radius:4px;margin:8px 0;display:block;">` : ''}
        ${v.memo ? `<div class="ticket-memo">${escapeHtml(v.memo)}</div>` : ''}
      </div>
      <div class="ticket-stub"><div class="date">${fmtDate(v.date)}</div></div>
    </div>
  `).join('');
}

async function addTrip(){
  const title = document.getElementById('t-title').value.trim();
  const priority = document.getElementById('t-priority').value;
  const memo = document.getElementById('t-memo').value.trim();
  if(!title){
    alert('行き先・目標を入力してください');
    return;
  }
  if (editingTripId) {
    const idx = tripNotes.findIndex(t => t.id === editingTripId);
    if (idx !== -1) {
      tripNotes[idx] = { ...tripNotes[idx], title, priority, memo };
    }
    cancelEditTrip();
  } else {
    tripNotes.unshift({ id: uid(), title, priority, memo, done:false, ts: Date.now() });
  }
  document.getElementById('t-title').value='';
  document.getElementById('t-memo').value='';
  document.getElementById('t-priority').value='中';
  await saveTrips();
  renderTrips();
}

function editTrip(id){
  const t = tripNotes.find(x => x.id === id);
  if (!t) return;
  editingTripId = id;
  document.getElementById('t-title').value = t.title || '';
  document.getElementById('t-priority').value = t.priority || '中';
  document.getElementById('t-memo').value = t.memo || '';
  document.getElementById('t-submit-btn').textContent = '更新する';
  document.getElementById('t-cancel-btn').style.display = 'block';
  document.getElementById('panel-trip').scrollIntoView({behavior:'smooth', block:'start'});
}

function cancelEditTrip(){
  editingTripId = null;
  document.getElementById('t-submit-btn').textContent = '目標に加える';
  document.getElementById('t-cancel-btn').style.display = 'none';
  document.getElementById('t-title').value='';
  document.getElementById('t-memo').value='';
  document.getElementById('t-priority').value='中';
}

async function toggleTrip(id){
  const item = tripNotes.find(t => t.id === id);
  if(item){ item.done = !item.done; await saveTrips(); renderTrips(); }
}

async function deleteTrip(id){
  tripNotes = tripNotes.filter(t => t.id !== id);
  await saveTrips();
  renderTrips();
}

function renderTrips(){
  const list = document.getElementById('t-list');
  const remaining = tripNotes.filter(t=>!t.done).length;
  document.getElementById('t-count').textContent = `${remaining}件 未達成`;
  if(tripNotes.length === 0){
    list.innerHTML = `<div class="empty"><span class="big">目標はまだ空っぽです</span>次に行きたい駅・バス停を書いてみましょう</div>`;
    return;
  }
  // sort: undone first (priority order), then done
  const order = {'高':0,'中':1,'低':2};
  const sorted = [...tripNotes].sort((a,b)=>{
    if(a.done !== b.done) return a.done ? 1 : -1;
    return order[a.priority] - order[b.priority];
  });
  list.innerHTML = sorted.map(t => `
    <div class="trip-card ${t.done ? 'done' : ''}">
      <div class="trip-top">
        <div class="check ${t.done ? 'checked' : ''}" onclick="toggleTrip('${t.id}')">${t.done ? '✓' : ''}</div>
        <div class="trip-title">${escapeHtml(t.title)}</div>
        <span class="priority-tag priority-${t.priority}">${t.priority}</span>
        <button class="del-btn" style="position:static;" onclick="editTrip('${t.id}')">編集</button>
        <button class="del-btn" style="position:static;" onclick="deleteTrip('${t.id}')">削除</button>
      </div>
      ${t.memo ? `<div class="trip-memo">${escapeHtml(t.memo)}</div>` : ''}
    </div>
  `).join('');
}

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

loadAll();
