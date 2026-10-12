// InvoiceFlow - International Freelancer Invoice Generator
// Data persistence via localStorage. All calculations client-side.
// No backend, no payments processing.

const STORAGE_KEYS = {
  BUSINESS: 'invoiceflow_business',
  CLIENTS: 'invoiceflow_clients',
  INVOICES: 'invoiceflow_invoices',
  SERIAL: 'invoiceflow_serial_counters'
};

const CURRENCIES = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'NGN', name: 'Nigerian Naira' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'ZAR', name: 'South African Rand' },
  { code: 'GHS', name: 'Ghanaian Cedi' },
  { code: 'KES', name: 'Kenyan Shilling' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'JPY', name: 'Japanese Yen' }
];

let appData = {
  business: null,
  clients: [],
  invoices: [],
  serialCounters: {}
};

let currentEditingInvoiceId = null;
let currentEditingClientId = null;

// ========== DATA LAYER ==========
function loadData() {
  try {
    appData.business = JSON.parse(localStorage.getItem(STORAGE_KEYS.BUSINESS)) || null;
    appData.clients = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLIENTS)) || [];
    appData.invoices = JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES)) || [];
    appData.serialCounters = JSON.parse(localStorage.getItem(STORAGE_KEYS.SERIAL)) || {};
  } catch (e) {
    console.error('Failed to load data:', e);
    showToast('Warning: Could not load saved data. Starting fresh.', 'error');
    appData = { business: null, clients: [], invoices: [], serialCounters: {} };
  }
  updateOverdueStatuses();
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEYS.BUSINESS, JSON.stringify(appData.business));
    localStorage.setItem(STORAGE_KEYS.CLIENTS, JSON.stringify(appData.clients));
    localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(appData.invoices));
    localStorage.setItem(STORAGE_KEYS.SERIAL, JSON.stringify(appData.serialCounters));
  } catch (e) {
    console.error('Failed to save data:', e);
    showToast('Error saving data. Storage may be full.', 'error');
  }
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function generateSerialNumber() {
  const year = new Date().getFullYear();
  if (!appData.serialCounters[year]) {
    appData.serialCounters[year] = 1;
  }
  const seq = appData.serialCounters[year];
  const serial = `INV-${year}-${String(seq).padStart(6, '0')}`;
  appData.serialCounters[year] = seq + 1;
  saveData();
  return serial;
}

// ========== CALCULATIONS ==========
function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calculateInvoiceTotals(invoice) {
  let subtotal = 0;
  const lineItems = (invoice.lineItems || []).map(item => {
    const qty = parseFloat(item.quantity) || 0;
    const price = parseFloat(item.unitPrice) || 0;
    const lineSub = roundMoney(qty * price);
    subtotal = roundMoney(subtotal + lineSub);
    return { ...item, quantity: qty, unitPrice: price, subtotal: lineSub };
  });

  const discount = Math.max(0, parseFloat(invoice.discountAmount) || 0);
  const afterDiscount = Math.max(0, roundMoney(subtotal - discount));
  const taxRate = Math.max(0, Math.min(100, parseFloat(invoice.taxRate) || 0));
  const taxAmount = roundMoney(afterDiscount * (taxRate / 100));
  const total = roundMoney(afterDiscount + taxAmount);

  const paid = (invoice.payments || []).reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  const paidRounded = roundMoney(paid);
  const balance = roundMoney(total - paidRounded);

  return {
    lineItems,
    subtotal,
    discount,
    afterDiscount,
    taxRate,
    taxAmount,
    total,
    paid: paidRounded,
    balance,
    currency: invoice.currency || 'USD'
  };
}

function updateOverdueStatuses() {
  const today = new Date().toISOString().split('T')[0];
  appData.invoices.forEach(inv => {
    if (inv.status === 'Cancelled' || inv.status === 'Draft') return;
    const totals = calculateInvoiceTotals(inv);
    if (inv.dueDate < today && totals.balance > 0) {
      inv.status = 'Overdue';
    } else if (totals.balance <= 0 && totals.paid > 0) {
      inv.status = 'Paid';
    } else if (totals.paid > 0 && totals.balance > 0) {
      inv.status = 'Partially Paid';
    }
  });
  saveData();
}

function formatCurrency(amount, currencyCode) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: currencyCode === 'JPY' ? 0 : 2,
      maximumFractionDigits: currencyCode === 'JPY' ? 0 : 2
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}

// ========== UI HELPERS ==========
function showSection(sectionId) {
  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
  const section = document.getElementById(sectionId);
  if (section) section.classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === sectionId);
  });
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `fixed bottom-4 right-4 px-4 py-2 rounded shadow z-50 ${type === 'error' ? 'bg-red-600' : 'bg-green-600'} text-white`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 4000);
}

function populateCurrencySelects() {
  const selects = ['invoice-currency', 'default-currency'];
  selects.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '';
    CURRENCIES.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.code;
      opt.textContent = `${c.code} - ${c.name}`;
      sel.appendChild(opt);
    });
  });
  if (appData.business?.defaultCurrency) {
    document.getElementById('default-currency').value = appData.business.defaultCurrency;
  }
}

