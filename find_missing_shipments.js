const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '확장주문검색_20260624204220_340168441.xls');
const outCsv = path.resolve(__dirname, 'missing_shipments.csv');

function normalize(v){ if (v===undefined||v===null) return ''; return String(v).trim(); }

const wb = XLSX.readFile(file, { cellDates: true });
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
if (rows.length === 0) { console.error('Empty sheet'); process.exit(1); }
const header = rows[0].map(h => normalize(h));
const findIdx = name => header.findIndex(h => h === name);

const idx_order = findIdx('주문번호');
const idx_product = findIdx('상품명');
const idx_option = findIdx('옵션명');
const idx_qty = findIdx('상품수량');
const idx_tracking = findIdx('송장번호');
const idx_date = findIdx('배송일');

if (idx_order === -1) { console.error('주문번호 컬럼을 찾을 수 없습니다.'); process.exit(1); }
if (idx_tracking === -1 && idx_date === -1) { console.error('송장번호 또는 배송일 컬럼을 찾을 수 없습니다.'); process.exit(1); }

const outRows = [];
outRows.push(['주문번호','상품명','옵션명','수량','송장번호','배송일'].join(','));
for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  const order = normalize(row[idx_order]||'');
  const prod = idx_product!==-1 ? normalize(row[idx_product]) : '';
  const opt = idx_option!==-1 ? normalize(row[idx_option]) : '';
  const qty = idx_qty!==-1 ? normalize(row[idx_qty]) : '';
  const tracking = idx_tracking!==-1 ? normalize(row[idx_tracking]) : '';
  const date = idx_date!==-1 ? normalize(row[idx_date]) : '';

  // consider missing if tracking empty OR date empty
  if (!tracking || !date) {
    outRows.push([`"${order}"`,`"${prod.replace(/"/g,'""')}` , `"${opt.replace(/"/g,'""')}` , qty ? qty : '', tracking ? `"${tracking.replace(/"/g,'""')}` : '', date ? `"${date}"` : ''].join(','));
  }
}

fs.writeFileSync(outCsv, outRows.join('\n'), 'utf8');
console.log('작성완료:', outCsv, '누락건수:', outRows.length-1);
