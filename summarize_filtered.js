const fs = require('fs');
const path = require('path');
const csvPath = path.resolve(__dirname, 'filtered_확장주문검색_20260624204220_340168441.csv');
const text = fs.readFileSync(csvPath, 'utf8');
const lines = text.split(/\r?\n/).filter(l => l.trim().length>0);
const header = lines[0].replace(/(^"|"$)/g,'').split('","');
const rows = lines.slice(1).filter(l => !l.startsWith('"합계"'));

function unquoteSplit(line) {
  // crude split for this CSV
  const parts = [];
  let cur = '';
  let inq = false;
  for (let i=0;i<line.length;i++){
    const ch = line[i];
    if (ch === '"') { inq = !inq; continue; }
    if (ch === ',' && !inq) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts.map(p=>p.trim());
}

const keyCols = ['주문번호','상품명','옵션명','상품수량','가용재고','송장번호','배송일','수령자휴대폰'];
const idxMap = {};
header.forEach((h,i)=> idxMap[h]=i);

const out = [];
for (let i=0;i<rows.length;i++){
  const parts = unquoteSplit(rows[i]);
  if (parts.length < 3) continue;
  const entry = {
    주문번호: parts[idxMap['주문번호']] || '',
    상품명: parts[idxMap['상품명']] || '',
    옵션명: parts[idxMap['옵션명']] || '',
    수량: parts[idxMap['상품수량']] || '',
    가용재고: parts[idxMap['가용재고']] || '',
    송장번호: parts[idxMap['송장번호']] || '',
    배송일: parts[idxMap['배송일']] || '',
    수령자휴대폰: parts[idxMap['수령자휴대폰']] || '',
  };
  out.push(entry);
}

console.log(JSON.stringify(out, null, 2));
