import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS_DIR = path.join(ROOT, 'docs', 'visual-audit');
const PORT = Number(process.env.AUDIT_PORT || 4175);
const BASE = `http://127.0.0.1:${PORT}`;
const MOCK_PORT = 54321;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startMockServer() {
  const script = path.join(ROOT, 'scripts', 'mock-server.mjs');
  const child = spawn('node', [script], { stdio: 'pipe' });
  child.stdout.on('data', (d) => process.stdout.write(`[mock] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[mock-err] ${d}`));
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${MOCK_PORT}/auth/v1/user`);
      if (res.status === 200) return child;
    } catch {}
    await sleep(200);
  }
  child.kill();
  throw new Error('Failed to start mock server');
}

async function buildAndPreview() {
  console.log('Building nounou-app with mock Supabase environment...');
  const build = spawn(
    'npm',
    ['run', 'build'],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        VITE_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
        VITE_SUPABASE_ANON_KEY: 'mock-anon-key'
      },
      stdio: 'inherit'
    }
  );
  await new Promise((resolve, reject) => {
    build.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Build exited with code ${code}`));
    });
  });

  console.log(`Starting vite preview on port ${PORT}...`);
  const preview = spawn(
    'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        VITE_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
        VITE_SUPABASE_ANON_KEY: 'mock-anon-key'
      },
      stdio: 'pipe'
    }
  );
  preview.stdout.on('data', (d) => process.stdout.write(`[preview] ${d}`));
  preview.stderr.on('data', (d) => process.stderr.write(`[preview-err] ${d}`));

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return preview;
    } catch {}
    await sleep(300);
  }
  preview.kill();
  throw new Error('Vite preview failed to start');
}

const SCREENS = [
  { id: '01_login', path: '/login', title: 'Login', auth: false },
  { id: '02_reset_password', path: '/reset-password', title: 'Reset Password', auth: false },
  { id: '03_home', path: '/', title: 'Home Dashboard', auth: true },
  { id: '04_children', path: '/children', title: 'Children List', auth: true },
  { id: '05_child_detail', path: '/children/44444444-4444-4444-8444-444444444441', title: 'Child Detail', auth: true },
  { id: '06_classes', path: '/classes', title: 'Classes List', auth: true },
  { id: '07_class_detail', path: '/classes/22222222-2222-4222-8222-222222222221', title: 'Class Detail', auth: true },
  { id: '08_today', path: '/today', title: 'Today Overview', auth: true },
  { id: '09_class_day', path: '/today/22222222-2222-4222-8222-222222222221', title: 'Class Day Mode', auth: true },
  { id: '10_invoices', path: '/invoices', title: 'Invoices List', auth: true },
  { id: '11_invoice_detail', path: '/invoices/inv-1', title: 'Invoice Detail', auth: true },
  { id: '12_proofs', path: '/proofs', title: 'Proofs Review', auth: true },
  { id: '13_reports', path: '/reports', title: 'Reports & Photos', auth: true },
  { id: '14_bus', path: '/bus', title: 'Bus Management', auth: true },
  { id: '15_announcements', path: '/announcements', title: 'Announcements', auth: true },
  { id: '16_portal_links', path: '/portal-links', title: 'Portal Links', auth: true },
  { id: '17_parent_portal', path: '/p/demo-guardian-token-12345', title: 'Parent Portal', auth: false },
  { id: '18_notifications', path: '/notifications', title: 'Notifications', auth: true },
  { id: '19_activity', path: '/activity', title: 'Activity Log', auth: true },
  { id: '20_settings', path: '/settings', title: 'Settings', auth: true },
  { id: '21_members', path: '/members', title: 'Staff Members', auth: true },
  { id: '22_export', path: '/export', title: 'Data Export', auth: true },
  { id: '23_more', path: '/more', title: 'More Menu', auth: true },
  { id: '24_not_found', path: '/non-existent-screen-404', title: '404 Not Found', auth: true },
  { id: '25_portal_invalid', path: '/p/invalid-token-test', title: 'Portal Invalid Token', auth: false }
];

