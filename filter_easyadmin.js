const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// Usage: node filter_easyadmin.js [input.xls] [output.xlsx]
const inputFile = process.argv[2] || path.join(__dirname, '확장주문검색_20260624204220_340168441.xls');
const outputFile = process.argv[3] || path.join(__dirname, 'filtered_' + path.basename(inputFile).replace(/\.[^.]+$/, '') + '.xlsx');
const outputCsv = outputFile.replace(/\.xlsx?$/i, '.csv');

function normalize(v){ if (v === undefined || v === null) return ''; return String(v).trim(); }

console.log('Input:', inputFile);
console.log('Output:', outputFile);

const wb = XLSX.readFile(inputFile, { cellDates: true });
const sheetName = wb.SheetNames[0];
const sheet = wb.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
if (rows.length === 0) { console.error('Empty sheet'); process.exit(1); }

const header = rows[0].map(h => normalize(h));
const idx = name => header.findIndex(h => h === name);
const idx_seller = idx('판매처');
const idx_stock = idx('가용재고');
const idx_sellerOption = idx('판매처 옵션');

if (idx_seller === -1) { console.error('판매처 컬럼을 찾을 수 없습니다. 파일 헤더를 확인하세요.'); process.exit(1); }
if (idx_stock === -1) { console.error('가용재고 컬럼을 찾을 수 없습니다. 파일 헤더를 확인하세요.'); process.exit(1); }
if (idx_sellerOption === -1) { console.error('판매처 옵션 컬럼을 찾을 수 없습니다. 파일 헤더를 확인하세요.'); process.exit(1); }

// Filter rules
const excludeSellers = ['쿠팡', 'B2B', 'B2C']; // substrings
const excludeSellerOptionKeywords = ['순차출고', '예약출고', '예약', '출고'];

const outRows = [rows[0]]; // keep header
let total = 0, filtered = 0;
for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  if (!row || row.length === 0) continue;
  total++;
  const seller = normalize(row[idx_seller]).toLowerCase();
  const stockRaw = normalize(row[idx_stock]);
  const sellerOption = normalize(row[idx_sellerOption]).toLowerCase();

  // 1) exclude sellers containing any of excludeSellers
  let skip = false;
  for (const ex of excludeSellers) {
    if (seller.includes(ex.toLowerCase())) { skip = true; break; }
  }
  if (skip) { filtered++; continue; }

  // 2) exclude negative stock (가용재고 < 0)
  const stockNum = parseFloat(stockRaw.replace(/[^0-9.\-]/g, ''));
  if (!isNaN(stockNum) && stockNum < 0) { filtered++; continue; }

  // 3) exclude seller options containing any of the keywords
  for (const kw of excludeSellerOptionKeywords) {
    if (sellerOption.includes(kw)) { skip = true; break; }
  }
  if (skip) { filtered++; continue; }

  outRows.push(row);
}

console.log('총 데이터 행:', total, '필터된 행:', filtered, '남은 행:', outRows.length-1);

// Write XLSX
const outWb = XLSX.utils.book_new();
const outSheet = XLSX.utils.aoa_to_sheet(outRows);
XLSX.utils.book_append_sheet(outWb, outSheet, 'filtered');
XLSX.writeFile(outWb, outputFile);

// Write CSV
const csvLines = outRows.map(r => r.map(c => typeof c === 'string' ? `"${c.replace(/"/g,'""')}`.replace(/"""/g,'""') + '"' : (c===undefined||c===null)?'':'"'+String(c).replace(/"/g,'""')+'"').join(','));
fs.writeFileSync(outputCsv, csvLines.join('\n'), 'utf8');
console.log('저장됨:', outputFile);
console.log('CSV 저장됨:', outputCsv);
