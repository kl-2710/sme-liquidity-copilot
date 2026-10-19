/* Shared number, money and date formatting (SRS v1.3, section 3.1).
   - Vietnamese number convention: period as thousands separator, comma as decimal separator: 1.234.567,89
   - Money shown in millions (M) or billions (bn): 11,85bn, 619,3M; full VND values as 1.200.000.000.
   - Dates as "30 Sep 2026".
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

/** Short millions: 1250000000 → "1.250,0M". */
const mm = n => nf(n / 1e6, 1) + 'M';

/** Short money: from 1 billion upwards "1,25bn", otherwise "850,0M". */
const money = n => Math.abs(n) >= 1e9 ? nf(n / 1e9, 2) + 'bn' : nf(n / 1e6, 1) + 'M';

/** Full VND value: 1200000000 → "1.200.000.000 VND". */
const vnd = n => nInt(n) + ' VND';

/** Millions written out for letters and applications: "VND 3,9 million". */
const enM = n => 'VND ' + nf(n / 1e6, 1) + ' million';

/** Percentage from a ratio: pct(0.281) → "28,1%". */
const pct = (x, d = 1) => nf(x * 100, d) + '%';

/** Days: days(112.94) → "112,9 days". */
const days = (x, d = 1) => nf(x, d) + ' days';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ISO date → "30 Sep 2026". */
const fd = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${+d} ${MONTHS[+m - 1]} ${y}`; };

/** ISO date → "28 Oct" (axis labels, short ranges). */
const fds = iso => { const [, m, d] = String(iso).slice(0, 10).split('-'); return `${+d} ${MONTHS[+m - 1]}`; };

/** Date used in draft letters; same convention. */
const enDate = fd;
