// Guards against README and CLAUDE.md drifting from the repo. Pure functions, so tests call them directly.
//
// The README fences two lists that a machine compares with the source of truth, in HTML comments
// (GitHub does not render them):
//   <!-- bh:deps -->     … `package` …   <!-- /bh:deps -->      every npm dependency in package.json
//   <!-- bh:examples --> … `docs/x.html` … <!-- /bh:examples -->  every page with <meta name="bh:example">
// A dependency claim is a backticked name in the part of a list item before its first colon
// ("- `cheerio` and `yaml`: what they are for"); the description after the colon may mention
// commands freely. An example claim is any backticked `docs/<slug>.html` in the fence.
//
// CLAUDE.md names each feature's contract file (`contracts/<feature>.md`); see contractProblems.

/** What an npm package name looks like. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const DOC_PATH = /^docs\/[a-z0-9][a-z0-9-]*\.html$/;

function fenced(readme: string, name: string): string | undefined {
  const m = readme.match(new RegExp(`<!--\\s*bh:${name}\\s*-->([\\s\\S]*?)<!--\\s*/bh:${name}\\s*-->`));
  return m?.[1];
}

function claims(text: string, shape: RegExp): string[] {
  return [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]).filter((t) => shape.test(t));
}

/** Backticked names before the first colon of each `- ` item. A wrapped item counts as one line. */
function leadClaims(text: string, shape: RegExp): string[] {
  return text.split(/\n(?=\s*[-*] )/).filter((item) => /^\s*[-*] /.test(item)).flatMap((item) => claims(item.replace(/\s*\n\s*/g, " ").split(":")[0], shape));
}

function compare(what: string, absentFrom: string, claimed: string[], actual: string[], hint: string): string[] {
  const problems: string[] = [];
  const have = new Set(claimed), want = new Set(actual);
  const missing = [...want].filter((x) => !have.has(x)).sort();
  const extra = [...have].filter((x) => !want.has(x)).sort();
  if (missing.length) problems.push(`README.md ${what} is missing ${missing.map((x) => `\`${x}\``).join(", ")} (${hint})`);
  if (extra.length) problems.push(`README.md ${what} names ${extra.map((x) => `\`${x}\``).join(", ")}, which ${absentFrom}`);
  if (!claimed.length && !missing.length && !extra.length) problems.push(`README.md ${what} lists nothing`);
  return problems;
}

/** `pkg` is the parsed package.json. Every dependency kind counts, not only `devDependencies`. */
export function readmeDependencyProblems(readme: string, pkg: unknown): string[] {
  const o = (pkg && typeof pkg === "object" ? pkg : {}) as Record<string, unknown>;
  const names = (v: unknown) => (v && typeof v === "object" ? Object.keys(v) : []);
  const actual = [...new Set(["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap((k) => names(o[k])))];
  const text = fenced(readme, "deps");
  if (text === undefined) return ["README.md has no <!-- bh:deps --> … <!-- /bh:deps --> list of the npm dependencies"];
  return compare("dependency list", "package.json does not have", leadClaims(text, PACKAGE_NAME), actual, "add it, or remove it from package.json");
}

/** `exampleHrefs` are the root-relative paths ("docs/x.html") of the public pages marked `bh:example`. */
export function readmeExampleProblems(readme: string, exampleHrefs: string[]): string[] {
  const text = fenced(readme, "examples");
  if (text === undefined) return ["README.md has no <!-- bh:examples --> … <!-- /bh:examples --> list of the example pages"];
  return compare("example list", "no `bh:example` marker marks", claims(text, DOC_PATH), exampleHrefs, "add it, or remove its bh:example marker");
}

/** A contract file's name, and a path naming one (`contracts/x.md` or `./contracts/x.md`, not `docs/contracts/x.md`). */
const CONTRACT_NAME = /^[a-z0-9][a-z0-9-]*\.md$/;
const CONTRACT_PATH = /(?:(?<![\w/.-])|(?<=(?<![\w./-])\.\/))contracts\/([a-z0-9][a-z0-9-]*\.md)\b/g;
const contractsNamed = (text: string) => new Set([...text.matchAll(CONTRACT_PATH)].map((m) => m[1]!));

/**
 * `CLAUDE.md` keeps one pointer line per feature contract, fenced by `<!-- bh:contracts -->` comments.
 * Every contract file that `CLAUDE.md` (or another file in `others`, path → text) names must exist,
 * since a pointer to nothing loses the rules; and every file in `contracts/` must have a pointer in
 * the fence, since a contract no pointer leads to is never read. `present` lists the files in `contracts/`.
 */
export function contractProblems(claudeMd: string, present: string[], others: Record<string, string> = {}): string[] {
  const problems: string[] = [];
  const have = new Set(present);
  for (const [file, text] of Object.entries({ "CLAUDE.md": claudeMd, ...others })) {
    for (const f of [...contractsNamed(text)].sort()) if (!have.has(f)) problems.push(`${file} names contracts/${f}, which does not exist`);
  }
  const fence = fenced(claudeMd, "contracts");
  if (fence === undefined) return [...problems, "CLAUDE.md has no <!-- bh:contracts --> … <!-- /bh:contracts --> list of pointers to the feature contracts"];
  const pointed = contractsNamed(fence);
  for (const f of [...have].sort()) {
    if (!CONTRACT_NAME.test(f)) problems.push(`contracts/${f}: a contract's file name is kebab-case (a-z, 0-9, -) and ends in .md`);
    else if (!pointed.has(f)) problems.push(`contracts/${f} has no pointer line in CLAUDE.md's <!-- bh:contracts --> list: add one, or delete the file`);
  }
  return problems;
}
