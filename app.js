// ---------- Theme (light/dark) ----------
const THEME_KEY = "planBoardTheme";
const SUN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
const MOON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

function setTheme(theme){
  const root = document.documentElement;
  // Freeze transitions for this change so every element flips color at
  // once instead of each running its own fade on its own schedule.
  root.classList.add('theme-switching');

  root.setAttribute('data-theme', theme);
  try{ localStorage.setItem(THEME_KEY, theme); }catch(e){}

  const icon = document.getElementById('themeIcon');
  if(icon) icon.innerHTML = theme === 'dark' ? SUN_ICON : MOON_ICON;

  const btn = document.getElementById('themeToggleBtn');
  if(btn) btn.title = theme === 'dark' ? "Switch to light theme" : "Switch to dark theme";

  const settingsToggle = document.getElementById('themeToggle');
  if(settingsToggle) settingsToggle.checked = (theme === 'dark');

  // Let the instant switch actually paint before re-enabling
  // transitions, so it doesn't get batched with them into one frame.
  root.offsetHeight;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove('theme-switching');
    });
  });
}
function toggleTheme(explicitDark){
  let next;
  if(typeof explicitDark === 'boolean'){
    next = explicitDark ? 'dark' : 'light';
  } else {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    next = current === 'dark' ? 'light' : 'dark';
  }
  setTheme(next);
}
(function initTheme(){
  // The <head> script already set data-theme before first paint to avoid a
  // flash of the wrong theme; this just syncs the toggle icon/checkbox to it.
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  setTheme(current);
})();
window.toggleTheme = toggleTheme;

function uid(){ return 'p' + Math.random().toString(36).slice(2,9); }

function emptyVision(){ return ""; }
function emptyMotive(){ return ""; }
function emptyAction(){ return {action:"", duration:"", time:"", resources:"", status:""}; }
function emptyLog(){ return {date:"", time:"", change:"", reason:""}; }

function newPlan(title){
  return {
    id: uid(),
    title: title || "Untitled Plan",
    visions: [],
    motives: [],
    actions: [],
    log: []
  };
}

// Normalizes any plan object to a guaranteed-complete shape. Data saved by
// an older version of this app (or a corrupted/partial record) can be
// missing fields entirely — without this, a single bad plan would throw
// mid-loop while rendering tabs and silently blank out the whole tab strip
// (including the + New Plan button), since the array is cleared before the
// loop runs. This runs on every plan coming from local storage, cloud
// sync, or file import, so the render loop never sees anything unexpected.
function sanitizePlan(p){
  if(!p || typeof p !== 'object') p = {};
  return {
    id: typeof p.id === 'string' && p.id ? p.id : uid(),
    title: typeof p.title === 'string' && p.title.trim() ? p.title : "Untitled Plan",
    visions: Array.isArray(p.visions) ? p.visions.filter(v => typeof v === 'string') : [],
    motives: Array.isArray(p.motives) ? p.motives.filter(v => typeof v === 'string') : [],
    actions: Array.isArray(p.actions) ? p.actions.map(a => ({
      action: (a && a.action) || "",
      duration: (a && a.duration) || "",
      time: (a && a.time) || "",
      resources: (a && a.resources) || "",
      status: (a && a.status) || ""
    })) : [],
    log: Array.isArray(p.log) ? p.log.map(l => ({
      date: (l && l.date) || "",
      time: (l && l.time) || "",
      change: (l && l.change) || "",
      reason: (l && l.reason) || ""
    })) : []
  };
}
function sanitizePlansArray(arr){
  return (Array.isArray(arr) ? arr : []).map(sanitizePlan);
}

let plans = [];
let activeIndex = -1;
let settings = { alertMethod: "none", email: "", mobile: "" };

// ---------- Local persistence (always on, works with or without sign-in) ----------
const STORAGE_KEY = "planBoardData";
const AUTOSAVE_PREF_KEY = "planBoardAutosavePref";
let storageAvailable = true;
let lastSavedAt = null;
let hasUnsavedChanges = false;

// The autosave on/off preference is written immediately and independently of
// autosave itself, so switching autosave off doesn't stop that preference
// from being remembered next time.
let autosaveEnabled = true;
try{
  const storedPref = localStorage.getItem(AUTOSAVE_PREF_KEY);
  if(storedPref !== null) autosaveEnabled = storedPref === "true";
}catch(e){ /* keep default */ }

function setAutosaveEnabled(on){
  autosaveEnabled = on;
  try{ localStorage.setItem(AUTOSAVE_PREF_KEY, String(on)); }catch(e){}
  if(on && hasUnsavedChanges){
    doSave();
    hasUnsavedChanges = false;
  }
  updateSaveStatus();
}
window.setAutosaveEnabled = setAutosaveEnabled;

function doSave(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify({plans, activeIndex, settings}));
    storageAvailable = true;
    lastSavedAt = new Date();
  }catch(e){
    storageAvailable = false;
  }
  updateSaveStatus();
  // Also push to the cloud if the user is signed in (debounced, defined in the Firebase module below)
  if(window.queueCloudSave) window.queueCloudSave();
}

function saveToStorage(){
  if(autosaveEnabled){
    // Debounce: typing fires this on every keystroke, but writing the
    // full JSON blob to localStorage (and pinging the cloud) on every
    // single character is unnecessary main-thread work and causes
    // typing lag, especially on slower/mobile devices. Wait for a short
    // pause in typing instead, then save once.
    hasUnsavedChanges = true;
    if(_saveDebounceTimer) clearTimeout(_saveDebounceTimer);
    _saveDebounceTimer = setTimeout(() => {
      _saveDebounceTimer = null;
      doSave();
      hasUnsavedChanges = false;
    }, 500);
  } else {
    hasUnsavedChanges = true;
    updateSaveStatus();
  }
}
let _saveDebounceTimer = null;
function flushPendingSave(){
  if(_saveDebounceTimer){
    clearTimeout(_saveDebounceTimer);
    _saveDebounceTimer = null;
    doSave();
    hasUnsavedChanges = false;
  }
}
// Make sure a save that's mid-debounce is never lost if the tab is
// closed, refreshed, or backgrounded before the 500ms timer fires.
window.addEventListener('beforeunload', flushPendingSave);
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'hidden') flushPendingSave();
});
function updateSaveStatus(){
  const el = document.getElementById('saveStatus');
  [el].forEach(target => {
    if(!target) return;
    if(!storageAvailable){
      target.textContent = "Save failed — your browser is blocking local storage. Use Export to keep your work.";
      target.className = "save-status warn";
    } else if(!autosaveEnabled){
      target.textContent = hasUnsavedChanges
        ? "Autosave is off — unsaved changes, click Save"
        : "Autosave is off" + (lastSavedAt ? " \u2013 last saved " + lastSavedAt.toLocaleTimeString() : "");
      target.className = hasUnsavedChanges ? "save-status warn" : "save-status";
    } else if(lastSavedAt){
      target.textContent = "\u2713 Autosaved " + lastSavedAt.toLocaleTimeString();
      target.className = "save-status";
    }
  });

  // Keep the always-visible sidebar "This device" row in sync, so it's
  // clear from anywhere in the app whether autosave is on and working.
  const dot = document.getElementById('localSaveDot');
  const label = document.getElementById('localSaveLabel');
  const detail = document.getElementById('localSaveDetail');
  const toggle = document.getElementById('autosaveToggle');
  if(toggle && toggle.checked !== autosaveEnabled) toggle.checked = autosaveEnabled;
  if(dot && label && detail){
    if(!storageAvailable){
      dot.className = "dot warn";
      label.textContent = "Autosave failed";
      detail.textContent = "Browser is blocking local storage — use Export to keep your work";
    } else if(!autosaveEnabled){
      dot.className = "dot off";
      label.textContent = "Autosave is off";
      detail.textContent = hasUnsavedChanges
        ? "Unsaved changes — click Save"
        : (lastSavedAt ? "Last saved " + lastSavedAt.toLocaleTimeString() : "Turn on to save automatically");
    } else {
      dot.className = "dot";
      label.textContent = "Autosave is on";
      detail.textContent = lastSavedAt
        ? "Last saved " + lastSavedAt.toLocaleTimeString()
        : "Changes save to this device as you type";
    }
  }
}
function manualSave(){
  if(_saveDebounceTimer){ clearTimeout(_saveDebounceTimer); _saveDebounceTimer = null; }
  doSave();
  hasUnsavedChanges = false;
  const btn = document.getElementById('saveBtn');
  if(!btn) return;
  const original = btn.textContent;
  btn.textContent = storageAvailable ? "\u2713 Saved" : "\u2715 Save failed";
  setTimeout(() => { btn.textContent = original; }, 1400);
}
function loadFromStorage(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return false;
    const parsed = JSON.parse(raw);
    if(!parsed || !Array.isArray(parsed.plans) || parsed.plans.length===0) return false;
    plans = sanitizePlansArray(parsed.plans);
    activeIndex = Math.min(parsed.activeIndex || 0, plans.length - 1);
    if(parsed.settings) settings = Object.assign(settings, parsed.settings);
    return true;
  }catch(e){ return false; }
}
loadFromStorage();

