import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { serveStatic } from "../scripts/chrome.mts";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface Response { status: number | undefined; headers: http.IncomingHttpHeaders; body: string }

/** The TCP port a listening server was given. */
function portOf(server: http.Server): number {
  const address = server.address();
  assert.ok(address && typeof address !== "string", "the server listens on a TCP port");
  return address.port;
}

/** What theme/build.js sets: the build record `serve` writes for review comments. */
interface BuildWindow { BH_BUILD?: { repo: string; builtAt: string } }
const buildOf = (js: string): NonNullable<BuildWindow["BH_BUILD"]> => {
  const window: BuildWindow = {};
  vm.runInNewContext(js, { window });
  assert.ok(window.BH_BUILD, "theme/build.js sets BH_BUILD");
  return window.BH_BUILD;
};

async function fixture(t: TestContext, { shared = false, symlinkRoot = false } = {}): Promise<(requestPath: string) => Promise<Response>> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh-serve-"));
  let proc: ChildProcess | undefined;
  let server: http.Server | undefined;
  t.after(async () => {
    try {
      if (server) await new Promise((resolve) => server!.close(resolve));
      if (proc?.pid && proc.exitCode === null && proc.signalCode === null) {
        const exited = once(proc, "exit");
        proc.kill();
        await exited;
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  let root = path.join(dir, "repo");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  for (const file of ["bh.mts", "private-cards.mts", "page-size.mts", "docs-drift.mts"]) fs.copyFileSync(path.join(source, "scripts", file), path.join(root, "scripts", file));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ repository: "github:example/blog" }));
  fs.writeFileSync(path.join(root, "index.html"), "<h1>Home</h1>");
  fs.writeFileSync(path.join(root, "404.html"), "<h1>Lost</h1>");
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "docs/index.html"), "<h1>Docs</h1>");
  fs.writeFileSync(path.join(root, "docs/a page.html"), "<h1>Encoded path</h1>");
  fs.mkdirSync(path.join(root, "theme"));
  fs.writeFileSync(path.join(root, "theme/test.css"), "body { color: red; }");
  // Both a sibling sharing ROOT's prefix and an unrelated sibling really exist.
  for (const name of ["repo-secrets", "outside"]) {
    fs.mkdirSync(path.join(dir, name));
    fs.writeFileSync(path.join(dir, name, "secret.txt"), "Must not be served");
    fs.writeFileSync(path.join(dir, name, "index.html"), "Must not be served");
  }

  fs.symlinkSync("../repo-secrets/secret.txt", path.join(root, "external.txt"));
  fs.symlinkSync("../outside", path.join(root, "external-dir"), "dir");
  fs.mkdirSync(path.join(root, "external-index"));
  fs.symlinkSync("../../outside/index.html", path.join(root, "external-index/index.html"));
  fs.symlinkSync("docs/a page.html", path.join(root, "internal.html"));
  fs.symlinkSync("docs", path.join(root, "internal-dir"), "dir");
  fs.mkdirSync(path.join(root, "internal-index"));
  fs.symlinkSync("../index.html", path.join(root, "internal-index/index.html"));
  fs.symlinkSync("missing.html", path.join(root, "dangling.html"));
  fs.symlinkSync("loop.html", path.join(root, "loop.html"));
  if (symlinkRoot) {
    const alias = path.join(dir, "alias");
    fs.symlinkSync(root, alias, "dir");
    root = alias;
  }

  let port: number;
  if (shared) {
    server = await serveStatic(root, new Map([["/dynamic.js", { type: "text/javascript", body: "dynamic route" }]]));
    port = portOf(server);
  } else {
    // Allocate an available port before launching the actual CLI, which accepts a port argument.
    const reservation = http.createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    port = portOf(reservation);
    await new Promise((resolve) => reservation.close(resolve));
    const child = spawn(process.execPath, [path.join(root, "scripts/bh.mts"), "serve", String(port)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    proc = child;
    let output = "";
    child.stderr.on("data", (data) => { output += data; });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`Server startup timed out: ${output}`)), 5000);
      const onExit = () => finish(new Error(`Server exited during startup: ${output}`));
      const onData = (data: Buffer) => { output += data; if (output.includes("Serving ")) finish(); };
      const finish = (error?: Error) => {
        clearTimeout(timer);
        child.off("exit", onExit);
        child.off("error", finish);
        child.stdout.off("data", onData);
        if (error) reject(error); else resolve();
      };
      child.once("exit", onExit);
      child.once("error", finish);
      child.stdout.on("data", onData);
    });
  }
  return (requestPath: string) => new Promise<Response>((resolve, reject) => {
    // Pass the path directly: URL-based clients normalize literal traversal segments.
    const req = http.get({ hostname: "127.0.0.1", port, path: requestPath }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (data) => { body += data; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      res.on("error", reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
  });
}

test("serve rejects malformed URLs and traversal while preserving pages and build metadata", async (t) => {
  const request = await fixture(t);
  for (const url of ["/%E0%A4%A", "/%", "//["]) {
    assert.equal((await request(url)).status, 400, url);
    assert.equal((await request("/")).body, "<h1>Home</h1>", "server remains alive");
  }
  for (const url of ["/..%2frepo-secrets/secret.txt", "/..%2foutside/secret.txt"]) {
    assert.equal((await request(url)).status, 403, url);
  }
  for (const [url, body] of [["/", "<h1>Home</h1>"], ["/docs/", "<h1>Docs</h1>"], ["/docs/a%20page.html", "<h1>Encoded path</h1>"]]) {
    const res = await request(url);
    assert.equal(res.status, 200);
    assert.equal(res.body, body);
    assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(res.headers["cache-control"], "no-cache");
  }
  const css = await request("/theme/test.css");
  assert.equal(css.status, 200);
  assert.equal(css.body, "body { color: red; }");
  assert.equal(css.headers["content-type"], "text/css");
  // A missing path gets the generated 404 page, with status 404, as on GitHub Pages.
  const missing = await request("/missing/deep/page.html");
  assert.equal(missing.status, 404);
  assert.equal(missing.body, "<h1>Lost</h1>");
  assert.equal(missing.headers["content-type"], "text/html; charset=utf-8");
  assert.equal((await request("/missing.html")).status, 404);
  const build = await request("/theme/build.js");
  assert.equal(build.status, 200);
  assert.equal(build.headers["content-type"], "text/javascript");
  assert.equal(build.headers["cache-control"], "no-cache");
  const record = buildOf(build.body);
  assert.equal(record.repo, "example/blog");
  assert.ok(Number.isFinite(Date.parse(record.builtAt)));
});

for (const shared of [false, true]) {
  for (const symlinkRoot of [false, true]) {
    test(`${shared ? "serveStatic" : "CLI serve"} enforces canonical containment (${symlinkRoot ? "symlinked" : "direct"} root)`, async (t) => {
      const request = await fixture(t, { shared, symlinkRoot });
      for (const url of ["/external.txt", "/external-dir/secret.txt", "/external-dir/index.html", "/external-dir/", "/external-index/index.html", ...(!shared ? ["/external-index/"] : [])]) {
        const res = await request(url);
        assert.equal(res.status, 403, url);
        assert.equal(res.body.includes("Must not be served"), false, url);
        assert.equal((await request("/index.html")).body, "<h1>Home</h1>", "server survives rejection");
      }
      for (const [url, body] of [["/internal.html", "<h1>Encoded path</h1>"], ["/internal-dir/index.html", "<h1>Docs</h1>"], ["/internal-index/index.html", "<h1>Home</h1>"], ...(!shared ? [["/internal-dir/", "<h1>Docs</h1>"], ["/internal-index/", "<h1>Home</h1>"]] : [])]) {
        const res = await request(url);
        assert.equal(res.status, 200, url);
        assert.equal(res.body, body, url);
        assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
      }
      for (const url of ["/dangling.html", "/loop.html", "/missing.html"]) {
        assert.equal((await request(url)).status, 404, url);
      }
      for (const url of ["/%", "/%E0%A4%A", "//["]) assert.equal((await request(url)).status, 400, url);
      for (const url of ["/..%2frepo-secrets/secret.txt", "/..%2foutside/secret.txt"]) assert.equal((await request(url)).status, 403, url);
      const css = await request("/theme/test.css");
      assert.equal(css.status, 200);
      assert.equal(css.body, "body { color: red; }");
      assert.equal(css.headers["content-type"], "text/css");
      assert.equal((await request("/index.html")).body, "<h1>Home</h1>");
      const dynamic = await request(shared ? "/dynamic.js" : "/theme/build.js");
      assert.equal(dynamic.status, 200);
      assert.equal(dynamic.headers["content-type"], "text/javascript");
      if (shared) assert.equal(dynamic.body, "dynamic route");
      else {
        assert.equal(buildOf(dynamic.body).repo, "example/blog");
      }
    });
  }
}
