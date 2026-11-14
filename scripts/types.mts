// Shapes of the data passed between the parts of scripts/bh.mts (index, check, cards, bundle, seal).
// Type-only: import with `import type`, so Node erases the import and never loads this file.

/** A public page as `index` and `check` read it from its head (root-relative `href`; lifecycle links are root-relative too, or ""). */
export interface Doc {
  file: string;
  href: string;
  title: string;
  description: string;
  kind: string;
  status: string;
  date: string;
  tags: string;
  example: boolean;
  unlisted: boolean;
  authors: string;
  supersedes: string;
  supersededBy: string;
}

/** Input of `socialBlock`: title, description, alt, authors and tags are HTML text as written in the page; urls are plain. */
export interface SocialMeta {
  type: "website" | "article";
  title: string;
  description: string;
  url: string;
  image: string;
  alt: string;
  published?: string;
  authors?: string[];
  tags?: string[];
  noindex?: boolean;
  /** schema.org structured data for the page, written as one `<script type="application/ld+json">` in the block. */
  jsonLd?: JsonLd;
}

/** A schema.org JSON-LD object (plain text values, not HTML): a `TechArticle` for a post, a `WebSite` for the home page. */
export interface JsonLd {
  "@context"?: string;
  "@type": string;
  [field: string]: unknown;
}

/** The visual a page's card shows (see `chooseVisual`): an element of the page (`css` + `index`) or an image file. */
export interface Visual {
  tier: "override" | "figure" | "image" | "glyph" | "logo";
  css?: string;
  index?: number;
  image?: string | null;
  label: string;
  source: string;
  files: string[];
  /** Set when an author's `bh:image` override can't be resolved. */
  problem?: string;
}

/** Everything that decides how one page's card looks; `key` is the staleness hash recorded in the PNG. */
export interface CardJob {
  slug: string;
  href: string;
  out: string;
  key: string;
  selection: Visual;
  frame: { title: string; kind: string; date: string; siteName: string };
}

/** A term of docs/glossary.html. `id` is undefined when the `<dt>` has none (reported by `check`). */
export interface GlossaryEntry {
  id: string | undefined;
  term: string;
  aliases: string[];
  html: string;
}

/** An element of the tolerant HTML tree (`parseTree`): `start`/`end` index the tree's `src`, `attrs` is the raw attribute text. */
export interface TreeNode {
  tag: string;
  attrs: string;
  children: TreeNode[];
  parent: TreeNode | null;
  start: number;
  end: number;
}

/** A point, [x, y]. */
export type Pt = [number, number];

/** One segment of an SVG path, in absolute coordinates. `ctrl` holds the Bézier control points (none for a line). */
export interface PathSeg {
  type: string;
  from: Pt;
  to: Pt;
  ctrl: Pt[] | null;
}

/** A diagram node's rectangle. */
export interface NodeRect { id: string; x: number; y: number; w: number; h: number }

/** A box in diagram coordinates. */
export interface Box { left: number; right: number; top: number; bottom: number }

/** One comment or reply of a `bh-review/1` file (reviews/schema.json). Only the fields `bh.mts` reads are named. */
export interface ReviewComment {
  id?: string;
  body?: string;
  kind?: string;
  created?: string;
  inReplyTo?: string;
  resolves?: boolean;
  author?: string | null;
  outdated?: unknown;
  target?: { quote?: { exact?: unknown } };
}

/** A parsed review file. The content is whatever the reviewer's browser exported, so every field may be missing or wrong (`reviewProblems` says which). */
export interface ReviewFile {
  format?: string;
  document?: string;
  reviewer?: string;
  comments?: ReviewComment[];
}

/** A comment as published: no export-time `outdated`, and attributed. */
export type ReviewRecord = Omit<ReviewComment, "outdated"> & { author: string | null };

/** A 1Password item as `readItem` flattens it (empty strings for absent fields). */
export interface OpItem { id: string; group: string; password: string }
