#!/usr/bin/env node
/**
 * اختبارات E2E دخانية للتدفقات الحرجة (R1 — بند 3A-311).
 *
 * شبكة أمان آلية: ستة تدفقات دخانية (دخول تجريبي، رئيسية+جرس، أطفال،
 * يوم فصل، فواتير، بوابة ولي أمر) تعمل بـ Puppeteer على بناء معاينة محلي
 * (vite preview من نفس الكود) ضد Supabase الحي بحساب الديمو العام
 * (بيانات اعتماده عامة عمداً بقرار المالك — لا أسرار أخرى هنا).
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
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const url = req.url();
    if (
      url.startsWith(BASE) ||
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url.startsWith('about:')
    ) {
      req.continue().catch(() => {});
      return;
    }
    const method = req.method();
    const attempt = async () => {
      const headers = { ...req.headers() };
      delete headers.host;
      const init = { method, headers, redirect: 'follow' };
      const pd = req.postData();
      if (pd && method !== 'GET' && method !== 'HEAD') init.body = pd;
      const res = await fetch(url, init);
      const buf = Buffer.from(await res.arrayBuffer());
      const out = {};
      res.headers.forEach((v, k) => {
        if (
          !['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(
            k.toLowerCase(),
          )
        )
          out[k] = v;
      });
      await req.respond({ status: res.status, headers: out, body: buf });
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
      req.abort().catch(() => {});
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

/** ينقر أول عنصر (زر/رابط) يحتوي نصه على النص المعطى — نقرة حقيقية عبر Puppeteer. */
async function clickByText(page, text, { timeout = WAIT_TIMEOUT, selector = 'button, a' } = {}) {
  const handle = await page.waitForFunction(
    (t, sel) => {
      const els = [...document.querySelectorAll(sel)];
      return els.find((el) => el.innerText && el.innerText.includes(t) && !el.disabled) || null;
    },
    { timeout },
    text,
    selector,
  );
  const el = handle.asElement();
  assert(el, `لم يُعثر على عنصر قابل للنقر يحتوي: ${text}`);
  await el.scrollIntoView().catch(() => {});
  await el.click();
  return el;
}

async function waitPathname(page, expected, timeout = WAIT_TIMEOUT) {
  await page.waitForFunction((p) => location.pathname === p, { timeout }, expected);
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
      await waitBodyText(page, 'إصدار فواتير الشهر');
    },
  },
  {
    id: '06-portal',
    title: 'بوابة ولي الأمر: إصدار رابط وفتحه بلا حساب',
    async run(page, ctx) {
      await ensureSession(page);
      await page.goto(BASE + '/portal-links', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await waitBodyText(page, 'روابط أولياء الأمور');
      // إصدار رابط لأول ولي أمر بلا رابط نشط (إن وُجد زر إصدار)
      const issued = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        const b = btns.find((x) => x.innerText && x.innerText.includes('إنشاء رابط'));
        if (b) { b.click(); return true; }
        return false;
      });
      if (issued) await sleep(2500);
      // الرابط الخام يظهر داخل رابط واتساب (نص الرسالة) بعد الإصدار
      const link = await page.evaluate(() => {
        const anchors = [...document.querySelectorAll('a[href*="wa.me"]')];
        for (const a of anchors) {
          try {
            const u = new URL(a.href);
            const text = u.searchParams.get('text') || '';
            const m = text.match(/\/p\/[A-Za-z0-9_-]{20,}/);
            if (m) return m[0];
          } catch { /* تجاهل */ }
        }
        return null;
      });
      assert(link, 'لم يُعثر على رابط بوابة مُصدَر في الصفحة');
      const portalPage = await ctx.browser.newPage();
      await portalPage.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true });
      const pw = watchPage(portalPage);
      if (process.env.E2E_RELAY === '1' || (process.env.E2E_RELAY == null && (process.env.HTTPS_PROXY || process.env.https_proxy))) {
        await enableRelay(portalPage, ctx.relayStats);
      }
      try {
        await portalPage.goto(BASE + link, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
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
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true });
    const watcher = watchPage(page);
    if (RELAY) await enableRelay(page, relayStats);
    const ctx = { browser, relayStats };
    for (const t of tests) {
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
