# Example pages

Read this before touching `bh:example`, `?examples`, `theme/examples.js` or what `scripts/publish.mts` removes.

Some pages only demonstrate the theme and the templates (the rate-limiting design doc and its two
ADRs). They are not posts. They are hidden by default, where
you work as well as on the published site, and opt-in with `?examples`. Pages deployment builds a
separate published copy without them; local source files and committed generated data keep every
example.

- **Mark one** with `<meta name="bh:example" content="true">` in the `<head>`, or create it with
  `npm run new -- --example <template> <slug> "<Title>"`. The marker is the only thing that
  counts. `check` fails on the `examples` tag, which is reserved: the index adds the
  "Examples" topic and the "Example · …" label itself.
- **Hidden by default, on every host**, local ones included (`localhost`, `127.0.0.1`, `[::1]`,
  `*.localhost`, `*.local`, `file://`), so an author sees what readers see. Open any page with
  `?examples` to show them; `npm run serve` prints the hint. The theme still tells a local host
  from a domain (`bhExamples.local`): an example page opened on one offers a "Show example pages"
  link. Anything that renders example pages itself (`cards`, `visual`) adds `?examples`.
- **What hidden means**: no home-page card, kind or topic chip; no search
  result; no "Referenced by" entry; links to the page become plain text (also inside glossary
  popups); and opening the page's address shows a short "This is an example page" notice with a
  link to the posts. Review threads on the page go with the page. This describes the source
  copy. **On deployed Pages**, `scripts/publish.mts` removes the
  example HTML and social cards, strips links to examples while keeping their text/markup,
  and rebuilds the index, glossary, search, backlinks and review data in the artifact only.
  Example URLs return 404. Publication fails on zero examples or missing expected files.
- **One place decides.** `theme/examples.js` holds the only list of local hosts and the default. It is a
  synchronous script in every page's `<head>`, after the theme script, so `<html data-examples>`
  is set before first paint and nothing flashes. `check` fails if a page or template lacks it, or
  if the `bh:example` marker comes after it (the script reads the marker as it runs).
  `bh.js` and the search module read `window.bhExamples`; never copy the list.
- **Override.** `?examples` (or `=on`) shows them, `?examples=off` hides them,
  and `?examples=auto` forgets the choice (back to hidden). It is remembered for the tab session
  (`sessionStorage`), so it survives following links. Overrides apply to the source copy;
  they cannot restore examples removed from the deployed Pages artifact.
- **Without JavaScript** the home page hides its example cards (fails closed, as by default),
  and an example page opened directly stays readable, since only script can swap in the notice.
- **Linking to an example** from an ordinary page is allowed; `check` warns, because the link
  becomes plain text on the published site. The glossary is exempt: its definitions point at
  examples by design. An example may link to other examples freely.
- **Bundles** (`npm run bundle`) always show their own content, wherever the file is opened or
  hosted: `<html data-bundled>` overrides the host. A bundle has no index, search or backlinks.
- **Cards and private pages.** Example pages keep their social cards (`check` still requires
  them locally; deployment removes their cards). Private and sealed pages are never examples and are
  unaffected.
