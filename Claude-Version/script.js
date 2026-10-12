'use strict';
/* InvoiceFlow - vanilla JS. Sections: 1 data, 2 money, 3 invoice logic, 4 UI helpers,
   5 views, 6 PDF/print, 7 reminders/export/import, 8 events. */

/* ---------- 1. DATA (localStorage) ---------- */
const KEY = 'invoiceflow.v1';
const CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN', 'CAD', 'AUD', 'ZAR', 'GHS', 'KES', 'INR', 'JPY'];
const STATUSES = ['Draft', 'Sent', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled'];
let corrupt = false;
let db = loadDB();

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

function emptyDB() { return { profile: {}, clients: [], invoices: [], seqs: {} }; }
function validDB(d) {
  const o = x => x && typeof x === 'object' && !Array.isArray(x);
  return o(d) && o(d.profile) && o(d.seqs) && Array.isArray(d.clients) && Array.isArray(d.invoices) &&
    d.clients.every(c => o(c) && c.id && typeof c.name === 'string') &&
    d.invoices.every(i => o(i) && i.id && typeof i.number === 'string' && CURRENCIES.includes(i.currency) &&
      Array.isArray(i.items) && i.items.every(o) && Array.isArray(i.payments) &&
      i.payments.every(p => o(p) && Number.isInteger(p.amt)) && typeof i.issue === 'string' && typeof i.due === 'string');
}
function loadDB() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return emptyDB();
  try { const d = JSON.parse(raw); if (validDB(d)) return d; } catch (e) { /* fall through */ }
  corrupt = true;
  try { localStorage.setItem(KEY + '.corrupt-backup', raw); } catch (e) { /* ignore */ }
  return emptyDB();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); return true; }
  catch (e) { toast('Could not save: browser storage is full or blocked. Export a backup and free space.', true); return false; }
}
/* Serial numbers: the per-year counter only ever increases, so numbers are never reused. */
function nextNumber() {
  const y = String(new Date().getFullYear());
  let n = (db.seqs[y] || 0) + 1;
  const used = new Set(db.invoices.map(i => i.number));
  while (used.has(`INV-${y}-${String(n).padStart(6, '0')}`)) n++;
  db.seqs[y] = n;
  return `INV-${y}-${String(n).padStart(6, '0')}`;
}

/* ---------- 2. MONEY (integer minor units) ---------- */
const decs = c => (c === 'JPY' ? 0 : 2);
const toMinor = (v, c) => Math.round(Number(String(v) + 'e' + decs(c)));
/* Returns minor units, or null if not a plain non-negative number with allowed decimals. */
function parseMoney(v, c) {
  const s = String(v).trim();
  if (!/^\d+(\.\d+)?$/.test(s) || (s.split('.')[1] || '').length > decs(c)) return null;
  return toMinor(s, c);
}
const money = (m, c, code) => {
  const t = new Intl.NumberFormat(undefined, { style: 'currency', currency: c, currencyDisplay: code ? 'code' : 'symbol' }).format(m / 10 ** decs(c));
  return code ? t.replace(/\u00a0/g, ' ') : t;
};
const plain = (m, c) => (m / 10 ** decs(c)).toFixed(decs(c));

