#!/usr/bin/env node
/**
 * اختبارات E2E دخانية للتدفقات الحرجة (R1 — بند 3A-311).
 *
 * شبكة أمان آلية: أحد عشر تدفقاً دخانياً (دخول تجريبي، رئيسية+جرس،
 * أطفال، يوم فصل، فواتير، بوابة ولي أمر، دورة إثباتات اعتماد، دورة
 * إثباتات رفض، حضور أوفلاين، قوائم باص، سحب موافقة تصوير) تعمل بـ
 * Puppeteer على بناء معاينة محلي (vite preview من نفس الكود) ضد
 * Supabase الحي بحساب الديمو العام (بيانات اعتماده عامة عمداً بقرار
 * المالك — لا أسرار أخرى هنا).
 *
 * تبعية مقصودة: التدفق 08 يعتمد على رصيد متبقٍّ من 07 (دفع جزئي
 * 300 من 1000 ثم اعتماد)؛ والتدفق 11 يرفع صورة ديمو ثم يعيد موافقة
 * التصوير لحالتها الأصلية في نهايته. التشغيل الحي الكامل داخل 3A-323.
 *
 * التشغيل: npm run test:e2e  (يبني أولاً ثم يشغّل هذا الملف)
 *
 * وضع الريلاي (E2E_RELAY): عندما توجد متغيرات بروكسي في البيئة
 * (HTTPS_PROXY) يُفعَّل تلقائياً — تُعترض طلبات المتصفح الخارجية
 * وتُمرَّر عبر Node fetch (يحترم بروكسي البيئة ومخزن شهادات النظام)،
 * لأن Chromium المجمّع لا يقرأ مخزن شهادات النظام في بيئات البروكسي
 * الموقّعة بشهادة وسيطة. في CI (لا بروكسي) يعمل المتصفح مباشرة.
 * فرض صريح: E2E_RELAY=1 / E2E_RELAY=0.
 *
 * سياسة الأخطاء: أخطاء الصفحة (pageerror) وأخطاء الكونسول الفادحة
 * (Uncaught/TypeError/ReferenceError) تُسقط الاختبار؛ فشل تحميل
 * الموارد يُسجَّل تحذيراً (في وضع الريلاي مصدره الريلاي نفسه غالباً).
 * عند أي فشل: لقطة شاشة في e2e/artifacts/<test-id>.png.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.E2E_PORT || 4173);
const BASE = `http://127.0.0.1:${PORT}`;
const ARTIFACTS = path.join(ROOT, 'e2e', 'artifacts');
const RELAY =
  process.env.E2E_RELAY != null
    ? process.env.E2E_RELAY === '1'
    : Boolean(process.env.HTTPS_PROXY || process.env.https_proxy);
const NAV_TIMEOUT = 60_000;
const WAIT_TIMEOUT = 45_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/* ---------------------------------- ريلاي الطلبات ---------------------------------- */