const VIEWPORTS = [
  { width: 360, height: 780, name: '360w' },
  { width: 390, height: 844, name: '390w' }
];

const LOCALES = ['ar', 'en'];


async function auditTouchTargets(page) {
  return await page.evaluate(() => {
    const selector = 'button, a, input, select, textarea, [role="button"], [role="tab"], [tabindex="0"]';
    const elements = Array.from(document.querySelectorAll(selector));
    const smallTargets = [];
    const validTargets = [];

    for (const el of elements) {
      // Ignore hidden or 0x0 elements
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (
        rect.width === 0 ||
        rect.height === 0 ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0'
      ) {
        continue;
      }

      const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.tagName).slice(0, 30).trim();
      const tag = el.tagName.toLowerCase();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);

      const isCompliant = w >= 44 && h >= 44;
      const item = { tag, text, width: w, height: h, className: el.className.slice(0, 50) };
      if (!isCompliant) {
        smallTargets.push(item);
      } else {
        validTargets.push(item);
      }
    }
    return {
      total: smallTargets.length + validTargets.length,
      compliant: validTargets.length,
      nonCompliantCount: smallTargets.length,
      smallTargets: smallTargets.slice(0, 10) // top 10 examples
    };
  });
}

async function checkOverflow(page) {
  return await page.evaluate(() => {
    const scrollWidth = document.documentElement.scrollWidth;
    const clientWidth = document.documentElement.clientWidth;
    const hasHorizontalOverflow = scrollWidth > clientWidth;
    return {
      hasHorizontalOverflow,
      scrollWidth,
      clientWidth,
      diff: scrollWidth - clientWidth
    };
  });
}

async function measurePerformance(page, urlPath) {
  // Clear metrics
  await page.goto(`${BASE}${urlPath}`, { waitUntil: 'networkidle0', timeout: 30000 });
  
  const perf = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const paints = performance.getEntriesByType('paint');
    const fcpEntry = paints.find(p => p.name === 'first-contentful-paint');
    
    // Node count
    const domNodes = document.querySelectorAll('*').length;
    
    // JS heap memory if available
    const memory = performance.memory ? Math.round(performance.memory.usedJSHeapSize / (1024 * 1024) * 10) / 10 : null;

    return {
      ttfb: Math.round(nav.responseStart - nav.requestStart) || 0,
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime) || 0,
      loadTime: Math.round(nav.loadEventEnd - nav.startTime) || 0,
      fcp: fcpEntry ? Math.round(fcpEntry.startTime) : null,
      domNodes,
      heapMB: memory
    };
  });

  return perf;
}

