# External links

Read this before touching `npm run links`, `scripts/links.mts`, `links-allowlist.json` or `.github/workflows/links.yml`.

`check` verifies internal links and ids; `npm run links` (`scripts/links.mts`) checks the external ones, and
`.github/workflows/links.yml` runs it every Monday (and from the Actions tab). It is never a PR check, so a slow
or bot-hostile site cannot make a PR flaky.

- **What it reads:** `href` and `src` in the markup of the home page and every published, readable page
  (unlisted ones included; not sealed shells, private sources or example pages, whose links no reader of the
  deployed site can follow). Comments, `<script>` and `<style>` bodies are skipped; so are the site's own URLs,
  `preconnect` links and fragments (only that the document answers is checked).
- **How:** one request per URL, HEAD then GET, redirects followed by hand, 15 s timeout, 3 attempts for network
  errors, timeouts, 429 and 5xx, at most 8 at once and 2 per host, with a generic User-Agent that names no one.
- **What it reports:** per URL, its status, the redirect chain and target, and the pages that use it. *Broken* is
  no response or >= 400 (exit 1); *moved* is a link whose own first answer is a 301/308: update it to the target
  shown. A permanent hop behind a temporary one (a DOI's 302 to the publisher) is not the link's move.
- **`links-allowlist.json`** is for sites that refuse automated clients but work in a browser: `url` (exact, or a
  prefix ending in `*`), `accept` (the status codes, `"timeout"`, `"error"` or `"redirect"` it tolerates) and a
  `reason`. Never allowlist a link that is really gone: fix it. An entry that tolerated nothing in a run is
  listed as unused; remove it once its site answers reliably.
- **The issue.** The workflow keeps one issue, labelled `link-check`: it opens or reopens it and rewrites its
  description while something is broken or moved (with a comment when the findings change, since an edit
  notifies nobody) and closes it when a run is clean. The issue is public, so it names unlisted pages only as
  "an unlisted page", and so does the job's log. The job goes red, and leaves the issue alone, when the check
  itself fails, when the issue can't be updated, or when most URLs got no response at all (a network problem on
  the runner, not hundreds of broken links).