function activePlan(){ return plans[activeIndex] || null; }

// ---------- View / navigation ----------
let currentView = 'home';
function showView(view){
  currentView = view;
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  const el = document.getElementById('view-' + view);
  if(el) el.style.display = 'block';
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  const navBtn = document.querySelector('.nav-item[data-view="' + view + '"]');
  if(navBtn) navBtn.classList.add('active');
  closeSidebarMobile();
  window.scrollTo(0,0);
  if(view === 'home'){
    const bg = document.getElementById('homeBg');
    if(bg) requestAnimationFrame(() => requestAnimationFrame(() => bg.classList.add('show')));
  }
}
function handleNav(view){
  if(view === 'myplans'){ renderTabs(); renderBoard(); }
  if(view === 'settings'){ renderSettings(); }
  if(view === 'newplan'){
    const input = document.getElementById('newPlanNameInput');
    if(input){
      input.value = "";
      showView(view);
      setTimeout(() => input.focus(), 0);
      return;
    }
  }
  showView(view);
}

// Reads the name typed on the New Plan page, creates the plan with that
// name (falling back to an auto-numbered name if left blank, same as
// every other "New Plan" entry point), then drops the user onto My Plans.
function submitNewPlan(){
  const input = document.getElementById('newPlanNameInput');
  const typed = input ? input.value.trim() : "";
  plans.push(newPlan(typed || ("Plan " + (plans.length + 1))));
  activeIndex = plans.length - 1;
  render();
  showView('myplans');
}

// Creates a plan immediately (auto-named) and takes you straight to its
// board — used by every "New Plan" entry point (sidebar, Home CTA, the
// empty My Plans state) so they all behave like the tab strip's own
// + New Plan button.
function createPlanDirect(){
  addPlan();
  showView('myplans');
}

function toggleSidebar(){
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('show');
}
function closeSidebarMobile(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
}

// ---------- Settings ----------
function toggleSettingsFields(){
  const checked = document.querySelector('input[name=alertMethod]:checked');
  const val = checked ? checked.value : 'none';
  document.getElementById('emailField').style.display = (val === 'email') ? 'block' : 'none';
  document.getElementById('mobileField').style.display = (val === 'mobile') ? 'block' : 'none';
}
let hasUnsavedSettingsChanges = false;
let lastSettingsSavedAt = null;
function markSettingsDirty(){
  hasUnsavedSettingsChanges = true;
  updateSettingsStatus();
}
function updateSettingsStatus(){
  const el = document.getElementById('settingsStatus');
  if(!el) return;
  if(hasUnsavedSettingsChanges){
    el.textContent = "Unsaved changes — click Save to apply";
    el.className = "save-status warn";
  } else if(lastSettingsSavedAt){
    el.textContent = "\u2713 Saved " + lastSettingsSavedAt.toLocaleTimeString();
    el.className = "save-status";
  } else {
    el.textContent = "";
    el.className = "save-status";
  }
}
function renderSettings(){
  const radio = document.querySelector('input[name=alertMethod][value="' + settings.alertMethod + '"]');
  if(radio) radio.checked = true;
  document.getElementById('alertEmailInput').value = settings.email || "";
  document.getElementById('alertMobileInput').value = settings.mobile || "";
  if(!settings.email && window.getSignedInEmail){
    const e = window.getSignedInEmail();
    if(e) document.getElementById('alertEmailInput').placeholder = e;
  }
  toggleSettingsFields();
  hasUnsavedSettingsChanges = false;
  updateSettingsStatus();
}
function syncSettingsFromInputs(){
  const checked = document.querySelector('input[name=alertMethod]:checked');
  settings.alertMethod = checked ? checked.value : 'none';
  settings.email = document.getElementById('alertEmailInput').value.trim();
  settings.mobile = document.getElementById('alertMobileInput').value.trim();
}
function manualSaveSettings(){
  syncSettingsFromInputs();
  doSave();
  hasUnsavedChanges = false;
  hasUnsavedSettingsChanges = false;
  lastSettingsSavedAt = new Date();
  updateSettingsStatus();
  const btn = document.getElementById('saveSettingsBtn');
  if(!btn) return;
  const original = btn.textContent;
  btn.textContent = storageAvailable ? "\u2713 Saved" : "\u2715 Save failed";
  setTimeout(() => { btn.textContent = original; }, 1400);
}

// ---------- Structural actions (trigger re-render) ----------
function addPlan(){
  plans.push(newPlan("Plan " + (plans.length + 1)));
  activeIndex = plans.length - 1;
  render();
}
function removePlan(i){
  showConfirmModal(
    "Delete this plan?",
    "This can't be undone.",
    () => {
      plans.splice(i,1);
      activeIndex = plans.length ? Math.min(activeIndex, plans.length - 1) : -1;
      render();
    }
  );
}
function switchPlan(i){ activeIndex = i; render(); }
function renamePlan(i){
  const name = prompt("Edit plan name:", plans[i].title);
  if(name !== null){
    plans[i].title = name.trim() || "Untitled Plan";
    render();
  }
}

function addVision(){ activePlan().visions.push(emptyVision()); render(); }
function removeVision(i){
  const items = activePlan().visions;
  confirmRowRemoval("vision entry", items[i], () => { items.splice(i,1); render(); });
}

function addMotive(){ activePlan().motives.push(emptyMotive()); render(); }
function removeMotive(i){
  const items = activePlan().motives;
  confirmRowRemoval("motive entry", items[i], () => { items.splice(i,1); render(); });
}

function addAction(){ activePlan().actions.push(emptyAction()); render(); }
function removeAction(i){
  const items = activePlan().actions;
  confirmRowRemoval("action", items[i] && items[i].action, () => { items.splice(i,1); render(); });
}

function addLog(){ activePlan().log.push(emptyLog()); render(); }
function removeLog(i){
  const items = activePlan().log;
  confirmRowRemoval("log entry", items[i] && items[i].change, () => { items.splice(i,1); render(); });
}

