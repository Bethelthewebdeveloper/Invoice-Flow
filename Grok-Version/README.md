# InvoiceFlow — International Freelancer Invoice Generator

A simple, reliable, browser-based invoice generator for freelancers, developers, designers, consultants, and independent service providers worldwide.

**No backend, no accounts, no paid APIs.** All data stays in your browser.

## How to Run

1. Download or clone the four files (`index.html`, `style.css`, `script.js`, `README.md`) into a folder.
2. Open `index.html` in any modern web browser (Chrome, Firefox, Safari, Edge).
3. No installation or server is required.

For development, you can also serve the folder with any static file server (e.g. `python -m http.server` or VS Code Live Server).

## Features

- **Dashboard**: Totals by currency (invoiced / paid / outstanding), overdue count, searchable & filterable recent invoices.
- **Business Profile**: Name, contact, address, website, logo (≤500 KB), default currency & payment instructions. Saved in localStorage.
- **Client Management**: Add, edit, delete clients. Clients are never silently deleted from existing invoices.
- **Invoice Creation & Editing**:
  - Unique serial numbers (`INV-YYYY-000001`) that are never reused (even after deletion or cancellation).
  - Line items, optional fixed discount, optional tax rate %.
  - Live preview.
  - Multiple currencies (USD, EUR, GBP, NGN, CAD, AUD, ZAR, GHS, KES, INR, JPY). Changing currency only changes the display — no conversion.
  - Statuses: Draft, Sent, Partially Paid, Paid, Overdue (auto-detected), Cancelled.
- **Payments**: Record partial or full payments manually. Outstanding balance and status update automatically. Does **not** process money.
- **PDF Download**: Professional multi-page-capable PDF including serial number (filename: `Invoice-INV-YYYY-XXXXXX.pdf`).
- **Print**: Browser print dialog with clean A4 layout. Serial number is hidden by default; toggle “Include invoice serial number when printing” to show it. Navigation and controls are hidden.
- **Payment Reminder Generator**: Polite templates (upcoming, due today, overdue, payment received). Copy to clipboard. Does **not** send emails or messages.
- **Export / Backup**:
  - Invoices CSV
  - Clients CSV
  - Full JSON backup
  - Import JSON backup (with confirmation and validation)
- **Validation & Safety**: Required fields, date logic, positive quantities, non-negative money values, tax 0–100 %, safe DOM insertion (no XSS), confirmation on destructive actions.
- **Responsive**: Works on desktop, tablet, and mobile.

## Data Storage & Privacy Limitations

- All data is stored in the browser’s `localStorage`.
- Clearing browser data, using private/incognito mode, or switching browsers/devices will lose your data unless you export a JSON backup.
- There is **no cloud sync** and **no automatic backup**.
- Serial numbers are unique only within the same browser. Different devices or browsers cannot guarantee a single global sequence.
- The application does **not** process payments, send emails, or connect to banks.
- This is **not** a fully secure or legally compliant invoicing system for every jurisdiction. Tax handling is user-entered only.
- Users are responsible for maintaining their own backups and complying with local tax/invoice regulations.

## Technical Notes

- Calculations use rounded money (2 decimal places, except JPY) to reduce floating-point issues.
- Serial number counters are stored per year and only increment.
- Internal invoice IDs are separate from the human-readable serial numbers.
- PDF generation uses jsPDF + AutoTable (loaded via CDN).
- Print styles use `@media print` and temporarily hide the serial number when the toggle is off.

## Known Limitations

- Local-only storage.
- No multi-user or multi-device synchronization.
- No automatic email sending.
- No real-time currency conversion or exchange rates.
- Logo is stored as base64 in localStorage (size-limited).
- Browser print headers/footers cannot be fully controlled by the application.
- Overdue status is recalculated on load and after changes; it is not a scheduled background process.

## Acceptance Testing Performed

The following were verified during development:

1. Business profile saves and reloads correctly.
2. Clients can be created, edited, and deleted (with warning if invoices exist).
3. Two invoices receive different serial numbers.
4. Editing an invoice preserves its serial number.
5. Duplicating creates a new serial number.
6. Deleted/cancelled serial numbers are not reused.
7. Multi-line calculations, discounts, and tax work correctly.
8. Partial payments update balance and status.
9. Currency change does not alter numerical amounts.
10. PDF downloads a real, non-empty file with correct content.
11. Print hides serial by default and shows it when toggled; data is unchanged.
12. Reminder text generates and copies.
13. CSV and JSON export/import work; malformed import is rejected.
14. Invalid inputs show clear errors.
15. Layout works on mobile-sized viewports.
16. Empty states and corrupted localStorage are handled gracefully.
17. All visible buttons perform real actions.

## License

This is a demonstration/educational project. Use at your own risk. No warranty is provided.
