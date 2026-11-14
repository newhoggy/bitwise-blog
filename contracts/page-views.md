# Page-view counting

Read this before touching GoatCounter, `GOATCOUNTER_CODE`, the deploy's tag injection or `npm run stats`.

The published site counts page views with [GoatCounter](https://www.goatcounter.com/): cookieless,
no consent banner. It is **added at deploy time and nowhere else**.

- **Switch.** The repository variable `GOATCOUNTER_CODE` (Settings → Secrets and variables →
  Actions → Variables; a variable, not a secret) is passed to `scripts/publish.mts` by
  the `deploy` job in `ci.yml`. Unset or empty means no tag, and the published artifact is byte-identical to one
  built without this feature. A value that is not `[a-z0-9-]+` fails the publish before anything
  is written.
- **Injection.** After everything else, `preparePublishedSite` adds one
  `<script data-goatcounter="https://<code>.goatcounter.com/count" async src="https://gc.zgo.at/count.js">`
  before `</head>` in the staged `index.html` and every staged `docs/*.html` that is not a sealed
  shell. Sources, templates, `theme/`, generated data, local previews, `npm run check` and
  `npm run bundle` never contain it. **Never put the tag in a page, template or theme file.**
- **Sealed pages are excluded by construction.** A sealed shell (recognised by
  `id="sealed-payload"`) is skipped, and the decrypted page comes from the source, which has no
  tag. This matters: after decrypting, the shell does `document.write`, so a tag in the source
  would run in the decrypted page, and `count.js` sends `document.title`, which is the private
  page's real title.
- **What is sent:** the path, the page title, the referrer, the screen size and the user agent
  (for browser and system statistics). No cookies, and GoatCounter stores no IP address. `count.js`
  takes the path from `<link rel="canonical">`, which every public page has, and excludes the URL
  fragment, so `#unlisted=true`, section ids and `#k=` keys never reach GoatCounter. It skips
  `localhost` by default.
- **Unlisted pages are counted.** Their paths reach GoatCounter and its dashboard lists their
  slugs, so keep the dashboard private and unshared: never enable public stats or the public visitor counter.
- **Trade-off.** `count.js` is a moving file on `gc.zgo.at` and is deliberately not pinned with
  SRI. If that matters later, host a copy and add an integrity hash.
- **Owner setup:** create a free GoatCounter site, then set `GOATCOUNTER_CODE=<code>`.

## Reading the numbers: `npm run stats`

`npm run stats` exports the hits from GoatCounter and prints views per page, sorted by views,
joined with each page's title, kind and tags from `docs/*.html` (`scripts/stats.mts`; no
dependencies, nothing written to disk).

- **Needs** `GOATCOUNTER_CODE` (the site code) and an API token. Create the token in
  GoatCounter under *Username → API*, with the **export** permission. The CSV export also needs
  *Individual pageviews* switched on in the site settings (off by default); without it the export
  fails and the error says so.
- **Token:** `GOATCOUNTER_TOKEN` in the environment, or a Password item titled
  `beautiful-html goatcounter token` in the 1Password vault `$BH_OP_VAULT` (default `Private`),
  read with `op` like the private-page keys. It is sent only as a `Bearer` header and is never
  printed, written to disk or committed. With no token the command says so and exits 1.
- **The join** matches GoatCounter's paths (from `<link rel="canonical">`; query, fragment and the
  site's sub-path removed) to the page heads in `docs/`. Bot hits and events are not counted;
  visitors are distinct sessions. Pages nobody viewed print with 0. A path that matches no page
  (removed, or an example page that is not published) prints under its path as "not in the repo".
  Sealed pages carry no tag, so they are never counted: they are left out unless a hit shows up
  for one (then it prints as `(private page)` with its path only, since its title is not in the repo).
- **It prints unlisted pages by title.** The output, like the dashboard and the export, is private:
  never paste it into a commit, issue, PR or any public place.
- `npm run stats -- --file export.csv` (or `.csv.gz`, as the dashboard saves it) reads an export you already have, with no token and no network.
- **GoatCounter allows one new export per hour** (HTTP 429 otherwise). The run prints the export's id
  as soon as it starts; if it then fails, `npm run stats -- --export-id <id>` continues that export
  instead of starting another.
  Each run is a full export; there is no stored cursor, because keeping the hits locally would put
  private analytics on disk.
