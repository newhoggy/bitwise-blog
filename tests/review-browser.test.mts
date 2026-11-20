// The Review panel (theme/modules/review.js) on a live page, in a real Chrome: comments made through
// the UI, downloaded as review files, and the files' contents checked field by field (the build
// stamp, each message's commit, the anchors an agent applying the review relies on). Also the
// phone layout, where the panel must leave the page usable (#350). Skipped without Chrome (and
// without the global WebSocket, Node >= 22, that scripts/chrome.mts drives it with).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import type http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { findChrome, launchChrome, serveStatic, sleep, type ChromeHandle } from "../scripts/chrome.mts";
import { readSchema, schemaProblems } from "../scripts/reviews.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skip = !findChrome() || typeof WebSocket === "undefined" ? "needs Chrome and Node >= 22" : false;

const HEAD = "c".repeat(40);
const STAMP = { repo: "example/blog", commit: HEAD, dirty: true, builtAt: "2026-11-18T00:00:00Z" };
const PAGE = "docs/post.html";
const TITLE = "A page under review";
const QUOTE = "refills its bucket lazily";

// Many paragraphs under the first heading make the article tall, so a scroll that lands on the article's middle
// instead of on the comment (#352) puts the thread far off screen.
const filler = Array.from({ length: 60 }, (_, i) => `    <p>Filler paragraph ${i + 1}: the bucket holds tokens, and each request spends one of them.</p>`).join("\n");
const CONTENT = `
    <h2 id="alpha">Alpha</h2>
    <p>The limiter ${QUOTE}, so an idle client costs nothing at all.</p>
    <figure class="diagram wide" id="flow">
      <svg viewBox="-16 -16 432 112" role="img" aria-label="A client calls a service">
        <g class="node c3" data-id="client"><rect x="0" y="12" width="130" height="56" rx="10"/><text x="65" y="40">Client</text></g>
        <g class="node c1" data-id="service"><rect x="250" y="12" width="130" height="56" rx="10"/><text x="315" y="40">Service</text></g>
        <path class="edge" data-id="call" d="M130 40 H239"/>
      </svg>
      <figcaption>The client calls the service.</figcaption>
    </figure>
${filler}
    <h2 id="beta">Beta</h2>
    <p>A burst is allowed while the bucket still holds enough tokens for it.</p>
    <h2 id="gamma">Gamma</h2>
    <p>The last section.</p>`;

function page(): string {
  const template = fs.readFileSync(path.join(ROOT, "templates/explainer.html"), "utf8")
    .replaceAll("{{title}}", TITLE).replaceAll("{{description}}", "A fixture for the review module.")
    .replaceAll("{{date}}", "2026-11-18").replaceAll("{{author}}", "Tester");
  const hero = template.match(/<header class="bh-hero">[\s\S]*?<\/header>/)![0];
  return template.replace(/(<article class="bh-article">)[\s\S]*(<\/article>)/, (_m, open, close) => `${open}\n    ${hero}\n${CONTENT}\n  ${close}`);
}

function portOf(server: http.Server): number {
  const address = server.address();
  assert.ok(address && typeof address !== "string", "the server is listening");
  return address.port;
}