/* ---------- 3. INVOICE LOGIC ---------- */
function calc(i) {
  const c = i.currency;
  const lines = i.items.map(x => Math.round((Number(x.q) || 0) * toMinor(Number(x.p) || 0, c)));
  const sub = lines.reduce((a, b) => a + b, 0);
  const dv = Number(i.discVal) || 0;
  const disc = Math.min(Math.max(i.discType === 'pct' ? Math.round(sub * dv / 100) : toMinor(dv, c), 0), sub);
  const tax = Math.round((sub - disc) * (Number(i.taxRate) || 0) / 100);
  return { lines, sub, disc, tax, total: sub - disc + tax };
}
const paidOf = i => i.payments.reduce((a, p) => a + p.amt, 0);
const todayISO = () => iso(new Date());
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00'));
const fd = s => (validDate(s) ? new Date(s + 'T00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

function status(i) {
  if (i.stat === 'Cancelled') return 'Cancelled';
  const t = calc(i).total, p = paidOf(i);
  if (t > 0 && p >= t) return 'Paid';
  if (i.stat === 'Draft' && p === 0) return 'Draft';
  if (i.due < todayISO()) return 'Overdue';
  return p > 0 ? 'Partially Paid' : 'Sent';
}
function validate(i) {
  const e = [], c = i.currency;
  if (!i.clientId || !db.clients.find(x => x.id === i.clientId)) e.push('Choose a client.');
  if (!validDate(i.issue)) e.push('Issue date is not a valid date.');
  if (!validDate(i.due)) e.push('Due date is not a valid date.');
  else if (validDate(i.issue) && i.due < i.issue) e.push('Due date cannot be earlier than the issue date.');
  if (!i.items.length) e.push('Add at least one line item.');
  i.items.forEach((x, n) => {
    const k = `Line ${n + 1}: `;
    if (!x.d.trim()) e.push(k + 'description is required.');
    if (!(Number(x.q) > 0) || !isFinite(Number(x.q))) e.push(k + 'quantity must be greater than zero.');
    if (parseMoney(x.p, c) === null) e.push(k + `unit price must be a non-negative number with at most ${decs(c)} decimals.`);
  });
  const dv = String(i.discVal).trim();
  if (dv !== '') {
    if (!/^\d+(\.\d+)?$/.test(dv)) e.push('Discount must be a non-negative number.');
    else if (i.discType === 'pct' && Number(dv) > 100) e.push('Discount percentage cannot exceed 100.');
    else if (i.discType === 'fix' && parseMoney(dv, c) === null) e.push(`Discount amount can have at most ${decs(c)} decimals.`);
  }
  const tr = String(i.taxRate).trim();
  if (tr !== '' && (!/^\d+(\.\d+)?$/.test(tr) || Number(tr) > 100)) e.push('Tax rate must be a number from 0 to 100.');
  if (!e.length) {
    const k = calc(i);
    if (i.discType === 'fix' && toMinor(dv || 0, c) > k.sub) e.push('Discount cannot exceed the subtotal.');
    if (k.total < paidOf(i)) e.push('Total cannot be lower than payments already recorded.');
  }
  return e;
}

/* ---------- 4. UI HELPERS ---------- */
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast ' + (err ? 'err' : 'ok'); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 4500);
}
function confirmBox(msg) {
  return new Promise(res => { const d = $('#dlg'); $('#dlg-msg').textContent = msg; d.returnValue = ''; d.onclose = () => res(d.returnValue === 'ok'); d.showModal(); });
}
const view = $('#view');
const fld = (label, name, val = '', type = 'text', extra = '') => `<label class="lbl">${label}<input class="input" name="${name}" type="${type}" value="${esc(val)}" ${extra}></label>`;
const area = (label, name, val = '', rows = 3) => `<label class="lbl">${label}<textarea class="input" name="${name}" rows="${rows}">${esc(val)}</textarea></label>`;
const curSelect = (name, val) => `<select class="input" name="${name}">${CURRENCIES.map(c => `<option ${c === val ? 'selected' : ''}>${c}</option>`).join('')}</select>`;
const badge = s => `<span class="badge ${s.split(' ')[0]}">${s}</span>`;
const emptyState = (t, d) => `<div class="text-center py-8"><p class="font-semibold">${t}</p><p class="muted">${d}</p></div>`;
const errBox = l => (l.length ? `<ul>${l.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
const emailOk = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/* ---------- 5. VIEWS ---------- */
const routes = { dashboard: vDash, clients: vClients, profile: vProfile, data: vData, invoice: vInvoice };
function route() {
  const p = (location.hash.slice(2) || 'dashboard').split('/');
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === (p[0] === 'invoice' ? 'dashboard' : p[0])));
  (routes[p[0]] || vDash)(p);
  window.scrollTo(0, 0);
}

/* Dashboard */
const flt = { q: '', s: '' };
function vDash() {
  const T = {}; let overdue = 0;
  db.invoices.forEach(i => {
    const s = status(i); if (s === 'Cancelled' || s === 'Draft') return;
    const c = i.currency, k = calc(i), p = Math.min(paidOf(i), k.total);
    T[c] = T[c] || { inv: 0, paid: 0, out: 0 };
    T[c].inv += k.total; T[c].paid += p; T[c].out += k.total - p;
    if (s === 'Overdue') overdue++;
  });
  const cur = Object.keys(T);
  const col = (label, key) => `<div class="card"><p class="muted">${label}</p>${cur.length ? cur.map(c => `<p class="text-lg font-semibold">${esc(money(T[c][key], c))}</p>`).join('') : '<p class="text-lg font-semibold">0</p>'}</div>`;
  view.innerHTML = `<h1 class="h1">Dashboard</h1>
  ${corrupt ? '<div class="err card mb-4">Saved data could not be read, so the app started empty. A copy of the unreadable data was kept in your browser under "invoiceflow.v1.corrupt-backup".</div>' : ''}
  ${!db.profile.name ? '<div class="card mb-4">Set up your <a class="text-blue-700 underline" href="#/profile">business profile</a> so it appears on invoices.</div>' : ''}
  <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-2">
    <div class="card"><p class="muted">Total invoices</p><p class="text-lg font-semibold">${db.invoices.length}</p></div>
    ${col('Total invoiced', 'inv')}${col('Total paid', 'paid')}${col('Outstanding', 'out')}
    <div class="card"><p class="muted">Overdue invoices</p><p class="text-lg font-semibold">${overdue}</p></div>
  </div>
  <p class="muted mb-6">Amounts are listed per currency and never converted. Drafts and cancelled invoices are excluded from money totals.</p>
  <section class="card"><h2 class="h2">Invoices</h2>
    <div class="grid sm:grid-cols-2 gap-3 mb-3">
      <label class="lbl">Search by invoice number or client<input id="q" class="input" value="${esc(flt.q)}"></label>
      <label class="lbl">Status<select id="s" class="input"><option value="">All statuses</option>${STATUSES.map(s => `<option ${s === flt.s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    </div><div id="list" class="tblwrap"></div></section>`;
  drawList();
}
function drawList() {
  const q = flt.q.toLowerCase();
  const L = db.invoices.slice().reverse().filter(i => (!flt.s || status(i) === flt.s) && (!q || `${i.number} ${i.client?.name || ''}`.toLowerCase().includes(q)));
  $('#list').innerHTML = L.length ? `<table class="tbl"><thead><tr><th>Number</th><th>Client</th><th>Due</th><th>Total</th><th>Balance</th><th>Status</th></tr></thead><tbody>${L.map(i => {
    const k = calc(i), s = status(i);
    return `<tr><td><a class="text-blue-700 underline" href="#/invoice/${i.id}">${esc(i.number)}</a></td><td>${esc(i.client?.name)}</td><td>${fd(i.due)}</td><td>${esc(money(k.total, i.currency))}</td><td>${s === 'Cancelled' ? '-' : esc(money(Math.max(k.total - paidOf(i), 0), i.currency))}</td><td>${badge(s)}</td></tr>`;
  }).join('')}</tbody></table>` : (db.invoices.length ? emptyState('No matching invoices', 'Change the search or status filter.') : emptyState('No invoices yet', 'Create your first invoice with the New invoice button.'));
}

/* Clients */
let cSel = null, cEdit = null;
function vClients() {
  const c = db.clients.find(x => x.id === cEdit) || {};
  const sel = db.clients.find(x => x.id === cSel);
  view.innerHTML = `<h1 class="h1">Clients</h1><div class="grid lg:grid-cols-3 gap-6">
  <section class="card lg:col-span-2 tblwrap">${db.clients.length ? `<table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Actions</th></tr></thead><tbody>${db.clients.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td>
    <button class="linkbtn" data-act="viewClient" data-id="${x.id}">View</button><button class="linkbtn" data-act="editClient" data-id="${x.id}">Edit</button><button class="linkbtn del" data-act="delClient" data-id="${x.id}">Delete</button></td></tr>`).join('')}</tbody></table>` : emptyState('No clients yet', 'Add a client using the form.')}</section>
  <section class="card"><h2 class="h2">${cEdit ? 'Edit client' : 'Add client'}</h2><form data-form="client" novalidate>
    <input type="hidden" name="id" value="${esc(c.id || '')}">
    ${fld('Name or business name *', 'name', c.name)}${fld('Email', 'email', c.email, 'email')}${fld('Phone', 'phone', c.phone, 'tel')}
    ${area('Billing address', 'address', c.address)}${area('Notes (optional)', 'notes', c.notes, 2)}
    <div class="err" role="alert"></div><button class="btn">Save client</button>
    ${cEdit ? '<button type="button" class="btn-secondary ml-2" data-act="cancelClientEdit">Cancel</button>' : ''}</form></section></div>
  ${sel ? `<section class="card mt-6"><h2 class="h2">${esc(sel.name)}</h2><p class="pre">${esc([sel.email, sel.phone, sel.address].filter(Boolean).join('\n'))}</p>${sel.notes ? `<p class="muted pre mt-2">Notes: ${esc(sel.notes)}</p>` : ''}
    <p class="mt-3 font-semibold text-sm">Invoices</p>${db.invoices.filter(i => i.clientId === sel.id).map(i => `<a class="text-blue-700 underline text-sm block" href="#/invoice/${i.id}">${esc(i.number)}</a>`).join('') || '<p class="muted">None yet.</p>'}</section>` : ''}`;
}
const forms = {
  client(f) {
    const d = Object.fromEntries(new FormData(f)), err = $('.err', f), e = [];
    d.name = d.name.trim(); d.email = d.email.trim();
    if (!d.name) e.push('Name is required.');
    if (d.email && !emailOk(d.email)) e.push('Email address is not valid.');
    if (e.length) { err.innerHTML = errBox(e); return; }
    if (d.id) Object.assign(db.clients.find(x => x.id === d.id), d); else db.clients.push({ ...d, id: uid() });
    if (!save()) return;
    cEdit = null; toast('Client saved.'); vClients();
  },
  profile(f) {
    const d = Object.fromEntries(new FormData(f)), err = $('.err', f), e = [];
    if (!d.name.trim()) e.push('Business or freelancer name is required.');
    if (!emailOk(d.email.trim())) e.push('A valid email address is required.');
    if (d.website.trim() && !/^https?:\/\/\S+$/i.test(d.website.trim())) e.push('Website must start with http:// or https://');
    if (e.length) { err.innerHTML = errBox(e); return; }
    const logo = logoTmp !== undefined ? logoTmp : db.profile.logo;
    db.profile = { ...d, logo };
    if (save()) { err.innerHTML = ''; toast('Profile saved.'); }
  },
  payment(f) {
    const inv = db.invoices.find(x => x.id === f.dataset.id), d = Object.fromEntries(new FormData(f)), err = $('.err', f);
    const amt = parseMoney(d.amt, inv.currency), bal = calc(inv).total - paidOf(inv), e = [];
    if (!validDate(d.date)) e.push('Payment date is not valid.');
    if (amt === null || amt <= 0) e.push('Enter an amount greater than zero (max ' + decs(inv.currency) + ' decimals).');
    else if (amt > bal) e.push(`Amount exceeds the outstanding balance of ${money(bal, inv.currency)}.`);
    if (e.length) { err.innerHTML = errBox(e); return; }
    inv.payments.push({ id: uid(), date: d.date, amt, ref: d.ref.trim(), notes: d.notes.trim() });
    if (save()) { toast('Payment recorded.'); vInvoice(['invoice', inv.id]); }
  }
};

/* Business profile */
let logoTmp;
function vProfile() {
  const p = db.profile; logoTmp = undefined;
  view.innerHTML = `<h1 class="h1">Business profile</h1><section class="card max-w-2xl"><form data-form="profile" novalidate>
    ${fld('Business or freelancer name *', 'name', p.name)}${fld('Email *', 'email', p.email, 'email')}${fld('Phone', 'phone', p.phone, 'tel')}
    ${area('Business address', 'address', p.address)}${fld('Website', 'website', p.website, 'url', 'placeholder="https://"')}
    <label class="lbl">Default currency ${curSelect('currency', p.currency || 'USD')}</label>
    ${area('Default payment instructions', 'payInstr', p.payInstr)}
    <label class="lbl">Logo (PNG or JPG, max 500 KB)<input id="logo" type="file" accept="image/png,image/jpeg" class="input"></label>
    <div id="logo-prev">${p.logo ? `<img src="${esc(p.logo)}" alt="Current logo" style="max-height:60px"> <button type="button" class="linkbtn del" data-act="rmLogo">Remove logo</button>` : ''}</div>
    <div class="err" role="alert"></div><button class="btn">Save profile</button></form></section>`;
}
function onLogo(input) {
  const f = input.files[0]; if (!f) return;
  if (!['image/png', 'image/jpeg'].includes(f.type)) { toast('Logo must be a PNG or JPG image.', true); input.value = ''; return; }
  if (f.size > 500 * 1024) { toast('Logo is larger than 500 KB. Choose a smaller file.', true); input.value = ''; return; }
  const r = new FileReader();
  r.onload = () => { logoTmp = r.result; $('#logo-prev').innerHTML = `<img src="${esc(r.result)}" alt="New logo preview" style="max-height:60px"> <span class="muted">Save the profile to keep it.</span>`; };
  r.onerror = () => toast('Could not read the logo file.', true);
  r.readAsDataURL(f);
}

/* Invoice editor */
let D = null;
function newDraft() {
  const p = db.profile, t = new Date(), due = new Date(t.getTime() + 14 * 864e5);
  return { id: null, number: null, clientId: '', issue: iso(t), due: iso(due), desc: '', currency: p.currency || 'USD', items: [{ d: '', q: '1', p: '' }], discType: 'pct', discVal: '', taxLabel: 'Tax', taxRate: '', payInstr: p.payInstr || '', notes: '', stat: 'Draft', payments: [] };
}
function vInvoice(p) {
  if (p[1] === 'new' || p[2] === 'edit') {
    const ex = db.invoices.find(i => i.id === p[1]);
    if (p[1] !== 'new' && (!ex || ex.stat === 'Cancelled')) { toast('That invoice cannot be edited.', true); location.hash = '#/dashboard'; return; }
    D = ex ? JSON.parse(JSON.stringify(ex)) : newDraft();
    return editor();
  }
  const inv = db.invoices.find(i => i.id === p[1]);
  if (!inv) { view.innerHTML = '<div class="card">' + emptyState('Invoice not found', '<a class="underline" href="#/dashboard">Back to dashboard</a>') + '</div>'; return; }
  detail(inv);
}
function editor() {
  if (!db.clients.length) { view.innerHTML = `<div class="card">${emptyState('Add a client first', 'Invoices need a client. <a class="underline text-blue-700" href="#/clients">Go to Clients</a>')}</div>`; return; }
  view.innerHTML = `<h1 class="h1">${D.id ? 'Edit invoice ' + esc(D.number) : 'New invoice'}</h1>
  <div class="grid lg:grid-cols-2 gap-6"><section class="card"><form id="ie" novalidate>
    <label class="lbl">Client *<select class="input" name="clientId"><option value="">Select a client</option>${db.clients.map(c => `<option value="${c.id}" ${c.id === D.clientId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <div class="grid grid-cols-2 gap-3">${fld('Issue date *', 'issue', D.issue, 'date')}${fld('Due date *', 'due', D.due, 'date')}</div>
    ${fld('Description', 'desc', D.desc)}
    <label class="lbl">Currency (changes display only, never converts amounts)${curSelect('currency', D.currency)}</label>
    <p class="font-semibold text-sm mb-2">Line items</p><div id="rows"></div>
    <button type="button" class="btn-secondary mb-4" data-act="addItem">Add line item</button>
    <div class="grid grid-cols-2 gap-3"><label class="lbl">Discount type<select class="input" name="discType"><option value="pct" ${D.discType === 'pct' ? 'selected' : ''}>Percent</option><option value="fix" ${D.discType === 'fix' ? 'selected' : ''}>Fixed amount</option></select></label>${fld('Discount (optional)', 'discVal', D.discVal, 'text', 'inputmode="decimal"')}</div>
    <div class="grid grid-cols-2 gap-3">${fld('Tax label (user-entered)', 'taxLabel', D.taxLabel)}${fld('Tax rate % (optional)', 'taxRate', D.taxRate, 'text', 'inputmode="decimal"')}</div>
    ${area('Payment instructions', 'payInstr', D.payInstr)}${area('Notes (optional)', 'notes', D.notes, 2)}
    <div class="err" id="ierr" role="alert"></div>
    <button class="btn" data-act="saveInv" type="button">Save invoice</button>
    <a class="btn-secondary ml-2" href="#/dashboard">Cancel</a></form></section>
  <section><p class="muted mb-2">Live preview. Tax is whatever you enter; InvoiceFlow does not check tax rules.</p><div class="card p-0 overflow-hidden" id="prev"></div></section></div>`;
  drawRows(); drawPrev();
}
function drawRows() {
  $('#rows').innerHTML = D.items.map((x, n) => `<div class="row grid grid-cols-12 gap-2 items-end mb-2">
    <label class="lbl col-span-12 sm:col-span-5 mb-0">Description<input class="input d" value="${esc(x.d)}"></label>
    <label class="lbl col-span-4 sm:col-span-2 mb-0">Qty<input class="input q" inputmode="decimal" value="${esc(x.q)}"></label>
    <label class="lbl col-span-5 sm:col-span-3 mb-0">Unit price<input class="input p" inputmode="decimal" value="${esc(x.p)}"></label>
    <button type="button" class="btn-secondary col-span-3 sm:col-span-2" data-act="rmItem" data-id="${n}" ${D.items.length < 2 ? 'disabled' : ''}>Remove</button></div>`).join('');
}
function sync() {
  const f = $('#ie'), g = n => f.elements[n].value;
  ['clientId', 'issue', 'due', 'desc', 'currency', 'discType', 'discVal', 'taxLabel', 'taxRate', 'payInstr', 'notes'].forEach(n => { D[n] = g(n); });
  D.items = $$('.row').map(r => ({ d: $('.d', r).value, q: $('.q', r).value, p: $('.p', r).value }));
  D.client = db.clients.find(c => c.id === D.clientId) || null;
  drawPrev();
}
function drawPrev() { D.client = db.clients.find(c => c.id === D.clientId) || null; $('#prev').innerHTML = invoiceHTML(D, true); }
function saveInv() {
  sync();
  const e = validate(D);
  if (e.length) { $('#ierr').innerHTML = errBox(e); $('#ierr').scrollIntoView({ block: 'nearest' }); return; }
  const rec = JSON.parse(JSON.stringify(D)); rec.client = { ...D.client };
  if (rec.id) db.invoices[db.invoices.findIndex(i => i.id === rec.id)] = rec;
  else { rec.id = uid(); rec.number = nextNumber(); db.invoices.push(rec); }
  if (!save()) return;
  toast('Invoice ' + rec.number + ' saved.'); location.hash = '#/invoice/' + rec.id;
}

/* Invoice document (used for preview, saved view, print) */
function invoiceHTML(i, showSerial) {
  const b = db.profile, c = i.client || {}, k = calc(i), cur = i.currency, m = v => esc(money(v, cur));
  const logo = b.logo && /^data:image\//.test(b.logo) ? `<img class="logo" src="${esc(b.logo)}" alt="">` : '';
  const sec = (t, v) => (v && String(v).trim() ? `<div class="sec"><b>${t}</b><div class="pre">${esc(v)}</div></div>` : '');
  return `<div class="inv"><div class="head"><div>${logo}<h2>${esc(b.name || 'Your business name')}</h2><div class="pre">${esc([b.address, b.email, b.phone, b.website].filter(Boolean).join('\n'))}</div></div>
  <div class="r"><h1>INVOICE</h1>${showSerial ? `<div class="serial"><b>${esc(i.number || 'Number assigned on save')}</b></div>` : ''}<div>Issued: ${fd(i.issue)}</div><div>Due: ${fd(i.due)}</div><div>Currency: ${esc(cur)}</div></div></div>
  ${sec('Bill to', [c.name, c.address, c.email, c.phone].filter(Boolean).join('\n'))}${sec('Description', i.desc)}
  <table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">Amount</th></tr></thead><tbody>${i.items.map((x, n) => `<tr><td class="pre">${esc(x.d)}</td><td class="n">${esc(x.q)}</td><td class="n">${m(toMinor(Number(x.p) || 0, cur))}</td><td class="n">${m(k.lines[n])}</td></tr>`).join('')}</tbody></table>
  <div class="tot"><div><span>Subtotal</span><span>${m(k.sub)}</span></div>${k.disc ? `<div><span>Discount</span><span>-${m(k.disc)}</span></div>` : ''}${k.tax ? `<div><span>${esc(i.taxLabel || 'Tax')} (${esc(i.taxRate)}%)</span><span>${m(k.tax)}</span></div>` : ''}<div class="grand"><span>Total due (${esc(cur)})</span><span>${m(k.total)}</span></div></div>
  ${sec('Payment instructions', i.payInstr)}${sec('Notes', i.notes)}</div>`;
}

/* Saved invoice detail + payments + reminders */
let printSerial = false;
function detail(inv) {
  const k = calc(inv), s = status(inv), paid = paidOf(inv), bal = k.total - paid, cur = inv.currency;
  view.innerHTML = `<div class="flex flex-wrap items-center gap-3 mb-4"><h1 class="h1 mb-0">${esc(inv.number)}</h1>${badge(s)}</div>
  <div class="flex flex-wrap gap-2 mb-4">
    ${s !== 'Cancelled' ? `<a class="btn-secondary" href="#/invoice/${inv.id}/edit">Edit</a>` : ''}
    ${inv.stat === 'Draft' ? `<button class="btn-secondary" data-act="markSent" data-id="${inv.id}">Mark as sent</button>` : ''}
    <button class="btn-secondary" data-act="dup" data-id="${inv.id}">Duplicate</button>
    ${s !== 'Cancelled' ? `<button class="btn-secondary" data-act="cancelInv" data-id="${inv.id}">Cancel invoice</button>` : ''}
    <button class="btn-secondary" data-act="delInv" data-id="${inv.id}">Delete</button>
    <button class="btn" data-act="pdf" data-id="${inv.id}">Download PDF</button>
    <button class="btn" data-act="print" data-id="${inv.id}">Print invoice</button></div>
  <label class="muted block mb-4"><input type="checkbox" id="serialchk" ${printSerial ? 'checked' : ''}> Include invoice serial number when printing</label>
  <div class="grid lg:grid-cols-2 gap-6"><div class="card p-0 overflow-hidden">${invoiceHTML(inv, true)}</div>
  <div class="space-y-6">
   <section class="card"><h2 class="h2">Payments</h2><p class="mb-2">Paid ${esc(money(Math.min(paid, k.total), cur))} of ${esc(money(k.total, cur))}. Balance: <b>${esc(money(s === 'Cancelled' ? 0 : Math.max(bal, 0), cur))}</b></p>
    ${inv.payments.length ? `<div class="tblwrap"><table class="tbl"><tbody>${inv.payments.map(p => `<tr><td>${fd(p.date)}</td><td>${esc(money(p.amt, cur))}</td><td>${esc(p.ref)} ${esc(p.notes)}</td><td><button class="linkbtn del" data-act="delPay" data-id="${inv.id}|${p.id}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No payments recorded.</p>'}
    ${s !== 'Cancelled' && bal > 0 ? `<form data-form="payment" data-id="${inv.id}" class="mt-3" novalidate><div class="grid grid-cols-2 gap-3">${fld('Payment date', 'date', todayISO(), 'date')}${fld('Amount received', 'amt', '', 'text', 'inputmode="decimal"')}${fld('Reference (optional)', 'ref')}${fld('Notes (optional)', 'notes')}</div><div class="err" role="alert"></div><button class="btn">Record payment</button><p class="muted mt-2">Records only. No money is processed.</p></form>` : ''}</section>
   <section class="card"><h2 class="h2">Payment reminder</h2><label class="lbl">Template<select id="tpl" class="input"><option value="upcoming">Upcoming due date</option><option value="today">Payment due today</option><option value="overdue" ${s === 'Overdue' ? 'selected' : ''}>Overdue payment</option><option value="received" ${s === 'Paid' ? 'selected' : ''}>Payment received confirmation</option></select></label>
    <textarea id="msg" class="input" rows="9" aria-label="Reminder message"></textarea><button class="btn mt-2" data-act="copy">Copy message</button><p class="muted mt-2">InvoiceFlow does not send messages. Paste this into your own email or chat app.</p></section></div></div>`;
  view.dataset.inv = inv.id; fillMsg();
}
function fillMsg() {
  const inv = db.invoices.find(i => i.id === view.dataset.inv); if (!inv) return;
  const k = calc(inv), cur = inv.currency, bal = money(Math.max(k.total - paidOf(inv), 0), cur), who = inv.client?.name || 'there', me = db.profile.name || '';
  const days = Math.round((new Date(inv.due + 'T00:00') - new Date(todayISO() + 'T00:00')) / 864e5);
  const T = {
    upcoming: `Hi ${who},\n\nA friendly reminder that invoice ${inv.number} for ${bal} is due on ${fd(inv.due)}${days > 0 ? ` (in ${days} day${days === 1 ? '' : 's'})` : ''}.\n\nPlease let me know if you have any questions.\n\nThank you,\n${me}`,
    today: `Hi ${who},\n\nInvoice ${inv.number} for ${bal} is due today, ${fd(inv.due)}.\n\nThank you for taking care of it.\n\nBest regards,\n${me}`,
    overdue: `Hi ${who},\n\nOur records show invoice ${inv.number} (${bal} outstanding) was due on ${fd(inv.due)} and has not yet been paid. Could you please arrange payment or let me know if there is an issue?\n\nThank you,\n${me}`,
    received: `Hi ${who},\n\nThank you. I have received payment for invoice ${inv.number}. ${paidOf(inv) >= k.total ? 'The invoice is now paid in full.' : `The remaining balance is ${bal}.`}\n\nBest regards,\n${me}`
  };
  $('#msg').value = T[$('#tpl').value];
}

/* Backup view */
function vData() {
  view.innerHTML = `<h1 class="h1">Backup and export</h1><div class="grid md:grid-cols-2 gap-6">
  <section class="card"><h2 class="h2">Export</h2><div class="flex flex-col gap-2 items-start"><button class="btn-secondary" data-act="expInv">Invoices (CSV)</button><button class="btn-secondary" data-act="expCli">Clients (CSV)</button><button class="btn-secondary" data-act="expJSON">Full backup (JSON)</button></div>
  <p class="muted mt-3">Backups contain your profile, clients and invoices. Store them somewhere safe.</p></section>
  <section class="card"><h2 class="h2">Import backup</h2><label class="lbl">JSON backup file<input id="imp" type="file" accept="application/json,.json" class="input"></label><p class="muted">Importing replaces current data after you confirm. Invoice number history is kept so numbers are not reused.</p></section></div>`;
}
function download(name, text, type) {
  const a = document.createElement('a'), u = URL.createObjectURL(new Blob([text], { type }));
  a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000);
}
const csvCell = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n');
async function onImport(input) {
  const f = input.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!validDB(d)) throw new Error('shape');
    if (!await confirmBox('Importing will replace ALL current data in this browser. Continue?')) { input.value = ''; return; }
    const seqs = { ...d.seqs };
    [db.seqs, ...d.invoices.map(i => { const m = /^INV-(\d{4})-(\d+)$/.exec(i.number); return m ? { [m[1]]: Number(m[2]) } : {}; })].forEach(o => Object.entries(o).forEach(([y, n]) => { seqs[y] = Math.max(seqs[y] || 0, Number(n) || 0); }));
    const old = db; db = { profile: d.profile, clients: d.clients, invoices: d.invoices, seqs };
    if (!save()) { db = old; return; }
    toast('Backup imported.'); location.hash = '#/dashboard'; route();
  } catch (e) { toast('Import failed: this is not a valid InvoiceFlow backup. Nothing was changed.', true); input.value = ''; }
}

/* ---------- 6. PDF and PRINT ---------- */
function makePDF(i) {
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('The PDF library did not load. Check your internet connection and reload.');
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' }), b = db.profile, k = calc(i), c = i.client || {}, cur = i.currency, m = v => money(v, cur, true);
    let y = 14;
    if (b.logo && /^data:image\/(png|jpeg)/.test(b.logo)) { try { doc.addImage(b.logo, b.logo.includes('png') ? 'PNG' : 'JPEG', 14, y, 18, 18); y += 22; } catch (e) { /* skip bad logo */ } }
    doc.setFontSize(14).setFont(undefined, 'bold').text(b.name || 'Business', 14, y + 4);
    doc.setFontSize(9).setFont(undefined, 'normal');
    const bl = doc.splitTextToSize([b.address, b.email, b.phone, b.website].filter(Boolean).join('\n'), 90); doc.text(bl, 14, y + 10);
    doc.setFontSize(20).setTextColor(29, 78, 216).text('INVOICE', 196, 18, { align: 'right' });
    doc.setFontSize(10).setTextColor(0).text([i.number, 'Issued: ' + fd(i.issue), 'Due: ' + fd(i.due), 'Currency: ' + cur], 196, 25, { align: 'right' });
    y = Math.max(y + 10 + bl.length * 4.2, 48) + 4;
    doc.setFont(undefined, 'bold').text('Bill to', 14, y); doc.setFont(undefined, 'normal');
    const cl = doc.splitTextToSize([c.name, c.address, c.email, c.phone].filter(Boolean).join('\n'), 90); doc.text(cl, 14, y + 5); y += 8 + cl.length * 4.5;
    if (i.desc) { const dl = doc.splitTextToSize(i.desc, 182); doc.text(dl, 14, y); y += dl.length * 4.5 + 2; }
    doc.autoTable({ startY: y, head: [['Item', 'Qty', 'Unit price', 'Amount']], headStyles: { fillColor: [37, 99, 235] }, styles: { fontSize: 9, overflow: 'linebreak' },
      columnStyles: { 0: { cellWidth: 90 }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      body: i.items.map((x, n) => [x.d, x.q, m(toMinor(Number(x.p) || 0, cur)), m(k.lines[n])]) });
    const rows = [['Subtotal', m(k.sub)]]; if (k.disc) rows.push(['Discount', '-' + m(k.disc)]); if (k.tax) rows.push([`${i.taxLabel || 'Tax'} (${i.taxRate}%)`, m(k.tax)]); rows.push(['Total due', m(k.total)]);
    doc.autoTable({ startY: doc.lastAutoTable.finalY + 4, body: rows, theme: 'plain', margin: { left: 110 }, styles: { fontSize: 10 }, columnStyles: { 1: { halign: 'right' } }, didParseCell: d => { if (d.row.index === rows.length - 1) d.cell.styles.fontStyle = 'bold'; } });
    y = doc.lastAutoTable.finalY + 8;
    [['Payment instructions', i.payInstr], ['Notes', i.notes]].forEach(([t, v]) => {
      if (!v || !v.trim()) return;
      const ln = doc.splitTextToSize(v, 182); if (y + 6 + ln.length * 4.5 > 285) { doc.addPage(); y = 20; }
      doc.setFont(undefined, 'bold').text(t, 14, y); doc.setFont(undefined, 'normal').text(ln, 14, y + 5); y += 9 + ln.length * 4.5;
    });
    doc.save(`Invoice-${i.number}.pdf`); toast('PDF downloaded.');
  } catch (e) { toast('PDF could not be created: ' + e.message, true); }
}
function printInv(i) {
  $('#print-area').innerHTML = invoiceHTML(i, printSerial); /* serial is left out of the markup entirely when unchecked */
  const t = document.title; document.title = printSerial ? i.number : 'Invoice';
  window.addEventListener('afterprint', () => { document.title = t; $('#print-area').innerHTML = ''; }, { once: true });
  window.print();
}

/* ---------- 7/8. ACTIONS and EVENTS ---------- */
const byId = id => db.invoices.find(i => i.id === id);
const acts = {
  viewClient(id) { cSel = id; vClients(); },
  editClient(id) { cEdit = id; vClients(); },
  cancelClientEdit() { cEdit = null; vClients(); },
  async delClient(id) {
    const n = db.invoices.filter(i => i.clientId === id).length;
    if (!await confirmBox(`Delete this client?${n ? ` Their ${n} invoice(s) will be kept.` : ''}`)) return;
    db.clients = db.clients.filter(c => c.id !== id); if (cSel === id) cSel = null;
    if (save()) { toast('Client deleted.'); vClients(); }
  },
  rmLogo() { logoTmp = null; $('#logo-prev').innerHTML = '<span class="muted">Logo will be removed when you save.</span>'; },
  addItem() { sync(); D.items.push({ d: '', q: '1', p: '' }); drawRows(); drawPrev(); },
  rmItem(n) { sync(); D.items.splice(Number(n), 1); drawRows(); drawPrev(); },
  saveInv,
  markSent(id) { byId(id).stat = 'Sent'; if (save()) { toast('Marked as sent (recorded manually).'); detail(byId(id)); } },
  dup(id) {
    const s = byId(id), c = JSON.parse(JSON.stringify(s)), t = new Date();
    Object.assign(c, { id: uid(), number: nextNumber(), stat: 'Draft', payments: [], issue: iso(t), due: iso(new Date(t.getTime() + 14 * 864e5)) });
    db.invoices.push(c); if (save()) { toast('Duplicated as ' + c.number); location.hash = '#/invoice/' + c.id; }
  },
  async cancelInv(id) { if (!await confirmBox('Cancel this invoice? Its number stays reserved and it stops counting as outstanding.')) return; byId(id).stat = 'Cancelled'; if (save()) { toast('Invoice cancelled.'); detail(byId(id)); } },
  async delInv(id) {
    if (!await confirmBox('Delete this invoice permanently? Its number will never be reused.')) return;
    db.invoices = db.invoices.filter(i => i.id !== id); if (save()) { toast('Invoice deleted.'); location.hash = '#/dashboard'; }
  },
  async delPay(v) {
    const [id, pid] = v.split('|'); if (!await confirmBox('Remove this payment record?')) return;
    const i = byId(id); i.payments = i.payments.filter(p => p.id !== pid); if (save()) detail(i);
  },
  pdf(id) { makePDF(byId(id)); },
  print(id) { printInv(byId(id)); },
  async copy() {
    const t = $('#msg');
    try { await navigator.clipboard.writeText(t.value); toast('Message copied.'); }
    catch (e) { t.select(); toast(document.execCommand && document.execCommand('copy') ? 'Message copied.' : 'Copy failed. Select the text and copy it manually.', false); }
  },
  expInv() {
    const r = [['Invoice number', 'Client', 'Issue date', 'Due date', 'Currency', 'Status', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Balance']];
    db.invoices.forEach(i => { const k = calc(i), c = i.currency, p = paidOf(i); r.push([i.number, i.client?.name, i.issue, i.due, c, status(i), plain(k.sub, c), plain(k.disc, c), plain(k.tax, c), plain(k.total, c), plain(p, c), plain(status(i) === 'Cancelled' ? 0 : k.total - p, c)]); });
    download('invoices.csv', csv(r), 'text/csv'); toast('Invoices exported.');
  },
  expCli() { download('clients.csv', csv([['Name', 'Email', 'Phone', 'Address', 'Notes'], ...db.clients.map(c => [c.name, c.email, c.phone, c.address, c.notes])]), 'text/csv'); toast('Clients exported.'); },
  expJSON() { download('invoiceflow-backup-' + todayISO() + '.json', JSON.stringify(db, null, 2), 'application/json'); toast('Backup downloaded.'); }
};
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && acts[b.dataset.act]) acts[b.dataset.act](b.dataset.id, b); });
document.addEventListener('submit', e => { e.preventDefault(); const f = forms[e.target.dataset.form]; if (f) f(e.target); });
document.addEventListener('input', e => {
  if (e.target.closest('#ie')) sync();
  else if (e.target.id === 'q') { flt.q = e.target.value; drawList(); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 's') { flt.s = t.value; drawList(); }
  else if (t.id === 'logo') onLogo(t);
  else if (t.id === 'imp') onImport(t);
  else if (t.id === 'serialchk') printSerial = t.checked;
  else if (t.id === 'tpl') fillMsg();
  else if (t.closest('#ie')) sync();
});
window.addEventListener('hashchange', route);
route();
