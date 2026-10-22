import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lintSkill, parseFrontmatter } from "../.claude/skills/skill-authoring/scripts/lint-skill.mjs";

const GOOD_SKILL = `---
name: demo-skill
description: Guidelines for demos. Use when asked to demo something, even if the request does not say "demo".
---

# Demo

Read [references/more.md](references/more.md) when you need more, and run scripts/run.mjs.
`;

// Builds a good skill in a temp dir named after it, then applies \`mutate\`; the mutation
// must change something, or the test would pass while checking nothing.
function build(mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lint-skill-"));
  const dir = path.join(root, "demo-skill");
  fs.mkdirSync(path.join(dir, "references"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.mkdirSync(path.join(dir, "evals"));
  fs.writeFileSync(path.join(dir, "SKILL.md"), GOOD_SKILL);
  fs.writeFileSync(path.join(dir, "references", "more.md"), "# More\n\nDetail.\n");
  fs.writeFileSync(path.join(dir, "scripts", "run.mjs"), "console.log(1);\n");
  if (mutate) {
    const before = snapshot(dir);
    mutate(dir);
    assert.notEqual(snapshot(dir), before, "the injected fault changed nothing");
  }
  return dir;
}
const snapshot = dir => fs.readdirSync(dir, { recursive: true }).sort().map(f => {
  const p = path.join(dir, f);
  return f + ":" + (fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : "");
}).join("\n");
const edit = (dir, rel, fn) => fs.writeFileSync(path.join(dir, rel), fn(fs.readFileSync(path.join(dir, rel), "utf8")));
const messages = (dir, level) => lintSkill(dir).filter(r => !level || r.level === level).map(r => r.msg);
const has = (list, re) => assert.ok(list.some(m => re.test(m)), `expected ${re} in:\n${list.join("\n")}`);

test("a well-formed skill is clean", () => {
  assert.deepEqual(lintSkill(build()), []);
});

test("parseFrontmatter reads quoted and folded values", () => {
  const fm = parseFrontmatter('---\nname: "x"\ndescription: one\n  two\n---\nbody\n');
  assert.equal(fm.fields.name, "x");
  assert.equal(fm.fields.description, "one two");
  assert.equal(fm.body, "body\n");
});

test("missing frontmatter and missing SKILL.md are errors", () => {
  has(messages(build(d => edit(d, "SKILL.md", s => s.replace(/^---[\s\S]*?---\n/, ""))), "error"), /no YAML frontmatter/);
  has(messages(build(d => fs.rmSync(path.join(d, "SKILL.md"))), "error"), /SKILL\.md not found/);
});

test("name rules", () => {
  has(messages(build(d => edit(d, "SKILL.md", s => s.replace("name: demo-skill", "name: Demo_Skill"))), "error"), /lowercase/);
  has(messages(build(d => edit(d, "SKILL.md", s => s.replace("name: demo-skill", "name: other"))), "error"), /directory name/);
  has(messages(build(d => edit(d, "SKILL.md", s => s.replace("name: demo-skill", "name: claude-demo-skill"))), "error"), /reserved word "claude"/);
  has(messages(build(d => edit(d, "SKILL.md", s => s.replace("name: demo-skill", "name: " + "a".repeat(70)))), "error"), /70 characters/);
});

test("description rules", () => {
  has(messages(build(d => edit(d, "SKILL.md", s => s.replace("for demos.", "for demos." + " More words.".repeat(100)))), "error"), /limit 1024/);
  has(messages(build(d => edit(d, "SKILL.md", s => s.replace("Guidelines for demos.", "I help you with demos."))), "warning"), /third person/);
  has(messages(build(d => edit(d, "SKILL.md", s => s.replace(/ Use when.*\n/, "\n"))), "warning"), /not when to use/);
});

test("frontmatter fields: Claude Code-only is a warning, unknown is an error", () => {
  const withField = f => build(d => edit(d, "SKILL.md", s => s.replace("---\n\n#", `${f}\n---\n\n#`)));
  has(messages(withField("disable-model-invocation: true"), "warning"), /read only by Claude Code/);
  has(messages(withField("triggers: [a]"), "error"), /unknown frontmatter field "triggers"/);
});

test("SKILL.md over 500 lines is an error", () => {
  has(messages(build(d => edit(d, "SKILL.md", s => s + "- line\n".repeat(500))), "error"), /lines \(limit 500\)/);
});

test("links must resolve, and references must be linked from SKILL.md", () => {
  has(messages(build(d => edit(d, "SKILL.md", s => s + "\nSee [gone](references/gone.md).\n")), "error"), /missing file references\/gone\.md/);
  const nested = build(d => {
    fs.writeFileSync(path.join(d, "references", "deep.md"), "# Deep\n");
    edit(d, "references/more.md", s => s + "\nSee [deep](deep.md).\n");
  });
  has(messages(nested, "warning"), /reached only through references\/more\.md/);
});

test("placeholder hrefs and URLs are not links to files", () => {
  assert.deepEqual(messages(build(d => edit(d, "references/more.md", s => s + '\n"see [the paper](…) and [x](https://example.com/a)"\n')), "error"), []);
});

test("long references need a contents list; unmentioned files are flagged", () => {
  has(messages(build(d => edit(d, "references/more.md", s => s + "line\n".repeat(120))), "warning"), /no "Contents" heading/);
  assert.deepEqual(messages(build(d => edit(d, "references/more.md", s => s.replace("# More", "# More\n\n## Contents\n") + "line\n".repeat(120))), "warning"), []);
  has(messages(build(d => fs.writeFileSync(path.join(d, "references", "orphan.md"), "# Orphan\n")), "warning"), /not mentioned in SKILL\.md/);
});

test("repo-root paths to bundled files warn; ${CLAUDE_SKILL_DIR} does not", () => {
  const bad = build(d => edit(d, "SKILL.md", s => s + "\nRun node .claude/skills/demo-skill/scripts/run.mjs\n"));
  has(messages(bad, "warning"), /repo-root path to a bundled file/);
  const ok = build(d => edit(d, "SKILL.md", s => s + "\nRun node ${CLAUDE_SKILL_DIR}/scripts/run.mjs, not .claude/skills/demo-skill/scripts/run.mjs\n"));
  assert.ok(!messages(ok, "warning").some(m => /repo-root/.test(m)));
});

test("a skill with no evals/ warns", () => {
  has(messages(build(d => fs.rmSync(path.join(d, "evals"), { recursive: true })), "warning"), /no evals\/ directory/);
});
