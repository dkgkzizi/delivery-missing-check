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

async function selectOptionByLabel(page, labelText, optionText) {
  const selects = page.locator('select');
  const count = await selects.count();
  for (let i = 0; i < count; i++) {
    const select = selects.nth(i);
    const options = await select.locator('option').allTextContents();
    const normalized = options.map(o => o.trim());
    if (normalized.some(o => o === optionText || o.includes(optionText))) {
      await select.selectOption({ label: optionText }).catch(() => {});
      return true;
    }
    const parentText = await select.evaluate(el => el.closest('div,td,tr')?.innerText || '');
    if (parentText.includes(labelText)) {
      await select.selectOption({ label: optionText }).catch(() => {});
      return true;
    }
  }
  return false;
}

async function fillDateFields(page, startValue, endValue) {
  const inputs = page.locator('input');
  const count = await inputs.count();
  let startFilled = false;
  let endFilled = false;

  for (let i = 0; i < count; i++) {
    const input = inputs.nth(i);
    const attrs = await input.evaluate(el => ({ name: el.name || '', id: el.id || '', placeholder: el.placeholder || '', ariaLabel: el.getAttribute('aria-label') || '' }));
    const label = `${attrs.name} ${attrs.id} ${attrs.placeholder} ${attrs.ariaLabel}`;

    if (!startFilled && /(?:start|from|sdate|시작|출발)/i.test(label)) {
      await input.fill(startValue).catch(() => {});
      startFilled = true;
      continue;
    }

    if (!endFilled && /(?:end|to|edate|종료|마감|~|23:59)/i.test(label)) {
      await input.fill(endValue).catch(() => {});
      endFilled = true;
      continue;
    }
  }

  if (!startFilled) {
    const startInput = page.locator('input[name*=start], input[id*=start], input[placeholder*=시작]');
    if (await startInput.count()) {
      await startInput.first().fill(startValue).catch(() => {});
      startFilled = true;
    }
  }

  if (!endFilled) {
    const endInput = page.locator('input[name*=end], input[id*=end], input[placeholder*=종료]');
    if (await endInput.count()) {
      await endInput.first().fill(endValue).catch(() => {});
      endFilled = true;
    }
  }
}

async function locateSearchArea(page) {
  const area = page.locator('div:has-text("확장주문검색2"), section:has-text("확장주문검색2"), form:has-text("확장주문검색2")').first();
  if (await area.count()) return area;
  return page;
}

async function selectDropdownInArea(area, optionText) {
  const dropdown = area.locator(`text=${optionText}`);
  if (await dropdown.count()) {
    await dropdown.first().click({ timeout: 3000 }).catch(() => {});
    return true;
  }
  return false;
}

async function selectOptionInAreaByLabel(area, labelText, optionText) {
  // Find elements that look like a label/title then find a nearby select
  const labelLocs = area.locator(`xpath=.//*[normalize-space(text())="${labelText}"]`);
  const cnt = await labelLocs.count();
  for (let i = 0; i < cnt; i++) {
    try {
      const labelEl = labelLocs.nth(i);
      // try following select within the same container
      const parent = await labelEl.evaluateHandle(el => el.closest('div,td,tr') || el.parentElement);
      if (parent) {
        const select = await parent.asElement().$('select');
        if (select) {
          try { await parent.asElement().evaluate((p, opt) => {
              const s = p.querySelector('select');
              if (!s) return;
              for (const o of Array.from(s.options)) if (o.text.trim() === opt) { s.value = o.value; s.dispatchEvent(new Event('change')); break; }
            }, optionText);
            return true;
          } catch (e) {}
        }
      }
    } catch (e) {}
  }
  // fallback: click the visible option text inside area
  return await selectDropdownInArea(area, optionText);
}

