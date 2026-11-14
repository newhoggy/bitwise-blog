// What `npm run visual` concluded, as data: the shapes of its results, the markdown summary CI
// shows on a pull request's checks page, and the exit code. Pure, so it is tested without Chrome
// (tests/visual-report.test.mts); scripts/visual.mts does the rendering and the file writing.

/** One layout a page is rendered in. */
export type Variant = { name: string; width: number; height: number; scheme: string; mobile: boolean };

/**
 * What became of one page in one layout. `new`: there was no baseline, so the render became one.
 * `updated`: `--update` accepted it. `error`: it never rendered (it threw, or never signalled
 * `data-bh-ready`), which always fails the run.
 */
export type Status = "same" | "changed" | "new" | "updated" | "error";

/** One page in one layout, and what became of it. */
export type Result = { name: string; file: string; v: Variant; status: Status; error?: string; changed?: number; ratio?: number; sizeChanged?: boolean };

/** Where a set of renders came from (`render.json` beside them). Every field is null when unknown, e.g. a local run. */
export type RenderInfo = { commit: string | null; chrome: string | null; run: string | null };

/** What the summary says about the comparison besides the results. */
export type SummaryContext = {
  /** The baseline's `render.json`, or null when it has none (no baseline, or one saved locally). */
  baseline: RenderInfo | null;
  /** This run's `render.json`. */
  current: RenderInfo;
  /** The commit a pull request is based on (`--base`), or null. */
  base: string | null;
  /** Whether differences only report (`--report-only`). */
  reportOnly: boolean;
};

/** The job fails on a page that did not render, and on a difference unless differences only report. */
export function exitCode(results: readonly Result[], reportOnly: boolean): 0 | 1 {
  if (results.some((r) => r.status === "error")) return 1;
  if (!reportOnly && results.some((r) => r.status === "changed")) return 1;
  return 0;
}

const short = (sha: string): string => sha.slice(0, 7);
// Text from a page or an error message, made safe for a markdown table cell or list item (never put it in a code span,
// where the escapes would show).
const md = (s: string): string => s.replace(/\s+/g, " ").replace(/[\\`*_|<>&[\]]/g, (ch) => `\\${ch}`);
const plural = (n: number, one: string, many = one + "s"): string => `${n} ${n === 1 ? one : many}`;

/** How much a changed render differs, in words. */
export function changeText(r: Result): string {
  if (r.sizeChanged) return "page size changed";
  if (r.changed === undefined || !Number.isFinite(r.changed)) return "changed";
  return `${r.changed.toLocaleString("en-US")} px (${((r.ratio ?? 0) * 100).toFixed(3)}%)`;
}

/** The job summary: a headline, the changed renders, the failures, and what the comparison was against. */
export function summaryMarkdown(results: readonly Result[], ctx: SummaryContext): string {
  const by = (s: Status): Result[] => results.filter((r) => r.status === s);
  const changed = by("changed"), errors = by("error"), same = by("same");
  const fresh = results.filter((r) => r.status === "new" || r.status === "updated");
  const compared = changed.length + same.length;
  const against = ctx.baseline?.commit
    ? `main at \`${short(ctx.baseline.commit)}\`${ctx.baseline.run ? ` ([run](${ctx.baseline.run}))` : ""}`
    : "the saved baselines";
  const lines: string[] = ["## Visual regression", ""];

  if (compared === 0) {
    lines.push(`**No baseline yet**, so ${plural(results.length - errors.length, "render was", "renders were")} not compared. Every build of main saves its renders as the baseline for pull requests (artifact \`visual-baseline\`), and a pull request is compared with the latest one.`);
  } else {
    lines.push(changed.length
      ? `**${changed.length} of ${plural(compared, "render")} changed** compared with ${against}.`
      : `**No visual changes** in ${plural(compared, "render")} compared with ${against}.`);
    if (changed.length && ctx.reportOnly) lines.push("", "Differences are reported, not failed: check that each one is intended.");
  }
  if (fresh.length && compared > 0) lines.push("", `${plural(fresh.length, "render has", "renders have")} no baseline yet: ${fresh.map((r) => md(r.name)).join(", ")}.`);

  if (changed.length) {
    lines.push("", "| Page | Layout | File | Change |", "| --- | --- | --- | --- |");
    for (const r of changed) lines.push(`| ${md(r.name.slice(0, r.name.length - r.v.name.length - 2) || r.name)} | ${md(r.v.name)} | ${md(r.file)} | ${changeText(r)} |`);
    lines.push("", "The baseline, current and diff images are in `report.html` in the `renders` artifact.");
  }

  if (errors.length) {
    lines.push("", `**${plural(errors.length, "render")} failed** (this fails the job):`, "");
    for (const r of errors) lines.push(`- ${md(r.name)}: ${md(r.error ?? "unknown error")}`);
  }

  const notes: string[] = [];
  if (compared > 0 && ctx.base && ctx.baseline?.commit && !sameCommit(ctx.base, ctx.baseline.commit)) {
    notes.push(`The baseline is main at \`${short(ctx.baseline.commit)}\`, but this pull request is based on \`${short(ctx.base)}\`: changes merged to main in between also show here.`);
  }
  if (compared > 0 && ctx.baseline?.chrome && ctx.current.chrome && ctx.baseline.chrome !== ctx.current.chrome) {
    notes.push(`Chrome changed between the two builds (baseline ${md(ctx.baseline.chrome)}, this run ${md(ctx.current.chrome)}), so some differences may come from the browser rather than from this change.`);
  }
  // A blank quoted line between notes, or markdown runs them together into one paragraph.
  if (notes.length) lines.push("", notes.map((n) => `> ${n}`).join("\n>\n"));
  return lines.join("\n") + "\n";
}

/** Whether two commit ids name the same commit (either may be abbreviated). */
function sameCommit(a: string, b: string): boolean {
  const n = Math.min(a.length, b.length);
  return n >= 7 && a.slice(0, n).toLowerCase() === b.slice(0, n).toLowerCase();
}
