// Read a writer's posts together with their corpus metadata. A port of lib/corpus.py from the
// shoulder-advisors repo.
//
// Everything derived from a writer's text lives in `dataDir(slug)`, under corpus/private, which is
// git-ignored (usually a symlink to a clone of a private data repo). Tools find it through
// `dataDir` and nowhere else. See corpus/README.md.
//
// `corpus_meta.yaml` in that directory is keyed by post file stem. It records judgments that don't
// belong in the scraped post files: the post's `category`, whether it feeds the stance atlas
// (`atlas: include|exclude`), whether it is held out for evals (`split: eval`), and provenance notes.
// Later stages read posts through `loadPosts`, `atlasPosts` or `evalPosts`, so the exclusions and
// the holdout are applied in one place.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  YamlError, codePointCompare, pyReadText, pySplitLines, pyStr, pyStrip, pyTruthy, pyYamlDump, pyYamlLoad, strRepr,
} from "./py-compat.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CORPUS_DIR = path.join(ROOT, "corpus");
export const PRIVATE_NAME = "private";
export const META_FILENAME = "corpus_meta.yaml";

// One writer's register shifted around 2024 (longer systematic essays before, shorter posts after).
export const EARLY_ERA = "2017-2023";
export const LATE_ERA = "2024+";
const EARLY_ERA_LAST_YEAR = 2023;

const ATLAS_VALUES = new Set(["include", "exclude"]);
const SPLIT_VALUES = new Set(["eval"]);
const REFERENCE_FIELDS = ["duplicate_of", "excerpt_of"];
const KNOWN_FIELDS = new Set(["category", "atlas", "atlas_reason", "split", "duplicate_of", "excerpt_of", "rehost_of", "partial", "byline"]);
// Categories that are excluded by default; including one needs a recorded reason.
const NEEDS_INCLUDE_REASON = new Set(["logistics", "fiction-humour-performance"]);
const TEXT_FIELDS = ["title", "author", "source", "platform", "slug"];

/** One entry of `corpus_meta.yaml`. */
export type PostMeta = Record<string, unknown>;
/** The `posts` map of `corpus_meta.yaml`, keyed by post file stem. */
export type CorpusMeta = Record<string, PostMeta | null>;
/** A post's YAML frontmatter, as PyYAML would read it. */
export type Frontmatter = Record<string, unknown>;

export interface Post {
  stem: string;
  path: string;
  title: string;
  author: string;
  source: string;
  published: string;
  platform: string;
  body: string;
  meta: PostMeta;
}

/** corpus/private: where everything derived from a writer's text lives. */
export function privateDir(corpusRoot: string = CORPUS_DIR): string {
  return path.join(corpusRoot, PRIVATE_NAME);
}

/** Where one writer's posts and derived data live. The only way tools find them. */
export function dataDir(slug: string, corpusRoot: string = CORPUS_DIR): string {
  return path.join(privateDir(corpusRoot), slug);
}

/** The era of a `published` date. Throws on a date whose first four characters aren't a year. */
export function eraOf(published: string): string {
  const head = Array.from(published).slice(0, 4).join("");
  if (!/^[ \t\n\r\f\v]*[-+]?[0-9]+(?:_[0-9]+)*[ \t\n\r\f\v]*$/.test(head)) throw new Error(`unparseable published date ${strRepr(published)}`);
  return Number(head.replaceAll("_", "")) <= EARLY_ERA_LAST_YEAR ? EARLY_ERA : LATE_ERA;
}

/** `entry.get("atlas", "include")`: a bare `atlas:` is null, which is neither value, not the default. */
function atlasValue(entry: PostMeta): unknown {
  return Object.hasOwn(entry, "atlas") ? entry.atlas : "include";
}

/** Not excluded from the atlas; ignores the holdout split. */
export function atlasEligible(post: Post): boolean {
  return atlasValue(post.meta) === "include";
}
export function isEval(post: Post): boolean {
  return post.meta.split === "eval";
}
export function inAtlas(post: Post): boolean {
  return atlasEligible(post) && !isEval(post);
}