function populateClientSelect() {
  const sel = document.getElementById('invoice-client');
  if (!sel) return;
  sel.innerHTML = '<option value="">Select a client</option>';
  appData.clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    sel.appendChild(opt);
  });
}

// ========== DASHBOARD ==========
function renderDashboard() {
  const statsContainer = document.getElementById('dashboard-stats');
  const recentContainer = document.getElementById('recent-invoices');
  if (!statsContainer || !recentContainer) return;

  // Group totals by currency
  const byCurrency = {};
  let totalInvoices = appData.invoices.length;
  let overdueCount = 0;

  appData.invoices.forEach(inv => {
    const t = calculateInvoiceTotals(inv);
    const cur = t.currency;
    if (!byCurrency[cur]) byCurrency[cur] = { invoiced: 0, paid: 0, outstanding: 0 };
    if (inv.status !== 'Cancelled') {
      byCurrency[cur].invoiced = roundMoney(byCurrency[cur].invoiced + t.total);
      byCurrency[cur].paid = roundMoney(byCurrency[cur].paid + t.paid);
      byCurrency[cur].outstanding = roundMoney(byCurrency[cur].outstanding + Math.max(0, t.balance));
    }
    if (inv.status === 'Overdue') overdueCount++;
  });

  statsContainer.innerHTML = `
    <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Invoices</div><div class="text-2xl font-bold">${totalInvoices}</div></div>
    <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Overdue</div><div class="text-2xl font-bold text-red-600">${overdueCount}</div></div>
  `;

  // Currency cards
  Object.keys(byCurrency).forEach(cur => {
    const d = byCurrency[cur];
    statsContainer.innerHTML += `
      <div class="bg-white p-4 rounded-lg shadow col-span-1 md:col-span-2">
        <div class="text-sm font-medium text-gray-700 mb-2">${cur}</div>
        <div class="grid grid-cols-3 gap-2 text-sm">
          <div><div class="text-gray-500">Invoiced</div><div class="font-semibold">${formatCurrency(d.invoiced, cur)}</div></div>
          <div><div class="text-gray-500">Paid</div><div class="font-semibold text-green-600">${formatCurrency(d.paid, cur)}</div></div>
          <div><div class="text-gray-500">Outstanding</div><div class="font-semibold text-orange-600">${formatCurrency(d.outstanding, cur)}</div></div>
        </div>
      </div>
    `;
  });

  // Recent / filtered invoices
  renderInvoiceTable(recentContainer, getFilteredInvoices());
}

function getFilteredInvoices() {
  const search = (document.getElementById('search-invoices')?.value || '').toLowerCase();
  const status = document.getElementById('filter-status')?.value || '';
  return appData.invoices.filter(inv => {
    const client = appData.clients.find(c => c.id === inv.clientId);
    const clientName = client ? client.name.toLowerCase() : '';
    const matchSearch = !search || inv.serialNumber.toLowerCase().includes(search) || clientName.includes(search);
    const matchStatus = !status || inv.status === status;
    return matchSearch && matchStatus;
  }).sort((a, b) => new Date(b.issueDate) - new Date(a.issueDate));
}

