# Glossary

Read this before defining a term, editing `docs/glossary.html` or changing the glossary popup in `bh.js`.

- **`docs/glossary.html` is the only place terms are defined.** It holds one
  `<dt id="kebab-id" data-aliases="plural, other spelling">Term</dt><dd>…</dd>` per term,
  kept A–Z. `npm run index` compiles it into `theme/glossary.js`. That file is generated,
  so never edit it by hand.
- Defined words are underlined automatically in article prose: the first occurrence per
  page, and the first per definition on the glossary page itself. Hover, focus or tap
  shows the definition.
- Change the marking per page with `<body data-glossary="page|section|every|off">`.
  Force a mark with `data-term="id"`; keep a passage unmarked with `class="no-glossary"`.
  Headings, links, code, labels, `summary` and diagrams are never marked.
- Definitions: one to three plain sentences a newcomer can follow, then a link to go
  deeper. Write relative links relative to `docs/`; they are rebased for other pages.
- List every plural and alternate spelling in `data-aliases`, because matching is
  whole-word and case-insensitive. Never let a name or alias belong to two terms;
  `check` fails on that.
- A page may add its own terms with a local `<dl class="glossary">`. These override
  shared terms with the same id on that page only.
- **Popup behaviour is a contract. Keep it when changing `bh.js`:**
  - It is placed once when it opens and never follows the pointer.
  - The pointer can cross the gap into it (an invisible bridge plus a hide delay).
  - Pressing inside it, clicking the term, or Enter/Space pins it until Esc or a click
    elsewhere.
  - Esc returns focus to the term without reopening the popup.