/** `key: value` lines of a frontmatter block, unparsed. */
function rawFields(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of pySplitLines(block)) {
    const at = line.indexOf(": ");
    if (at !== -1 && !/^[ \t-]/.test(line)) out[pyStrip(line.slice(0, at))] = pyStrip(line.slice(at + 2));
  }
  return out;
}

/** A YAML scalar if `value` parses as one, else the raw text. */
function scalarOrRaw(value: string): unknown {
  let parsed: unknown;
  try {
    parsed = pyYamlLoad(value);
  } catch (e) {
    if (e instanceof YamlError) return value;
    throw e;
  }
  return parsed === null || parsed === undefined || isCollection(parsed) ? value : parsed;
}

function isCollection(value: unknown): boolean {
  return Array.isArray(value) || (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype);
}

function asMapping(value: unknown): Frontmatter {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype ? (value as Frontmatter) : {};
}

/** Split a post's text into its frontmatter and body. Text with no complete frontmatter is all body. */
export function parsePostText(text: string): [Frontmatter, string] {
  if (!text.startsWith("---\n")) return [{}, text];
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return [{}, text];
  const block = text.slice(4, end);
  const raw = rawFields(block);
  let fm: Frontmatter;
  try {
    fm = asMapping(pyYamlLoad(block));
  } catch (e) {
    if (!(e instanceof YamlError)) throw e;
    // Some ingested titles start with "[" unquoted: parse line by line instead.
    fm = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, scalarOrRaw(value)]));
  }
  for (const key of TEXT_FIELDS) {
    // `title: [Links]` is valid YAML but a list; these fields are always text.
    if (key in fm && typeof fm[key] !== "string" && key in raw && typeof scalarOrRaw(raw[key]) === "string") fm[key] = raw[key];
  }
  return [fm, text.slice(end + 5)];
}

export function parsePost(file: string): [Frontmatter, string] {
  return parsePostText(pyReadText(file));
}

/** A post's frontmatter with no line-by-line fallback: `build_index.py` treats unparseable frontmatter as empty. */
export function parseFrontmatter(file: string): Frontmatter {
  const text = pyReadText(file);
  if (!text.startsWith("---\n")) return {};
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return {};
  try {
    return asMapping(pyYamlLoad(text.slice(4, end)));
  } catch (e) {
    if (e instanceof YamlError) return {};
    throw e;
  }
}

export function metaPath(slug: string, corpusRoot: string = CORPUS_DIR): string {
  return path.join(dataDir(slug, corpusRoot), META_FILENAME);
}

export function loadMeta(slug: string, corpusRoot: string = CORPUS_DIR): CorpusMeta {
  const file = metaPath(slug, corpusRoot);
  if (!fs.existsSync(file)) return {};
  const posts = asMapping(pyYamlLoad(pyReadText(file))).posts;
  return pyTruthy(posts) ? (posts as CorpusMeta) : {};
}

/** The text of a sidecar holding `posts`, keeping the leading comment block of `existing`. */
export function renderMeta(posts: CorpusMeta, existing: string | null): string {
  let header = "";
  if (existing !== null) {
    const lines = pySplitLines(existing, true);
    const first = lines.findIndex((l) => pyStrip(l) !== "" && !l.startsWith("#"));
    header = lines.slice(0, first === -1 ? lines.length : first).join("");
    if (header && !header.endsWith("\n")) header += "\n";
  }
  return header + pyYamlDump({ posts });
}

/** Rewrite the sidecar deterministically, keeping its leading comment block. */
export function writeMeta(slug: string, posts: CorpusMeta, corpusRoot: string = CORPUS_DIR): void {
  const file = metaPath(slug, corpusRoot);
  fs.writeFileSync(file, renderMeta(posts, fs.existsSync(file) ? pyReadText(file) : null));
}

/** The `.md` files of a directory in `sorted(glob("*.md"))` order: by name with its suffix, so `a-b.md` comes before `a.md`. */
export function markdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort(codePointCompare).map((f) => path.join(dir, f));
}

