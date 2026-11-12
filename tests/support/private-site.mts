// A throwaway copy of the site for tests of private pages, with `op` replaced by a script on PATH
// that keeps its items in a JSON file, so the real cmdSeal and cmdCheck run end to end without
// touching a vault (or holding a real key).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";
import { parseCardsFile, renderCardsFile } from "../../scripts/private-cards.mts";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const FAKE_OP = `#!/usr/bin/env node
const fs = require("node:fs");
const file = process.env.FAKE_OP_STATE;
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { items: [], archived: [] };
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const [a, b, ...rest] = process.argv.slice(2);
if (a !== "item") { console.error("[ERROR] fake op: unsupported " + a); process.exit(1); }
// FAKE_OP_LOG: record when each call starts and ends, so a test can see how many ran at once.
// FAKE_OP_DELAY_MS: stand in for the round trip to the 1Password app.
const log = (mark) => process.env.FAKE_OP_LOG && fs.appendFileSync(process.env.FAKE_OP_LOG, mark + " " + [a, b, ...rest].join(" ") + "\\n");
const delay = Number(process.env.FAKE_OP_DELAY_MS || 0);
log("start");
if (delay) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
process.on("exit", () => log("end"));
if (b === "get" && state.failGet) { console.error("[ERROR] fake op: get failed"); process.exit(1); }
if (b === "get") {
  const item = state.items.find((i) => i.title === rest[0]);
  if (!item) { console.error('[ERROR] 2026/01/01 00:00:00 "' + rest[0] + '" isn\\'t an item in the "Private" vault.'); process.exit(1); }
  console.log(JSON.stringify(item));
} else if (b === "create") {
  const item = JSON.parse(fs.readFileSync(0, "utf8"));
  if (state.failCreateOnce === item.title) { delete state.failCreateOnce; save(); console.error("[ERROR] fake op: create failed"); process.exit(1); }
  item.id = "id" + (state.items.length + state.archived.length);
  state.items.push(item); save(); console.log(JSON.stringify({ id: item.id }));
} else if (b === "delete" && rest.includes("--archive")) {
  const i = state.items.findIndex((x) => x.title === rest[0]);
  if (i < 0) { console.error("[ERROR] not found"); process.exit(1); }
  state.archived.push(...state.items.splice(i, 1)); save();
} else { console.error("[ERROR] fake op: unsupported " + b); process.exit(1); }
`;

/** One item in the fake vault, as `op item get` prints it. */
export interface FakeOpItem { id?: string; title: string; fields: { id?: string; label: string; value?: string }[]; [more: string]: unknown }
/** The fake vault's state file. */
interface FakeOpState { items: FakeOpItem[]; archived: FakeOpItem[]; failCreateOnce?: string; failGet?: boolean }