async function main() {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  fs.mkdirSync(path.join(ARTIFACTS_DIR, 'screenshots'), { recursive: true });

  const mockServer = await startMockServer();
  let previewServer;
  let browser;

  const results = [];
  const perfResults = [];

  try {
    previewServer = await buildAndPreview();

    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // 1. First navigate to /login and do demo login once to establish session
    await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true });
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
    
    // Click demo login button
    const demoBtn = await page.waitForFunction(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.find(b => b.innerText && b.innerText.includes('دخول تجريبي'));
    });
    await demoBtn.click();
    await sleep(2000);

    // Verify session
    const currentUrl = page.url();
    console.log(`Initial login completed, landed on: ${currentUrl}`);

    // 2. Iterate through Viewports x Locales x Screens
    for (const vp of VIEWPORTS) {
      await page.setViewport({
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true
      });

      for (const loc of LOCALES) {
        console.log(`\n================ Testing ${vp.name} [${loc.toUpperCase()}] ================`);

        // Switch locale in app
        await page.evaluate((l) => {
          localStorage.setItem('nounou-locale', l);
          document.documentElement.lang = l;
          document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
          window.dispatchEvent(new Event('storage'));
        }, loc);

        for (const screen of SCREENS) {
          const runId = `${screen.id}_${vp.name}_${loc}`;
          const screenshotPath = path.join(ARTIFACTS_DIR, 'screenshots', `${runId}.png`);

          try {
            await page.goto(`${BASE}${screen.path}`, { waitUntil: 'networkidle0', timeout: 20000 });
            await sleep(500); // Allow render animations

            // Confirm locale state
            const pageDir = await page.evaluate(() => document.documentElement.dir);
            const pageLang = await page.evaluate(() => document.documentElement.lang);

            // Check overflow
            const overflow = await checkOverflow(page);

            // Audit touch targets
            const touchTargets = await auditTouchTargets(page);

            // Take screenshot
            await page.screenshot({ path: screenshotPath, fullPage: true });

            const itemResult = {
              screenId: screen.id,
              title: screen.title,
              path: screen.path,
              viewport: vp.name,
              locale: loc,
              expectedDir: loc === 'ar' ? 'rtl' : 'ltr',
              actualDir: pageDir,
              actualLang: pageLang,
              overflow: overflow.hasHorizontalOverflow,
              overflowDiff: overflow.diff,
              touchTotal: touchTargets.total,
              touchCompliant: touchTargets.compliant,
              touchNonCompliant: touchTargets.nonCompliantCount,
              smallTargets: touchTargets.smallTargets,
              screenshot: `${runId}.png`,
              status: overflow.hasHorizontalOverflow ? 'FAIL_OVERFLOW' : 'PASS'
            };

            results.push(itemResult);
            const statusIcon = itemResult.status === 'PASS' ? '✓' : '✗';
            console.log(
              `${statusIcon} [${vp.name}|${loc}] ${screen.title} (${screen.path}) ` +
              `dir=${pageDir} targets=${touchTargets.compliant}/${touchTargets.total} ` +
              `overflow=${overflow.hasHorizontalOverflow ? `+${overflow.diff}px` : 'none'}`
            );
          } catch (err) {
            console.error(`✗ Error on ${screen.title} [${vp.name}|${loc}]:`, err.message);
            results.push({
              screenId: screen.id,
              title: screen.title,
              path: screen.path,
              viewport: vp.name,
              locale: loc,
              status: 'ERROR',
              error: err.message
            });
          }
        }
      }
    }

    // 3. Laboratory Performance measurements for Heavy Screens
    console.log('\n================ Measuring Heavy Screens Performance ================');
    const HEAVY_SCREENS = [
      { path: '/', name: 'Home Dashboard' },
      { path: '/children', name: 'Children List' },
      { path: '/today/22222222-2222-4222-8222-222222222221', name: 'Classroom Live Mode' },
      { path: '/invoices', name: 'Invoices List' },
      { path: '/reports', name: 'Daily Reports & Photos' },
      { path: '/p/demo-guardian-token-12345', name: 'Parent Portal' }
    ];

    for (const s of HEAVY_SCREENS) {
      const perf = await measurePerformance(page, s.path);
      perfResults.push({ name: s.name, path: s.path, ...perf });
      console.log(`⚡ ${s.name} (${s.path}): FCP=${perf.fcp}ms, DCL=${perf.domContentLoaded}ms, Load=${perf.loadTime}ms, DOM Nodes=${perf.domNodes}, Heap=${perf.heapMB}MB`);
    }

    // Save results JSON
    fs.writeFileSync(
      path.join(ARTIFACTS_DIR, 'audit-results.json'),
      JSON.stringify({ results, perfResults, timestamp: new Date().toISOString() }, null, 2)
    );

    console.log(`\nAudit complete! Results and screenshots saved to: ${ARTIFACTS_DIR}`);

  } finally {
    if (browser) await browser.close();
    if (previewServer) previewServer.kill();
    if (mockServer) mockServer.kill();
  }
}

main().catch(err => {
  console.error('Audit runner fatal error:', err);
  process.exit(1);
});
