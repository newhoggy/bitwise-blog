// The theme serves its fonts and third-party scripts itself (scripts/vendor.mts), and `check` keeps it so
// (scripts/remote-assets.mts). The page and theme rules also have fixtures in checker-rules.test.mts;
// these cover the matching details, and that `bundle` carries the self-hosted files inside the page.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { remoteAssetProblems, themeRemoteProblems, vendoredPrismLanguages, codeLanguageProblems } from "../scripts/remote-assets.mts";
import { VENDOR, PRISM_LANGUAGES } from "../scripts/vendor.mts";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HASH = 'integrity="sha384-EOXBFmc3gx5mb+vn0vPvvGqACToJD24hhacX5Yx+8NUUQrHIle/Qi5Bg9o3zKwW2"';

test("a script or stylesheet on another host needs an exact version and an integrity hash", () => {
  const flagged = (tag: string) => remoteAssetProblems(tag).length;
  // Unpinned or unhashed: flagged.
  assert.equal(flagged('<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>'), 1);
  assert.equal(flagged('<script src="https://cdn.jsdelivr.net/npm/mermaid@latest"></script>'), 1);
  assert.equal(flagged(`<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js" ${HASH}></script>`), 1);
  assert.equal(flagged('<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.30.0/prism.min.js"></script>'), 1);
  assert.equal(flagged('<script type="module" src="//unpkg.com/x@1.2.3/x.js"></script>'), 1, "protocol-relative");
  assert.equal(flagged('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">'), 1);
  assert.equal(flagged('<link rel="preload" as="script" href="https://cdn.example.com/x.js">'), 1);
  assert.equal(flagged(`<script src="https://cdn.example.com/x.js?v=1.2.3" ${HASH}></script>`), 1, "a version in the query string is not a pinned path");
  assert.equal(flagged(`<script src="https://cdn.example.com/x.js" integrity="md5-abc"></script>`), 1, "not an SRI algorithm");
  // Pinned and hashed, local, or not loaded at all: clean.
  assert.equal(flagged(`<script src="https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js" ${HASH} crossorigin="anonymous"></script>`), 0);
  assert.equal(flagged(`<script src='https://cdnjs.cloudflare.com/ajax/libs/prism/1.30.0/prism.min.js' ${HASH}></script>`), 0);
  assert.equal(flagged(`<script src="https://cdn.example.com/lib/v2.0.0-rc.1/lib.js" ${HASH}></script>`), 0);
  assert.equal(flagged('<script src="../theme/bh.js"></script><link rel="stylesheet" href="../theme/bh.css">'), 0);
  assert.equal(flagged('<link rel="alternate" type="application/atom+xml" href="https://example.com/feed.xml"><link rel="icon" href="https://example.com/i.svg">'), 0);
  assert.equal(flagged('<!-- <script src="https://cdn.jsdelivr.net/npm/mermaid@11"></script> -->'), 0, "a comment loads nothing");
  assert.equal(flagged('<pre><code>&lt;script src="https://cdn.jsdelivr.net/npm/mermaid@11"&gt;&lt;/script&gt;</code></pre>'), 0, "escaped markup is text");
});

test("the theme loads nothing from another host, and bh.js names the vendored files", () => {
  assert.deepEqual(themeRemoteProblems(source), []);
  const bhJs = fs.readFileSync(path.join(source, "theme/bh.js"), "utf8");
  for (const rel of Object.values(VENDOR)) {
    assert.ok(bhJs.includes(JSON.stringify(rel)), `bh.js names ${rel}`);
    assert.ok(fs.statSync(path.join(source, rel)).size > 0, `${rel} exists`);
    assert.ok(fs.existsSync(path.join(source, path.dirname(rel), "LICENSE")), `${rel} has its licence beside it`);
  }
  const css = fs.readFileSync(path.join(source, "theme/fonts.css"), "utf8");
  for (const [, file] of css.matchAll(/url\("([^"]+)"\)/g)) assert.ok(fs.existsSync(path.join(source, "theme", file!)), `theme/fonts.css: ${file} exists`);
  for (const family of ["Fraunces", "IBM Plex Sans", "JetBrains Mono"]) assert.ok(css.includes(`font-family: '${family}'`), family);
  assert.equal(fs.readdirSync(path.join(source, "theme/fonts")).filter((f) => /^OFL-.*\.txt$/.test(f)).length, 3, "one OFL licence per family");
});

test("the vendored Prism has every listed language, with aliases, and nothing else is reported", () => {
  const languages = vendoredPrismLanguages(source)!;
  for (const lang of [...PRISM_LANGUAGES, "py", "sh", "html", "none"]) assert.ok(languages.has(lang), lang);
  assert.deepEqual(codeLanguageProblems('<pre><code class="language-rust">fn main() {}</code></pre><code class="x language-yml">a: 1</code>', languages), []);
  assert.equal(codeLanguageProblems('<pre><code class="language-elixir">x</code></pre><pre><code class="language-elixir">y</code></pre>', languages).length, 1, "one warning per language");
  assert.deepEqual(codeLanguageProblems('<script>const s = \'<code class="language-elixir">\';</script>', languages), [], "scripts are not markup");
});

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bh-vendor-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const entry of ["scripts", "theme", "docs", "reviews", "templates", "package.json", "index.html"]) fs.cpSync(path.join(source, entry), path.join(root, entry), { recursive: true });
  const bundle = (rel: string) => {
    const r = spawnSync(process.execPath, [path.join(root, "scripts/bh.mts"), "bundle", rel], { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return fs.readFileSync(path.join(root, "dist", path.basename(rel)), "utf8");
  };
  return { bundle };
}

test("a bundle carries the fonts and the vendored scripts its page uses, byte for byte", (t) => {
  const f = fixture(t);
  const gallery = f.bundle("docs/component-gallery.html");
  const inlined = (rel: string) => fs.readFileSync(path.join(source, rel), "utf8").replace(/<\/script/gi, "<\\/script");
  // Mermaid holds `$&` and `$'`, which a string replacement would have expanded.
  assert.ok(gallery.includes(inlined(VENDOR.mermaid)), "Mermaid is inlined unchanged");
  assert.ok(gallery.includes(inlined(VENDOR.prism)), "Prism is inlined unchanged");
  assert.match(gallery, /src: url\("data:font\/woff2;base64,/, "the fonts are data: URIs");
  assert.doesNotMatch(gallery, /url\("fonts\//, "no font is left pointing at theme/fonts/");
  assert.doesNotMatch(gallery, /fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr|cdnjs\.cloudflare/);

  // A page with neither code nor Mermaid carries neither script.
  const glossary = f.bundle("docs/glossary.html");
  assert.ok(!glossary.includes(inlined(VENDOR.mermaid).slice(0, 2000)), "no Mermaid");
  assert.ok(!glossary.includes("window.Prism = window.Prism || { manual: true };"), "no Prism");
});
