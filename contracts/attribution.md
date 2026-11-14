# Attribution link

Read this before touching the footer's attribution link, `bh.repoUrl` or `bh.siteName`.

Every footer carries a link back to the blog and its repo, because the posts are CC BY 4.0 and a
copy (a bundle, a fork, a saved page) should still say where it came from. It is generated:

- **The markup** is `<span data-attribution>From <a href="<site>">Bitwise Engineering</a> · <a
  href="<repo>">source</a></span>`, in the footer of the home page, every public page and every
  template. The links are **absolute**, so they work from a bundle or a file on disk. `npm run
  index` writes it (after the Subscribe span) and repairs a stale one; `check` requires exactly
  one, equal to what `index` would write. Don't edit it by hand, and keep it in your footer.
- **Where the URLs come from:** the site from `homepage` in `package.json` (or `BH_SITE_URL`), the
  repo from `bh.repoUrl` there (or `BH_REPO_URL`), the name from `bh.siteName`. A fork sets those
  and runs `npm run index`.
- **Bundles** keep it (unlike the feed links, which a standalone file has no use for).
- Sealed shells are frozen and have none; a private page's own footer is encrypted with it, and
  `check` does not require it there.
