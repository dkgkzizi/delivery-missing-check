const XLSX = require('xlsx');
const path = require('path');
const file = path.resolve(__dirname, '확장주문검색_20260624204220_340168441.xls');
console.log('Reading:', file);
const wb = XLSX.readFile(file, { cellDates: true });
console.log('Sheets:', wb.SheetNames);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
for (let i = 0; i < Math.min(20, rows.length); i++) {
  console.log(i, rows[i]);
}
