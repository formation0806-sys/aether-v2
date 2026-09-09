#!/usr/bin/env node
/**
 * AETHER — MOBILE VIEWPORT VERIFICATION (public routes)
 * =================================================
 * Serves the production build (`next start`), drives headless Chrome over
 * raw CDP, and measures horizontal overflow on the public routes at every
 * supported viewport width.
 *
 * Usage: node scripts/mobile-viewport-check.mjs
 * (Requires the production build: npm run build)
 */

import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, "..");
const CHROME =
  process.env.AETHER_CHECK_CHROME ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = Number(process.env.AETHER_CHECK_PORT || 3000);
const APP = `http://localhost:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Minimal CDP client (Node >= 22 global WebSocket)                    */
/* ------------------------------------------------------------------ */
class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
  }
  async open() {
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
    });
    this.ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      } else if (msg.method) {
        const h = this.handlers.get(msg.method);
        if (h) h(msg.params);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) =>
      this.pending.set(id, { resolve, reject })
    );
  }
  on(method, fn) {
    this.handlers.set(method, fn);
  }
}

let cdp;
let chromeProc;
let serverProc;
const browserErrors = [];

function uniqueProfileDir() {
  return join(tmpdir(), "aether-viewport-chrome-" + Date.now());
}

const VIEWPORTS = [320, 360, 375, 390, 412, 430, 768, 1024, 1440];
const ROUTES = ["/", "/signin", "/signup"];
const AUTHED_ROUTES = ["/dashboard", "/chat", "/memory", "/tasks", "/settings"];

/* ------------------------------------------------------------------ */
/* Safe env loading (never logs values)                                */
/* ------------------------------------------------------------------ */
function loadEnvFile(path) {
  const out = {};
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || m[2].startsWith("#")) continue;
      let v = m[2].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!(m[1] in out)) out[m[1]] = v;
    }
  } catch {
    /* no env file */
  }
  return out;
}

const __env = loadEnvFile(join(APP_ROOT, ".env.local"));
const SMOKE_EMAIL = __env.M2_SMOKE_EMAIL || __env.AETHER_SMOKE_EMAIL;
const SMOKE_PASSWORD = __env.M2_SMOKE_PASSWORD || __env.AETHER_SMOKE_PASSWORD;

async function startServer() {
  const nextBin = join(APP_ROOT, "node_modules", "next", "dist", "bin", "next");
  serverProc = spawn(
    process.execPath,
    [nextBin, "start", "-p", String(PORT), "-H", "127.0.0.1"],
    { stdio: "ignore", cwd: APP_ROOT }
  );
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${APP}/signup`);
      if (res.status >= 200 && res.status < 500) {
        await sleep(500);
        return;
      }
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  throw new Error("production server did not come up on " + APP);
}

