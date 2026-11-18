# Reviews

Read this before applying a review file, replying to one, or touching `reviews/` or the Review panel.

Readers comment **on the page itself**: the top bar's Review button (or `?review`) lets
them select text or use "+ Comment" on a section or block. Comments stay in their browser,
reappear on later visits, and are exported from the Review panel as a `bh-review/1` file
(`.json`, or `.json.gz`). The format is defined in `reviews/schema.json`. Reviewers submit a
file by adding it to `reviews/inbox/` in a pull request. `check` validates every review file
against the schema and its own rules (`scripts/reviews.mts`). Review is off on a page with
`<body data-review="off">` (no button; `?review` and stored drafts do nothing) and on every private
page, whose review would quote it in public (see `contracts/private-pages.md`). Below 1100px, where
the page does not make room for the Review panel, it opens collapsed to a bar ("Show panel", "Done"),
so the page stays usable while reviewing.

**Each file names the version it was made against**: `repo`, `build.commit` and `build.dirty`, and
each message's `commit` and `dirty`, all from `theme/build.js`. That file is not committed: the deploy
writes it, `npm run serve` serves it and `bundle` inlines it. A page opened from `file://` has none, so
a download from it first asks for one (#353): the panel shows `cd '<the page's folder>' && npm run -s stamp`
(`node scripts/bh.mts stamp`, which prints the stamp `serve` would give, as one line of JSON), and the
reader pastes what it prints. That goes into the file's `build` and every draft that has no commit. "Download
without it" gives `null` for all of them (the schema allows it), and the page does not ask again on that
visit. The stamp is not written to `theme/build.js` for `file://` pages to load: it would go stale without
notice after the next commit or pull, and a wrong commit is worse than none. Drafts stay under the storage key
they were loaded from, so a pasted stamp does not hide them from the next visit. `tests/review-browser.test.mts`
checks these fields in a downloaded file, from a served page and from `file://`.

**Submitting from the page waits for a hosted service** (#207). A "Submit on GitHub" button that
filed the review as a GitHub issue, and workflows that turned the issue into a pull request, were
removed in #199: they let any GitHub account make a workflow with a write token push a branch to this
repo and start CI on it, again on every edit, with no rate limit. (CI checking a review file in a
contributor's own pull request is fine: that runs with a read-only token, and GitHub asks you to approve
a first-time contributor's run.) Don't bring back an issue-, comment- or label-triggered workflow that
writes to the repo or starts CI on a stranger's input; that is the service's job, outside this repo.

**Published threads.** Every review file in `reviews/` is compiled by `npm run index` into
`theme/reviews.js`, so once a review PR is merged its comments show on the published page
for everyone: highlights and pins, opening into threads.
- The pins and the Review button's count are theme code that only a published thread shows, so `npm run a11y`
  scans a fixture page with threads ([`contracts/a11y.md`](a11y.md)). A pin's button is 24px square even though it
  draws smaller, and its name and the button's contain the number they show.
- Anyone can **Reply** in a thread. A reply is a draft in their browser until exported;
  it's a message with `inReplyTo` (and no target). A reply with `resolves: true` resolves
  the thread, and `false` reopens it.
- Resolved threads are hidden unless "Show resolved threads" is ticked.
- Drafts that have since been merged are dropped from the browser automatically.
- Re-exporting drafts is safe: unchanged messages on the same document are published
  once, even across multiple files. JSON property order and export-time `outdated` status
  do not affect identity; effective author and every other comment field do. Editing an
  already-submitted draft causes an id conflict: submit a new reply instead.
- `check` rejects ids reused for different content or documents, and requires every
  `inReplyTo` to point at a message that exists on the same document.

**Applying a review file (for an agent or a person):**
1. Read it (`gunzip` if it's `.json.gz`). For each comment, see the page as the reviewer
   saw it with `git show <comment.commit>:<document>` (if `commit` is null, use the
   current file).
2. Locate the target:
   - Start inside `target.anchor`: the section from that heading to the next one
     (`anchorKind` "section"), or that element ("block"), or before the first heading
     ("top").
   - Find `target.quote.exact` there, using `prefix`/`suffix` (then `position`) to choose
     between repeats. The quote is rendered text with whitespace collapsed, so match
     against the text, not the raw HTML.
   - If it isn't in the current version, find where that passage went. If it's gone,
     say so.
3. Act by `kind`:
   - `suggestion`: apply `suggestion` if it's right, or explain why not.
   - `question`: answer it in the document if a reader would ask it too, otherwise in
     the reply.
   - `blocker`: must be resolved or argued.
   - `comment`: use judgement.
   - Keep every house rule; `npm run check` must still pass.
4. **Reply on the page, not only in the pull request.** Add a review file of your own,
   `reviews/inbox/response-<document-slug>-<date>.json`, holding one reply per comment:
   - `reviewer` is your name (for example "Claude");
   - `inReplyTo` is the comment's id;
   - the `body` says what changed (quote the new wording) or why not;
   - set `resolves: true` when the comment is fully dealt with.
   After merge, readers see the answer in the thread on the page. The file is a full
   `bh-review/1` file (see `reviews/schema.json`); each reply needs `id`, `created`
   (ISO date-time), `kind` and `body` as well, and `document` must be the path of the
   page the comment is on, and every `inReplyTo` must be a comment on that same page:
   ```json
   {"format": "bh-review/1", "document": "docs/<slug>.html", "reviewer": "Claude",
    "build": {"commit": null}, "comments": [{"id": "r-1", "kind": "comment", "created": "2026-10-11T09:00:00Z",
                  "inReplyTo": "<comment id>", "resolves": true, "body": "Reworded to …"}]}
   ```
5. Leave the reviewer's file in the PR as the record. Don't edit it.