export function loadPosts(slug: string, corpusRoot: string = CORPUS_DIR): Post[] {
  const meta = loadMeta(slug, corpusRoot);
  return markdownFiles(path.join(dataDir(slug, corpusRoot), "posts")).map((file) => {
    const stem = path.basename(file, ".md");
    const [fm, body] = parsePost(file);
    const text = (key: string, fallback: string) => (pyTruthy(fm[key]) ? pyStr(fm[key]) : fallback);
    return {
      stem,
      path: file,
      title: text("title", stem),
      author: text("author", ""),
      source: text("source", ""),
      published: text("published", ""),
      platform: text("platform", ""),
      body,
      meta: { ...(meta[stem] ?? {}) },
    };
  });
}

export function atlasPosts(slug: string, corpusRoot: string = CORPUS_DIR): Post[] {
  return loadPosts(slug, corpusRoot).filter(inAtlas);
}

export function evalPosts(slug: string, corpusRoot: string = CORPUS_DIR): Post[] {
  return loadPosts(slug, corpusRoot).filter(isEval);
}

/** True if corpus/private is a symlink whose target has gone: linked, but not there, which is not the same as no private data. */
export function danglingLink(corpusRoot: string = CORPUS_DIR): boolean {
  const link = privateDir(corpusRoot);
  return fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() === true && !fs.existsSync(link);
}

/** The problems with a writer's sidecar; empty when it is consistent. */
export function validate(slug: string, corpusRoot: string = CORPUS_DIR): string[] {
  const meta = loadMeta(slug, corpusRoot);
  if (Object.keys(meta).length === 0) return [];
  const posts = new Map(loadPosts(slug, corpusRoot).map((p) => [p.stem, p]));
  const metaOf = (stem: string): PostMeta => meta[stem] ?? {};
  const problems: string[] = [];
  for (const stem of [...posts.keys()].filter((s) => !Object.hasOwn(meta, s)).sort(codePointCompare)) {
    problems.push(`${stem}: post has no metadata entry`);
  }
  for (const stem of Object.keys(meta).sort(codePointCompare)) {
    const post = posts.get(stem);
    if (!post) {
      problems.push(`${stem}: metadata entry has no post`);
      continue;
    }
    const entry = metaOf(stem);
    const atlas = atlasValue(entry);
    const included = atlas === "include";
    for (const key of Object.keys(entry).filter((k) => !KNOWN_FIELDS.has(k)).sort(codePointCompare)) problems.push(`${stem}: unknown field ${key}`);
    if (!pyTruthy(entry.category)) problems.push(`${stem}: missing category`);
    try {
      eraOf(post.published);
    } catch (e) {
      problems.push(`${stem}: ${(e as Error).message}`);
    }
    if (!ATLAS_VALUES.has(atlas as string)) problems.push(`${stem}: atlas must be one of ['exclude', 'include']`);
    if (!included && !pyTruthy(entry.atlas_reason)) problems.push(`${stem}: excluded without atlas_reason`);
    if (included && NEEDS_INCLUDE_REASON.has(entry.category as string) && !pyTruthy(entry.atlas_reason)) {
      problems.push(`${stem}: ${pyStr(entry.category)} post included without atlas_reason`);
    }
    if ("split" in entry && !SPLIT_VALUES.has(entry.split as string)) problems.push(`${stem}: split must be one of ['eval']`);
    if (entry.split === "eval" && !included) problems.push(`${stem}: eval holdout post is excluded from the atlas`);
    for (const ref of REFERENCE_FIELDS) {
      const target = entry[ref];
      if (!pyTruthy(target)) continue;
      if (!posts.has(pyStr(target))) {
        problems.push(`${stem}: ${ref} names unknown post ${pyStr(target)}`);
        continue;
      }
      if (included) problems.push(`${stem}: ${ref} set but post is still atlas-included`);
      // The canonical copy must be the one that feeds the atlas: no self-references, cycles or chains.
      if (atlasValue(metaOf(pyStr(target))) !== "include") problems.push(`${stem}: ${ref} target ${pyStr(target)} is not atlas-eligible`);
    }
  }
  return problems;
}