async function clickExactLabel(area, label) {
  const locator = area.locator(`xpath=.//a[normalize-space(text())="${label}"] | .//button[normalize-space(text())="${label}"] | .//span[normalize-space(text())="${label}"] | .//div[normalize-space(text())="${label}"]`);
  const count = await locator.count();
  if (count) {
    console.log(`clickExactLabel: found ${count} matches for '${label}' in area`);
    await locator.first().click({ timeout: 5000 }).catch(() => {});
    return true;
  }
  return false;
}

async function clickTopMenu(page, label) {
  const topArea = page.locator('header, nav, .gnb, .top-menu, .topNav, .header-nav').first();
  if (await topArea.count() && await clickExactLabel(topArea, label)) return true;
  const pageArea = page.locator(`xpath=//a[normalize-space(text())="${label}"] | //button[normalize-space(text())="${label}"] | //span[normalize-space(text())="${label}"]`).first();
  if (await pageArea.count()) {
    console.log(`clickTopMenu: fallback found '${label}' in entire page`);
    await pageArea.click({ timeout: 5000 }).catch(() => {});
    return true;
  }
  console.warn(`clickTopMenu: failed to find '${label}'`);
  return false;
}

async function clickSideMenu(page, label) {
  const sideArea = page.locator('aside, .sidebar, .left-menu, .side-menu, .gnb, .navigation').first();
  if (await sideArea.count() && await clickExactLabel(sideArea, label)) return true;
  console.warn(`clickSideMenu: failed to find '${label}' in side menu`);
  return false;
}

async function closeDatePicker(page) {
  try {
    await page.keyboard.press('Escape').catch(() => {});
    await clickIfExists(page.locator('button:has-text("닫기"), a:has-text("닫기"), span:has-text("닫기")'));
    await page.waitForTimeout(300);
  } catch (e) {
    // ignore if no date picker open
  }
}