async function launchChrome() {
  const port = 9338;
  chromeProc = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--remote-allow-origins=*",
      "--window-size=1440,900",
      `--remote-debugging-port=${port}`,
      "--user-data-dir=" + uniqueProfileDir(),
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  let targets = null;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`);
      targets = await res.json();
      if (targets.some((t) => t.type === "page")) break;
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  if (!targets) throw new Error("Chrome remote debugging did not come up");
  const page = targets.find((t) => t.type === "page");
  cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  cdp.on("Runtime.exceptionThrown", (p) => {
    const d =
      p.exceptionDetails?.exception?.description ||
      p.exceptionDetails?.text ||
      "exception";
    browserErrors.push(String(d).slice(0, 300));
  });
  cdp.on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error") {
      const text = (p.args || [])
        .map((a) => a.value ?? a.description ?? a.type)
        .join(" ")
        .slice(0, 300);
      browserErrors.push("console.error: " + text);
    }
  });
}

async function evaluate(expression) {
  const { result } = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (!result) return undefined;
  if (result.type === "object" && "value" in result) return result.value;
  if (
    result.type === "string" ||
    result.type === "number" ||
    result.type === "boolean"
  ) {
    return result.value;
  }
  return result;
}

const BODY_IS_SIGNIN = `(document.body ? document.body.innerText : '').includes('Welcome back')`;
const BODY_TEXT = `document.body ? document.body.innerText : ''`;

const ROUTE_MARKERS = {
  "/dashboard": "Command center",
  "/chat": "persistent intelligence layer",
  "/memory": "What your AI remembers",
  "/tasks": "Things to follow up on",
  "/settings": "Account settings",
};

const OVERFLOW_PROBE = `(() => {
  const doc = document.documentElement;
  const w = window.innerWidth;
  const wide = Array.from(document.querySelectorAll('body *'))
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > w + 2);
    })
    .map((el) => {
      const c = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
      return '<' + el.tagName + '>' + (c ? '.' + c : '');
    })
    .slice(0, 5);
  return {
    overflowX: doc.scrollWidth > w + 2,
    innerWidth: w,
    scrollWidth: doc.scrollWidth,
    clip: wide,
  };
})()`;

/* ------------------------------------------------------------------ */
/* Authed-phase helpers                                                */
/* ------------------------------------------------------------------ */
async function signIn(email, password) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const SET_TEMPLATE = (id, value) => `(() => {
    const el = document.querySelector('#${id}');
    if (!el) return false;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;

  for (let attempt = 0; attempt < 3; attempt++) {
    await cdp.send("Page.navigate", { url: APP + "/signin" });
    let ready = false;
    for (let i = 0; i < 60; i++) {
      const ok = await evaluate(
        `!!document.querySelector('#signin-email') && !!document.querySelector('#signin-password')`
      );
      if (ok) {
        ready = true;
        break;
      }
      await sleep(300);
    }
    if (!ready) return null;
    await sleep(400); // hydrate
    await evaluate(SET_TEMPLATE("signin-email", email));
    await evaluate(SET_TEMPLATE("signin-password", password));
    await sleep(250);
    const vals = await evaluate(`(() => {
      const e = document.querySelector('#signin-email');
      const p = document.querySelector('#signin-password');
      return { e: e ? e.value : "", p: p ? p.value : "" };
    })()`);
    if (!vals || vals.e !== email || vals.p !== password) {
      // Native setter did not register with React — fall back to real typing.
      await evaluate(`document.querySelector('#signin-email').focus()`);
      await sleep(150);
      await cdp.send("Input.insertText", { text: email });
      await cdp.send("Input.keyDown", { key: "Tab" });
      await cdp.send("Input.keyUp", { key: "Tab" });
      await sleep(150);
      await cdp.send("Input.insertText", { text: password });
      await sleep(250);
    }
    await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find((b) => b.textContent.replace(/\\s+/g, ' ').includes('Sign in'));
      if (btn) btn.click();
      return !!btn;
    })()`);
    // Wait until we leave /signin AND the dashboard marker is visible.
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const path = await evaluate(`location.pathname`);
      await sleep(250);
      if (typeof path === "string" && path !== "/signin") {
        const marker = await waitForBody("Command center", 8000);
        if (marker) return path;
        // Landed somewhere authed but not dashboard marker (e.g. slow render)
        const body = await evaluate(BODY_TEXT);
        if (typeof body === "string" && body.includes("Command center")) {
          return path;
        }
      }
      const isSignin = await evaluate(BODY_IS_SIGNIN);
      if (!isSignin && (await evaluate(`location.pathname`)) !== "/signin") {
        const still = await evaluate(BODY_IS_SIGNIN);
        if (!still) return await evaluate(`location.pathname`);
      }
    }
  }
  return null;
}

async function waitForBody(marker, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const body = await evaluate(BODY_TEXT);
    if (typeof body === "string" && body.includes(marker)) return true;
    await sleep(250);
  }
  return false;
}

async function checkDrawer() {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 375,
    height: 812,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await cdp.send("Page.navigate", { url: APP + "/chat" });
  let menuReady = false;
  for (let i = 0; i < 80; i++) {
    const ok = await evaluate(
      `!!document.querySelector('button[aria-label="Open navigation"]')`
    );
    if (ok) {
      menuReady = true;
      break;
    }
    await sleep(300);
  }
  if (!menuReady) {
    const diag = await evaluate(`document.body ? document.body.innerText.slice(0, 120) : 'no body'`);
    console.log(`drawer    375px -> FAIL (menu button missing) BODY: ${JSON.stringify(diag)}`);
    return false;
  }
  await sleep(1500); // let hydration + any soft navigation settle
  let opened = false;
  let openAttempts = 0;
  while (!opened && openAttempts < 3) {
    if (openAttempts > 0) await sleep(800);
    await evaluate(`document.querySelector('button[aria-label="Open navigation"]').click()`);
    for (let i = 0; i < 30; i++) {
      const ok = await evaluate(
        `!!document.querySelector('button[aria-label="Close navigation"]') && !!document.querySelector('[role="dialog"]')`
      );
      if (ok) {
        opened = true;
        break;
      }
      await sleep(150);
    }
    openAttempts++;
  }
  if (!opened) {
    console.log("drawer    375px -> FAIL (did not open)");
    return false;
  }
  // Let the 220ms drawer-entry animation finish before measuring.
  await sleep(500);
  const probe = await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return { error: 'no dialog' };
    // Panel = the non-backdrop child (backdrop is a <button>, panel a <div>).
    const panel =
      Array.from(dialog.children).find((el) => el.tagName === 'DIV') || null;
    const rect = panel ? panel.getBoundingClientRect() : null;
    const nav = panel ? panel.querySelector('nav') : null;
    if (nav) {
      nav.scrollTo(0, nav.scrollHeight);
    }
    return {
      innerWidth: window.innerWidth,
      panelWidth: rect ? Math.round(rect.width) : -1,
      panelLeft: rect ? Math.round(rect.left) : -1,
      drawerClassOk: panel ? /w-\\[85%\\]|max-w-sm/.test(panel.className || '') : false,
      navHasChat: nav ? nav.innerText.includes('Chat') : false,
      dialogModal: dialog ? dialog.getAttribute('aria-modal') : null,
      accountVisible: nav
        ? /account/i.test(nav.innerText) && /sign out/i.test(nav.innerText)
        : false,
      footerEmail: panel ? /@/.test(panel.innerText) : false,
    };
  })()`);
  await sleep(250);
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  if (shot?.data) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      join(APP_ROOT, "scripts", "drawer-shot.png"),
      Buffer.from(shot.data, "base64")
    );
    console.log("drawer screenshot saved: scripts/drawer-shot.png");
  }
  const ok =
    probe.panelWidth > 0 &&
    probe.panelWidth < probe.innerWidth &&
    probe.panelWidth >= Math.round(probe.innerWidth * 0.8) &&
    probe.drawerClassOk &&
    probe.navHasChat &&
    probe.dialogModal === "true" &&
    probe.accountVisible;

  // Drawer scrolls independently + close works
  let closed = false;
  await evaluate(`document.querySelector('button[aria-label="Close navigation"]').click()`);
  for (let i = 0; i < 30; i++) {
    const gone = await evaluate(
      `!document.querySelector('button[aria-label="Close navigation"]')`
    );
    if (gone) {
      closed = true;
      break;
    }
    await sleep(150);
  }
  console.log(
    `drawer    375px -> ${ok && closed ? "ok" : "FAIL"}` +
      ` (panelW=${probe.panelWidth}, innerW=${probe.innerWidth}, left=${probe.panelLeft}, classOk=${probe.drawerClassOk}, navChat=${probe.navHasChat}, ariaModal=${probe.dialogModal}, account=${probe.accountVisible}, footerEmail=${probe.footerEmail})`
  );
  return ok && closed;
}

