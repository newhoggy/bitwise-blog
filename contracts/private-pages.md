# Private pages

Read this before touching sealing, `seal`, `unseal`, `bh:group`, `*.private.html` or `theme/private-cards.js`.

The repo and its GitHub Pages site are public, so a page that must stay private is never
committed as plain HTML. The committed copy is encrypted, and it opens only from a link that
carries its key.

- Write it as `docs/<slug>.private.html` (`npm run new -- --private <template> <slug> "<Title>"`).
  That name is git-ignored. Preview it locally like any page.
- `npm run seal` gzips and AES-256-GCM-encrypts each private page into `docs/<slug>.html`,
  which is committed and published. Its link is `docs/<slug>.html#k=<key>`; add `&<id>`
  after the key to link to a section. `seal -- --show-links` prints the full links. The key
  is in the URL fragment, which browsers never send to the server. Opened without it, the
  page shows only a notice.
- **Keys live in 1Password**, never on disk: one Password item per page, titled
  `beautiful-html private page: <slug>`, in the vault `$BH_OP_VAULT` (default `Private`).
  `seal` creates the item the first time and reads it back to confirm it was stored. The
  key stays the same across re-seals, so links keep working. Needs the `op` CLI with
  1Password's desktop-app integration turned on.
- **The sealed file is the copy of record.** In a fresh clone, `npm run unseal` (or
  `unseal -- <slug>`) recreates `docs/<slug>.private.html` from the sealed page and its key.
  It refuses to overwrite unsealed edits unless you pass `--force`.
- **Groups.** Several private pages can share one key. Put `<meta name="bh:group" content="<name>">`
  (kebab-case) in each page's `<head>`; a page with no group keeps its own key, as before. The
  meta is valid only in `docs/*.private.html` (`check` fails on a public page or template) and is
  encrypted along with the page, so the group name never reaches the repo (`check` fails if it
  shows up in a sealed file or in `theme/private-cards.js`; a name shorter than 8 characters can't be
  told from chance in base64, so it isn't searched for: pick a longer one).
  - The group's key is one Password item, `beautiful-html private group: <name>`, in the same
    vault. A grouped page's own item, `beautiful-html private page: <slug>`, then holds no key,
    only a `group` field naming the group; `readKey`, `unseal` and `check` follow it. `seal`
    creates the group item on first use.
  - **Anyone with a group key opens every page in the group** and sees every card in it. Use a
    separate group (or none) for pages with a different audience.
  - **Adding, removing or renaming `bh:group` re-keys the page**: it is re-encrypted under the new
    key and every old `#k=` link to it stops working. `seal` prints a warning naming the page.
    It archives the page's old item (it never edits a secret through argv) and creates the new one;
    if that fails it puts the old item back. If a page's group item is missing while the page still
    points at it, `seal` refuses (it would re-key the whole group) and `check` and `unseal` say the
    group item is missing: restore it from the 1Password archive.
  - Archive a group's item only once no page uses the group.
- **Cards on the home page.** `npm run seal` also writes `theme/private-cards.js` (generated;
  never edit it, and `index` never touches it): one blob per sealed page, holding its card
  (title, description, kind, status, date, tags and any `supersededBy`) as gzip(JSON) under
  AES-256-GCM, with the page's key (the group's, for a grouped page) and the additional data
  `bh-card/1:<slug>`, so a blob can't pass for a page payload or for another page's card. Opening
  `index.html#k=<key>` (repeat `k=` for several keys) decrypts the blobs that key opens and merges
  their cards into the catalogue, with a lock and "Private" label; filters and the filter box work
  on them. The home page is unchanged without a key: nothing is requested.
  - The browser also uses keys remembered in the tab (`sessionStorage["bh-index-keys"]`, set when
    a key opened cards, and the `bh-sealed-key:*` keys of sealed pages opened in this tab), so
    opening a private page and going back to the home page shows its card. The key is removed
    from the address bar; a key that opens nothing shows a toast and is not remembered.
  - The card file is public: it reveals each page's slug and the rough length of its card (the
    sealed filename and payload already do). A card link, `docs/<slug>.html#k=<key>`, is assembled
    in the browser, so a key is never in committed HTML.
  - `seal -- --show-links` also prints the home page link for each group. Never put one in a
    commit, PR, issue or any public place.
  - `check` verifies the file's structure everywhere (CI included): it parses, is sorted and
    unique, every blob is plausible, every sealed page has one and every blob has a sealed page.
    Where the key and plaintext are at hand, it also decrypts each blob and compares it with the
    card the plaintext gives ("private card for `<slug>` is stale: run `npm run seal`").
  - A bundled page (`npm run bundle`) never carries the card file, so a bundled `index.html`
    shows no private cards. Header search does not include private pages.
- Re-run `npm run seal` after every edit. `check` fails when a sealed copy is stale, when
  its shell is outdated, or when a private page was never sealed.
  `check` reads each plaintext page's key from 1Password, all at once rather than one by one. In the
  edit loop, `npm run check -- --skip-keys` makes no 1Password call: it still checks every sealed
  shell, but not that a seal is current, and says so. It is refused under `CI`. Run plain `check` before you push.
- Private pages stay out of the catalogue, search, backlinks, card generation and
  `bundle --all`. Public pages, glossary entries included, must not link to them; `check`
  fails if one does.
- **A sealed page unfurls as a generic card**: title "Private page", a fixed description, the
  shared site card, `noindex, nofollow`, and no URL, date, author or tags. Its title,
  description and tags are inside the ciphertext only. `check` requires everything outside
  the payload and digest to equal the generic shell, and that a local plaintext's title and
  description don't appear in it. If the shell changes (for example a new site base), run
  `npm run seal -- --reshell`: it rewraps the existing ciphertext in the new shell without
  needing the key. A plain `seal` does the same when only the shell is outdated.
- A page that becomes private must lose its card: `npm run cards` deletes cards that have no
  public page, and `check` fails on any that remain (a card shows the title in clear).
- Private pages stay out of the published review threads too. `index` skips any review whose
  `document` is a private page (`docs/<slug>.private.html`, or a sealed `docs/<slug>.html`), so
  its quotes and comments never reach `theme/reviews.js` or `theme/site.js`. The review file
  itself would be public in git, so `check` fails if one under `reviews/` targets a private
  page: keep such review files out of the repo.
- After decrypting, the page removes the key from the address bar and remembers it for the
  browser session. Copied section links therefore have no key: share the full `#k=` link.
- Never put a `#k=` link in a commit message, PR, issue or any other public place.
- Making a page public: rename it to `docs/<slug>.html` (replacing the sealed copy), archive
  its 1Password item (and its group's item, once no page uses the group), and run
  `npm run seal` (it drops the page's blob from `theme/private-cards.js`) then `npm run index`.