// Shared confirmation for every row-level "−" remove button. Shows a
// short preview of the actual text being deleted (truncated so a long
// paragraph doesn't blow up the dialog) so the warning is concrete, not
// just a generic "are you sure".
function confirmRowRemoval(kindLabel, previewText, onConfirm){
  const text = (previewText || "").trim();
  const max = 140;
  const preview = text.length > max ? text.slice(0, max).trim() + "…" : text;
  const message = preview
    ? 'This will delete: "' + preview + '" — this can\'t be undone.'
    : "This can't be undone.";
  showConfirmModal("Remove this " + kindLabel + "?", message, onConfirm);
}

// ---------- Field updates (no re-render, so focus/cursor is preserved) ----------
function updatePlanTitle(v){
  activePlan().title = v;
  const tabEl = document.getElementById('tabs').children[activeIndex];
  if(tabEl && tabEl.firstChild) tabEl.firstChild.textContent = v || "Untitled Plan";
  saveToStorage();
}
function updateVision(i, v){ activePlan().visions[i] = v; saveToStorage(); }
function updateMotive(i, v){ activePlan().motives[i] = v; saveToStorage(); }
function updateAction(i, field, v){ activePlan().actions[i][field] = v; saveToStorage(); }
function updateLog(i, field, v){ activePlan().log[i][field] = v; saveToStorage(); }