function renderInvoiceTable(container, invoices) {
  if (invoices.length === 0) {
    container.innerHTML = '<div class="p-8 text-center text-gray-500">No invoices found. Create your first invoice to get started.</div>';
    return;
  }
  let html = '<table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr>' +
    '<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Invoice #</th>' +
    '<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client</th>' +
    '<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Issue Date</th>' +
    '<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Due Date</th>' +
    '<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total</th>' +
    '<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>' +
    '<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>' +
    '</tr></thead><tbody class="bg-white divide-y divide-gray-200">';

  invoices.forEach(inv => {
    const client = appData.clients.find(c => c.id === inv.clientId);
    const totals = calculateInvoiceTotals(inv);
    const statusClass = inv.status === 'Paid' ? 'text-green-600' : inv.status === 'Overdue' ? 'text-red-600' : inv.status === 'Cancelled' ? 'text-gray-500' : 'text-blue-600';
    html += `<tr>
      <td class="px-4 py-3 text-sm font-medium">${escapeHtml(inv.serialNumber)}</td>
      <td class="px-4 py-3 text-sm">${escapeHtml(client?.name || 'Unknown')}</td>
      <td class="px-4 py-3 text-sm">${inv.issueDate || ''}</td>
      <td class="px-4 py-3 text-sm">${inv.dueDate || ''}</td>
      <td class="px-4 py-3 text-sm">${formatCurrency(totals.total, totals.currency)}</td>
      <td class="px-4 py-3 text-sm ${statusClass}">${inv.status}</td>
      <td class="px-4 py-3 text-sm space-x-2">
        <button class="text-blue-600 hover:underline edit-invoice" data-id="${inv.id}">Edit</button>
        <button class="text-green-600 hover:underline record-payment" data-id="${inv.id}">Payment</button>
        <button class="text-purple-600 hover:underline duplicate-invoice" data-id="${inv.id}">Duplicate</button>
        <button class="text-red-600 hover:underline delete-invoice" data-id="${inv.id}">Delete</button>
      </td>
    </tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;

  // Attach listeners
  container.querySelectorAll('.edit-invoice').forEach(btn => btn.addEventListener('click', () => editInvoice(btn.dataset.id)));
  container.querySelectorAll('.record-payment').forEach(btn => btn.addEventListener('click', () => openPaymentForm(btn.dataset.id)));
  container.querySelectorAll('.duplicate-invoice').forEach(btn => btn.addEventListener('click', () => duplicateInvoice(btn.dataset.id)));
  container.querySelectorAll('.delete-invoice').forEach(btn => btn.addEventListener('click', () => deleteInvoice(btn.dataset.id)));
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========== INVOICE FORM ==========
function openNewInvoice() {
  currentEditingInvoiceId = null;
  document.getElementById('invoice-form-title').textContent = 'Create Invoice';
  document.getElementById('invoice-serial').value = generateSerialNumber();
  document.getElementById('invoice-client').value = '';
  document.getElementById('issue-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('due-date').value = '';
  document.getElementById('invoice-description').value = '';
  document.getElementById('invoice-currency').value = appData.business?.defaultCurrency || 'USD';
  document.getElementById('discount-amount').value = '';
  document.getElementById('tax-rate').value = '';
  document.getElementById('payment-instructions').value = appData.business?.defaultPaymentInstructions || '';
  document.getElementById('invoice-notes').value = '';
  document.getElementById('invoice-status').value = 'Draft';
  document.getElementById('line-items-container').innerHTML = '';
  addLineItemRow();
  updateInvoicePreview();
  showSection('invoice-form');
}

function editInvoice(id) {
  const inv = appData.invoices.find(i => i.id === id);
  if (!inv) return;
  currentEditingInvoiceId = id;
  document.getElementById('invoice-form-title').textContent = 'Edit Invoice';
  document.getElementById('invoice-serial').value = inv.serialNumber;
  document.getElementById('invoice-client').value = inv.clientId || '';
  document.getElementById('issue-date').value = inv.issueDate || '';
  document.getElementById('due-date').value = inv.dueDate || '';
  document.getElementById('invoice-description').value = inv.description || '';
  document.getElementById('invoice-currency').value = inv.currency || 'USD';
  document.getElementById('discount-amount').value = inv.discountAmount || '';
  document.getElementById('tax-rate').value = inv.taxRate || '';
  document.getElementById('payment-instructions').value = inv.paymentInstructions || '';
  document.getElementById('invoice-notes').value = inv.notes || '';
  document.getElementById('invoice-status').value = inv.status || 'Draft';
  document.getElementById('line-items-container').innerHTML = '';
  (inv.lineItems || []).forEach(item => addLineItemRow(item));
  if (!inv.lineItems || inv.lineItems.length === 0) addLineItemRow();
  updateInvoicePreview();
  showSection('invoice-form');
}

function addLineItemRow(item = {}) {
  const container = document.getElementById('line-items-container');
  const row = document.createElement('div');
  row.className = 'line-item-row border border-gray-200 p-2 rounded';
  row.innerHTML = `
    <input type="text" placeholder="Description" class="line-desc px-2 py-1 border rounded text-sm" value="${escapeHtml(item.description || '')}" required>
    <input type="number" placeholder="Qty" min="0.01" step="0.01" class="line-qty px-2 py-1 border rounded text-sm" value="${item.quantity || ''}" required>
    <input type="number" placeholder="Unit Price" min="0" step="0.01" class="line-price px-2 py-1 border rounded text-sm" value="${item.unitPrice || ''}" required>
    <input type="text" class="line-subtotal px-2 py-1 border rounded text-sm bg-gray-100" readonly value="${item.subtotal || '0.00'}">
    <button type="button" class="remove-line text-red-600 text-sm px-2">Remove</button>
  `;
  container.appendChild(row);
  row.querySelector('.remove-line').addEventListener('click', () => {
    if (container.children.length > 1) row.remove();
    else showToast('At least one line item is required.', 'error');
    updateInvoicePreview();
  });
  ['line-desc', 'line-qty', 'line-price'].forEach(cls => {
    row.querySelector('.' + cls).addEventListener('input', updateInvoicePreview);
  });
}

function collectInvoiceData() {
  const lineItems = [];
  document.querySelectorAll('#line-items-container .line-item-row').forEach(row => {
    const desc = row.querySelector('.line-desc').value.trim();
    const qty = parseFloat(row.querySelector('.line-qty').value);
    const price = parseFloat(row.querySelector('.line-price').value);
    if (desc && qty > 0 && price >= 0) {
      lineItems.push({ description: desc, quantity: qty, unitPrice: price });
    }
  });

  return {
    id: currentEditingInvoiceId || generateId(),
    serialNumber: document.getElementById('invoice-serial').value,
    clientId: document.getElementById('invoice-client').value,
    issueDate: document.getElementById('issue-date').value,
    dueDate: document.getElementById('due-date').value,
    description: document.getElementById('invoice-description').value.trim(),
    currency: document.getElementById('invoice-currency').value,
    discountAmount: parseFloat(document.getElementById('discount-amount').value) || 0,
    taxRate: parseFloat(document.getElementById('tax-rate').value) || 0,
    paymentInstructions: document.getElementById('payment-instructions').value.trim(),
    notes: document.getElementById('invoice-notes').value.trim(),
    status: document.getElementById('invoice-status').value,
    lineItems,
    payments: currentEditingInvoiceId ? (appData.invoices.find(i => i.id === currentEditingInvoiceId)?.payments || []) : []
  };
}

function validateInvoice(data) {
  const errors = [];
  if (!data.clientId) errors.push('Client is required.');
  if (!data.issueDate) errors.push('Issue date is required.');
  if (!data.dueDate) errors.push('Due date is required.');
  if (data.dueDate && data.issueDate && data.dueDate < data.issueDate) errors.push('Due date cannot be earlier than issue date.');
  if (data.lineItems.length === 0) errors.push('At least one valid line item is required.');
  data.lineItems.forEach((item, i) => {
    if (item.quantity <= 0) errors.push(`Line ${i + 1}: Quantity must be positive.`);
    if (item.unitPrice < 0) errors.push(`Line ${i + 1}: Unit price cannot be negative.`);
  });
  if (data.discountAmount < 0) errors.push('Discount cannot be negative.');
  if (data.taxRate < 0 || data.taxRate > 100) errors.push('Tax rate must be between 0 and 100.');
  return errors;
}

function saveInvoice(asDraft = false) {
  const data = collectInvoiceData();
  if (asDraft) data.status = 'Draft';
  const errors = validateInvoice(data);
  const errorEl = document.getElementById('invoice-form-error');
  if (errors.length > 0) {
    errorEl.textContent = errors.join(' ');
    errorEl.classList.remove('hidden');
    return;
  }
  errorEl.classList.add('hidden');

  const totals = calculateInvoiceTotals(data);
  data.calculated = totals; // store for convenience

  const idx = appData.invoices.findIndex(i => i.id === data.id);
  if (idx >= 0) {
    appData.invoices[idx] = data;
  } else {
    appData.invoices.push(data);
  }
  saveData();
  updateOverdueStatuses();
  showToast(asDraft ? 'Draft saved.' : 'Invoice saved successfully.');
  showSection('invoices');
  renderInvoicesList();
  renderDashboard();
}

function updateInvoicePreview() {
  const data = collectInvoiceData();
  const totals = calculateInvoiceTotals(data);
  const client = appData.clients.find(c => c.id === data.clientId);
  const business = appData.business || {};

  let html = `<div class="invoice-preview-content">`;
  // Business header
  html += `<div class="flex justify-between mb-4">
    <div>
      ${business.logo ? `<img src="${business.logo}" class="max-h-12 mb-2" alt="Logo">` : ''}
      <strong>${escapeHtml(business.name || 'Your Business')}</strong><br>
      ${escapeHtml(business.address || '')}<br>
      ${escapeHtml(business.email || '')} ${escapeHtml(business.phone || '')}
    </div>
    <div class="text-right">
      <div class="text-xl font-bold">INVOICE</div>
      <div class="serial-number-print">${escapeHtml(data.serialNumber)}</div>
      <div>Issue: ${data.issueDate || ''}</div>
      <div>Due: ${data.dueDate || ''}</div>
    </div>
  </div>`;

  // Client
  if (client) {
    html += `<div class="mb-4"><strong>Bill To:</strong><br>${escapeHtml(client.name)}<br>${escapeHtml(client.address || '')}<br>${escapeHtml(client.email || '')}</div>`;
  }

  if (data.description) html += `<div class="mb-2"><em>${escapeHtml(data.description)}</em></div>`;

  // Line items table
  html += `<table><thead><tr><th>Description</th><th class="text-right">Qty</th><th class="text-right">Price</th><th class="text-right">Amount</th></tr></thead><tbody>`;
  totals.lineItems.forEach(item => {
    html += `<tr><td>${escapeHtml(item.description)}</td><td class="text-right">${item.quantity}</td><td class="text-right">${formatCurrency(item.unitPrice, totals.currency)}</td><td class="text-right">${formatCurrency(item.subtotal, totals.currency)}</td></tr>`;
  });
  html += `</tbody></table>`;

  // Totals
  html += `<div class="totals text-right">
    <div>Subtotal: ${formatCurrency(totals.subtotal, totals.currency)}</div>
    ${totals.discount > 0 ? `<div>Discount: -${formatCurrency(totals.discount, totals.currency)}</div>` : ''}
    ${totals.taxAmount > 0 ? `<div>Tax (${totals.taxRate}%): ${formatCurrency(totals.taxAmount, totals.currency)}</div>` : ''}
    <div class="font-bold text-lg">Total: ${formatCurrency(totals.total, totals.currency)}</div>
    ${totals.paid > 0 ? `<div>Paid: ${formatCurrency(totals.paid, totals.currency)}</div><div>Balance: ${formatCurrency(totals.balance, totals.currency)}</div>` : ''}
  </div>`;

  if (data.paymentInstructions) html += `<div class="mt-4"><strong>Payment Instructions:</strong><br>${escapeHtml(data.paymentInstructions).replace(/\n/g, '<br>')}</div>`;
  if (data.notes) html += `<div class="mt-2"><strong>Notes:</strong><br>${escapeHtml(data.notes).replace(/\n/g, '<br>')}</div>`;

  html += `</div>`;
  document.getElementById('invoice-preview').innerHTML = html;
}

// ========== PDF ==========
async function downloadPDF() {
  const data = collectInvoiceData();
  const totals = calculateInvoiceTotals(data);
  const client = appData.clients.find(c => c.id === data.clientId);
  const business = appData.business || {};

  if (!data.serialNumber) {
    showToast('Save the invoice first before downloading PDF.', 'error');
    return;
  }

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let y = 20;

    if (business.logo) {
      try {
        doc.addImage(business.logo, 'PNG', 15, y, 30, 15);
        y += 20;
      } catch (e) { /* ignore logo error */ }
    }

    doc.setFontSize(18);
    doc.text('INVOICE', 150, 25);
    doc.setFontSize(10);
    doc.text(data.serialNumber, 150, 32);
    doc.text(`Issue: ${data.issueDate}`, 150, 38);
    doc.text(`Due: ${data.dueDate}`, 150, 44);

    doc.setFontSize(12);
    doc.text(business.name || 'Business', 15, y);
    y += 6;
    doc.setFontSize(10);
    if (business.address) { doc.text(business.address, 15, y); y += 5; }
    if (business.email) { doc.text(business.email, 15, y); y += 5; }
    if (business.phone) { doc.text(business.phone, 15, y); y += 5; }

    y += 10;
    doc.setFontSize(11);
    doc.text('Bill To:', 15, y);
    y += 6;
    if (client) {
      doc.text(client.name || '', 15, y); y += 5;
      if (client.address) { doc.text(client.address, 15, y); y += 5; }
      if (client.email) { doc.text(client.email, 15, y); y += 5; }
    }

    y += 10;
    const tableData = totals.lineItems.map(item => [
      item.description,
      item.quantity.toString(),
      formatCurrency(item.unitPrice, totals.currency),
      formatCurrency(item.subtotal, totals.currency)
    ]);

    doc.autoTable({
      startY: y,
      head: [['Description', 'Qty', 'Unit Price', 'Amount']],
      body: tableData,
      theme: 'grid',
      styles: { fontSize: 9 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } }
    });

    y = doc.lastAutoTable.finalY + 10;
    doc.text(`Subtotal: ${formatCurrency(totals.subtotal, totals.currency)}`, 150, y);
    if (totals.discount > 0) { y += 6; doc.text(`Discount: -${formatCurrency(totals.discount, totals.currency)}`, 150, y); }
    if (totals.taxAmount > 0) { y += 6; doc.text(`Tax (${totals.taxRate}%): ${formatCurrency(totals.taxAmount, totals.currency)}`, 150, y); }
    y += 8;
    doc.setFontSize(12);
    doc.text(`Total: ${formatCurrency(totals.total, totals.currency)}`, 150, y);

    if (data.paymentInstructions) {
      y += 15;
      doc.setFontSize(10);
      doc.text('Payment Instructions:', 15, y);
      y += 5;
      const lines = doc.splitTextToSize(data.paymentInstructions, 180);
      doc.text(lines, 15, y);
    }

    doc.save(`Invoice-${data.serialNumber}.pdf`);
    showToast('PDF downloaded successfully.');
  } catch (err) {
    console.error(err);
    showToast('Failed to generate PDF. Please try again.', 'error');
  }
}

// ========== PRINT ==========
function printInvoice() {
  const includeSerial = document.getElementById('include-serial-print').checked;
  const preview = document.getElementById('invoice-preview');
  const serialEls = preview.querySelectorAll('.serial-number-print');
  serialEls.forEach(el => {
    if (includeSerial) el.classList.remove('hidden-serial');
    else el.classList.add('hidden-serial');
  });
  window.print();
  // Reset after print
  setTimeout(() => {
    serialEls.forEach(el => el.classList.remove('hidden-serial'));
  }, 1000);
}

// ========== PAYMENTS ==========
function openPaymentForm(invoiceId) {
  const inv = appData.invoices.find(i => i.id === invoiceId);
  if (!inv) return;
  const totals = calculateInvoiceTotals(inv);
  if (totals.balance <= 0) {
    showToast('This invoice is already fully paid.', 'error');
    return;
  }
  document.getElementById('payment-invoice-id').value = invoiceId;
  document.getElementById('payment-invoice-serial').textContent = inv.serialNumber;
  document.getElementById('payment-outstanding').textContent = formatCurrency(totals.balance, totals.currency);
  document.getElementById('payment-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('payment-amount').value = '';
  document.getElementById('payment-amount').max = totals.balance;
  document.getElementById('payment-reference').value = '';
  document.getElementById('payment-notes').value = '';
  showSection('payment-form');
}

function recordPayment() {
  const invoiceId = document.getElementById('payment-invoice-id').value;
  const inv = appData.invoices.find(i => i.id === invoiceId);
  if (!inv) return;

  const amount = parseFloat(document.getElementById('payment-amount').value);
  const date = document.getElementById('payment-date').value;
  const totals = calculateInvoiceTotals(inv);

  const errorEl = document.getElementById('payment-form-error');
  if (!date || !amount || amount <= 0) {
    errorEl.textContent = 'Valid date and positive amount are required.';
    errorEl.classList.remove('hidden');
    return;
  }
  if (amount > totals.balance + 0.01) { // small tolerance
    errorEl.textContent = `Amount cannot exceed outstanding balance of ${formatCurrency(totals.balance, totals.currency)}.`;
    errorEl.classList.remove('hidden');
    return;
  }
  errorEl.classList.add('hidden');

  if (!inv.payments) inv.payments = [];
  inv.payments.push({
    id: generateId(),
    date,
    amount: roundMoney(amount),
    reference: document.getElementById('payment-reference').value.trim(),
    notes: document.getElementById('payment-notes').value.trim()
  });

  // Update status
  const newTotals = calculateInvoiceTotals(inv);
  if (newTotals.balance <= 0) inv.status = 'Paid';
  else if (newTotals.paid > 0) inv.status = 'Partially Paid';

  saveData();
  updateOverdueStatuses();
  showToast('Payment recorded.');
  showSection('invoices');
  renderInvoicesList();
  renderDashboard();
}

// ========== CLIENTS ==========
function renderClientsList() {
  const container = document.getElementById('clients-list');
  if (appData.clients.length === 0) {
    container.innerHTML = '<div class="p-8 text-center text-gray-500">No clients yet. Add your first client.</div>';
    return;
  }
  let html = '<table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr>' +
    '<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>' +
    '<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>' +
    '<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>' +
    '<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th></tr></thead><tbody>';
  appData.clients.forEach(c => {
    html += `<tr>
      <td class="px-4 py-3 text-sm">${escapeHtml(c.name)}</td>
      <td class="px-4 py-3 text-sm">${escapeHtml(c.email || '')}</td>
      <td class="px-4 py-3 text-sm">${escapeHtml(c.phone || '')}</td>
      <td class="px-4 py-3 text-sm space-x-2">
        <button class="text-blue-600 hover:underline edit-client" data-id="${c.id}">Edit</button>
        <button class="text-red-600 hover:underline delete-client" data-id="${c.id}">Delete</button>
      </td>
    </tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
  container.querySelectorAll('.edit-client').forEach(btn => btn.addEventListener('click', () => editClient(btn.dataset.id)));
  container.querySelectorAll('.delete-client').forEach(btn => btn.addEventListener('click', () => deleteClient(btn.dataset.id)));
}

function openNewClient() {
  currentEditingClientId = null;
  document.getElementById('client-form-title').textContent = 'Add Client';
  document.getElementById('client-name').value = '';
  document.getElementById('client-email').value = '';
  document.getElementById('client-phone').value = '';
  document.getElementById('client-address').value = '';
  document.getElementById('client-notes').value = '';
  showSection('client-form');
}

function editClient(id) {
  const client = appData.clients.find(c => c.id === id);
  if (!client) return;
  currentEditingClientId = id;
  document.getElementById('client-form-title').textContent = 'Edit Client';
  document.getElementById('client-name').value = client.name || '';
  document.getElementById('client-email').value = client.email || '';
  document.getElementById('client-phone').value = client.phone || '';
  document.getElementById('client-address').value = client.address || '';
  document.getElementById('client-notes').value = client.notes || '';
  showSection('client-form');
}

function saveClient() {
  const name = document.getElementById('client-name').value.trim();
  const errorEl = document.getElementById('client-form-error');
  if (!name) {
    errorEl.textContent = 'Name is required.';
    errorEl.classList.remove('hidden');
    return;
  }
  errorEl.classList.add('hidden');

  const client = {
    id: currentEditingClientId || generateId(),
    name,
    email: document.getElementById('client-email').value.trim(),
    phone: document.getElementById('client-phone').value.trim(),
    address: document.getElementById('client-address').value.trim(),
    notes: document.getElementById('client-notes').value.trim()
  };

  const idx = appData.clients.findIndex(c => c.id === client.id);
  if (idx >= 0) appData.clients[idx] = client;
  else appData.clients.push(client);
  saveData();
  populateClientSelect();
  showToast('Client saved.');
  showSection('clients');
  renderClientsList();
}

function deleteClient(id) {
  const hasInvoices = appData.invoices.some(inv => inv.clientId === id);
  if (hasInvoices) {
    if (!confirm('This client has associated invoices. Deleting the client will not delete the invoices, but the client name will no longer appear on them. Continue?')) return;
  } else {
    if (!confirm('Delete this client?')) return;
  }
  appData.clients = appData.clients.filter(c => c.id !== id);
  saveData();
  populateClientSelect();
  renderClientsList();
  showToast('Client deleted.');
}

function deleteInvoice(id) {
  if (!confirm('Delete this invoice? The serial number will not be reused. This cannot be undone.')) return;
  appData.invoices = appData.invoices.filter(i => i.id !== id);
  saveData();
  renderInvoicesList();
  renderDashboard();
  showToast('Invoice deleted. Serial number preserved (not reused).');
}

function duplicateInvoice(id) {
  const original = appData.invoices.find(i => i.id === id);
  if (!original) return;
  const copy = JSON.parse(JSON.stringify(original));
  copy.id = generateId();
  copy.serialNumber = generateSerialNumber();
  copy.status = 'Draft';
  copy.payments = [];
  copy.issueDate = new Date().toISOString().split('T')[0];
  appData.invoices.push(copy);
  saveData();
  showToast('Invoice duplicated with new serial number.');
  renderInvoicesList();
  editInvoice(copy.id);
}

function cancelInvoice(id) {
  const inv = appData.invoices.find(i => i.id === id);
  if (inv) {
    inv.status = 'Cancelled';
    saveData();
    updateOverdueStatuses();
    renderInvoicesList();
    renderDashboard();
    showToast('Invoice cancelled.');
  }
}

// ========== PROFILE ==========
function loadProfileForm() {
  const b = appData.business || {};
  document.getElementById('business-name').value = b.name || '';
  document.getElementById('business-email').value = b.email || '';
  document.getElementById('business-phone').value = b.phone || '';
  document.getElementById('business-address').value = b.address || '';
  document.getElementById('business-website').value = b.website || '';
  document.getElementById('default-currency').value = b.defaultCurrency || 'USD';
  document.getElementById('default-payment-instructions').value = b.defaultPaymentInstructions || '';
  if (b.logo) {
    document.getElementById('logo-img').src = b.logo;
    document.getElementById('logo-preview').classList.remove('hidden');
  }
}

function saveProfile() {
  const name = document.getElementById('business-name').value.trim();
  const email = document.getElementById('business-email').value.trim();
  if (!name || !email) {
    showToast('Name and email are required.', 'error');
    return;
  }

  const logoInput = document.getElementById('business-logo');
  let logo = appData.business?.logo || null;
  if (logoInput.files && logoInput.files[0]) {
    const file = logoInput.files[0];
    if (file.size > 500 * 1024) {
      showToast('Logo must be under 500KB.', 'error');
      return;
    }
    if (!file.type.startsWith('image/')) {
      showToast('Please upload an image file.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      logo = e.target.result;
      finishSaveProfile(logo);
    };
    reader.readAsDataURL(file);
    return;
  }
  finishSaveProfile(logo);
}

function finishSaveProfile(logo) {
  appData.business = {
    name: document.getElementById('business-name').value.trim(),
    email: document.getElementById('business-email').value.trim(),
    phone: document.getElementById('business-phone').value.trim(),
    address: document.getElementById('business-address').value.trim(),
    website: document.getElementById('business-website').value.trim(),
    logo,
    defaultCurrency: document.getElementById('default-currency').value,
    defaultPaymentInstructions: document.getElementById('default-payment-instructions').value.trim()
  };
  saveData();
  document.getElementById('profile-message').textContent = 'Profile saved successfully.';
  document.getElementById('profile-message').classList.remove('hidden');
  showToast('Profile saved.');
  setTimeout(() => document.getElementById('profile-message').classList.add('hidden'), 3000);
}

// ========== REMINDERS ==========
function generateReminder() {
  const data = collectInvoiceData();
  const totals = calculateInvoiceTotals(data);
  const client = appData.clients.find(c => c.id === data.clientId);
  if (!client) {
    showToast('Select a client first.', 'error');
    return;
  }
  const today = new Date().toISOString().split('T')[0];
  let template = '';
  if (data.status === 'Paid' || totals.balance <= 0) {
    template = `Dear ${client.name},\n\nWe have received your payment for invoice ${data.serialNumber}. Thank you!\n\nAmount paid: ${formatCurrency(totals.paid, totals.currency)}\n\nBest regards,\n${appData.business?.name || 'Your Business'}`;
  } else if (data.dueDate === today) {
    template = `Dear ${client.name},\n\nThis is a friendly reminder that payment for invoice ${data.serialNumber} is due today.\n\nAmount due: ${formatCurrency(totals.balance, totals.currency)}\nDue date: ${data.dueDate}\n\nPlease let us know if you have any questions.\n\nBest regards,\n${appData.business?.name || 'Your Business'}`;
  } else if (data.dueDate < today && totals.balance > 0) {
    template = `Dear ${client.name},\n\nOur records show that invoice ${data.serialNumber} is now overdue.\n\nAmount outstanding: ${formatCurrency(totals.balance, totals.currency)}\nOriginal due date: ${data.dueDate}\n\nPlease arrange payment at your earliest convenience.\n\nBest regards,\n${appData.business?.name || 'Your Business'}`;
  } else {
    template = `Dear ${client.name},\n\nThis is a reminder that invoice ${data.serialNumber} is due on ${data.dueDate}.\n\nAmount due: ${formatCurrency(totals.balance, totals.currency)}\n\nThank you for your business.\n\nBest regards,\n${appData.business?.name || 'Your Business'}`;
  }

  const output = document.getElementById('reminder-output');
  output.textContent = template;
  output.classList.remove('hidden');
  document.getElementById('copy-reminder-btn').classList.remove('hidden');
}

function copyReminder() {
  const text = document.getElementById('reminder-output').textContent;
  navigator.clipboard.writeText(text).then(() => showToast('Reminder copied to clipboard.')).catch(() => showToast('Failed to copy.', 'error'));
}

// ========== EXPORT / IMPORT ==========
function exportInvoicesCSV() {
  if (appData.invoices.length === 0) { showToast('No invoices to export.', 'error'); return; }
  const headers = ['Serial Number', 'Client', 'Issue Date', 'Due Date', 'Currency', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Balance', 'Status'];
  const rows = appData.invoices.map(inv => {
    const t = calculateInvoiceTotals(inv);
    const client = appData.clients.find(c => c.id === inv.clientId);
    return [
      inv.serialNumber,
      client?.name || '',
      inv.issueDate,
      inv.dueDate,
      t.currency,
      t.subtotal,
      t.discount,
      t.taxAmount,
      t.total,
      t.paid,
      t.balance,
      inv.status
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });
  const csv = [headers.join(','), ...rows].join('\n');
  downloadFile(csv, 'invoices.csv', 'text/csv');
}

function exportClientsCSV() {
  if (appData.clients.length === 0) { showToast('No clients to export.', 'error'); return; }
  const headers = ['Name', 'Email', 'Phone', 'Address', 'Notes'];
  const rows = appData.clients.map(c => [
    c.name, c.email, c.phone, c.address, c.notes
  ].map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  downloadFile(csv, 'clients.csv', 'text/csv');
}

function exportJSONBackup() {
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    business: appData.business,
    clients: appData.clients,
    invoices: appData.invoices,
    serialCounters: appData.serialCounters
  };
  downloadFile(JSON.stringify(backup, null, 2), 'invoiceflow-backup.json', 'application/json');
  showToast('Backup exported.');
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function importJSONBackup(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.clients || !Array.isArray(data.clients) || !data.invoices || !Array.isArray(data.invoices)) {
        showToast('Invalid backup file format.', 'error');
        return;
      }
      if (!confirm('This will replace ALL existing data (clients, invoices, profile, serial counters). Continue?')) return;
      appData.business = data.business || null;
      appData.clients = data.clients;
      appData.invoices = data.invoices;
      appData.serialCounters = data.serialCounters || {};
      saveData();
      updateOverdueStatuses();
      populateClientSelect();
      loadProfileForm();
      renderDashboard();
      renderInvoicesList();
      renderClientsList();
      showToast('Backup imported successfully.');
    } catch (err) {
      showToast('Failed to import backup. File may be corrupted.', 'error');
    }
  };
  reader.readAsText(file);
}

function renderInvoicesList() {
  renderInvoiceTable(document.getElementById('invoices-list'), appData.invoices);
}

// ========== EVENT LISTENERS ==========
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  populateCurrencySelects();
  populateClientSelect();
  loadProfileForm();
  renderDashboard();
  renderInvoicesList();
  renderClientsList();

  // Navigation
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sec = btn.dataset.section;
      if (sec === 'invoices') renderInvoicesList();
      if (sec === 'clients') renderClientsList();
      if (sec === 'profile') loadProfileForm();
      if (sec === 'dashboard') renderDashboard();
      showSection(sec);
    });
  });

  // Dashboard filters
  document.getElementById('search-invoices')?.addEventListener('input', renderDashboard);
  document.getElementById('filter-status')?.addEventListener('change', renderDashboard);

  // Invoice form
  document.getElementById('new-invoice-btn')?.addEventListener('click', openNewInvoice);
  document.getElementById('back-to-invoices')?.addEventListener('click', () => showSection('invoices'));
  document.getElementById('add-line-item')?.addEventListener('click', () => addLineItemRow());
  document.getElementById('invoice-editor-form')?.addEventListener('submit', (e) => { e.preventDefault(); saveInvoice(false); });
  document.getElementById('save-draft-btn')?.addEventListener('click', () => saveInvoice(true));

  // Live preview
  ['invoice-client', 'issue-date', 'due-date', 'invoice-description', 'invoice-currency', 'discount-amount', 'tax-rate', 'payment-instructions', 'invoice-notes', 'invoice-status'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateInvoicePreview);
    document.getElementById(id)?.addEventListener('change', updateInvoicePreview);
  });

  document.getElementById('download-pdf-btn')?.addEventListener('click', downloadPDF);
  document.getElementById('print-invoice-btn')?.addEventListener('click', printInvoice);
  document.getElementById('generate-reminder-btn')?.addEventListener('click', generateReminder);
  document.getElementById('copy-reminder-btn')?.addEventListener('click', copyReminder);

  // Clients
  document.getElementById('new-client-btn')?.addEventListener('click', openNewClient);
  document.getElementById('client-editor-form')?.addEventListener('submit', (e) => { e.preventDefault(); saveClient(); });
  document.getElementById('cancel-client')?.addEventListener('click', () => showSection('clients'));

  // Profile
  document.getElementById('profile-form')?.addEventListener('submit', (e) => { e.preventDefault(); saveProfile(); });
  document.getElementById('business-logo')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        document.getElementById('logo-img').src = ev.target.result;
        document.getElementById('logo-preview').classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    }
  });

  // Payments
  document.getElementById('payment-editor-form')?.addEventListener('submit', (e) => { e.preventDefault(); recordPayment(); });
  document.getElementById('cancel-payment')?.addEventListener('click', () => showSection('invoices'));

  // Data tools
  document.getElementById('export-invoices-csv')?.addEventListener('click', exportInvoicesCSV);
  document.getElementById('export-clients-csv')?.addEventListener('click', exportClientsCSV);
  document.getElementById('export-json-backup')?.addEventListener('click', exportJSONBackup);
  document.getElementById('import-json')?.addEventListener('change', (e) => {
    if (e.target.files[0]) importJSONBackup(e.target.files[0]);
    e.target.value = '';
  });

  // Initial section
  showSection('dashboard');
});