async function openTab(chrome: ChromeHandle, { width = 1280, height = 900, mobile = false } = {}) {
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (method: string, params?: object) => chrome.send(method, params, sessionId);
  await s("Page.enable");
  await s("Page.bringToFront");
  await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await s("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__errors = [];
    addEventListener("error", (e) => window.__errors.push(String(e.message)));
    addEventListener("unhandledrejection", (e) => window.__errors.push(String(e.reason)));` });
  const evaluate = async (expression: string) => {
    const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  /** Wait until `expression` is truthy (the module paints on animation frames and after timers). */
  const until = async (expression: string, what = expression) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression).catch(() => false)) return;
      await sleep(50);
    }
    throw new Error(`timed out waiting for ${what} (page errors: ${JSON.stringify(await evaluate("window.__errors").catch(() => null))})`);
  };
  const goto = async (url: string) => {
    await s("Page.navigate", { url });
    await sleep(150);
    await until("document.readyState === 'complete' && document.documentElement.hasAttribute('data-bh-ready')", "the page to be ready");
  };
  /** Fill a composer or reply field the way typing does (the module reads .value when saving). */
  const fill = (selector: string, value: string) => evaluate(`(() => { const f = document.querySelector(${JSON.stringify(selector)}); f.value = ${JSON.stringify(value)}; f.dispatchEvent(new Event("input", { bubbles: true })); f.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  const click = (selector: string) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  return { evaluate, until, goto, fill, click, close: () => chrome.send("Target.closeTarget", { targetId }).catch(() => {}) };
}
type Tab = Awaited<ReturnType<typeof openTab>>;

/** Save the composer that is open: kind, body and (for a suggestion) the replacement. */
async function compose(p: Tab, kind: string, body: string, suggestion?: string) {
  await p.until("document.querySelector('.bh-review-pop[aria-label=\"New comment\"]')", "the composer");
  await p.fill(".bh-review-pop .bh-review-kind", kind);
  await p.fill(".bh-review-pop .bh-review-body", body);
  if (suggestion) await p.fill(".bh-review-pop .bh-review-suggestion", suggestion);
  await p.click(".bh-review-pop .btn.primary");
  await p.until("!document.querySelector('.bh-review-pop')", "the composer to close");
}

/** Click a download button and return the file Chrome saved. Names are per minute, and headless Chrome overwrites a
    file of the same name, so a file counts as downloaded when it is new or has changed since the click. */
async function download(p: Tab, dir: string, button: string, ext: string): Promise<string> {
  const stamp = (f: string) => fs.statSync(path.join(dir, f)).mtimeMs;
  const before = new Map(fs.readdirSync(dir).map((f) => [f, stamp(f)]));
  await p.click(button);
  for (let i = 0; i < 100; i++) {
    const done = fs.readdirSync(dir).find((f) => f.endsWith(ext) && (!before.has(f) || stamp(f) !== before.get(f)));
    if (done) return path.join(dir, done);
    await sleep(50);
  }
  throw new Error(`no ${ext} download (the folder holds ${JSON.stringify(fs.readdirSync(dir))})`);
}

test("the Review panel: comments made on the page, and the review files they download as", { skip, timeout: 180000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bh-review-browser-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(ROOT, "theme"), path.join(root, "theme"), { recursive: true });
  fs.rmSync(path.join(root, "theme/build.js"), { force: true }); // a build stamp `serve` may have left; the route below is the one
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>Home</title>");
  fs.writeFileSync(path.join(root, PAGE), page());
  const downloads = fs.mkdtempSync(path.join(os.tmpdir(), "bh-review-downloads-"));
  t.after(() => fs.rmSync(downloads, { recursive: true, force: true }));

  const server = await serveStatic(root, new Map([
    ["/theme/build.js", { type: "text/javascript", body: `window.BH_BUILD = ${JSON.stringify(STAMP)};` }],
    ["/theme/reviews.js", { type: "text/javascript", body: "window.BH_REVIEWS = {};" }],
  ]));
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const base = `http://127.0.0.1:${portOf(server)}/`;
  const chrome = await launchChrome();
  t.after(() => chrome.close());
  await chrome.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  const tab = async (opts?: { width?: number; height?: number; mobile?: boolean }) => { const x = await openTab(chrome, opts); t.after(() => x.close()); return x; };
  const schema = readSchema(ROOT);

  await t.test("a review file carries the build, each message's commit, and anchors that find the passage", async () => {
    const p = await tab();
    await p.goto(`${base}${PAGE}?review`);
    await p.until("document.querySelector('.bh-review-panel:not([hidden])')", "the panel");
    assert.equal(await p.evaluate("document.querySelector('.bh-review-panel').classList.contains('is-collapsed')"), false, "open where the page makes room for it");
    // #351: no comment names a version yet, so there is nothing to compare with.
    assert.equal(await p.evaluate("getComputedStyle(document.querySelector('.bh-review-changes')).display"), "none", "'Show changes since' is hidden");

    // #349: a heading's "+ Comment" is a section comment.
    assert.equal(await p.evaluate("document.querySelector('#alpha > .bh-review-add').title"), "Comment on this section");
    await p.click("#alpha > .bh-review-add");
    await p.until("document.querySelector('.bh-review-pop .bh-review-quote')?.textContent.startsWith('Section: Alpha')", "the composer to quote the section");
    await compose(p, "question", "Why lazily?");
    assert.equal(await p.evaluate("document.querySelector('#flow > .bh-review-add').title"), "Comment on this block");
    await p.click("#flow > .bh-review-add");
    await compose(p, "comment", "Label the edge.");

    // A comment on selected text: select the phrase, then the floating Comment button.
    await p.evaluate(`(() => {
      const para = document.querySelector("#alpha + p"), node = para.firstChild, at = node.data.indexOf(${JSON.stringify(QUOTE)});
      const r = document.createRange(); r.setStart(node, at); r.setEnd(node, at + ${QUOTE.length});
      getSelection().removeAllRanges(); getSelection().addRange(r);
    })()`);
    await p.until("!document.querySelector('.bh-review-selbtn').hidden", "the Comment button");
    await p.click(".bh-review-selbtn");
    await compose(p, "suggestion", "Say when it refills.", "refills its bucket on demand");

    // A reply that resolves the first thread, and a name set after the comments were written.
    await p.click(".bh-review-pin[data-thread='1']");
    await p.until("document.querySelector('.bh-review-pop[aria-label=\"Thread 1\"]')", "thread 1");
    await p.fill(".bh-review-pop .bh-review-body", "Answered in the text.");
    await p.evaluate("document.querySelector('.bh-review-pop .bh-review-resolve input').checked = true");
    await p.click(".bh-review-pop .btn.primary");
    await p.until("document.querySelectorAll('.bh-review-pop .bh-review-msg').length === 2", "the reply");
    await p.click(".bh-review-pop .bh-review-actions .btn.ghost"); // Close
    await p.fill(".bh-review-reviewer", "Pat Tester");

    const jsonFile = await download(p, downloads, "[data-export=json]", ".json");
    assert.match(path.basename(jsonFile), /^review-post-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-pat-tester\.json$/);
    const review = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
    assert.deepEqual(schemaProblems(review, schema), []);
    assert.deepEqual({ format: review.format, repo: review.repo, document: review.document, title: review.title, url: review.url, reviewer: review.reviewer, build: review.build },
      { format: "bh-review/1", repo: STAMP.repo, document: PAGE, title: TITLE, url: `${base}${PAGE}`, reviewer: "Pat Tester", build: { commit: HEAD, dirty: true, builtAt: STAMP.builtAt } });
    assert.ok(Date.parse(review.exported) >= Date.parse(STAMP.builtAt));

    const [section, block, quoted, reply] = review.comments;
    assert.equal(review.comments.length, 4);
    for (const m of review.comments) {
      assert.deepEqual([m.commit, m.dirty, m.author], [HEAD, true, "Pat Tester"], `the stamp on ${m.id}`);
      assert.ok(!Number.isNaN(Date.parse(m.created)) && Date.parse(m.created) <= Date.parse(review.exported), `${m.id} has its time`);
    }
    assert.deepEqual([section.kind, section.body, section.target, section.outdated], ["question", "Why lazily?", { anchor: "alpha", anchorKind: "section", quote: null, position: null }, false]);
    assert.deepEqual([block.target.anchor, block.target.anchorKind, block.target.quote], ["flow", "block", null]);
    assert.deepEqual([quoted.kind, quoted.suggestion, quoted.target.anchor, quoted.target.anchorKind, quoted.target.quote.exact], ["suggestion", "refills its bucket on demand", "alpha", "section", QUOTE]);
    assert.ok(quoted.target.quote.prefix.endsWith("The limiter ") && quoted.target.quote.suffix.startsWith(", so an idle"), "the context either side of the quote");
    assert.ok(quoted.target.quote.prefix.length <= 32 && quoted.target.quote.suffix.length <= 32);
    assert.equal(quoted.target.position.end - quoted.target.position.start, QUOTE.length);
    assert.deepEqual([reply.inReplyTo, reply.resolves, reply.body, "target" in reply], [section.id, true, "Answered in the text.", false]);

    const gzFile = await download(p, downloads, "[data-export=gz]", ".json.gz");
    const unzipped = JSON.parse(zlib.gunzipSync(fs.readFileSync(gzFile)).toString("utf8"));
    assert.deepEqual(schemaProblems(unzipped, schema), []);
    assert.deepEqual(unzipped.comments, review.comments, "the .json.gz holds the same messages");
    assert.deepEqual(await p.evaluate("window.__errors"), []);
  });

  await t.test("on a phone the panel is a bar, the page stays usable, and a thread opens where its comment is", async () => {
    const p = await tab({ width: 390, height: 844, mobile: true });
    await p.goto(`${base}${PAGE}`);
    await p.evaluate("localStorage.clear()"); // the drafts of the test before share this origin
    await p.goto(`${base}${PAGE}?review`);
    await p.until("document.querySelector('.bh-review-panel:not([hidden])')", "the panel");
    // #350: open, the panel covered all but 38px of the page, and every "+ Comment" with it.
    assert.deepEqual(await p.evaluate(`(() => {
      const panel = document.querySelector(".bh-review-panel"), r = panel.getBoundingClientRect();
      return [panel.classList.contains("is-collapsed"), panel.querySelector(".bh-review-collapse").getAttribute("aria-expanded"), r.height < 80, r.left >= 0 && r.right <= 390];
    })()`), [true, "false", true, true], "collapsed to a bar inside the screen");
    await p.evaluate("document.getElementById('alpha').scrollIntoView({ block: 'center' })");
    assert.equal(await p.evaluate(`(() => {
      const b = document.querySelector("#alpha > .bh-review-add"), r = b.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b;
    })()`), true, "the section's + Comment is not covered");
    await p.click("#alpha > .bh-review-add");
    await compose(p, "comment", "From a phone.");
    assert.equal(await p.evaluate("document.querySelector('.bh-review-summary').textContent"), "1 draft");

    // #352: far from the comment, choose it in the panel's list: the page scrolls to it and the thread opens in view.
    await p.evaluate("scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })");
    await p.click(".bh-review-collapse");
    assert.equal(await p.evaluate("document.querySelector('.bh-review-collapse').getAttribute('aria-expanded')"), "true");
    await p.click(".bh-review-mylist .bh-review-item");
    await p.until("document.querySelector('.bh-review-pop[aria-label=\"Thread 1\"]')", "thread 1");
    assert.deepEqual(await p.evaluate(`(() => {
      const pop = document.querySelector(".bh-review-pop"), r = pop.getBoundingClientRect();
      return [document.querySelector(".bh-review-panel").classList.contains("is-collapsed"), r.top >= 0 && r.top < innerHeight, document.elementFromPoint(r.left + 20, r.top + 20)?.closest(".bh-review-pop") === pop];
    })()`), [true, true, true], "the panel collapsed, and the thread is on screen and on top");
    assert.deepEqual(await p.evaluate("[innerWidth, document.documentElement.scrollWidth]"), [390, 390], "no horizontal overflow");
    assert.deepEqual(await p.evaluate("window.__errors"), []);
  });
  await t.test("from file:// a download first asks for the build stamp, and puts the one pasted in the file", async () => {
    const real = fs.realpathSync(root);
    const p = await tab();
    await p.goto(`${pathToFileURL(path.join(real, PAGE)).href}?review`);
    await p.until("document.querySelector('.bh-review-panel:not([hidden])')", "the panel");
    await p.click("#beta > .bh-review-add");
    await compose(p, "comment", "Read from disk.");
    const files = () => fs.readdirSync(downloads).length;
    const before = files();

    await p.click("[data-export=json]");
    await p.until("document.querySelector('.bh-review-stamp')", "the stamp prompt");
    assert.equal(await p.evaluate("document.querySelector('.bh-review-stamp-cmd code').textContent"), `cd '${real}' && npm run -s stamp`, "the command, in the page's own folder");
    assert.equal(await p.evaluate("document.activeElement.id"), "bh-review-stamp-input");
    const tryPaste = async (text: string) => {
      await p.fill("#bh-review-stamp-input", text);
      await p.click(".bh-review-stamp .btn.primary");
      return p.evaluate("(() => { const e = document.querySelector('.bh-review-stamp-error'); return e && !e.hidden ? e.textContent : null; })()");
    };
    assert.match(await tryPaste("command not found: npm"), /starts with \{/);
    assert.match(await tryPaste('{"repo":"example/blog","commit":"abc123","dirty":false}'), /no commit/);
    assert.match(await tryPaste(`{"repo":"","commit":"${HEAD}","dirty":false}`), /no repository/);
    await sleep(300);
    assert.equal(files(), before, "nothing downloads until the reader chooses");

    // What the command prints, pasted with the terminal's other lines around it.
    const printed = execFileSync(process.execPath, [path.join(ROOT, "scripts/bh.mts"), "stamp"], { cwd: ROOT, encoding: "utf8" }).trim();
    const stamp = JSON.parse(printed);
    await p.fill("#bh-review-stamp-input", `$ npm run -s stamp\n${printed}\n$ `);
    const jsonFile = await download(p, downloads, ".bh-review-stamp .btn.primary", ".json");
    const review = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
    assert.deepEqual(schemaProblems(review, schema), []);
    assert.deepEqual([review.repo, review.build], [stamp.repo, { commit: stamp.commit, dirty: stamp.dirty, builtAt: stamp.builtAt }]);
    assert.deepEqual(review.comments.map((m: { commit: string; dirty: boolean }) => [m.commit, m.dirty]), [[stamp.commit, stamp.dirty]], "the draft took the stamp");
    assert.equal(await p.evaluate("document.querySelector('.bh-review-stamp')"), null, "the prompt closed");

    // A new visit has no stamp again. A draft written now has no commit; "Download without it" keeps it so, and does not ask twice.
    await p.goto(pathToFileURL(path.join(real, PAGE)).href + "?review");
    await p.until("document.querySelector('.bh-review-panel:not([hidden])')", "the panel");
    await p.click("#gamma > .bh-review-add");
    await compose(p, "comment", "Second visit.");
    await p.click("[data-export=gz]");
    await p.until("document.querySelector('.bh-review-stamp')", "the stamp prompt");
    const gzFile = await download(p, downloads, ".bh-review-stamp .bh-review-actions .btn.ghost", ".json.gz");
    const plain = JSON.parse(zlib.gunzipSync(fs.readFileSync(gzFile)).toString("utf8"));
    assert.deepEqual(schemaProblems(plain, schema), []);
    assert.deepEqual([plain.repo, plain.build.commit], [null, null]);
    assert.deepEqual(plain.comments.map((m: { commit: string | null }) => m.commit), [stamp.commit, null], "the earlier draft keeps its stamp; the new one has none");
    await download(p, downloads, "[data-export=json]", ".json");
    assert.equal(await p.evaluate("document.querySelector('.bh-review-stamp')"), null, "not asked again on this visit");
    assert.deepEqual(await p.evaluate("window.__errors"), []);
  });
});

test("npm run stamp prints the build stamp serve gives a page", () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, "scripts/bh.mts"), "stamp"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(out.trim().split("\n").length, 1, "one line, to paste");
  const stamp = JSON.parse(out);
  const git = (...a: string[]) => execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8" });
  const repo = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).repository.replace(/^github:/, "");
  assert.deepEqual([stamp.repo, stamp.commit, stamp.dirty], [repo, git("rev-parse", "HEAD").trim(), git("status", "--porcelain", "--", "docs", "theme", "index.html") !== ""]);
  assert.ok(!Number.isNaN(Date.parse(stamp.builtAt)));
});
