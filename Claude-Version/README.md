# InvoiceFlow

A simple invoice generator for freelancers. Plain HTML, Tailwind CSS (CDN), vanilla JavaScript and jsPDF (CDN). No backend, no account, no API key.

## Run it

1. Keep `index.html`, `style.css`, `script.js` in one folder.
2. Open `index.html` in a modern browser. An internet connection is needed the first time so the Tailwind and jsPDF CDN scripts load.
3. Start with **Business profile**, then **Clients**, then **New invoice**.

## Files

- `index.html` page shell, navigation, dialogs
- `style.css` styles and the `@media print` layout
- `script.js` all logic, in numbered sections (data, money, invoice logic, UI helpers, views, PDF/print, actions). Everything that touches storage goes through `loadDB()` and `save()`, so a backend can replace them later.

## Features

Dashboard with per-currency totals, search and status filter; business profile with logo; client add, edit, view, delete; invoice editor with live preview, line items, discount, user-entered tax; automatic serial numbers; save, edit, duplicate, cancel, delete; manual payment records with partial payments; PDF download; print with serial-number toggle; reminder templates with copy; CSV export, JSON backup and import.

## Serial numbers

Format `INV-YYYY-000001`. The number is assigned the first time an invoice is saved, cannot be edited, stays the same when the invoice is edited, and a per-year counter in localStorage only ever goes up, so numbers of deleted or cancelled invoices are not reused. Imports keep the highest counter seen.

Limits: the counter lives in one browser. Two browsers or devices have separate counters and can produce the same number. A serial number does not prove an invoice is genuine and does not prevent forgery.

## Printing

Printing uses the browser print dialog (A4). By default the serial number is left out of the printed markup and the page title is set to "Invoice". Tick **Include invoice serial number when printing** to include it. The PDF always includes the number. Browser-added headers and footers are controlled by the browser's print settings, which this app cannot override. Printing does not change saved data.

## Money and currency

Amounts are calculated in integer minor units (JPY has none). Choosing a currency changes display only; no amount is converted and no exchange rates are used. Tax is whatever rate you type; the app does not check tax rules for any country. The PDF shows amounts with currency codes (for example `NGN 1,500.00`) because the built-in PDF font cannot draw every currency symbol.

## Privacy and data limits

- Data is stored in this browser's localStorage only.
- Clearing browser data can delete everything.
- Data does not sync between devices and there are no cloud backups. Use **Backup > Full backup (JSON)** regularly. You are responsible for your backups.
- The app does not process payments or send email or messages. Marking an invoice "Sent" is a manual record.
- The app makes no claim of being fully secure or legally compliant in any country.

## Known limitations

- Business details on an invoice come from the current profile; client details are copied into the invoice when it is saved.
- Logos must be PNG or JPG, 500 KB or less.
- localStorage holds about 5 MB; the app shows an error if saving fails.
