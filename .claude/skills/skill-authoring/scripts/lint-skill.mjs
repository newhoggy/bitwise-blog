#!/usr/bin/env node
// Usage: node lint-skill.mjs [--strict] [--all | <skill-dir>...]
//
// Structural checks for Agent Skills, the skill equivalent of `npm run check`:
// frontmatter fields and limits, a name that matches the directory and avoids
// the reserved words, a description within 1,024 characters, a SKILL.md of at
// most 500 lines, links that resolve, references that stay one level deep,
// contents lists on long references, files nobody links to, repo-root paths
// to bundled files, and an evals/ directory. It reads files only: it does not
// check that the description triggers or that the skill helps (that is what
// the evals are for). --all lints every directory under .claude/skills of the
// current directory. Errors exit 1; warnings exit 1 only with --strict.
// No dependencies.
import fs from "node:fs";
import path from "node:path";

const CROSS_SURFACE = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
// Fields Claude Code reads that other hosts (pi, claude.ai, the API) reject or ignore.
const CLAUDE_CODE_ONLY = new Set([
  "when_to_use", "argument-hint", "arguments", "disable-model-invocation", "user-invocable",
  "disallowed-tools", "paths", "context", "agent", "model", "effort", "hooks", "shell",
]);
const RESERVED = ["claude", "anthropic"];
const MAX_NAME = 64, MAX_DESC = 1024, MAX_BODY_LINES = 500, LONG_REFERENCE_LINES = 100;

// Minimal frontmatter reader: top-level `key: value` pairs, quoted or plain, with
// indented continuation lines folded into the value. Enough for the checks below.
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return null;
  const fields = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      fields[key] = kv[2];
    } else if (key && /^\s+\S/.test(line)) {
      fields[key] += " " + line.trim();
    }
  }
  for (const k of Object.keys(fields)) {
    let v = fields[k].trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    fields[k] = v;
  }
  return { fields, body: text.slice(m[0].length), bodyStartLine: m[0].split("\n").length };
}

