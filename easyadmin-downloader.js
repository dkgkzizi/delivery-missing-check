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
    const cnt = await element.count();
    if (cnt) {
      await element.first().fill(value);
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

async function clickIfExists(locator) {
  const count = await locator.count();
  for (let i = 0; i < count; i++) {
    try {
      await locator.nth(i).click({ timeout: 2000 }).catch(() => {});
    } catch (err) {
      // ignore click failures
    }
  }
}

async function dismissPopups(frame) {
  const selectors = [
    'button:has-text("팝업 전체 닫기")',
    'button:has-text("전체 닫기")',
    'button:has-text("닫기")',
    'button:has-text("확인")',
    'button:has-text("취소")',
    'button:has-text("바로가기")',
    'button:has-text("다운로드 신청")',
    'button:has-text("다운로드 신청하기")',
    'a:has-text("팝업 전체 닫기")',
    'a:has-text("닫기")',
    'a:has-text("확인")',
    'a:has-text("바로가기")',
    'a:has-text("다운로드 신청")'
  ];

  for (const selector of selectors) {
    const locator = frame.locator(selector);
    await clickIfExists(locator);
  }

  const closeSelectors = [
    '.modal-close',
    '.close-button',
    '.popup-close',
    '.layer-close',
    '.btn-close',
    '[aria-label="닫기"]',
    '[aria-label="close"]',
    '.btn_modal_close',
    '.btn-pop-close'
  ];

  for (const selector of closeSelectors) {
    const locator = frame.locator(selector);
    await clickIfExists(locator);
  }

  const childFrames = typeof frame.childFrames === 'function' ? frame.childFrames() :
    (typeof frame.frames === 'function' ? frame.frames() : []);

  for (const child of childFrames) {
    await dismissPopups(child);
  }
}

async function run() {
  let browser;
  let context;
  let page;
  try {
    await fs.promises.mkdir(DOWNLOAD_DIR, { recursive: true });
    await fs.promises.mkdir(DEBUG_DIR, { recursive: true });

    const headlessMode = (process.env.HEADLESS || 'true') === 'true';
    browser = await chromium.launch({ headless: headlessMode, slowMo: process.env.SLOWMO ? Number(process.env.SLOWMO) : 0 });
    context = await browser.newContext({ acceptDownloads: true });
    page = await context.newPage();

    page.on('dialog', async dialog => {
      console.log('JS dialog detected:', dialog.message());
      try { await dialog.accept(); } catch (err) { console.error('Dialog accept failed:', err); }
    });

    console.log('Opening EasyAdmin login page...');
    await page.goto(EASYADMIN_URL, { waitUntil: 'domcontentloaded' });
    await dismissPopups(page);

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

    // Manual mode: allow user to navigate in the opened browser and press Enter to continue.
    const manual = (process.env.MANUAL || 'false') === 'true';
    if (manual && !headlessMode) {
      console.log('MANUAL mode active: 브라우저에서 다운로드 페이지로 이동한 뒤 Enter를 눌러주세요.');
      process.stdin.resume();
      await new Promise(resolve => process.stdin.once('data', () => resolve()));
      process.stdin.pause();
      console.log('Continuing after manual confirmation...');
    }

    const downloadFile = path.resolve(DOWNLOAD_DIR, DOWNLOAD_FILENAME);
    let download;

    // Try to navigate to the search page and perform the filter + download flow.
    try {
      // Close any modal/popups that may block interaction (generic attempt)
      async function dismissCommonPopups() {
        const btnTexts = ['확인', '닫기', '취소', '확인했습니다', '바로가기', '다운로드 신청', '다운로드 신청하기'];
        for (const t of btnTexts) {
          const locs = page.locator(`button:has-text("${t}"), a:has-text("${t}"), input:has-text("${t}")`);
          const cnt = await locs.count();
          for (let i = 0; i < cnt; i++) {
            try { await locs.nth(i).click({ timeout: 2000 }).catch(() => {}); } catch(e) {}
          }
        }
      }

      // Click top menu '주문배송관리'
      await dismissPopups(page);
      try { await page.locator('text=주문배송관리').first().click({ timeout: 5000 }); } catch (e) { /* ignore */ }
      await page.waitForTimeout(800);
      await dismissPopups(page);
      // Click left side menu '확장주문검색2'
      try { await page.locator('text=확장주문검색2').first().click({ timeout: 5000 }); } catch (e) { /* ignore */ }
      await page.waitForLoadState('networkidle');
      await dismissPopups(page);

      // Fill period = 발주일 (try to select option)
      try {
        // attempt to find a select that contains the option text
        const selects = await page.$$('select');
        for (const s of selects) {
          const opt = await s.$(`option:has-text("발주일")`);
          if (opt) { await s.selectOption({ index: await (await s.$$('option')).then(opts=>opts.findIndex(o=>o === opt)) }).catch(()=>{}); break; }
        }
      } catch (e) {}

      // Compute date strings: yesterday 16:00 to today 23:59
      const now = new Date();
      const todayStr = now.toISOString().slice(0,10);
      const y = new Date(now.getTime() - 24*3600*1000);
      const yesterdayStr = y.toISOString().slice(0,10);

      // Try to fill date inputs (various possible selectors)
      const datePairs = [
        ['input[name*=start]', `${yesterdayStr} 16:00`],
        ['input[name*=end]', `${todayStr} 23:59`],
        ['input[placeholder*=시작]', `${yesterdayStr} 16:00`],
        ['input[placeholder*=종료]', `${todayStr} 23:59`],
        ['input[type=date]', yesterdayStr]
      ];
      for (const [sel, val] of datePairs) {
        try { const els = page.locator(sel); if (await els.count()) { await els.first().fill(val).catch(()=>{}); } } catch(e){}
      }

      // Set 상태 = 송장, C/S = 정상+교환 if possible
      try { await page.locator('text=상태').first().click().catch(()=>{}); await page.locator('text=송장').first().click().catch(()=>{}); } catch (e) {}
      try { await page.locator('text=C/S').first().click().catch(()=>{}); await page.locator('text=정상+교환').first().click().catch(()=>{}); } catch (e) {}

      // Click 검색
      try { await page.locator('button:has-text("검색"), input:has-text("검색")').first().click({ timeout: 5000 }); } catch (e) {}
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // Dismiss any popups now
      await dismissPopups(page);

      // Click download button
      try {
        const downloadLoc = page.locator('button:has-text("다운로드"), a:has-text("다운로드"), button:has-text("엑셀"), a:has-text("엑셀")').first();
        if (await downloadLoc.count()) {
          // start waiting for download
          const dlPromise = context.waitForEvent('download', { timeout: 120000 });
          await downloadLoc.click().catch(()=>{});
          // after clicking it may open popups; attempt to handle them
          await page.waitForTimeout(1000);
          await dismissPopups(page);
          download = await dlPromise.catch(()=>null);
        }
      } catch (e) {
        console.error('다운로드 클릭 시도 중 예외:', e);
      }

      // If a popup asks to proceed to download manager (바로가기) try clicking it
      try { await page.locator('a:has-text("바로가기"), button:has-text("바로가기")').first().click({ timeout: 3000 }).catch(()=>{}); } catch(e){}

      // If still no download, attempt to navigate to download manager page by link text
      if (!download) {
        try { await page.locator('text=다운로드관리, text=다운로드 관리자, text=다운로드관리자'.split(',').map(s=>s.trim()).join(' >> ')).catch(()=>{}); } catch(e){}
      }

      // If arrived at download manager, poll for 100% progress
      try {
        // flexible approach: reload until the page contains '100%'
        const maxTries = 60; // up to several minutes
        for (let i=0;i<maxTries && !download;i++) {
          const content = await page.content();
          if (content.indexOf('100%') !== -1 || content.indexOf('100 %') !== -1) {
            // try to click the first downloadable filename/link
            const link = page.locator('a:has-text(".xls"), a:has-text(".xlsx"), a:has-text("다운로드")').first();
            if (await link.count()) {
              const dlPromise2 = context.waitForEvent('download', { timeout: 60000 }).catch(()=>null);
              await link.click().catch(()=>{});
              download = await dlPromise2;
              break;
            }
          }
          await page.waitForTimeout(2000);
          await page.reload({ waitUntil: 'networkidle' }).catch(()=>{});
        }
      } catch (e) { /* ignore */ }

    } catch (err) {
      console.error('다운로드 흐름 실행 중 오류:', err);
      await saveDebug(page, 'download-flow-error');
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