async function dismissPopups(frame) {
  const selectors = [
    'button:has-text("팝업 전체 닫기")',
    'button:has-text("팝업 닫기")',
    'button:has-text("전체 닫기")',
    'button:has-text("닫기")',
    'button:has-text("확인")',
    'button:has-text("취소")',
    'button:has-text("바로가기")',
    'button:has-text("다운로드 신청")',
    'button:has-text("다운로드 신청하기")',
    'a:has-text("팝업 전체 닫기")',
    'a:has-text("팝업 닫기")',
    'a:has-text("닫기")',
    'a:has-text("확인")',
    'a:has-text("바로가기")',
    'a:has-text("다운로드 신청")',
    '*:has-text("팝업 전체 닫기")',
    '*:has-text("팝업 닫기")',
    '*:has-text("닫기")',
    '*:has-text("확인")',
    '*:has-text("바로가기")',
    '*:has-text("다운로드 신청")'
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

async function handleDownloadPopups(page) {
  // Handles the multi-step download confirmation flow shown by the site.
  // Sequence: click '다운로드 신청' -> handle '확인' modals -> fill '확인했습니다' when requested -> click '바로가기'.
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      // 1) Click '다운로드 신청' if present
      const applyBtn = page.locator('button:has-text("다운로드 신청"), a:has-text("다운로드 신청")').first();
      if (await applyBtn.count() && await applyBtn.isVisible()) {
        await applyBtn.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(500);
        continue;
      }

      // 2) Look for modal/dialog container
      const modal = page.locator('div[role="dialog"], .modal, .layer-popup, .popup, .ui-dialog').first();
      if (await modal.count() && await modal.isVisible()) {
        const modalText = (await modal.innerText()).trim();

        // If modal asks to type '확인했습니다', fill the input and confirm
        if (modalText.indexOf('확인했습니다') !== -1) {
          const input = modal.locator('input[type=text], input').first();
          if (await input.count() && await input.isVisible()) {
            await input.fill('확인했습니다').catch(() => {});
            await page.waitForTimeout(150);
            const confirmBtn = modal.locator('button:has-text("확인"), a:has-text("확인")').first();
            if (await confirmBtn.count() && await confirmBtn.isVisible()) {
              await confirmBtn.click().catch(() => {});
              await page.waitForTimeout(500);
              continue;
            }
          }
        }

        // Otherwise, if modal has a '확인' button (e.g., 개인정보 안내), click it
        const okBtn = modal.locator('button:has-text("확인"), a:has-text("확인")').first();
        if (await okBtn.count() && await okBtn.isVisible()) {
          await okBtn.click().catch(() => {});
          await page.waitForTimeout(400);
          continue;
        }

        // If modal has '바로가기', click it and wait for navigation
        const goBtn = modal.locator('button:has-text("바로가기"), a:has-text("바로가기")').first();
        if (await goBtn.count() && await goBtn.isVisible()) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null),
            goBtn.click().catch(() => {})
          ]);
          return;
        }
      }

      // 3) Global '바로가기' (outside modal)
      const globalGo = page.locator('button:has-text("바로가기"), a:has-text("바로가기")').first();
      if (await globalGo.count() && await globalGo.isVisible()) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null),
          globalGo.click().catch(() => {})
        ]);
        return;
      }

      // 4) If nothing actionable yet, try to click any '닫기' or small '확인' buttons to clear overlays conservatively
      const extra = page.locator('button:has-text("닫기"), a:has-text("닫기")').first();
      if (await extra.count() && await extra.isVisible()) {
        await extra.click().catch(() => {});
        await page.waitForTimeout(300);
        continue;
      }

    } catch (e) {
      // ignore transient errors and retry
    }
    await page.waitForTimeout(400);
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

    context.on('page', async popup => {
      if (popup !== page) {
        try {
          console.log('Closing extra popup/tab opened by the site');
          await popup.close();
        } catch (e) {
          console.error('Failed to close extra popup/tab:', e);
        }
      }
    });

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
      await saveDebug(page, 'manual-confirmation');
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

      if (!manual) {
        // Click top menu '주문배송관리'
        await dismissPopups(page);
        await clickTopMenu(page, '주문배송관리');
        await page.waitForTimeout(1200);
        await dismissPopups(page);
        await page.waitForTimeout(600);
        await dismissPopups(page);
        // 주문배송관리 팝업 닫기 재시도
        await clickIfExists(page.locator('button:has-text("팝업 닫기"), a:has-text("팝업 닫기"), *:has-text("팝업 닫기")'));
        await dismissPopups(page);
        // Click left side menu '확장주문검색2'
        await clickSideMenu(page, '확장주문검색2');
        await page.waitForLoadState('networkidle');
        await dismissPopups(page);
        await page.waitForTimeout(800);
        await dismissPopups(page);
      }

      // Fill period = 발주일
      const searchArea = await locateSearchArea(page);
      try {
        await selectDropdownInArea(searchArea, '발주일');
      } catch (e) {}

      // Compute date strings: yesterday 16:00 to today 23:59
      const now = new Date();
      const todayStr = now.toISOString().slice(0,10);
      const y = new Date(now.getTime() - 24*3600*1000);
      const yesterdayStr = y.toISOString().slice(0,10);

      // Fill only the start date (작업일 기준 전날) via calendar, then select hour '16' separately.
      try {
        const startDateStr = yesterdayStr; // YYYY-MM-DD
        const dayOfMonth = String(y.getDate());

        const startInputLocator = searchArea.locator('input[name*=start], input[id*=start], input[placeholder*=시작], input[placeholder*=발주]').first();
        if (await startInputLocator.count()) {
          // open datepicker by clicking the input
          await startInputLocator.click({ force: true }).catch(() => {});

          // wait shortly for jQuery UI datepicker element
          const dp = page.locator('#ui-datepicker-div');
          try { await dp.waitFor({ state: 'visible', timeout: 1500 }); } catch(e) {}

          // try to click the day cell in the datepicker
          let clicked = false;
          try {
            const dayLocator = dp.locator(`xpath=.//a[normalize-space(text())='${dayOfMonth}']`).first();
            if (await dayLocator.count()) {
              await dayLocator.click({ timeout: 1200 }).catch(() => {});
              clicked = true;
            }
          } catch (e) {}

          // fallback: if calendar didn't work, fill date-only string into input
          if (!clicked) {
            try {
              await startInputLocator.fill(startDateStr).catch(() => {});
              await startInputLocator.evaluate(el => el.dispatchEvent(new Event('change'))).catch(() => {});
            } catch (e) {}
          }

          // Now select hour '16' from nearby select element (search area scoped)
          try {
            const selects = searchArea.locator('select');
            const scnt = await selects.count();
            for (let si = 0; si < scnt; si++) {
              const s = selects.nth(si);
              const opts = await s.locator('option').allTextContents();
              const norm = opts.map(o => o.trim());
              if (norm.includes('16') || norm.includes('16:00') || norm.includes('16시') ) {
                try { await s.selectOption({ label: '16' }).catch(() => {}); } catch(e) {}
                try { await s.selectOption({ value: '16' }).catch(() => {}); } catch(e) {}
                // dispatch change on select via evaluate to ensure any listeners run
                try { await s.evaluate(el => el.dispatchEvent(new Event('change'))).catch(() => {}); } catch(e) {}
                break;
              }
            }
          } catch (e) {}

        } else {
          // generic fallback: fill first input
          const inputs = searchArea.locator('input');
          if (await inputs.count()) await inputs.first().fill(startDateStr).catch(() => {});
        }
      } catch (e) {}
      await closeDatePicker(page);

      // Set 상태 = 송장 and C/S = 정상+교환 using label-scoped selection
      try { await selectOptionInAreaByLabel(searchArea, '상태', '송장'); } catch (e) {}
      try { await selectOptionInAreaByLabel(searchArea, 'C/S', '정상+교환'); } catch (e) {}

      // Trigger search via F2 to avoid clicking wrong elements, wait for results, then trigger download via F6.
      try {
        await page.keyboard.press('F2').catch(() => {});
      } catch (e) {}
      // Wait for the page to settle after search
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // After search completes, trigger the download hotkey F6 (site shortcut).
      try {
        await page.keyboard.press('F6').catch(() => {});
      } catch (e) {}
      await page.waitForTimeout(800);

      // Handle the expected download popups in sequence:
      // 1) Click '다운로드 신청'
      // 2) Click '확인'
      // 3) Fill '확인했습니다' into the confirmation input and click 확인
      // 4) Click '바로가기' to go to 다운로드관리자
      try {
        // helper to click a button/text if found
        async function clickIfTextExists(text, timeout = 1500) {
          const loc = page.locator(`button:has-text("${text}"), a:has-text("${text}"), input:has-text("${text}")`);
          if (await loc.count()) {
            await loc.first().click({ timeout }).catch(() => {});
            return true;
          }
          return false;
        }

        // try clicking '다운로드 신청' if present
        await clickIfTextExists('다운로드 신청');
        await page.waitForTimeout(400);

        // click '확인' on the 개인정보/안내 dialog
        // try a few times with small waits to avoid racing
        for (let i = 0; i < 3; i++) {
          const okClicked = await clickIfTextExists('확인');
          if (okClicked) break;
          await page.waitForTimeout(300);
        }

        // If an input is required (the '확인했습니다' prompt), fill it
        try {
          const inputLocator = page.locator('div:has(button:has-text("확인")) input, .modal input, .layer input, input[type=text], input[placeholder]');
          if (await inputLocator.count()) {
            const firstInput = inputLocator.first();
            await firstInput.fill('확인했습니다').catch(() => {});
            await page.waitForTimeout(200);
            // click confirm again
            await clickIfTextExists('확인');
          }
        } catch (e) {}

        await page.waitForTimeout(400);

        // finally click '바로가기' to navigate to download manager
        await clickIfTextExists('바로가기');
        await page.waitForTimeout(600);

      } catch (e) {
        // if anything fails, still attempt to dismiss generic popups
        await dismissPopups(page).catch(() => {});
      }

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
      throw err;
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