export function lintSkill(dir) {
  const out = [];
  const add = (level, file, msg) => out.push({ level, file: path.relative(process.cwd(), file) || file, msg });
  const skillMd = path.join(dir, "SKILL.md");
  if (!fs.existsSync(skillMd)) {
    add("error", dir, "SKILL.md not found");
    return out;
  }
  const text = fs.readFileSync(skillMd, "utf8");
  const fm = parseFrontmatter(text);
  if (!fm) {
    add("error", skillMd, "no YAML frontmatter (the file must start with ---)");
    return out;
  }
  const { fields, body } = fm;

  // name
  const dirName = path.basename(path.resolve(dir));
  if (!fields.name) add("error", skillMd, "frontmatter has no name");
  else {
    if (fields.name.length > MAX_NAME) add("error", skillMd, `name is ${fields.name.length} characters (limit ${MAX_NAME})`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fields.name)) add("error", skillMd, `name "${fields.name}" must be lowercase letters, digits and single hyphens`);
    if (fields.name !== dirName) add("error", skillMd, `name "${fields.name}" must equal its directory name "${dirName}"`);
    for (const w of RESERVED) {
      if (fields.name.split("-").includes(w)) add("error", skillMd, `name contains the reserved word "${w}"`);
    }
  }

  // description
  const desc = fields.description;
  if (!desc) add("error", skillMd, "frontmatter has no description");
  else {
    if (desc.length > MAX_DESC) add("error", skillMd, `description is ${desc.length} characters (limit ${MAX_DESC}, also pi's limit)`);
    if (/^(i|you|we|my)\b/i.test(desc)) add("warning", skillMd, 'description should be in the third person ("Guidelines for…", "Use when…"), not "I/you/we"');
    if (!/\b(use|used) when\b|\bwhen (the user|asked|you)\b|\btriggers? (on|when)\b/i.test(desc)) add("warning", skillMd, 'description says what the skill does but not when to use it ("Use when…")');
  }

  // fields
  for (const k of Object.keys(fields)) {
    if (CROSS_SURFACE.has(k)) continue;
    if (CLAUDE_CODE_ONLY.has(k)) add("warning", skillMd, `"${k}" is read only by Claude Code; other hosts (pi, claude.ai) may reject the skill. Keep it only if it earns its place`);
    else add("error", skillMd, `unknown frontmatter field "${k}"`);
  }

  // length
  const bodyLines = body.replace(/\n$/, "").split("\n").length;
  if (bodyLines > MAX_BODY_LINES) add("error", skillMd, `SKILL.md body is ${bodyLines} lines (limit ${MAX_BODY_LINES}); move detail into references/`);

  // files in the skill, links, depth
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? (e.name === "results" || e.name === "node_modules" ? [] : walk(p)) : [p];
  });
  const files = walk(dir);
  const linkedFrom = new Map(); // absolute target -> [source files]
  const mdFiles = files.filter(f => /\.md$/i.test(f) && !f.includes(`${path.sep}evals${path.sep}`));
  for (const f of mdFiles) {
    const src = fs.readFileSync(f, "utf8");
    const noCode = src.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
    for (const m of noCode.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const href = m[1].split("#")[0];
      // Skip URLs and placeholders such as "(…)" in an example quoted in the prose.
      if (!href || !/[A-Za-z0-9]/.test(href) || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
      const target = path.resolve(path.dirname(f), href);
      if (!fs.existsSync(target)) add("error", f, `link to missing file ${href}`);
      else {
        if (!linkedFrom.has(target)) linkedFrom.set(target, []);
        linkedFrom.get(target).push(f);
      }
    }
  }
  // A reference reached only through another reference may be read partially, so every
  // reference must be linked from SKILL.md itself.
  const refDir = path.resolve(dir, "references");
  const fromSkill = new Set([...linkedFrom].filter(([, srcs]) => srcs.some(s => path.resolve(s) === path.resolve(skillMd))).map(([t]) => t));
  for (const [target, sources] of linkedFrom) {
    if (!target.startsWith(refDir + path.sep) || fromSkill.has(target)) continue;
    const via = [...new Set(sources.map(s => path.relative(dir, s)))].join(", ");
    add("warning", target, `reached only through ${via}: references should be one level deep, so link it from SKILL.md`);
  }
  for (const f of files) {
    const rel = path.relative(dir, f);
    if (/^references\//.test(rel) && /\.md$/i.test(f)) {
      const n = fs.readFileSync(f, "utf8").split("\n").length;
      if (n > LONG_REFERENCE_LINES && !/^#{1,3}\s+(table of )?contents\b/im.test(fs.readFileSync(f, "utf8"))) add("warning", f, `${n} lines and no "Contents" heading: add a contents list so a partial read still shows the scope`);
    }
    if (/^(references|scripts|assets)\//.test(rel)) {
      const named = linkedFrom.has(path.resolve(f)) || text.includes(rel) || text.includes(path.basename(f));
      if (!named) add("warning", f, "not mentioned in SKILL.md: Claude will not know it exists");
    }
  }

  // repo-root paths to bundled files
  for (const f of mdFiles.concat(files.filter(f => /\.(mjs|js|sh|py)$/.test(f)))) {
    const src = fs.readFileSync(f, "utf8").split("\n");
    src.forEach((line, i) => {
      if (/\.claude\/skills\/[\w-]+\/(scripts|references|assets)\//.test(line) && !/\$\{CLAUDE_SKILL_DIR\}/.test(line)) {
        add("warning", f, `line ${i + 1}: repo-root path to a bundled file; use a path relative to the skill directory or \${CLAUDE_SKILL_DIR} so it resolves wherever the skill is loaded from (#77)`);
      }
    });
  }

  if (!fs.existsSync(path.join(dir, "evals"))) add("warning", dir, "no evals/ directory: add trigger evals and output evals (see references/evals.md)");
  // The same broken link can appear several times in one file; report it once.
  return out.filter((r, i) => out.findIndex(o => o.level === r.level && o.file === r.file && o.msg === r.msg) === i);
}

function main(argv) {
  const strict = argv.includes("--strict");
  let dirs = argv.filter(a => !a.startsWith("--"));
  if (argv.includes("--all")) {
    const root = path.resolve(".claude/skills");
    if (!fs.existsSync(root)) {
      console.error("no .claude/skills here: run from the repo root");
      return 2;
    }
    dirs = dirs.concat(fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(root, e.name)));
  }
  if (!dirs.length) {
    console.error("usage: node lint-skill.mjs [--strict] [--all | <skill-dir>...]");
    return 2;
  }
  let errors = 0, warnings = 0;
  for (const d of dirs) {
    const found = lintSkill(d);
    for (const r of found) {
      console.log(`${r.level === "error" ? "ERROR  " : "warning"} ${r.file}: ${r.msg}`);
      if (r.level === "error") errors++; else warnings++;
    }
    if (!found.length) console.log(`ok      ${path.relative(process.cwd(), d) || d}`);
  }
  console.log(`\n${errors} error(s), ${warnings} warning(s)${strict && warnings ? " (warnings are errors under --strict)" : ""}`);
  return errors || (strict && warnings) ? 1 : 0;
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
