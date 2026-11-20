// Print or save as PDF, after a result on /check (2026-11-20, own two feet). A first-party file so the page
// keeps no inline handler under its CSP.
document.getElementById('print')?.addEventListener('click', () => window.print());