// ---------- Export / Import ----------
function exportPlans(){
  const blob = new Blob([JSON.stringify(plans, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = "plans.json";
  a.click();
  URL.revokeObjectURL(url);
}
function importPlans(evt){
  const file = evt.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = function(e){
    try{
      const parsed = JSON.parse(e.target.result);
      if(!Array.isArray(parsed) || parsed.length===0) throw new Error("bad format");
      plans = sanitizePlansArray(parsed);
      activeIndex = 0;
      render();
    }catch(err){
      alert("Could not read that file — make sure it's a plans.json exported from this tool.");
    }
  };
  reader.readAsText(file);
  evt.target.value = "";
}
// ---------- Printable report ----------
// Builds a clean, purpose-formatted document (not a screenshot of the
// editable board) into #printReport, then shows only that container.
// IMPORTANT: this triggers on the browser's actual print lifecycle
// (beforeprint/afterprint + a matchMedia('print') fallback), not just
// on our own menu buttons — so a native Ctrl+P, a phone's share-sheet
// "Print", etc. all get the arranged report too, never the raw screen.

function escapeHtml(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

function formatDateRangeDisplay(value){
  const parts = String(value || "").split(/\s*to\s*/i);
  const start = formatDateDisplay(parts[0]);
  const end = formatDateDisplay(parts[1]);
  if(start && end) return start + " – " + end;
  return start || end || "";
}

function formatTimeRangeDisplay(value){
  const parts = String(value || "").split(/\s*(?:to|–|-)\s*/);
  const start = formatTimeDisplay(parts[0]);
  const end = formatTimeDisplay(parts[1]);
  if(start && end) return start + " – " + end;
  return start || end || "";
}

function buildPrintListSection(title, items){
  const nonEmpty = (items || []).map(v => (v || "").trim()).filter(Boolean);
  const section = document.createElement('div');
  section.className = "print-section";
  const h2 = document.createElement('h2');
  h2.textContent = title;
  section.appendChild(h2);
  if(nonEmpty.length === 0){
    const p = document.createElement('p');
    p.className = "print-empty";
    p.textContent = "Nothing added yet.";
    section.appendChild(p);
  } else {
    const ol = document.createElement('ol');
    ol.className = "print-list";
    nonEmpty.forEach(v => {
      const li = document.createElement('li');
      li.textContent = v;
      ol.appendChild(li);
    });
    section.appendChild(ol);
  }
  return section;
}

function buildPrintActionsSection(actions){
  const rows = (actions || []).filter(a =>
    (a.action||"").trim() || (a.duration||"").trim() || (a.time||"").trim() ||
    (a.resources||"").trim() || (a.status||"").trim()
  );
  const section = document.createElement('div');
  section.className = "print-section";
  const h2 = document.createElement('h2');
  h2.textContent = "Actions (Mission)";
  section.appendChild(h2);
  if(rows.length === 0){
    const p = document.createElement('p');
    p.className = "print-empty";
    p.textContent = "No actions added yet.";
    section.appendChild(p);
  } else {
    let html = '<table class="print-table"><thead><tr>' +
      '<th>Action</th><th>Duration</th><th>Time of day</th><th>Resources required</th><th>Status</th>' +
      '</tr></thead><tbody>';
    rows.forEach(a => {
      html += '<tr>' +
        '<td>' + (escapeHtml(a.action) || '—') + '</td>' +
        '<td>' + (escapeHtml(formatDateRangeDisplay(a.duration)) || '—') + '</td>' +
        '<td>' + (escapeHtml(formatTimeRangeDisplay(a.time)) || '—') + '</td>' +
        '<td>' + (escapeHtml(a.resources) || '—') + '</td>' +
        '<td>' + (a.status ? '<span class="print-status-pill">'+escapeHtml(a.status)+'</span>' : '—') + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    section.insertAdjacentHTML('beforeend', html);
  }
  return section;
}

function buildPrintLogSection(log){
  const rows = (log || []).filter(e =>
    (e.date||"").trim() || (e.time||"").trim() || (e.change||"").trim() || (e.reason||"").trim()
  );
  const section = document.createElement('div');
  section.className = "print-section";
  const h2 = document.createElement('h2');
  h2.textContent = "Adjustments Log";
  section.appendChild(h2);
  if(rows.length === 0){
    const p = document.createElement('p');
    p.className = "print-empty";
    p.textContent = "No adjustments logged yet.";
    section.appendChild(p);
  } else {
    let html = '<table class="print-table"><thead><tr>' +
      '<th>Date</th><th>Time</th><th>Change made</th><th>Reason</th>' +
      '</tr></thead><tbody>';
    rows.forEach(e => {
      html += '<tr>' +
        '<td>' + (escapeHtml(formatDateDisplay(e.date)) || '—') + '</td>' +
        '<td>' + (escapeHtml(formatTimeDisplay(e.time)) || '—') + '</td>' +
        '<td>' + (escapeHtml(e.change) || '—') + '</td>' +
        '<td>' + (escapeHtml(e.reason) || '—') + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    section.insertAdjacentHTML('beforeend', html);
  }
  return section;
}

function buildPrintPlanNode(plan, {showOwnHeader}){
  const wrap = document.createElement('div');
  wrap.className = "print-plan";

  if(showOwnHeader){
    const header = document.createElement('div');
    header.className = "print-plan-header";
    const h1 = document.createElement('h1');
    h1.textContent = plan.title || "Untitled Plan";
    header.appendChild(h1);
    const date = document.createElement('p');
    date.className = "print-date";
    date.textContent = "Generated " + formatDateDisplay(todayISO());
    header.appendChild(date);
    wrap.appendChild(header);
  }

  wrap.appendChild(buildPrintListSection("Vision (Main Objective)", plan.visions));
  wrap.appendChild(buildPrintListSection("Motive (Why)", plan.motives));
  wrap.appendChild(buildPrintActionsSection(plan.actions));
  wrap.appendChild(buildPrintLogSection(plan.log));
  return wrap;
}

// mode: 'current' | 'all'. Drives what gets built when printing actually
// starts (see the beforeprint/matchMedia wiring below).
let pendingPrintMode = 'current';

// Always rebuilds from the current pendingPrintMode — deliberately NOT
// gated behind an "already active" flag. Some browsers don't reliably
// fire `afterprint` when the print/save dialog is cancelled rather than
// completed, which would leave a stale guard stuck "on" and cause the
// next print (e.g. switching from "current plan" to "all plans") to
// silently reuse the old report instead of rebuilding. Rebuilding is
// cheap, so just always doing it is the robust choice.
function activatePrintReport(){
  const container = document.getElementById('printReport');
  container.innerHTML = "";
  const reportRoot = document.createElement('div');
  reportRoot.className = "print-report";

  if(pendingPrintMode === 'all' && plans && plans.length > 0){
    const cover = document.createElement('div');
    cover.className = "print-cover";
    cover.innerHTML =
      '<p class="print-kicker">Plan Board</p>' +
      '<h1>Full Report</h1>' +
      '<p class="print-date">Generated ' + escapeHtml(formatDateDisplay(todayISO())) + ' &middot; ' + plans.length + ' plan' + (plans.length===1?'':'s') + '</p>';
    const toc = document.createElement('ol');
    toc.className = "print-toc";
    plans.forEach((p, i) => {
      const li = document.createElement('li');
      li.innerHTML = '<span>' + (i+1) + '. ' + escapeHtml(p.title || "Untitled Plan") + '</span>';
      toc.appendChild(li);
    });
    cover.appendChild(toc);
    reportRoot.appendChild(cover);
    plans.forEach(p => reportRoot.appendChild(buildPrintPlanNode(p, {showOwnHeader:true})));
  } else {
    const plan = activePlan();
    if(plan){
      reportRoot.appendChild(buildPrintPlanNode(plan, {showOwnHeader:true}));
    } else {
      const empty = document.createElement('p');
      empty.className = "print-empty";
      empty.textContent = "No plan to print yet.";
      reportRoot.appendChild(empty);
    }
  }

  container.appendChild(reportRoot);
  document.documentElement.classList.add('printing-report');
}

function deactivatePrintReport(){
  document.documentElement.classList.remove('printing-report');
  document.getElementById('printReport').innerHTML = "";
  pendingPrintMode = 'current';
}

// The actual report-building/hiding happens here, driven by the real
// print lifecycle — so it fires whether printing was started from our
// File-menu buttons, a native Ctrl+P, or a mobile browser's share-sheet
// print option. beforeprint/afterprint cover most desktop browsers;
// matchMedia('print') is the more reliable signal on Firefox and older
// Safari, so both are wired up (activatePrintReport/deactivatePrintReport
// are idempotent, so firing twice is harmless).
window.addEventListener('beforeprint', activatePrintReport);
window.addEventListener('afterprint', deactivatePrintReport);
if(window.matchMedia){
  const printMql = window.matchMedia('print');
  const onPrintChange = (e) => { if(e.matches) activatePrintReport(); else deactivatePrintReport(); };
  if(printMql.addEventListener) printMql.addEventListener('change', onPrintChange);
  else if(printMql.addListener) printMql.addListener(onPrintChange); // older Safari
}

// Gives the browser a rendered frame before invoking window.print(). On
// mobile (iOS Safari's share-sheet print, Android Chrome's print
// activity), calling window.print() immediately after a DOM/class change
// can snapshot the page before that change has actually painted, which is
// why "print all" could still show only the current plan. Double
// requestAnimationFrame waits for the next two paint cycles, which is
// enough for the browser to have actually rendered the updated report.
function printAfterRender(){
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.print();
    });
  });
}

function printCurrentPlanReport(){
  if(!activePlan()){ alert("Create a plan first."); return; }
  pendingPrintMode = 'current';
  // Build the report content immediately, rather than waiting on the
  // beforeprint/matchMedia listeners below. On mobile browsers, print
  // goes through an OS-level share sheet that doesn't reliably fire
  // those events in time, which can leave the report stale or empty
  // when the print snapshot is taken. Building it up front here removes
  // that race; activatePrintReport() is idempotent so it's harmless if
  // beforeprint/matchMedia also fire afterward.
  activatePrintReport();
  printAfterRender();
}

function printAllPlansReport(){
  if(!plans || plans.length === 0){ alert("Create a plan first."); return; }
  pendingPrintMode = 'all';
  activatePrintReport();
  printAfterRender();
}

// Kept for backward compatibility in case anything else still calls it.
function printBoard(){ printCurrentPlanReport(); }

function toggleFileMenu(evt){
  evt.stopPropagation();
  const menu = document.getElementById('fileMenu');
  const btn = document.getElementById('fileMenuBtn');
  const nowOpen = !menu.classList.contains('show');
  if(nowOpen){
    // Detach the menu to <body> so it's never clipped or stacked behind
    // content by whatever ancestor stacking/overflow context it started in
    // (position:sticky containers can misbehave with nested absolute
    // children on some mobile browsers).
    if(menu.parentElement !== document.body) document.body.appendChild(menu);
    const rect = btn.getBoundingClientRect();
    const menuWidth = 210;
    let left = rect.left;
    if(left + menuWidth > window.innerWidth - 10) left = window.innerWidth - menuWidth - 10;
    if(left < 10) left = 10;
    menu.style.top = (rect.bottom + 8) + 'px';
    menu.style.left = left + 'px';
  }
  menu.classList.toggle('show', nowOpen);
  if(btn) btn.setAttribute('aria-expanded', String(nowOpen));
}
function closeFileMenu(){
  const menu = document.getElementById('fileMenu');
  const btn = document.getElementById('fileMenuBtn');
  if(menu) menu.classList.remove('show');
  if(btn) btn.setAttribute('aria-expanded', 'false');
}
document.addEventListener('click', (e) => {
  const menu = document.getElementById('fileMenu');
  const btn = document.getElementById('fileMenuBtn');
  if(!menu || !btn) return;
  if(!menu.contains(e.target) && !btn.contains(e.target)) closeFileMenu();
});
window.addEventListener('scroll', () => closeFileMenu(), true);
window.addEventListener('resize', () => closeFileMenu());
document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeFileMenu(); });

// ---------- Bridge for the Firebase/cloud-sync module below ----------
function getBoardState(){ return { plans, activeIndex, settings }; }
function setBoardState(data){
  if(!data || !Array.isArray(data.plans) || data.plans.length===0) return;
  plans = sanitizePlansArray(data.plans);
  activeIndex = Math.min(data.activeIndex || 0, plans.length - 1);
  if(data.settings) settings = Object.assign(settings, data.settings);
  render();
  if(currentView === 'settings') renderSettings();
}
window.getBoardState = getBoardState;
window.setBoardState = setBoardState;

function updateAuthUI(user){
  const signInBtn = document.getElementById('signInBtn');
  const userInfo = document.getElementById('userInfo');
  const userEmail = document.getElementById('userEmail');
  const signInBtnTop = document.getElementById('signInBtnTop');
  const userInfoTop = document.getElementById('userInfoTop');
  const userEmailTop = document.getElementById('userEmailTop');
  if(user){
    signInBtn.style.display = 'none';
    userInfo.style.display = 'flex';
    userEmail.textContent = user.displayName || user.email || "Signed in";
    signInBtnTop.style.display = 'none';
    userInfoTop.style.display = 'flex';
    userEmailTop.textContent = user.displayName || user.email || "Signed in";
  } else {
    signInBtn.style.display = 'inline-block';
    userInfo.style.display = 'none';
    signInBtnTop.style.display = 'flex';
    userInfoTop.style.display = 'none';
  }
}
window.updateAuthUI = updateAuthUI;

function setCloudStatus(text, state){
  // state: "on" | "warn" | "off"
  const dot = document.getElementById('cloudDot');
  if(dot) dot.className = "cloud-dot" + (state === "on" ? " on" : state === "warn" ? " warn" : "");
  const dotTop = document.getElementById('cloudDotTop');
  if(dotTop) dotTop.className = "cloud-dot" + (state === "on" ? " on" : state === "warn" ? " warn" : "");

  // Drive the "Your account" row in the sidebar autosave badge.
  const cloudRowDot = document.getElementById('cloudSaveDot');
  const cloudRowDetail = document.getElementById('cloudSaveDetail');
  if(cloudRowDot) cloudRowDot.className = "dot" + (state === "on" ? "" : state === "warn" ? " warn" : " off");
  if(cloudRowDetail && text) cloudRowDetail.textContent = text;
}
window.setCloudStatus = setCloudStatus;

// ---------- Render ----------
function render(){
  renderTabs();
  renderBoard();
  saveToStorage();
}

function renderTabs(){
  const tabs = document.getElementById('tabs');
  if(!tabs) return;
  tabs.innerHTML = "";
  try{
    (Array.isArray(plans) ? plans : []).forEach((p, i) => {
      try{
        const tab = document.createElement('div');
        tab.className = "tab" + (i===activeIndex ? " active" : "");
        const label = document.createElement('span');
        label.textContent = (p && p.title) || "Untitled Plan";
        tab.appendChild(label);
        const edit = document.createElement('span');
        edit.className = "edit-icon";
        edit.textContent = "\u270E";
        edit.title = "Edit plan";
        edit.onclick = (e) => { e.stopPropagation(); renamePlan(i); };
        tab.appendChild(edit);
        const close = document.createElement('span');
        close.className = "close";
        close.textContent = "\u00D7";
        close.title = "Delete plan";
        close.onclick = (e) => { e.stopPropagation(); removePlan(i); };
        tab.appendChild(close);
        tab.onclick = () => switchPlan(i);
        tabs.appendChild(tab);
      }catch(err){
        // One malformed plan should never take down the whole tab strip —
        // log it and keep going so every other tab (and + New Plan) still shows.
        console.error("Failed to render tab for plan index " + i, err);
      }
    });
  }catch(err){
    // Even if `plans` itself is somehow not a proper array, or something
    // else entirely unexpected happens, that must never take the
    // + New Plan button down with it — log it and fall through.
    console.error("renderTabs failed unexpectedly", err);
  }

  const newBtn = document.createElement('div');
  newBtn.className = "newplan-btn";
  newBtn.textContent = "+ New Plan";
  newBtn.onclick = addPlan;
  tabs.appendChild(newBtn);
}

function renderBoard(){
  const board = document.getElementById('board');
  board.innerHTML = "";

  if(plans.length === 0){
    const empty = document.createElement('div');
    empty.className = "empty-plans-state";
    empty.innerHTML = `
      <h2>You have no plan yet</h2>
      <p>Create a plan to start mapping out its vision, motives, actions, and adjustments.</p>
    `;
    const cta = document.createElement('button');
    cta.className = "add-btn amber";
    cta.textContent = "+ Start Your First Plan";
    cta.onclick = () => createPlanDirect();
    empty.appendChild(cta);
    board.appendChild(empty);
    updateSaveStatus();
    return;
  }

  const p = activePlan();

  // Title
  const titleRow = document.createElement('div');
  titleRow.className = "plan-title-row";
  const titleInput = document.createElement('input');
  titleInput.value = p.title;
  titleInput.placeholder = "Plan title...";
  titleInput.oninput = (e) => updatePlanTitle(e.target.value);
  titleRow.appendChild(titleInput);
  board.appendChild(titleRow);

  // Vision
  board.appendChild(buildListSection(
    "Vision (Main Objective)", p.visions, updateVision, addVision, removeVision,
    "Write a vision / main objective..."
  ));

  // Motive
  board.appendChild(buildListSection(
    "Motive (Why)", p.motives, updateMotive, addMotive, removeMotive,
    "Write the motive behind this objective..."
  ));

  // Actions
  board.appendChild(buildActionsSection(p.actions));

  // Adjustments Log
  board.appendChild(buildLogSection(p.log));

  updateSaveStatus();
}

function buildListSection(heading, items, updateFn, addFn, removeFn, placeholder){
  const section = document.createElement('div');
  section.className = "section";
  const head = document.createElement('div');
  head.className = "section-head";
  head.innerHTML = `<h2>${heading}</h2>`;
  const addBtn = document.createElement('button');
  addBtn.className = "add-btn amber";
  addBtn.textContent = "+ Add";
  addBtn.onclick = addFn;
  head.appendChild(addBtn);
  section.appendChild(head);

  items.forEach((val, i) => {
    const row = document.createElement('div');
    row.className = "list-row";
    const ta = document.createElement('textarea');
    ta.value = val;
    ta.placeholder = placeholder;
    ta.oninput = (e) => updateFn(i, e.target.value);
    row.appendChild(ta);
    const rm = document.createElement('button');
    rm.className = "row-remove";
    rm.textContent = "\u2212";
    rm.title = "Remove";
    rm.onclick = () => removeFn(i);
    row.appendChild(rm);
    section.appendChild(row);
  });

  return section;
}

function buildActionsSection(actions){
  const section = document.createElement('div');
  section.className = "section";
  const head = document.createElement('div');
  head.className = "section-head";
  head.innerHTML = `<h2>Actions (Mission)</h2>`;
  const addBtn = document.createElement('button');
  addBtn.className = "add-btn amber";
  addBtn.textContent = "+ Add Action";
  addBtn.onclick = addAction;
  head.appendChild(addBtn);
  section.appendChild(head);

  const table = document.createElement('table');
  table.className = "actions-table";
  table.innerHTML = `<thead><tr>
    <th>Action</th><th>Duration</th><th>Time of day</th><th>Resources required</th><th>Status</th><th></th>
  </tr></thead>`;
  const tbody = document.createElement('tbody');

  actions.forEach((a, i) => {
    const tr = document.createElement('tr');

    const actionTd = makeCell(a.action, "Action", (v)=>updateAction(i,'action',v), true);
    actionTd.classList.add('cell-primary');
    tr.appendChild(actionTd);

    const durationTd = makeDateRangeCell(a.duration, "Duration", (v)=>updateAction(i,'duration',v));
    durationTd.classList.add('cell-secondary');
    tr.appendChild(durationTd);

    const timeTd = makeTimeRangeCell(a.time, "Time of Day", (v)=>updateAction(i,'time',v));
    timeTd.classList.add('cell-secondary');
    tr.appendChild(timeTd);

    const resourcesTd = makeCell(a.resources, "Resources", (v)=>updateAction(i,'resources',v), true);
    resourcesTd.classList.add('cell-secondary');
    tr.appendChild(resourcesTd);

    const statusTd = makeStatusCell(a.status, "Status", (v)=>updateAction(i,'status',v));
    statusTd.classList.add('cell-primary');
    tr.appendChild(statusTd);

    tr.appendChild(createRowToggle(["Duration", "Time of day", "Resources required"]));

    const tdRm = document.createElement('td');
    tdRm.className = "col-remove";
    const rm = document.createElement('button');
    rm.className = "row-remove";
    rm.textContent = "\u2212";
    rm.onclick = () => removeAction(i);
    tdRm.appendChild(rm);
    tr.appendChild(tdRm);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  const scrollWrap = document.createElement('div');
  scrollWrap.className = "table-scroll";
  scrollWrap.appendChild(table);
  section.appendChild(scrollWrap);
  return section;
}

function buildLogSection(log){
  const section = document.createElement('div');
  section.className = "section";
  const head = document.createElement('div');
  head.className = "section-head";
  head.innerHTML = `<h2>Adjustments Log</h2>`;
  const addBtn = document.createElement('button');
  addBtn.className = "add-btn amber";
  addBtn.textContent = "+ Add Entry";
  addBtn.onclick = addLog;
  head.appendChild(addBtn);
  section.appendChild(head);

  const table = document.createElement('table');
  table.className = "log-table";
  table.innerHTML = `<thead><tr><th>Date</th><th>Time</th><th>Change Made</th><th>Reason</th><th></th></tr></thead>`;
  const tbody = document.createElement('tbody');

  log.forEach((entry, i) => {
    const tr = document.createElement('tr');

    const dateTd = makeDateCell(entry.date, "Date", (v)=>updateLog(i,'date',v));
    dateTd.classList.add('cell-primary');
    tr.appendChild(dateTd);

    const timeTd = makeTimeCell(entry.time, "Time", (v)=>updateLog(i,'time',v));
    timeTd.classList.add('cell-primary');
    tr.appendChild(timeTd);

    const changeTd = makeCell(entry.change, "Change Made", (v)=>updateLog(i,'change',v), true);
    changeTd.classList.add('cell-primary');
    tr.appendChild(changeTd);

    const reasonTd = makeCell(entry.reason, "Reason", (v)=>updateLog(i,'reason',v), true);
    reasonTd.classList.add('cell-secondary');
    tr.appendChild(reasonTd);

    tr.appendChild(createRowToggle(["Reason"]));

    const tdRm = document.createElement('td');
    tdRm.className = "col-remove";
    const rm = document.createElement('button');
    rm.className = "row-remove";
    rm.textContent = "\u2212";
    rm.onclick = () => removeLog(i);
    tdRm.appendChild(rm);
    tr.appendChild(tdRm);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  const scrollWrap = document.createElement('div');
  scrollWrap.className = "table-scroll";
  scrollWrap.appendChild(table);
  section.appendChild(scrollWrap);
  return section;
}

// Builds the mobile-only "Show N more fields" bar for a row's hidden
// (cell-secondary) columns. On screens above 700px this cell stays
// display:none, so it never affects desktop/tablet layout.
function createRowToggle(hiddenFieldNames){
  const tdToggle = document.createElement('td');
  tdToggle.className = "row-toggle-cell";

  const toggleBtn = document.createElement('button');
  toggleBtn.type = "button";
  toggleBtn.className = "row-toggle-btn";

  const count = hiddenFieldNames.length;
  const showText = "Show " + count + " more field" + (count === 1 ? "" : "s");
  const hideText = "Hide extra fields";

  const label = document.createElement('span');
  label.className = "toggle-label";
  label.textContent = showText;
  const chev = document.createElement('span');
  chev.className = "chev";
  chev.textContent = "\u2304";
  toggleBtn.appendChild(label);
  toggleBtn.appendChild(chev);
  toggleBtn.setAttribute('aria-label', showText + ": " + hiddenFieldNames.join(", "));

  toggleBtn.onclick = () => {
    const tr = tdToggle.closest('tr');
    const expanded = tr.classList.toggle('row-expanded');
    label.textContent = expanded ? hideText : showText;
    toggleBtn.setAttribute('aria-label', expanded ? hideText : showText + ": " + hiddenFieldNames.join(", "));
  };

  tdToggle.appendChild(toggleBtn);
  return tdToggle;
}

function isISODate(s){ return /^\d{4}-\d{2}-\d{2}$/.test(s || ""); }
function isHHMM(s){ return /^\d{2}:\d{2}$/.test(s || ""); }
function pad2(n){ return String(n).padStart(2,'0'); }
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const CALENDAR_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';
const CLOCK_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
const CHECK_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
const CHEV_LEFT_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
const CHEV_RIGHT_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

function formatDateDisplay(iso){
  if(!isISODate(iso)) return "";
  const [y, m, d] = iso.split('-').map(Number);
  return MONTH_NAMES[m - 1] + " " + d + ", " + y;
}
function daysInMonth(year, month){ return new Date(year, month, 0).getDate(); }
function todayISO(){
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

// ---------------------------------------------------------------------
// Shared popover plumbing: only one date/time popover is ever open at a
// time. Selecting a day/hour/minute inside the popover only updates the
// popover's own pending selection — it does NOT commit the value or
// close the popover. The person must press the check-marked "Done"
// button to confirm and apply the selection (or "Clear" to blank it).
// Clicking outside the popover, or pressing Escape, dismisses it
// without applying whatever was pending, same as changing your mind.
// ---------------------------------------------------------------------
let closeActivePopover = null;

function dismissActivePopover(){
  if(closeActivePopover){
    const fn = closeActivePopover;
    closeActivePopover = null;
    fn();
  }
}

function openDtPopover(anchor, buildContent){
  dismissActivePopover();

  const pop = document.createElement('div');
  pop.className = "dt-popover";
  buildContent(pop, () => dismissActivePopover());
  document.body.appendChild(pop);

  function position(){
    const r = anchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    let top = r.bottom + 6;
    let left = r.left;
    if(top + pr.height > window.innerHeight - 8){
      top = Math.max(8, r.top - pr.height - 6);
    }
    if(left + pr.width > window.innerWidth - 8){
      left = Math.max(8, window.innerWidth - 8 - pr.width);
    }
    pop.style.top = top + "px";
    pop.style.left = left + "px";
  }
  position();

  function onOutsideClick(e){
    if(!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)){
      dismissActivePopover();
    }
  }
  function onKeydown(e){
    if(e.key === "Escape") dismissActivePopover();
  }
  function onReposition(){ position(); }

  document.addEventListener('mousedown', onOutsideClick, true);
  document.addEventListener('keydown', onKeydown, true);
  window.addEventListener('resize', onReposition);
  window.addEventListener('scroll', onReposition, true);

  closeActivePopover = () => {
    document.removeEventListener('mousedown', onOutsideClick, true);
    document.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('resize', onReposition);
    window.removeEventListener('scroll', onReposition, true);
    pop.remove();
  };

  return pop;
}

function makeDtPopoverFooter({onClear, onDone}){
  const footer = document.createElement('div');
  footer.className = "dt-pop-footer";

  const clearBtn = document.createElement('button');
  clearBtn.type = "button";
  clearBtn.className = "dt-pop-clear";
  clearBtn.textContent = "Clear";
  clearBtn.onclick = onClear;

  const doneBtn = document.createElement('button');
  doneBtn.type = "button";
  doneBtn.className = "dt-pop-done";
  doneBtn.innerHTML = CHECK_ICON + '<span>Done</span>';
  doneBtn.onclick = onDone;

  footer.appendChild(clearBtn);
  footer.appendChild(doneBtn);
  return footer;
}

// Single clickable pill (icon + label/value). Clicking it opens a
// custom calendar popover; picking a day only stages that day as the
// pending selection (highlighted), it does not close the popover or
// apply the change. Pressing the check-marked "Done" button confirms
// and applies the pending day; "Clear" blanks it. No manual typing is
// possible anywhere — every interaction is a click on a day cell or a
// footer button. Optional getMin(): an ISO date string ("YYYY-MM-DD")
// this field may not go earlier than (equal is allowed) — days before
// it are shown disabled in the popover.
function makeDatePillField({value, label, onChange, getMin}){
  const wrap = document.createElement('div');
  wrap.className = "pill-field date-select-group";

  let val = isISODate(value) ? value : "";

  const pill = document.createElement('button');
  pill.type = "button";
  pill.className = "dt-pill";
  pill.setAttribute('aria-label', label || "Date");

  const textEl = document.createElement('span');
  textEl.className = "dt-pill-text";

  function refreshPill(){
    pill.classList.toggle('has-value', !!val);
    textEl.textContent = val ? formatDateDisplay(val) : (label || "Date");
  }

  function enforceMin(){
    const min = getMin ? getMin() : null;
    if(isISODate(min) && val && val < min) val = min;
  }

  refreshPill();

  pill.onclick = () => {
    const min = getMin ? getMin() : null;
    const minVal = isISODate(min) ? min : null;
    let pending = val || null;
    const seed = pending || minVal || todayISO();
    const view = { y: Number(seed.slice(0,4)), m: Number(seed.slice(5,7)) };

    openDtPopover(pill, (pop, close) => {
      const header = document.createElement('div');
      header.className = "dt-pop-header";
      const prevBtn = document.createElement('button');
      prevBtn.type = "button"; prevBtn.className = "dt-pop-nav"; prevBtn.innerHTML = CHEV_LEFT_ICON;
      prevBtn.setAttribute('aria-label', "Previous month");
      const nextBtn = document.createElement('button');
      nextBtn.type = "button"; nextBtn.className = "dt-pop-nav"; nextBtn.innerHTML = CHEV_RIGHT_ICON;
      nextBtn.setAttribute('aria-label', "Next month");
      const monthLabel = document.createElement('div');
      monthLabel.className = "dt-pop-month-label";
      header.appendChild(prevBtn); header.appendChild(monthLabel); header.appendChild(nextBtn);

      const grid = document.createElement('div');
      grid.className = "dt-pop-grid";

      function render(){
        monthLabel.textContent = MONTH_NAMES[view.m - 1] + " " + view.y;
        grid.innerHTML = "";
        ["S","M","T","W","T","F","S"].forEach(d => {
          const wd = document.createElement('div');
          wd.className = "dt-pop-wd";
          wd.textContent = d;
          grid.appendChild(wd);
        });
        const firstDow = new Date(view.y, view.m - 1, 1).getDay();
        const count = daysInMonth(view.y, view.m);
        const today = todayISO();
        for(let i = 0; i < firstDow; i++){
          const blank = document.createElement('div');
          grid.appendChild(blank);
        }
        for(let d = 1; d <= count; d++){
          const iso = view.y + '-' + pad2(view.m) + '-' + pad2(d);
          const btn = document.createElement('button');
          btn.type = "button";
          btn.className = "dt-pop-day";
          btn.textContent = String(d);
          const disabled = minVal && iso < minVal;
          if(disabled){
            btn.classList.add('disabled');
            btn.disabled = true;
          } else {
            btn.onclick = () => { pending = iso; render(); };
          }
          if(iso === today) btn.classList.add('today');
          if(iso === pending) btn.classList.add('selected');
          grid.appendChild(btn);
        }
      }

      prevBtn.onclick = () => { view.m--; if(view.m < 1){ view.m = 12; view.y--; } render(); };
      nextBtn.onclick = () => { view.m++; if(view.m > 12){ view.m = 1; view.y++; } render(); };
      render();

      const footer = makeDtPopoverFooter({
        onClear: () => { pending = null; render(); },
        onDone: () => {
          val = pending || "";
          enforceMin();
          onChange(val);
          refreshPill();
          close();
        }
      });

      pop.appendChild(header);
      pop.appendChild(grid);
      pop.appendChild(footer);
    });
  };

  pill.appendChild(document.createRange().createContextualFragment(CALENDAR_ICON));
  pill.appendChild(textEl);
  wrap.appendChild(pill);

  // Called by a paired "From" field when its value changes, so this "To"
  // field's current value re-validates against the new minimum.
  wrap.refreshMinConstraint = function(){
    const before = val;
    enforceMin();
    if(val !== before) onChange(val);
    refreshPill();
  };

  return wrap;
}

function makeDateRangeCell(value, label, onChange){
  const td = document.createElement('td');
  td.setAttribute('data-label', label);
  const wrap = document.createElement('div');
  wrap.className = "range-cell";
  const parts = (value || "").split(/\s*to\s*/i);
  let startVal = isISODate(parts[0]) ? parts[0] : "";
  let endVal = isISODate(parts[1]) ? parts[1] : "";
  function emit(){
    let v = startVal;
    if(endVal) v += " to " + endVal;
    onChange(v);
  }
  let endField;
  const startField = makeDatePillField({
    value:startVal, label:"From", onChange:(v)=>{
      startVal = v;
      emit();
      if(endField) endField.refreshMinConstraint();
    }
  });
  endField = makeDatePillField({
    value:endVal, label:"To", getMin:() => startVal, onChange:(v)=>{ endVal = v; emit(); }
  });
  wrap.appendChild(startField);
  wrap.appendChild(endField);
  td.appendChild(wrap);
  return td;
}

function formatTimeDisplay(hhmm){
  if(!isHHMM(hhmm)) return "";
  let [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if(h === 0) h = 12;
  return h + ":" + pad2(m) + " " + suffix;
}

// Single clickable pill (icon + label/value). Clicking it opens a
// custom hour/minute popover; picking an hour or minute only stages it
// as the pending selection (highlighted), it does not close the
// popover or apply the change. Pressing the check-marked "Done" button
// confirms and applies the pending time; "Clear" blanks it. No manual
// typing is possible anywhere — every interaction is a click on an
// hour/minute cell or a footer button. Optional getMin(): an "HH:MM"
// string this field may not go earlier than (equal is allowed) — hours
// and minutes before it are shown disabled in the popover.
function makeTimePillField({value, label, onChange, getMin}){
  const wrap = document.createElement('div');
  wrap.className = "pill-field time-select-group";

  let val = isHHMM(value) ? value : "";

  const pill = document.createElement('button');
  pill.type = "button";
  pill.className = "dt-pill";
  pill.setAttribute('aria-label', label || "Time");

  const textEl = document.createElement('span');
  textEl.className = "dt-pill-text";

  function refreshPill(){
    pill.classList.toggle('has-value', !!val);
    textEl.textContent = val ? formatTimeDisplay(val) : (label || "Time");
  }

  function enforceMin(){
    const min = getMin ? getMin() : null;
    if(isHHMM(min) && val && val < min) val = min;
  }

  refreshPill();

  pill.onclick = () => {
    const min = getMin ? getMin() : null;
    const minVal = isHHMM(min) ? min : null;
    const [minH, minM] = minVal ? minVal.split(':') : [null, null];
    let [pendH, pendM] = isHHMM(val) ? val.split(':') : [null, null];

    openDtPopover(pill, (pop, close) => {
      const cols = document.createElement('div');
      cols.className = "dt-pop-time-cols";

      const hourCol = document.createElement('div');
      hourCol.className = "dt-pop-time-col";
      const hourLabel = document.createElement('div');
      hourLabel.className = "dt-pop-col-label";
      hourLabel.textContent = "Hour";
      const hourList = document.createElement('div');
      hourList.className = "dt-pop-col-list";
      hourCol.appendChild(hourLabel);
      hourCol.appendChild(hourList);

      const minCol = document.createElement('div');
      minCol.className = "dt-pop-time-col";
      const minLabel = document.createElement('div');
      minLabel.className = "dt-pop-col-label";
      minLabel.textContent = "Min";
      const minList = document.createElement('div');
      minList.className = "dt-pop-col-list";
      minCol.appendChild(minLabel);
      minCol.appendChild(minList);

      function renderMinutes(){
        minList.innerHTML = "";
        for(let m = 0; m < 60; m++){
          const mm = pad2(m);
          const btn = document.createElement('button');
          btn.type = "button";
          btn.className = "dt-pop-time-opt";
          btn.textContent = mm;
          const disabled = minVal && pendH !== null && pendH === minH && mm < minM;
          if(disabled){
            btn.classList.add('disabled');
            btn.disabled = true;
          } else {
            btn.onclick = () => { pendM = mm; renderMinutes(); };
          }
          if(mm === pendM) btn.classList.add('selected');
          minList.appendChild(btn);
        }
      }

      function renderHours(){
        hourList.innerHTML = "";
        for(let h = 0; h < 24; h++){
          const hh = pad2(h);
          const btn = document.createElement('button');
          btn.type = "button";
          btn.className = "dt-pop-time-opt";
          btn.textContent = hh;
          const disabled = minVal && hh < minH;
          if(disabled){
            btn.classList.add('disabled');
            btn.disabled = true;
          } else {
            btn.onclick = () => {
              pendH = hh;
              if(minVal && pendH === minH && pendM !== null && pendM < minM) pendM = minM;
              renderHours();
              renderMinutes();
            };
          }
          if(hh === pendH) btn.classList.add('selected');
          hourList.appendChild(btn);
        }
      }

      renderHours();
      renderMinutes();
      cols.appendChild(hourCol);
      cols.appendChild(minCol);

      const footer = makeDtPopoverFooter({
        onClear: () => { pendH = null; pendM = null; renderHours(); renderMinutes(); },
        onDone: () => {
          val = (pendH !== null && pendM !== null) ? (pendH + ':' + pendM) : "";
          enforceMin();
          onChange(val);
          refreshPill();
          close();
        }
      });

      pop.appendChild(cols);
      pop.appendChild(footer);

      const selHour = hourList.querySelector('.selected');
      if(selHour) selHour.scrollIntoView({ block: "center" });
      const selMin = minList.querySelector('.selected');
      if(selMin) selMin.scrollIntoView({ block: "center" });
    });
  };

  pill.appendChild(document.createRange().createContextualFragment(CLOCK_ICON));
  pill.appendChild(textEl);
  wrap.appendChild(pill);

  // Called by a paired "From" field when its value changes, so this "To"
  // field's current value re-validates against the new minimum.
  wrap.refreshMinConstraint = function(){
    const before = val;
    enforceMin();
    if(val !== before) onChange(val);
    refreshPill();
  };

  return wrap;
}

function makeTimeRangeCell(value, label, onChange){
  const td = document.createElement('td');
  td.setAttribute('data-label', label);
  const wrap = document.createElement('div');
  wrap.className = "range-cell";
  const parts = (value || "").split(/\s*(?:to|–|-)\s*/);
  let startVal = isHHMM(parts[0]) ? parts[0] : "";
  let endVal = isHHMM(parts[1]) ? parts[1] : "";
  function emit(){
    let v = startVal;
    if(endVal) v += "–" + endVal;
    onChange(v);
  }
  let endField;
  const startField = makeTimePillField({
    value:startVal, label:"From", onChange:(v)=>{
      startVal = v;
      emit();
      if(endField) endField.refreshMinConstraint();
    }
  });
  endField = makeTimePillField({
    value:endVal, label:"To", getMin:() => startVal, onChange:(v)=>{ endVal = v; emit(); }
  });
  wrap.appendChild(startField);
  wrap.appendChild(endField);
  td.appendChild(wrap);
  return td;
}

const STATUS_OPTIONS = ["Not started", "In progress", "Finished"];

function makeStatusCell(value, label, onChange){
  const td = document.createElement('td');
  td.setAttribute('data-label', label);
  const wrap = document.createElement('div');
  wrap.className = "status-cell";

  const norm = (value || "").trim().toLowerCase();
  let current = STATUS_OPTIONS.find(o => o.toLowerCase() === norm) || (norm === "done" ? "Finished" : "");

  const pill = document.createElement('button');
  pill.type = "button";
  pill.className = "pill-btn status-pill";

  const options = document.createElement('div');
  options.className = "status-options";
  options.style.display = "none";

  function statusClass(v){ return v ? "status-" + v.toLowerCase().replace(/\s+/g,'-') : ""; }
  function refreshPill(){
    pill.textContent = current || "Select status";
    pill.className = "pill-btn status-pill" + (current ? " has-value " + statusClass(current) : "");
  }
  refreshPill();

  function openOptions(){ pill.style.display = "none"; options.style.display = "flex"; }
  function closeOptions(){ options.style.display = "none"; pill.style.display = "flex"; refreshPill(); }
  pill.onclick = openOptions;

  STATUS_OPTIONS.forEach(opt => {
    const optWrap = document.createElement('label');
    const slug = opt.toLowerCase().replace(/\s+/g,'-');
    optWrap.className = "status-opt status-opt-" + slug;
    const cb = document.createElement('input');
    cb.type = "checkbox";
    cb.checked = current === opt;
    cb.onchange = () => {
      if(cb.checked){
        options.querySelectorAll('input[type=checkbox]').forEach(other => { if(other !== cb) other.checked = false; });
        current = opt;
        onChange(opt);
      } else {
        current = "";
        onChange("");
      }
      closeOptions();
    };
    const dot = document.createElement('span');
    dot.className = "status-dot";
    const txt = document.createElement('span');
    txt.className = "status-opt-text";
    txt.textContent = opt;
    const check = document.createElement('span');
    check.className = "status-check";
    check.innerHTML = "&#10003;";
    optWrap.appendChild(cb);
    optWrap.appendChild(dot);
    optWrap.appendChild(txt);
    optWrap.appendChild(check);
    options.appendChild(optWrap);
  });

  wrap.appendChild(pill);
  wrap.appendChild(options);
  td.appendChild(wrap);
  return td;
}

function makeDateCell(value, label, onChange){
  const td = document.createElement('td');
  td.setAttribute('data-label', label);
  const field = makeDatePillField({
    value: isISODate(value) ? value : "",
    label: label || "Date",
    onChange: onChange
  });
  td.appendChild(field);
  return td;
}

function makeTimeCell(value, label, onChange){
  const td = document.createElement('td');
  td.setAttribute('data-label', label);
  const field = makeTimePillField({
    value: isHHMM(value) ? value : "",
    label: label || "Time",
    onChange: onChange
  });
  td.appendChild(field);
  return td;
}

function makeCell(value, label, onChange, useTextarea, placeholder){
  const td = document.createElement('td');
  td.setAttribute('data-label', label);
  const el = document.createElement(useTextarea ? 'textarea' : 'input');
  if(!useTextarea) el.type = "text";
  el.value = value;
  if(placeholder) el.placeholder = placeholder;
  el.oninput = (e) => { onChange(e.target.value); if(useTextarea) growIfFocused(el); };
  if(useTextarea){
    el.rows = 1;
    el.addEventListener('focus', () => { el.style.maxHeight = el.scrollHeight + 'px'; });
    el.addEventListener('blur', () => { el.style.maxHeight = ''; });
  }
  td.appendChild(el);
  return td;
}

// While a textarea cell is focused and the person keeps typing, keep
// growing its max-height to match content so nothing gets clipped
// mid-edit. Only runs while the element still has focus.
function growIfFocused(el){
  if(document.activeElement !== el) return;
  el.style.maxHeight = 'none';
  el.style.maxHeight = el.scrollHeight + 'px';
}

// initial paint: build the My Plans content in the background, but land on Home
renderTabs();
renderBoard();
renderSettings();
if(autosaveEnabled){ doSave(); } else { updateSaveStatus(); }
showView('home');
