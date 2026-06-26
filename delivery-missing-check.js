const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

function usage() {
  console.log(`Usage:
  node delivery-missing-check.js <planned.xlsx> <shipped.xlsx> [options]

Options:
  --key <col1,col2,...>       Compare key columns for matching rows (default: 주문번호,상품코드)
  --qty <col>                  Quantity column name (default: 수량)
  --sheet <index>              Sheet index to read from each file (default: 0)
  --output <filename>          CSV output filename (default: delivery_missing_report.csv)
  --skip-headers <n>           Number of title rows to skip before the header row (default: 0)

Example:
  node delivery-missing-check.js plan.xls ship.xls --key "주문번호,상품코드" --qty "수량" --output report.csv
`);
}

function parseArgs(argv) {
  const args = {
    files: [],
    keyColumns: ['주문번호', '상품코드'],
    qtyColumn: '수량',
    sheetIndex: 0,
    output: 'delivery_missing_report.csv',
    skipHeaders: 0,
  };

  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--key' && argv[i + 1]) {
      args.keyColumns = argv[i + 1].split(',').map(v => v.trim()).filter(Boolean);
      i += 2;
    } else if (arg === '--qty' && argv[i + 1]) {
      args.qtyColumn = argv[i + 1].trim();
      i += 2;
    } else if (arg === '--sheet' && argv[i + 1]) {
      args.sheetIndex = parseInt(argv[i + 1], 10) || 0;
      i += 2;
    } else if (arg === '--output' && argv[i + 1]) {
      args.output = argv[i + 1];
      i += 2;
    } else if (arg === '--skip-headers' && argv[i + 1]) {
      args.skipHeaders = parseInt(argv[i + 1], 10) || 0;
      i += 2;
    } else if (!arg.startsWith('--')) {
      args.files.push(arg);
      i += 1;
    } else {
      console.error('Unknown option:', arg);
      usage();
      process.exit(1);
    }
  }

  if (args.files.length !== 2) {
    usage();
    process.exit(1);
  }

  return args;
}

function normalizeValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number') return String(value).trim();
  return String(value).trim();
}

function readRows(filePath, sheetIndex, skipHeaders) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[sheetIndex] || workbook.SheetNames[0];
  if (!sheetName) throw new Error(`No sheet found in file: ${filePath}`);
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (rows.length <= skipHeaders) return [];
  return rows.slice(skipHeaders);
}

function findHeaderIndex(row, columnName) {
  const normalizedTarget = columnName.trim().toLowerCase();
  return row.findIndex(cell => normalizeValue(cell).toLowerCase() === normalizedTarget);
}

function buildKey(row, keyIndices) {
  return keyIndices.map(index => normalizeValue(row[index]).toLowerCase()).join('||');
}

function parseSheet(filePath, sheetIndex, skipHeaders, keyColumns, qtyColumn) {
  const rows = readRows(filePath, sheetIndex, skipHeaders);
  if (rows.length === 0) return { summary: new Map(), headerRow: [] };

  const headerRow = rows[0].map(cell => normalizeValue(cell));
  const keyIndices = keyColumns.map(col => {
    const idx = findHeaderIndex(headerRow, col);
    if (idx === -1) throw new Error(`Key column not found: ${col} in ${filePath}`);
    return idx;
  });
  const qtyIndex = findHeaderIndex(headerRow, qtyColumn);
  if (qtyIndex === -1) throw new Error(`Quantity column not found: ${qtyColumn} in ${filePath}`);

  const summary = new Map();
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row || row.length === 0) continue;
    const key = buildKey(row, keyIndices);
    if (!key) continue;
    const qtyValue = normalizeValue(row[qtyIndex]).replace(/[^0-9.\-]/g, '');
    const qty = qtyValue === '' ? 0 : parseFloat(qtyValue) || 0;
    const existing = summary.get(key) || { qty: 0, values: keyIndices.map(index => normalizeValue(row[index])) };
    existing.qty += qty;
    summary.set(key, existing);
  }

  return { summary, headerRow };
}

function buildReport(plannedSummary, shippedSummary, keyColumns) {
  const report = [];
  const allKeys = new Set([...plannedSummary.keys(), ...shippedSummary.keys()]);

  allKeys.forEach(key => {
    const planned = plannedSummary.get(key) || { qty: 0, values: [] };
    const shipped = shippedSummary.get(key) || { qty: 0, values: [] };
    const diff = planned.qty - shipped.qty;
    const status = diff === 0 ? '정상' : diff > 0 ? '누락' : '초과';
    const keyValues = planned.values.length ? planned.values : shipped.values;
    report.push({ keyValues, plannedQty: planned.qty, shippedQty: shipped.qty, diff, status });
  });

  report.sort((a, b) => {
    if (a.status !== b.status) return a.status.localeCompare(b.status);
    return b.diff - a.diff;
  });
  return report;
}

function writeCsv(report, outputPath, keyColumns) {
  const header = [...keyColumns, '상태', '예정수량', '출하수량', '차이'];
  const lines = [header.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')];

  report.forEach(item => {
    const keyCells = item.keyValues.map(value => `"${value.replace(/"/g, '""')}"`);
    lines.push([...keyCells, item.status, item.plannedQty, item.shippedQty, item.diff].join(','));
  });

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
}

function main() {
  const args = parseArgs(process.argv);
  const [plannedFile, shippedFile] = args.files;
  const plannedPath = path.resolve(plannedFile);
  const shippedPath = path.resolve(shippedFile);

  if (!fs.existsSync(plannedPath) || !fs.existsSync(shippedPath)) {
    console.error('파일을 찾을 수 없습니다. 파일 경로를 확인하세요.');
    process.exit(1);
  }

  console.log('계획 파일:', plannedPath);
  console.log('출고 파일:', shippedPath);
  console.log('비교 키:', args.keyColumns.join(', '));
  console.log('수량 컬럼:', args.qtyColumn);

  const { summary: plannedSummary } = parseSheet(plannedPath, args.sheetIndex, args.skipHeaders, args.keyColumns, args.qtyColumn);
  const { summary: shippedSummary } = parseSheet(shippedPath, args.sheetIndex, args.skipHeaders, args.keyColumns, args.qtyColumn);
  const report = buildReport(plannedSummary, shippedSummary, args.keyColumns);

  const missing = report.filter(item => item.status === '누락').length;
  const over = report.filter(item => item.status === '초과').length;
  const ok = report.filter(item => item.status === '정상').length;

  console.log(`결과: 전체 ${report.length}건, 누락 ${missing}건, 초과 ${over}건, 정상 ${ok}건`);
  writeCsv(report, args.output, args.keyColumns);
  console.log('리포트 저장됨:', args.output);
}

main();