async function main() {
  const results = {};
  console.log("starting production server...");
  await startServer();
  console.log("launching headless Chrome...");
  await launchChrome();
  try {
    for (const route of ROUTES) {
      results[route] = {};
      for (const width of VIEWPORTS) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: true,
        });
        await cdp.send("Page.navigate", { url: APP + route });
        // Wait for content
        for (let i = 0; i < 60; i++) {
          const len = await evaluate(
            `document.body ? document.body.innerText.length : 0`
          );
          if (len && len > 30) break;
          await sleep(300);
        }
        await sleep(150);
        const probe = await evaluate(OVERFLOW_PROBE);
        results[route][width] = probe;
        const flag = probe?.overflowX ? "OVERFLOW" : "ok";
        console.log(
          `${route.padEnd(8)} ${String(width).padStart(4)}px -> ${flag}` +
            (probe?.scrollWidth && probe?.innerWidth
              ? ` (scrollW=${probe.scrollWidth}, innerW=${probe.innerWidth})`
              : "") +
            (probe?.clip?.length ? ` CLIP: ${probe.clip.join(", ")}` : "")
        );
      }
    }
    // ---- Authed routes (read-only: resize + measure, no writes) ----
    let signedIn = SMOKE_EMAIL && SMOKE_PASSWORD
      ? await signIn(SMOKE_EMAIL, SMOKE_PASSWORD)
      : null;
    if (signedIn) {
      console.log(`\nsigned in as smoke user (landed on ${signedIn})`);
      const cookieNames = await evaluate(
        `document.cookie.split(';').map((c) => c.split('=')[0].trim()).join(', ')`
      );
      console.log(`cookie jar after sign-in: ${JSON.stringify(cookieNames)}`);
    } else {
      console.log(
        "\nauthed session could not be established with the smoke account"
      );
    }

    async function gotoAuthed(route, marker) {
      // Returns true when the authed page matching `marker` is displayed.
      for (let attempt = 0; attempt < 3; attempt++) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: VIEWPORTS[0],
          height: 900,
          deviceScaleFactor: 1,
          mobile: true,
        });
        await cdp.send("Page.navigate", { url: APP + route });
        for (let i = 0; i < 60; i++) {
          await sleep(300);
          const body = await evaluate(BODY_TEXT);
          if (typeof body === "string" && body.includes(marker)) return true;
          if (typeof body === "string" && body.includes("Welcome back")) {
            const cookieNames = await evaluate(
              `document.cookie.split(';').map((c) => c.split('=')[0].trim()).join(', ')`
            );
            console.log(
              `  [!] ${route} bounced to sign-in; cookies: ${JSON.stringify(cookieNames)}`
            );
            break;
          }
        }
        // Session died -> re-sign in and retry.
        signedIn = await signIn(SMOKE_EMAIL, SMOKE_PASSWORD);
        if (!signedIn) return false;
      }
      return false;
    }

    for (const route of AUTHED_ROUTES) {
      results[route] = {};
      const marker = ROUTE_MARKERS[route];
      const current = await evaluate(`location.pathname`);
      let ok = false;
      if (current === route) {
        ok = true;
      } else {
        ok = await gotoAuthed(route, marker);
      }
      if (!ok) {
        for (const width of VIEWPORTS) {
          results[route][width] = { overflowX: false, authSkip: true };
        }
        console.log(`${route.padEnd(11)} AUTH-SKIP (auth session unstable)`);
        continue;
      }
      for (const width of VIEWPORTS) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: true,
        });
        await sleep(350);
        const probe = await evaluate(OVERFLOW_PROBE);
        results[route][width] = probe;
        const flag = probe?.overflowX ? "OVERFLOW" : "ok";
        console.log(
          `${route.padEnd(11)} ${String(width).padStart(4)}px -> ${flag}` +
            (probe?.scrollWidth && probe?.innerWidth
              ? ` (scrollW=${probe.scrollWidth}, innerW=${probe.innerWidth})`
              : "") +
            (probe?.clip?.length ? ` CLIP: ${probe.clip.join(", ")}` : "")
        );
      }
    }
    if (signedIn) {
      // Fresh re-sign-in so the drawer navigations start with a valid cookie.
      await signIn(SMOKE_EMAIL, SMOKE_PASSWORD);
      await checkDrawer();
    } else {
      console.log("\ndrawer check SKIPPED (no authed session)");
    }
    if (browserErrors.length > 0) {
      console.log(
        "browser errors during authed phase:\n  " +
          browserErrors.slice(-6).join("\n  ")
      );
    }

    await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    console.log("\n==== SUMMARY ====");
    const measured = Object.keys(results);
    let pass = true;
    let authSkips = 0;
    for (const route of measured) {
      for (const width of VIEWPORTS) {
        const r = results[route][width];
        if (r?.authSkip) {
          authSkips++;
          continue;
        }
        if (!r || r.overflowX) {
          pass = false;
          console.log(
            `FAIL ${route} @ ${width}px` +
              (r
                ? ` scrollW=${r.scrollWidth} innerW=${r.innerWidth}`
                : " (no data)")
          );
        }
      }
    }
    console.log(
      pass
        ? "RESULT: PASS - no horizontal overflow at any supported viewport" +
            (authSkips
              ? ` (${authSkips} auth-skip measurements)`
              : "")
        : "RESULT: FAIL"
    );
  } finally {
    await cdp?.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    chromeProc?.kill();
    serverProc?.kill();
  }
}

main().catch((err) => {
  console.error("FATAL: " + err.message);
  chromeProc?.kill();
  serverProc?.kill();
  process.exit(1);
});