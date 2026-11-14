# Reviews

Read this before applying a review file, replying to one, or touching `reviews/` or the Review panel.

Readers comment **on the page itself**: the top bar's Review button (or `?review`) lets
them select text or use "+ Comment" on a section or block. Comments stay in their browser,
reappear on later visits, and are exported from the Review panel as a `bh-review/1` file
(`.json`, or `.json.gz`). The format is defined in `reviews/schema.json`. Reviewers submit a
file by adding it to `reviews/inbox/` in a pull request. `check` validates every review file.

**Published threads.** Every review file in `reviews/` is compiled by `npm run index` into
`theme/reviews.js`, so once a review PR is merged its comments show on the published page
for everyone: highlights and pins, opening into threads.
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