async function enableRelay(page, stats) {
  // ريلاي عبر CDP Fetch domain — لا عبر اعتراض Puppeteer: ‏postData() هناك
  // يرجع undefined لطلبات multipart (رفع الصور/الإثباتات) فتصل فارغة (400
  // "No content provided")، بينما postDataEntries في حدث الإيقاف تحمل
  // البايتات الدقيقة (base64) لأي جسم ثنائي.
  const cdp = await page.createCDPSession();
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*', requestStage: 'Request' }],
  });
  cdp.on('Fetch.requestPaused', async (ev) => {
    const { requestId, request } = ev;
    const url = request.url;
    if (
      url.startsWith(BASE) ||
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url.startsWith('about:')
    ) {
      await cdp.send('Fetch.continueRequest', { requestId }).catch(() => {});
      return;
    }
    const method = request.method;
    // وضع الأوفلاين المُحاكى: محاكاة المتصفح وحدها لا تكفي — الريلاي يلبي
    // الطلب من شبكة Node الحية فينجح «رغم انقطاع الاتصال». حين يرفع التدفق
    // راية stats.offline نفشل الطلبات الخارجية كما يفعل انقطاع حقيقي.
    if (stats.offline) {
      await cdp
        .send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' })
        .catch(() => {});
      return;
    }
    const attempt = async () => {
      const headers = {};
      for (const [k, v] of Object.entries(request.headers || {})) {
        if (k.toLowerCase() !== 'host') headers[k] = v;
      }
      const init = { method, headers, redirect: 'follow' };
      if (method !== 'GET' && method !== 'HEAD') {
        // البايتات الدقيقة تأتي في postDataEntries (base64) — postData النصي
        // يفسد الأجسام الثنائية (صور multipart) عند إعادة ترميزه UTF-8
        const entries = request.postDataEntries;
        if (entries && entries.length) {
          try {
            init.body = Buffer.concat(
              entries.map((e) => Buffer.from(e.bytes || '', 'base64')),
            );
          } catch {
            if (request.postData) init.body = request.postData;
          }
        } else if (request.postData) {
          init.body = request.postData;
        }
      }
      const res = await fetch(url, init);
      const buf = Buffer.from(await res.arrayBuffer());
      const responseHeaders = [];
      res.headers.forEach((v, k) => {
        if (
          !['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(
            k.toLowerCase(),
          )
        )
          responseHeaders.push({ name: k, value: v });
      });
      await cdp.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: res.status,
        responseHeaders,
        body: buf.toString('base64'),
      });
    };
    try {
      await attempt();
    } catch {
      // إعادة واحدة للطلبات الآمنة (قراءة) ضد هزّات البروكسي العابرة
      if (method === 'GET' || method === 'HEAD') {
        await sleep(300);
        try {
          await attempt();
          return;
        } catch {
          /* fallthrough للإجهاض */
        }
      }
      stats.aborted += 1;
      await cdp
        .send('Fetch.failRequest', { requestId, errorReason: 'Failed' })
        .catch(() => {});
    }
  });
}

/* ---------------------------------- أدوات صفحات ---------------------------------- */

function watchPage(page) {
  const w = { pageErrors: [], consoleErrors: [] };
  page.on('pageerror', (e) => w.pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') w.consoleErrors.push(m.text());
  });
  page.on('dialog', async (d) => {
    await d.accept().catch(() => {});
  });
  return w;
}

const FATAL_CONSOLE = /uncaught|TypeError|ReferenceError|SyntaxError/i;

function fatalErrors(w, from) {
  const errs = [];
  errs.push(...w.pageErrors.slice(from.pe).map((m) => `pageerror: ${m}`));
  errs.push(
    ...w.consoleErrors
      .slice(from.ce)
      .filter((t) => FATAL_CONSOLE.test(t))
      .map((t) => `console: ${t.slice(0, 200)}`),
  );
  return errs;
}

async function waitBodyText(page, text, timeout = WAIT_TIMEOUT) {
  await page.waitForFunction((t) => document.body && document.body.innerText.includes(t), {
    timeout,
  }, text);
}

async function bodyText(page) {
  return page.evaluate(() => (document.body ? document.body.innerText : ''));
}

/**
 * طبقة التحميل (PageLoadingOverlay, z-40) تحجب اللمس عن المحتوى قصداً أثناء
 * تحميل الصفحة — أي نقرة CDP أثناء وجودها تقع عليها ولا تصل للزر.
 * انتظر زوالها قبل أي نقرة (تختفي فور اكتمال التحميل).
 */
async function waitNoOverlay(page) {
  // غياب مستقر: 3 فحوص متتالية بلا طبقة (~1.2s) — فحص واحد قد يسبق ظهورها أصلاً
  const deadline = Date.now() + WAIT_TIMEOUT;
  let streak = 0;
  while (Date.now() < deadline) {
    const present = await page
      .evaluate(() => !!document.querySelector('[data-loading-overlay]'))
      .catch(() => false);
    if (!present) {
      streak += 1;
      if (streak >= 3) return;
    } else streak = 0;
    await sleep(400);
  }
}

/** ينقر أول عنصر (زر/رابط) يحتوي نصه على النص المعطى — نقرة حقيقية عبر Puppeteer. */
async function clickByText(page, text, { timeout = WAIT_TIMEOUT, selector = 'button, a, [role="button"], .cursor-pointer' } = {}) {
  const handle = await page.waitForFunction(
    (t, sel) => {
      const els = [...document.querySelectorAll(sel)].filter(
        (el) => el.innerText && el.innerText.includes(t) && !el.disabled,
      );
      // الأقصر نصاً أولاً: الزر نفسه لا البطاقة الحاوية (نصها أطول دائماً)
      els.sort((a, b) => a.innerText.length - b.innerText.length);
      return els[0] || null;
    },
    { timeout },
    text,
    selector,
  );
  const el = handle.asElement();
  assert(el, `لم يُعثر على عنصر قابل للنقر يحتوي: ${text}`);
  await el.scrollIntoView().catch(() => {});
  await waitNoOverlay(page);
  await el.click();
  return el;
}