export function site(t: TestContext) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bh-private-cards-test-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, "site"), bin = path.join(temp, "bin"), state = path.join(temp, "op-state.json"), opLog = path.join(temp, "op-calls.log");
  let delayMs = 0;
  fs.mkdirSync(root); fs.mkdirSync(bin);
  for (const entry of ["scripts", "theme", "docs", "templates", "reviews", "package.json", "index.html", "feed.xml"]) {
    fs.cpSync(path.join(ROOT, entry), path.join(root, entry), { recursive: true });
  }
  // The real sealed pages, and any plaintext unsealed from them, belong to the real vault: this site starts with none.
  for (const f of fs.readdirSync(path.join(root, "docs")).filter((f) => f.endsWith(".html"))) {
    if (f.endsWith(".private.html") || /<meta\s+name="bh:sealed"/.test(fs.readFileSync(path.join(root, "docs", f), "utf8"))) fs.rmSync(path.join(root, "docs", f));
  }
  fs.writeFileSync(path.join(root, "theme/private-cards.js"), renderCardsFile([]));
  fs.writeFileSync(path.join(bin, "op"), FAKE_OP, { mode: 0o755 });
  const env = (withOp: boolean) => ({ ...process.env, PATH: (withOp ? bin + path.delimiter : "") + path.dirname(process.execPath) + path.delimiter + "/usr/bin:/bin", FAKE_OP_STATE: state, FAKE_OP_LOG: opLog, FAKE_OP_DELAY_MS: String(delayMs), BH_OP_VAULT: "Private", CI: "" });
  const run = (args: string[], { withOp = true, env: extra = {} }: { withOp?: boolean; env?: Record<string, string> } = {}) => {
    const r = spawnSync(process.execPath, [path.join(root, "scripts/bh.mts"), ...args], { cwd: root, env: { ...env(withOp), ...extra }, encoding: "utf8" });
    return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
  };
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
  const write = (rel: string, text: string) => fs.writeFileSync(path.join(root, rel), text);
  const items = (): FakeOpItem[] => JSON.parse(fs.existsSync(state) ? fs.readFileSync(state, "utf8") : '{"items":[]}').items;
  const field = (title: string, label: string) => items().find((i) => i.title === title)?.fields.find((f) => f.label === label)?.value;
  const entries = () => parseCardsFile(read("theme/private-cards.js")).entries;
  const newPrivate = (slug: string, title: string, group?: string) => {
    const r = run(["new", "--private", "explainer", slug, title, `About ${title}`]);
    assert.equal(r.code, 0, r.out);
    if (group) setGroup(slug, group);
  };
  const setGroup = (slug: string, group?: string) => {
    const rel = `docs/${slug}.private.html`, html = read(rel).replace(/\s*<meta name="bh:group"[^>]*>/, "");
    const next = group ? html.replace(/(<meta name="bh:tags"[^>]*>)/, `$1\n  <meta name="bh:group" content="${group}">`) : html;
    assert.ok(!group || next !== html, "the group meta was not injected");
    write(rel, next);
  };
  const setMeta = (slug: string, name: string, value: string) => {
    const rel = `docs/${slug}.private.html`, html = read(rel), next = html.replace(new RegExp(`(<meta name="${name}" content=")[^"]*"`), `$1${value}"`);
    assert.notEqual(next, html, `${name} was not changed`);
    write(rel, next);
  };
  /** Put an item in the fake vault as it is, for states `seal` would never make itself. */
  const seed = (item: FakeOpItem) => {
    const data: FakeOpState = fs.existsSync(state) ? JSON.parse(fs.readFileSync(state, "utf8")) : { items: [], archived: [] };
    data.items.push({ id: "seed" + data.items.length, ...item });
    fs.writeFileSync(state, JSON.stringify(data));
  };
  const edit = (change: (data: FakeOpState) => void) => {
    const data: FakeOpState = fs.existsSync(state) ? JSON.parse(fs.readFileSync(state, "utf8")) : { items: [], archived: [] };
    change(data);
    fs.writeFileSync(state, JSON.stringify(data));
  };
  /** Remove an item from the fake vault, as if it were archived or deleted out of band. */
  const drop = (title: string) => edit((data) => { data.items = data.items.filter((i) => i.title !== title); });
  /** Make the next `op item create` for this title fail. */
  const failCreateOnce = (title: string) => edit((data) => { data.failCreateOnce = title; });
  /** Every `op` call so far, and the most that ran at the same time. Needs `delay` to overlap anything. */
  const opCalls = () => {
    const lines = fs.existsSync(opLog) ? fs.readFileSync(opLog, "utf8").split("\n").filter(Boolean) : [];
    let live = 0, peak = 0;
    for (const l of lines) { live += l.startsWith("start") ? 1 : -1; peak = Math.max(peak, live); }
    return { count: lines.filter((l) => l.startsWith("start")).length, peak, lines };
  };
  /** Make every fake `op` call take this long, as a round trip to the app does. */
  const delay = (ms: number) => { delayMs = ms; };
  return { root, edit, opCalls, delay, run, read, write, items, field, entries, newPrivate, setGroup, setMeta, seed, drop, failCreateOnce };
}


/** The helpers `site` returns. */
export type Site = ReturnType<typeof site>;
