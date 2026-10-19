/* Shared number, money and date formatting (SRS v1.3, section 3.1).
   - Vietnamese number convention: period as thousands separator, comma as decimal separator: 1.234.567,89
   - Money shown in millions (M) or billions (bn); full VND values when needed.
   - Dates as dd/mm/yyyy.
   Every screen (tables, KPI cards, chart tooltips, drafts) uses these helpers. */

/** Number with d decimals: nf(1234567.891, 2) → "1.234.567,89"; nf(-619.3) → "-619,3". */
function nf(n, d = 1) {
  const x = Number(n);
  if (!isFinite(x)) return '–';
  const fixed = Math.abs(x).toFixed(d);
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = x < 0 && Number(fixed) !== 0 ? '-' : '';
  return sign + (frac ? grouped + ',' + frac : grouped);
}

/** Integer with thousands separators: 1200000000 → "1.200.000.000". */
const nInt = n => nf(n, 0);

// Units follow the display language (LANG from js/i18n.js): M / bn in English, tr (triệu) / tỷ in Vietnamese.
const isVi = () => typeof LANG !== 'undefined' && LANG === 'vi';

/** Short millions: 1250000000 → "1.250,0M" (vi: "1.250,0 tr"). */
const mm = n => nf(n / 1e6, 1) + (isVi() ? ' tr' : 'M');

/** Short money: from 1 billion upwards "1,25bn", otherwise "850,0M". */
const money = n => Math.abs(n) >= 1e9 ? nf(n / 1e9, 2) + (isVi() ? ' tỷ' : 'bn') : nf(n / 1e6, 1) + (isVi() ? ' tr' : 'M');

/** Full VND value: 1200000000 → "1.200.000.000 VND". */
const vnd = n => nInt(n) + ' VND';

/** Millions written out for letters and applications: "VND 3,9 million". */
const enM = n => 'VND ' + nf(n / 1e6, 1) + ' million';

/** Percentage from a ratio: pct(0.281) → "28,1%". */
const pct = (x, d = 1) => nf(x * 100, d) + '%';

/** Days: days(112.94) → "112,9 days". */
const days = (x, d = 1) => nf(x, d) + (isVi() ? ' ngày' : ' days');

/** ISO date → dd/mm/yyyy: "2026-09-30" → "30/09/2026". */
const fd = iso => { const [y, m, d] = String(iso).split('-'); return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`; };

/** ISO date → dd/mm (axis labels, short ranges): "2026-10-28" → "28/10". */
const fds = iso => { const [, m, d] = String(iso).split('-'); return `${d.padStart(2, '0')}/${m.padStart(2, '0')}`; };

/** Date used in draft letters; same dd/mm/yyyy convention. */
const enDate = fd;