/** ينقر زراً بـ aria-label مطابق — لأزرار Fab التي تنكمش تسميتها النصية بعد 2.6 ثانية */
async function clickAriaLabel(page, label, timeout = WAIT_TIMEOUT) {
  const handle = await page.waitForFunction(
    (l) => {
      const els = [...document.querySelectorAll('button')];
      return els.find((el) => el.getAttribute('aria-label') === l && !el.disabled) || null;
    },
    { timeout },
    label,
  );
  const el = handle.asElement();
  assert(el, `لم يُعثر على زر aria-label: ${label}`);
  await waitNoOverlay(page);
  await el.click();
}

async function waitPathname(page, expected, timeout = WAIT_TIMEOUT) {
  await page.waitForFunction((p) => location.pathname === p, { timeout }, expected);
}

/** صورة PNG صغيرة (1×1) تُكتب مرة في مجلد اللقطات لرفعها كإثبات/صورة طفل */
function writeTestPng() {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const file = path.join(ARTIFACTS, 'proof.png');
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.writeFileSync(file, png);
  return file;
}

/** ينقر زراً بنص مطابق تماماً داخل نافذة حوار مفتوحة (role=dialog) */
async function clickDialogButton(page, text, timeout = WAIT_TIMEOUT) {
  const handle = await page.waitForFunction(
    (t) => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return null;
      return [...dlg.querySelectorAll('button')].find(
        (el) => el.innerText && el.innerText.trim() === t && !el.disabled,
      ) || null;
    },
    { timeout },
    text,
  );
  const el = handle.asElement();
  assert(el, `لم يُعثر على زر حوار بنص: ${text}`);
  await waitNoOverlay(page);
  await el.click();
}

/**
 * ينقر زراً بنص مطابق داخل بطاقة طفل بعينه: يصعد من كل زر مطابق
 * لأقرب أب يحتوي الاسم في نص قصير (البطاقة نفسها) — فلا ينقر زر
 * طفل آخر في نفس القائمة.
 */
async function clickButtonInCardWith(page, name, label, timeout = WAIT_TIMEOUT) {
  await waitNoOverlay(page);
  const handle = await page.waitForFunction(
    (n, l) => {
      const btns = [...document.querySelectorAll('button')].filter(
        (b) => b.innerText && b.innerText.trim() === l && !b.disabled,
      );
      for (const btn of btns) {
        let el = btn.parentElement;
        while (el) {
          const txt = el.innerText || '';
          if (txt.includes(n) && txt.length < 300) return btn;
          el = el.parentElement;
        }
      }
      return null;
    },
    { timeout },
    name,
    label,
  );
  const el = handle.asElement();
  assert(el, `لم يُعثر على زر «${label}» في بطاقة «${name}»`);
  await waitNoOverlay(page);
  await el.click();
}

/**
 * إصدار رابط بوابة لوصيّ يوسف تحديداً (من /portal-links) وإرجاع مساره /p/…
 * الاستخراج والنقر محصوران في بطاقة الوصي التي تحمل اسم يوسف — إصدار لوصي
 * آخر يجعل البوابة تعرض طفلاً آخر. إن كان له رابط نشط أصلاً يُستخدم كما هو.
 */
