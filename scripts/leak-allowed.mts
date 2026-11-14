// The files allowed to share text with the private corpus, and how much (see corpus/README.md).
//
// Data only, outside scripts/advisor/: scripts/bh.mts may reach no advisor code and no installed
// package (the deploy job runs it with no install), but the feed needs this list to keep these pages'
// text out of feed.xml, since an allowance covers its page, not a file generated from it.
// scripts/advisor/guards.mts, which runs the leak check, re-exports both names.

/** A file allowed to share text with the private data, on purpose. */
export interface LeakAllowance {
  /** How many words of shared runs were reviewed. More than this fails: someone has to look again. */
  maxWords: number;
  reason: string;
}

/**
 * Files that quote a writer deliberately. The exception is per file and capped, so quoting more, or
 * quoting anywhere else, still fails. A generated file gets a cap of Infinity only if every word in it
 * comes from pages that are checked themselves.
 */
export const LEAK_ALLOWED: Record<string, LeakAllowance> = {
  // 1,500 words measured against post text, atlas, voice negatives and authored samples (#112). Most are one
  // 1,156-word run: the <template> blocks that hold verbatim essay passages shown as popups. The page says
  // they are used with permission, and the owner has to confirm that this covers all of them; the cap only
  // records what was measured, so more quoting still fails.
  "docs/voice-notes-on-trial.html": { maxWords: 1500, reason: "a published page: cited quotations and verbatim essay passages, said to be used with the writer's permission (scope to be confirmed by the owner)" },
  "theme/search-index.js": { maxWords: Infinity, reason: "generated from the text of docs/*.html, which are checked themselves" },
};
