import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findChrome, launchChrome, serveStatic, sleep } from "../scripts/chrome.mts";

// A container that scrolls sideways must be reachable by keyboard (tabindex, plus a role that takes a name),
// and one that fits must stay out of the tab order. The review panel's "+ Comment" button on a list sits in
// an li, because a list may only hold li.
const skip = !findChrome() || typeof WebSocket === "undefined" ? "needs Chrome and Node >= 22" : false;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const wide = `<div class="table-wrap" id="wide-wrap"><table><caption>Wide table</caption><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td style="min-width: 900px">x</td><td style="min-width: 900px">y</td></tr></tbody></table></div>`;
const narrow = `<div class="table-wrap" id="narrow-wrap"><table><caption>Narrow table</caption><thead><tr><th>A</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table></div>`;
const longCode = `<pre id="long-code"><code>${"let x = 1; ".repeat(200)}</code></pre>`;
const shortCode = `<pre id="short-code"><code>let x = 1;</code></pre>`;
const strip = `<div id="strip" data-scroll-region="Alphabet" style="overflow-x: auto; width: 200px"><div style="width: 900px">strip</div></div>`;
const authored = `<div class="table-wrap" id="authored-wrap" tabindex="-1" style="width: 100px"><table><tbody><tr><td style="min-width: 500px">z</td></tr></tbody></table></div>`;
const list = `<ol id="a-list" data-linkable><li>one</li><li>two</li></ol>`;
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fixture</title>
<link rel="stylesheet" href="../theme/bh.css"><script src="../theme/bh.js" defer></script></head>
<body><main class="bh-page"><article class="bh-article"><header class="bh-hero"><h1>Fixture</h1></header>
${wide}${narrow}${longCode}${shortCode}${strip}${authored}${list}</article></main></body></html>`;

/** Each region's tab-order state, by id. */
const probe = `(() => Object.fromEntries(["wide-wrap", "narrow-wrap", "long-code", "short-code", "strip", "authored-wrap"].map((id) => {
  const e = document.getElementById(id);
  return [id, { tabindex: e.getAttribute("tabindex"), role: e.getAttribute("role"), label: e.getAttribute("aria-label") }];
})))()`;

test("only containers that scroll join the tab order, and they get a name", { skip, timeout: 120000 }, async (t) => {
  const server = await serveStatic(root, new Map([["/docs/_scroll-fixture.html", { type: "text/html", body: page }]]));
  const chrome = await launchChrome();
  t.after(async () => { await chrome.close(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/docs/_scroll-fixture.html`;
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (method: string, params?: object) => chrome.send(method, params, sessionId);
  await s("Page.enable");
  await s("Page.bringToFront");
  const evaluate = async (expression: string) => {
    const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const ready = async () => {
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      if (await evaluate("document.readyState === 'complete' && document.documentElement.hasAttribute('data-bh-ready')").catch(() => false)) return;
    }
    assert.fail("the page never became ready");
  };

  await s("Emulation.setDeviceMetricsOverride", { width: 600, height: 800, deviceScaleFactor: 1, mobile: false });
  await s("Page.navigate", { url: base });
  await ready();
  let r = await evaluate(probe);
  assert.deepEqual(r["wide-wrap"], { tabindex: "0", role: "group", label: "Wide table" }, "a table that overflows is focusable and named by its caption");
  assert.deepEqual(r["long-code"], { tabindex: "0", role: "group", label: "Code" }, "code that overflows is focusable and named");
  assert.deepEqual(r["strip"], { tabindex: "0", role: "group", label: "Alphabet" }, "a data-scroll-region takes its name from the attribute");
  assert.deepEqual(r["narrow-wrap"], { tabindex: null, role: null, label: null }, "a table that fits stays out of the tab order");
  assert.deepEqual(r["short-code"], { tabindex: null, role: null, label: null }, "code that fits stays out of the tab order");
  assert.deepEqual(r["authored-wrap"], { tabindex: "-1", role: null, label: null }, "an authored tabindex is left alone");

  // When the content shrinks to fit, the table leaves the tab order; when it grows again, it rejoins.
  const setWidth = (px: number) => evaluate(`document.querySelectorAll("#wide-wrap td").forEach((td) => { td.style.minWidth = "${px}px"; })`);
  await setWidth(10);
  await sleep(400);
  r = await evaluate(probe);
  assert.deepEqual(r["wide-wrap"], { tabindex: null, role: null, label: null }, "a table that now fits leaves the tab order");
  await setWidth(900);
  await sleep(400);
  r = await evaluate(probe);
  assert.equal(r["wide-wrap"].tabindex, "0", "and rejoins it when it overflows again");

  // The review panel's "+ Comment" on a list goes inside an item.
  await s("Page.navigate", { url: base + "?review" });
  await ready();
  for (let i = 0; i < 50 && !(await evaluate(`!!document.querySelector(".bh-review-add")`)); i++) await sleep(100);
  const parents = await evaluate(`[...document.querySelectorAll("#a-list .bh-review-add")].map((b) => b.parentElement.tagName)`);
  assert.deepEqual(parents, ["LI"], "the list holds one + Comment button, inside its first li");
});