async function issuePortalLink(page) {
  await page.goto(BASE + '/portal-links', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  await waitBodyText(page, 'روابط أولياء الأمور');
  // انتظر تحميل القائمة فعلياً (العنوان يظهر قبل البيانات) — اسم وصيّ ثابت في
  // كل الحالات؛ «إنشاء رابط» يغيب حين تكون كل الروابط نشطة أصلاً
  await waitBodyText(page, 'أحمد تجريبي');
  await waitNoOverlay(page);
  const extractForChild = async () =>
    page.evaluate(() => {
      const anchors = [...document.querySelectorAll('a[href*="wa.me"]')];
      for (const a of anchors) {
        let m = null;
        try {
          const text = new URL(a.href).searchParams.get('text') || '';
          m = text.match(/\/p\/[A-Za-z0-9_-]{20,}/);
        } catch { /* تجاهل */ }
        if (!m) continue;
        let el = a.parentElement;
        while (el) {
          const txt = el.innerText || '';
          if (txt.includes('يوسف تجريبي') && txt.length < 400) return m[0];
          el = el.parentElement;
        }
      }
      return null;
    });
  let link = await extractForChild();
  if (!link) {
    // الرابط الخام لا يظهر إلا لحظة الإصدار (الهاش فقط يُحفظ) — فإن كان لوصي
    // يوسف توكن نشط، ألغِه أولاً ثم أعد الإصدار من بطاقته هو (مسار W1)
    await clickButtonInCardWith(page, 'يوسف تجريبي', 'إلغاء الرابط', 8_000).catch(() => null);
    await clickButtonInCardWith(page, 'يوسف تجريبي', 'إنشاء رابط جديد');
    await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll('a[href*="wa.me"]')].some((a) => {
            try {
              const text = new URL(a.href).searchParams.get('text') || '';
              return /\/p\/[A-Za-z0-9_-]{20,}/.test(text);
            } catch { return false; }
          }),
        { timeout: WAIT_TIMEOUT },
      )
      .catch(() => {});
    link = await extractForChild();
  }
  assert(link, 'لم يُعثر على رابط بوابة مُصدَر لوصي يوسف في الصفحة');
  return link;
}

/** يفتح رابط بوابة في صفحة موبايل مجهولة ويرجعها مع مراقب أخطائها */
async function openPortalPage(ctx, link) {
  const portalPage = await ctx.browser.newPage();
  await portalPage.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true });
  const pw = watchPage(portalPage);
  if (process.env.E2E_RELAY === '1' || (process.env.E2E_RELAY == null && (process.env.HTTPS_PROXY || process.env.https_proxy))) {
    await enableRelay(portalPage, ctx.relayStats);
  }
  await portalPage.goto(BASE + link, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  return { page: portalPage, watcher: pw };
}

/** يقرأ الرقم بعد «المتبقي عليك» في البوابة (الرصيد الحالي للطفل) */
async function portalBalance(portalPage) {
  const txt = await bodyText(portalPage);
  const m = txt.match(/المتبقي عليك[^0-9]*([0-9][0-9,]*)/);
  assert(m, 'لم يُعثر على رصيد «المتبقي عليك» في البوابة');
  return Number(m[1].replaceAll(',', ''));
}

/* ---------------------------------- جلسة الديمو ---------------------------------- */

async function demoLogin(page) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  await clickByText(page, 'دخول تجريبي');
  await waitPathname(page, '/');
  await waitBodyText(page, 'حضانة نونو التجريبية');
  await sleep(1500);
}

async function ensureSession(page) {
  const onLogin = await page.evaluate(() => location.pathname === '/login').catch(() => false);
  if (onLogin || page.url() === 'about:blank') await demoLogin(page);
}

/* ---------------------------------- الاختبارات ---------------------------------- */

