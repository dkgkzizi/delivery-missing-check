const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const EASYADMIN_URL = process.env.EASYADMIN_URL || 'https://login2.ezadmin.co.kr/login.htm';
const EASYADMIN_DOMAIN = process.env.EASYADMIN_DOMAIN;
const EASYADMIN_USER = process.env.EASYADMIN_USER;
const EASYADMIN_PASS = process.env.EASYADMIN_PASS;
const DOWNLOAD_URL = process.env.EASYADMIN_DOWNLOAD_URL || '';
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.resolve(__dirname, 'downloads');
const DOWNLOAD_FILENAME = process.env.DOWNLOAD_FILENAME || 'easyadmin_download.xls';
const DEBUG_DIR = process.env.DEBUG_DIR || path.resolve(__dirname, 'debug');

if (!EASYADMIN_DOMAIN || !EASYADMIN_USER || !EASYADMIN_PASS) {
  console.error('Missing required environment variables. Set EASYADMIN_DOMAIN, EASYADMIN_USER, EASYADMIN_PASS.');
  process.exit(1);
}

async function fillFirst(page, selectors, value) {
  for (const sel of selectors) {
    const element = page.locator(sel);
    if (await element.count()) {
      await element.fill(value);
      return true;
    }
  }
  return false;
}

async function saveDebug(page, namePrefix = 'error') {
  try {
    await fs.promises.mkdir(DEBUG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const png = path.join(DEBUG_DIR, `${namePrefix}_${ts}.png`);
    const html = path.join(DEBUG_DIR, `${namePrefix}_${ts}.html`);
    if (page) {
      await page.screenshot({ path: png, fullPage: true });
      const content = await page.content();
      await fs.promises.writeFile(html, content, 'utf8');
      console.log('Saved debug artifacts:', png, html);
    }
  } catch (e) {
    console.error('Failed to save debug artifacts:', e);
  }
}

async function run() {
  let browser;
  let context;
  let page;
  try {
    await fs.promises.mkdir(DOWNLOAD_DIR, { recursive: true });
    await fs.promises.mkdir(DEBUG_DIR, { recursive: true });

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ acceptDownloads: true });
    page = await context.newPage();

    console.log('Opening EasyAdmin login page...');
    await page.goto(EASYADMIN_URL, { waitUntil: 'domcontentloaded' });

    const domainFilled = await fillFirst(page, [
      'input[name*=domain]',
      'input[id*=domain]',
      'input[placeholder*=도메인]',
      'input[placeholder*=Domain]',
      'input[type=text]'
    ], EASYADMIN_DOMAIN);

    const userFilled = await fillFirst(page, [
      'input[name*=user]',
      'input[id*=user]',
      'input[placeholder*=아이디]',
      'input[placeholder*=ID]',
      'input[type=text]'
    ], EASYADMIN_USER);

    const passFilled = await fillFirst(page, [
      'input[name*=pass]',
      'input[id*=pass]',
      'input[placeholder*=비밀번호]',
      'input[placeholder*=Password]',
      'input[type=password]'
    ], EASYADMIN_PASS);

    if (!domainFilled || !userFilled || !passFilled) {
      console.error('로그인 폼 입력 필드를 찾을 수 없습니다. 페이지 구조가 변경되었을 수 있습니다.');
      await saveDebug(page, 'login-form-missing');
      process.exit(1);
    }

    console.log('로그인 정보 입력 완료. 로그인 시도 중...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null),
      page.click('button[type=submit], input[type=submit], button:has-text("로그인"), input:has-text("로그인")')
    ]);

    console.log('로그인 완료를 기다리는 중...');
    await page.waitForLoadState('networkidle');

    if (DOWNLOAD_URL) {
      console.log('다운로드 페이지로 이동:', DOWNLOAD_URL);
      await page.goto(DOWNLOAD_URL, { waitUntil: 'networkidle' });
    } else {
      console.log('다운로드 URL이 설정되지 않았습니다. 로그인 후 사용자 지정 URL을 지정하세요(EASYADMIN_DOWNLOAD_URL).');
    }

    const downloadFile = path.resolve(DOWNLOAD_DIR, DOWNLOAD_FILENAME);
    let download;

    try {
      // start waiting for download, then click
      const clickPromise = (async () => {
        await page.click('a:has-text("엑셀"), button:has-text("엑셀"), a:has-text("다운로드"), button:has-text("다운로드")');
      })();
      download = await Promise.race([
        context.waitForEvent('download', { timeout: 20000 }),
        (async () => { await clickPromise; return null; })()
      ]);
    } catch (err) {
      console.error('다운로드 링크를 찾거나 다운로드를 시작할 수 없습니다. 페이지 구조를 확인하세요.');
      await saveDebug(page, 'download-fail');
      process.exit(1);
    }

    if (!download) {
      console.error('다운로드가 감지되지 않았습니다. 본 스크립트는 자동 엑셀 다운로드를 지원합니다.');
      await saveDebug(page, 'download-not-detected');
      process.exit(1);
    }

    console.log('다운로드 중...');
    await download.saveAs(downloadFile);
    console.log('다운로드 완료:', downloadFile);

    const outputFile = path.join(DOWNLOAD_DIR, `filtered_${path.basename(downloadFile, path.extname(downloadFile))}.xlsx`);
    console.log('필터 스크립트 실행:', downloadFile);
    execFileSync('node', ['filter_easyadmin.js', downloadFile, outputFile], { stdio: 'inherit' });
    console.log('필터 완료:', outputFile);
  } catch (err) {
    console.error('스크립트 실행 중 오류 발생:', err);
    await saveDebug(page, 'uncaught-error');
    process.exit(1);
  } finally {
    try { if (browser) await browser.close(); } catch (e) {}
  }
}

run();