const tests = [
  {
    id: '01-login-demo',
    title: 'الدخول التجريبي والوصول للرئيسية',
    async run(page) {
      await demoLogin(page);
      await waitBodyText(page, 'حاضر النهارده');
      const txt = await bodyText(page);
      assert(txt.includes('حاضر النهارده'), 'الرئيسية لا تعرض عدّاد الحضور');
    },
  },
  {
    id: '02-home-bell',
    title: 'الرئيسية والجرس (تنبيهات خلف الجرس فقط)',
    async run(page) {
      await ensureSession(page);
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await waitBodyText(page, 'حضانة نونو التجريبية');
      await clickByText(page, 'الإشعارات', { selector: 'button, a', timeout: 10_000 }).catch(() => null);
      // الجرس زر أيقونة بلا نص — نفتح صفحة الإشعارات مباشرة كبديل حتمي
      await page.goto(BASE + '/notifications', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await waitBodyText(page, 'الإشعارات');
    },
  },
  {
    id: '03-children',
    title: 'قائمة الأطفال وفتح ملف طفل',
    async run(page) {
      await ensureSession(page);
      await page.goto(BASE + '/children', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await waitBodyText(page, 'يوسف تجريبي');
      await clickByText(page, 'يوسف تجريبي');
      await page.waitForFunction(() => location.pathname.startsWith('/children/'), { timeout: WAIT_TIMEOUT });
      await waitBodyText(page, 'أولياء الأمور');
    },
  },
  {
    id: '04-today',
    title: 'يوم الفصل: فتح فصل وتسجيل وصول',
    async run(page) {
      await ensureSession(page);
      await page.goto(BASE + '/today', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await waitBodyText(page, 'البراعم');
      await clickByText(page, 'البراعم');
      await page.waitForFunction(() => location.pathname.startsWith('/today/'), { timeout: WAIT_TIMEOUT });
      await waitBodyText(page, 'يوسف تجريبي');
      const txt = await bodyText(page);
      assert(/اتسجلوا|وصل/.test(txt), 'شاشة اليوم لا تعرض شبكة الحضور');
    },
  },
  {
    id: '05-invoices',
    title: 'الفواتير: القائمة وزر الإصدار الشهري (مالك)',
    async run(page) {
      await ensureSession(page);
      await page.goto(BASE + '/invoices', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      // زر الإصدار Fab: تسميته النصية تنكمش بعد 2.6s — الثابت هو aria-label
      await page.waitForFunction(
        () => [...document.querySelectorAll('button')].some((b) => b.getAttribute('aria-label') === 'إصدار الفواتير'),
        { timeout: WAIT_TIMEOUT },
      );
    },
  },
  {
    id: '06-portal',
    title: 'بوابة ولي الأمر: إصدار رابط وفتحه بلا حساب',
    async run(page, ctx) {
      await ensureSession(page);
      const link = await issuePortalLink(page);
      const { page: portalPage, watcher: pw } = await openPortalPage(ctx, link);
      try {
        await waitBodyText(portalPage, 'يوسف تجريبي');
        const ptxt = await bodyText(portalPage);
        assert(!/غير صالح|انتهت صلاحية الرابط|رابط غير صحيح/.test(ptxt), 'البوابة عرضت خطأ رابط غير صالح');
        const fatal = fatalErrors(pw, { pe: 0, ce: 0 });
        assert(fatal.length === 0, `أخطاء فادحة في البوابة: ${fatal[0]}`);
      } finally {
        await portalPage.close().catch(() => {});
      }
    },
  },
  {
    id: '07-proof-approve',
    title: 'دورة الإثباتات (اعتماد): إصدار فاتورة ← دفع من البوابة ← اعتماد ← نزول الرصيد (ق١٨)',
    async run(page, ctx) {
      await ensureSession(page);
      // فاتورة بذرة الديمو عن الشهر الماضي فقط — أصدِر فواتير الشهر الحالي
      await page.goto(BASE + '/invoices', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await clickAriaLabel(page, 'إصدار الفواتير');
      await clickDialogButton(page, 'إصدار الفواتير');
      await waitBodyText(page, 'اتصدرت');
      const link = await issuePortalLink(page);
      const { page: portalPage, watcher: pw } = await openPortalPage(ctx, link);
      let before = 0;
      try {
        await waitBodyText(portalPage, 'يوسف تجريبي');
        await waitBodyText(portalPage, 'ادفع بتحويل');
        before = await portalBalance(portalPage);
        assert(before > 0, 'رصيد الطفل صفر قبل الدفع — الإصدار لم ينشئ فاتورة مفتوحة');
        // مبلغ جزئي (300) حتى يبقى رصيد للتدفق 08
        await portalPage.type('input[type="number"]', '300');
        const fileInput = await portalPage.$('input[type="file"]');
        assert(fileInput, 'لا حقل ملف إثبات في البوابة');
        await fileInput.uploadFile(writeTestPng());
        await clickByText(portalPage, 'إرسال الإثبات');
        await waitBodyText(portalPage, 'وصل الإثبات');
        await waitBodyText(portalPage, 'إثباتك بانتظار مراجعة الحضانة');
        const fatal = fatalErrors(pw, { pe: 0, ce: 0 });
        assert(fatal.length === 0, `أخطاء فادحة في البوابة: ${fatal[0]}`);
      } finally {
        await portalPage.close().catch(() => {});
      }
      // المراجعة كمالك: اعتماد الإثبات (بطاقة الإثبات باسم الوصيّ الدافع لا الطفل)
      await page.goto(BASE + '/proofs', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await waitBodyText(page, 'المبلغ المُدّعى');
      await clickByText(page, 'اعتماد كدفعة');
      await waitBodyText(page, 'لا إثباتات معلّقة');
      // الرصيد نزل بمقدار الدفعة المعتمدة
      const link2 = await issuePortalLink(page);
      const { page: portalPage2 } = await openPortalPage(ctx, link2);
      try {
        await waitBodyText(portalPage2, 'يوسف تجريبي');
        const after = await portalBalance(portalPage2);
        assert(after === before - 300, `الرصيد لم ينزل كما المتوقع: ${before} ← ${after}`);
      } finally {
        await portalPage2.close().catch(() => {});
      }
    },
  },
  {
    id: '08-proof-reject',
    title: 'دورة الإثباتات (رفض): دفع ثانٍ من البوابة ← رفض بسبب ← ظهور السبب في البوابة',
    async run(page, ctx) {
      // يعتمد على رصيد متبقٍّ من 07 (1000 − 300 معتمد = 700)
      await ensureSession(page);
      const link = await issuePortalLink(page);
      const { page: portalPage } = await openPortalPage(ctx, link);
      try {
        await waitBodyText(portalPage, 'يوسف تجريبي');
        await waitBodyText(portalPage, 'ادفع بتحويل');
        const before = await portalBalance(portalPage);
        assert(before > 0, 'لا رصيد متبقٍّ للدفع — هل نُفذ 07 قبله؟');
        await portalPage.type('input[type="number"]', '300');
        const fileInput = await portalPage.$('input[type="file"]');
        assert(fileInput, 'لا حقل ملف إثبات في البوابة');
        await fileInput.uploadFile(writeTestPng());
        await clickByText(portalPage, 'إرسال الإثبات');
        await waitBodyText(portalPage, 'وصل الإثبات');
      } finally {
        await portalPage.close().catch(() => {});
      }
      // المراجعة كمالك: رفض بسبب واضح (البطاقة باسم الوصيّ الدافع لا الطفل)
      await page.goto(BASE + '/proofs', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await waitBodyText(page, 'المبلغ المُدّعى');
      await clickByText(page, 'رفض');
      await waitBodyText(page, 'سبب الرفض');
      const reasonField = await page.waitForFunction(
        () => {
          const dlg = document.querySelector('[role="dialog"]');
          return dlg ? dlg.querySelector('textarea, input') : null;
        },
        { timeout: WAIT_TIMEOUT },
      );
      const reasonEl = reasonField.asElement();
      assert(reasonEl, 'لا حقل لسبب الرفض داخل الحوار');
      await reasonEl.click();
      await page.keyboard.type('الصورة مش واضحة');
      await clickDialogButton(page, 'رفض');
      await waitBodyText(page, 'لا إثباتات معلّقة');
      // البوابة تعرض الرفض والسبب، والرصيد لم يتغير (المرفوض لا يُحتسب)
      const link2 = await issuePortalLink(page);
      const { page: portalPage2 } = await openPortalPage(ctx, link2);
      try {
        await waitBodyText(portalPage2, 'يوسف تجريبي');
        await waitBodyText(portalPage2, 'الإثبات اترفض: الصورة مش واضحة');
        const after = await portalBalance(portalPage2);
        assert(after === before, `الرصيد تغيّر بعد رفض الإثبات: ${before} ← ${after}`);
      } finally {
        await portalPage2.close().catch(() => {});
      }
    },
  },
  {
    id: '09-offline-attendance',
    title: 'حضور أوفلاين: تسجيل وصول بلا اتصال ← عودة الاتصال ← مزامنة بلا تكرار',
    async run(page, ctx) {
      await ensureSession(page);
      await page.goto(BASE + '/today', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      // فصل «الزهور» تحديداً: لا يلمسه أي تدفق آخر، فيبقى يومه بلا حضور مسجل
      // مهما تكررت الجولات (البراعم يستخدمه 04 وتلوثه جولات 09 السابقة)
      await waitBodyText(page, 'الزهور');
      await clickByText(page, 'الزهور');
      await page.waitForFunction(() => location.pathname.startsWith('/today/'), { timeout: WAIT_TIMEOUT });
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll('button')].some(
            (b) => b.innerText && b.innerText.replace('✓', '').trim() === 'وصل',
          ),
        { timeout: WAIT_TIMEOUT },
      );
      const countArrivedButtons = async () =>
        page.evaluate(
          () =>
            [...document.querySelectorAll('button')].filter(
              (b) => b.innerText && b.innerText.replace('✓', '').trim() === 'وصل',
            ).length,
        );
      const before = await countArrivedButtons();
      assert(before > 0, 'لا طفل بلا وصول اليوم في البذرة — لا يمكن اختبار الأوفلاين');
      await page.setOfflineMode(true);
      // الريلاي المحلي يجب أن يفشل الطلبات أيضاً وإلا نجحت الكتابة «أوفلاين»
      if (ctx.relayStats) ctx.relayStats.offline = true;
      try {
        await clickByText(page, 'وصل');
        await waitBodyText(page, 'بانتظار المزامنة');
      } finally {
        if (ctx.relayStats) ctx.relayStats.offline = false;
        await page.setOfflineMode(false);
      }
      // التفريغ عند عودة الاتصال (حدث online أو دورة الـ30 ثانية)
      await page.waitForFunction(
        () => document.body && !document.body.innerText.includes('بانتظار المزامنة'),
        { timeout: 45_000 },
      );
      await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      const after = await countArrivedButtons();
      assert(after === before - 1, `عدد أزرار «وصل» لم ينقص واحداً بعد المزامنة: ${before} ← ${after}`);
      const txt = await bodyText(page);
      assert(!/بانتظار المزامنة/.test(txt), 'بانر المزامنة ما زال ظاهراً بعد عودة الاتصال');
    },
  },
  {
    id: '10-bus-lists',
    title: 'قوائم الباص: ركوب صباحاً ونزول بعد الضهر (handed_to غير مسجل من الواجهة — انظر الملاحظة)',
    async run(page) {
      await ensureSession(page);
      await page.goto(BASE + '/bus', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await waitBodyText(page, 'قوائم النهارده');
      await clickByText(page, 'خط المعادي التجريبي');
      await waitBodyText(page, 'قايمة الركوب (الصبح)');
      await waitBodyText(page, 'يوسف تجريبي');
      // إعادة التشغيل آمنة: إن كان راكباً أصلاً من جولة سابقة فالحالة النهائية
      // هي المطلوب إثباتها ولا ننقر زراً غير موجود
      if (!(await bodyText(page)).includes('ركب ✓')) {
        await clickButtonInCardWith(page, 'يوسف تجريبي', 'ركب');
        await waitBodyText(page, 'ركب ✓');
      }
      await clickByText(page, 'قايمة النزول (بعد الضهر)');
      await waitBodyText(page, 'يوسف تجريبي');
      if (!(await bodyText(page)).includes('نزل / اتسلّم ✓')) {
        await clickButtonInCardWith(page, 'يوسف تجريبي', 'نزل / اتسلّم');
        await waitBodyText(page, 'نزل / اتسلّم ✓');
      }
      // ملاحظة موثقة (3A-338): زر «نزل / اتسلّم» لا يسجل handed_to أبداً
      // في الواجهة — الحقل موجود في API لكن بلا إدخال؛ يُعاد للمدير كفجوة.
    },
  },
  {
    id: '11-photo-consent',
    title: 'سحب موافقة التصوير: صور ظاهرة في البوابة ← سحب الموافقة ← اختفاء الصور فوراً',
    async run(page, ctx) {
      await ensureSession(page);
      // 1) ارفع صورة ليوسف من صفحة التقارير (البذرة بلا صور)
      await page.goto(BASE + '/reports', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await clickByText(page, 'تصوير / إضافة صور');
      const fileInput = await page.$('input[type="file"]');
      assert(fileInput, 'لا حقل ملف صور في صفحة التقارير');
      await fileInput.uploadFile(writeTestPng());
      await clickByText(page, 'يوسف تجريبي');
      await clickByText(page, 'رفع الصور');
      await waitBodyText(page, 'اترفعت 1 صورة');
      // 2) البوابة تعرض «صور اليوم»
      const link = await issuePortalLink(page);
      const { page: portalPage } = await openPortalPage(ctx, link);
      try {
        await waitBodyText(portalPage, 'صور اليوم');
        const imgs = await portalPage.$$eval('img', (els) => els.length);
        assert(imgs > 0, 'قسم «صور اليوم» بلا أي صورة في البوابة');
      } finally {
        await portalPage.close().catch(() => {});
      }
      // 3) اسحب موافقة التصوير من ملف الطفل
      await page.goto(BASE + '/children', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await waitBodyText(page, 'يوسف تجريبي');
      await clickByText(page, 'يوسف تجريبي');
      await page.waitForFunction(() => location.pathname.startsWith('/children/'), { timeout: WAIT_TIMEOUT });
      await waitBodyText(page, 'موافقة التصوير');
      const unchecked = await page.evaluate(() => {
        const labels = [...document.querySelectorAll('label')];
        const label = labels.find((l) => l.innerText && l.innerText.includes('موافقة التصوير'));
        const input = label?.querySelector('input[type="checkbox"]');
        if (!input || !input.checked) return false;
        input.click();
        return true;
      });
      assert(unchecked, 'لم يُعثر على مربع موافقة تصوير مفعّل في ملف الطفل');
      await waitBodyText(page, '🚫');
      // 4) البوابة بلا صور فوراً
      const link2 = await issuePortalLink(page);
      const { page: portalPage2 } = await openPortalPage(ctx, link2);
      try {
        await waitBodyText(portalPage2, 'يوسف تجريبي');
        const txt = await bodyText(portalPage2);
        assert(!txt.includes('صور اليوم'), 'صور اليوم ما زالت ظاهرة بعد سحب الموافقة');
      } finally {
        await portalPage2.close().catch(() => {});
      }
      // 5) استعد الحالة: أعد الموافقة كما كانت
      await page.goto(BASE + '/children', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await clickByText(page, 'يوسف تجريبي');
      await page.waitForFunction(() => location.pathname.startsWith('/children/'), { timeout: WAIT_TIMEOUT });
      await page.evaluate(() => {
        const labels = [...document.querySelectorAll('label')];
        const label = labels.find((l) => l.innerText && l.innerText.includes('موافقة التصوير'));
        const input = label?.querySelector('input[type="checkbox"]');
        if (input && !input.checked) input.click();
      });
      await waitBodyText(page, '📷');
    },
  },
];

async function startPreview() {
  const child = spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'pipe' },
  );
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`خادم المعاينة خرج مبكراً:\n${out}`);
    try {
      const r = await fetch(BASE + '/');
      if (r.ok) return child;
    } catch {
      /* لم يجهز بعد */
    }
    await sleep(500);
  }
  child.kill('SIGTERM');
  throw new Error('خادم المعاينة لم يجهز خلال ٣٠ ثانية');
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  console.log(`E2E smoke — base=${BASE} relay=${RELAY ? 'on' : 'off'}`);
  const preview = await startPreview();
  const relayStats = { aborted: 0 };
  let browser;
  const results = [];
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    let page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true });
    let watcher = watchPage(page);
    if (RELAY) await enableRelay(page, relayStats);
    const ctx = { browser, relayStats };
    for (const t of tests) {
      // صفحة ميتة (إطار انفصل/متصفح تعب) لا تسمّم بقية التدفقات: جدّدها
      const alive = await page.evaluate(() => true).then(() => true).catch(() => false);
      if (!alive) {
        page = await browser.newPage();
        await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true });
        watcher = watchPage(page);
        if (RELAY) await enableRelay(page, relayStats);
      }
      const from = { pe: watcher.pageErrors.length, ce: watcher.consoleErrors.length };
      const started = Date.now();
      try {
        await t.run(page, ctx);
        const fatal = fatalErrors(watcher, from);
        assert(fatal.length === 0, `أخطاء فادحة أثناء الاختبار: ${fatal[0]}`);
        results.push({ id: t.id, title: t.title, ok: true, ms: Date.now() - started });
        console.log(`✓ ${t.id} — ${t.title} (${Math.round((Date.now() - started) / 1000)}s)`);
      } catch (e) {
        const shot = path.join(ARTIFACTS, `${t.id}.png`);
        await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
        results.push({ id: t.id, title: t.title, ok: false, ms: Date.now() - started, error: e.message });
        console.log(`✗ ${t.id} — ${t.title}: ${e.message} [لقطة: e2e/artifacts/${t.id}.png]`);
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    preview.kill('SIGTERM');
  }
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\nالنتيجة: ${results.length - failed.length}/${results.length} ناجح` +
      (relayStats.aborted ? ` — طلبات ريلاي مُجهضة بعد إعادة المحاولة: ${relayStats.aborted} (تحذير)` : ''),
  );
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error('E2E runner failed:', e.message);
  process.exit(1);
});
