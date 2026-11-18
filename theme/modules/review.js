/* ==========================================================================
   Review — comment and reply directly on a page.

   Published threads: review files merged into the repo (reviews/**) are compiled by
   `npm run index` into theme/reviews.js and shown to every reader as highlighted,
   pinned threads. Drafts: new comments and replies made here stay in this browser
   (they survive revisits) until exported as a review file (JSON, optionally gzipped)
   and added to the repo by pull request; once merged they become part of the threads,
   and the local drafts are dropped automatically.

   Turn on with the top bar's Review button (or ?review); never where <body data-review="off">,
   which bh.js sets on every private page. Then:
   - select text and press "Comment", or use "+ Comment" on any section/figure;
   - open any pin to read the thread and Reply (optionally marking it resolved);
   - the panel lists threads and drafts, and exports your drafts.

   Each comment is anchored three ways, so it survives edits to the document:
     target.anchor    nearest stable id (a section heading, figure, step, …)
     target.quote     the exact text (whitespace collapsed) plus 32 chars either side
     target.position  offsets of that text within the anchor's text
   and stamped with the commit the page was built from (theme/build.js). That commit is
   also what "Changes since this comment" compares the page with (theme/modules/diff.js).
   ========================================================================== */
(function () {
  "use strict";
  const bh = window.bh;
  const { el } = bh;
  const doc = document, root = doc.documentElement;
  const FORMAT = "bh-review/1";
  const KINDS = ["comment", "suggestion", "question", "blocker"];
  const CONTEXT = 32;
  // Text the theme injects at runtime is not part of the document.
  const INJECTED = [
    "script", "style", ".heading-anchor", ".bh-link-btn", ".sidenote-ref", ".code-head", ".cw-gutter",
    ".cw-layer", ".bh-stepper-bar", ".bh-tablist", ".bh-versions-bar", ".bh-versions-caption",
    ".bh-versions-tag", ".bh-versions-divider", ".bh-versions-range", ".mx-bar", ".chart-legend", ".chart-plot",
    ".chart-data > summary", ".bh-backlinks", ".glossary-az", ".bh-toc", ".bh-meta", ".visually-hidden",
    "pre.mermaid", ".bh-review-ui", ".bh-review-add", ".bh-diff-ui",
  ].join(",");
  const BLOCKS = "figure[id], dt[id], [data-linkable][id], bh-step[id], bh-cw-step[id], bh-codewalk[id], bh-matrix[id]";
  const HEADINGS = ":scope > h2[id], :scope > h3[id], :scope > h4[id]";

  const article = doc.querySelector(".bh-article");
  const build = () => window.BH_BUILD || { repo: null, commit: null, dirty: null, builtAt: null };
  const docPath = () => bh.sitePath() || bh.meta("bh:source") || location.pathname.replace(/^\//, "");
  const storeKey = () => `bh-review/v1/${build().repo || "local"}/${docPath()}`;

  let state = { reviewer: "", comments: [] };            // local drafts (comments + replies)
  let published = [];                                      // merged comments for this document
  let active = false, panel, pinLayer, selBtn, pop, liveRegion;
  let showOnPage = true, showResolved = false;
  // Below this width theme/review.css does not make room for the panel, so open it covers the article (on a phone,
  // all but 38px of it): there it starts collapsed to a bar, and review mode stays on (#350). Keep in step with the CSS.
  const ROOMY = window.matchMedia("(min-width: 1100px)");
  const located = new Map(); // thread root id → { range } | null (outdated)

  // ---- Storage ------------------------------------------------------------------------

  function load() {
    const raw = bh.storage(() => localStorage.getItem(storeKey()));
    try { state = raw ? JSON.parse(raw) : state; } catch (_) { /* corrupt: start fresh */ }
    state.reviewer = state.reviewer || bh.storage(() => localStorage.getItem("bh-review/v1/reviewer")) || "";
    state.comments = state.comments || [];
    showOnPage = bh.storage(() => localStorage.getItem("bh-review/v1/show")) !== "off";
    published = ((window.BH_REVIEWS || {})[docPath()] || []).slice();
    // Drafts that have since been merged are now published: drop the local copies.
    const merged = new Set(published.map((c) => c.id));
    const before = state.comments.length;
    state.comments = state.comments.filter((c) => !merged.has(c.id));
    if (state.comments.length !== before) save();
  }
  function save() {
    bh.storage(() => {
      if (state.comments.length) localStorage.setItem(storeKey(), JSON.stringify(state));
      else localStorage.removeItem(storeKey());
      localStorage.setItem("bh-review/v1/reviewer", state.reviewer || "");
    });
    // Ask the browser not to evict this origin's data (Safari drops it after 7 idle days).
    if (state.comments.length && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    updateCount();
  }

  // ---- Text model: the document's own text, whitespace collapsed ----------------------------

  /** Scope = a block with an id, a section (its heading up to the next heading), or the top. */
  function headings() { return article ? [...article.querySelectorAll(HEADINGS)] : []; }
  // Not elt.matches(HEADINGS): in matches(), :scope is the element itself, so ":scope > h2" never matches (#349).
  const isHeading = (elt) => headings().includes(elt);

  function scopeRange(anchor) {
    const r = doc.createRange();
    const heads = headings();
    if (anchor) {
      const t = doc.getElementById(anchor);
      if (t && heads.includes(t)) {
        const next = heads[heads.indexOf(t) + 1];
        r.setStartBefore(t);
        if (next) r.setEndBefore(next); else r.setEndAfter(article.lastElementChild);
        return r;
      }
      if (t && article.contains(t)) { r.selectNodeContents(t); return r; }
      return null;
    }
    r.setStart(article, 0);
    if (heads[0]) r.setEndBefore(heads[0]); else r.setEndAfter(article.lastElementChild);
    return r;
  }

  /** Text nodes inside a range (minus injected UI), and the collapsed text with an index map. */
  function textModel(range) {
    const nodes = [];
    const walker = doc.createTreeWalker(range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (range.intersectsNode(n) && !(n.parentElement && n.parentElement.closest(INJECTED)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    for (let n; (n = walker.nextNode());) nodes.push(n);
    // Collapse runs of whitespace (across node boundaries) to one space; map back to (node, offset).
    let text = "";
    const map = []; // per output char: [nodeIndex, offset]
    let lastSpace = true;
    nodes.forEach((n, ni) => {
      const data = n.data;
      for (let i = 0; i < data.length; i++) {
        const ch = data[i];
        if (/\s/.test(ch)) { if (!lastSpace) { text += " "; map.push([ni, i]); lastSpace = true; } }
        else { text += ch; map.push([ni, i]); lastSpace = false; }
      }
    });
    return { nodes, text, map };
  }

  function pointToIndex(model, container, offset) {
    // Index of the first collapsed char at or after the DOM point.
    const probe = doc.createRange();
    for (let k = 0; k < model.map.length; k++) {
      const [ni, off] = model.map[k];
      probe.setStart(model.nodes[ni], off);
      probe.collapse(true);
      if (probe.compareBoundaryPoints(Range.START_TO_START, rangeAt(container, offset)) >= 0) return k;
    }
    return model.map.length;
  }
  function rangeAt(container, offset) { const r = doc.createRange(); r.setStart(container, offset); r.collapse(true); return r; }

  function indexRange(model, start, end) {
    if (start >= end || end > model.map.length) return null;
    const [sn, so] = model.map[start], [en, eo] = model.map[end - 1];
    const r = doc.createRange();
    r.setStart(model.nodes[sn], so);
    r.setEnd(model.nodes[en], eo + 1);
    return r;
  }

  // ---- Anchoring a new selection --------------------------------------------------------------

  function scopeForNode(node) {
    const elt = node.nodeType === 1 ? node : node.parentElement;
    const block = elt && elt.closest(BLOCKS);
    if (block && article.contains(block) && !isHeading(block)) return { anchor: block.id, kind: "block" };
    let section = null;
    for (const h of headings()) {
      if (h === elt || h.contains(elt) || (h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) section = h;
    }
    return { anchor: section ? section.id : "", kind: section ? "section" : "top" };
  }

  function targetFromSelection(sel) {
    const range = sel.getRangeAt(0);
    if (!article.contains(range.commonAncestorContainer)) return null;
    const { anchor, kind } = scopeForNode(range.startContainer);
    const scope = scopeRange(anchor);
    if (!scope) return null;
    // Clamp the selection to its scope.
    if (range.compareBoundaryPoints(Range.END_TO_END, scope) > 0) range.setEnd(scope.endContainer, scope.endOffset);
    const model = textModel(scope);
    const start = pointToIndex(model, range.startContainer, range.startOffset);
    let end = pointToIndex(model, range.endContainer, range.endOffset);
    let exact = model.text.slice(start, end);
    const trimmed = exact.replace(/\s+$/, "");
    end -= exact.length - trimmed.length;
    exact = trimmed.replace(/^\s+/, "");
    const s2 = end - exact.length;
    if (!exact) return null;
    return {
      anchor, anchorKind: kind,
      quote: { exact, prefix: model.text.slice(Math.max(0, s2 - CONTEXT), s2), suffix: model.text.slice(end, end + CONTEXT) },
      position: { start: s2, end },
    };
  }

  function targetForBlock(elt) {
    const kind = isHeading(elt) ? "section" : "block";
    const model = textModel(scopeRange(elt.id));
    const exact = model.text.trim().slice(0, 80);
    return { anchor: elt.id, anchorKind: kind, quote: null, position: null, label: exact };
  }

  // ---- Re-anchoring stored comments ----------------------------------------------------------------

  function locate(c) {
    const t = c.target;
    const scope = scopeRange(t.anchor) || (t.anchor ? null : scopeRange(""));
    if (!t.quote) return scope ? { range: blockRange(t.anchor) || scope } : null;
    const tryIn = (range) => {
      if (!range) return null;
      const model = textModel(range);
      const hits = [];
      for (let i = model.text.indexOf(t.quote.exact); i >= 0; i = model.text.indexOf(t.quote.exact, i + 1)) hits.push(i);
      if (!hits.length) return null;
      const score = (i) => {
        let sc = 0;
        const before = model.text.slice(0, i), after = model.text.slice(i + t.quote.exact.length);
        for (let k = 1; k <= t.quote.prefix.length && before.endsWith(t.quote.prefix.slice(-k)); k++) sc++;
        for (let k = 1; k <= t.quote.suffix.length && after.startsWith(t.quote.suffix.slice(0, k)); k++) sc++;
        if (t.position) sc -= Math.abs(i - t.position.start) / 1000;
        return sc;
      };
      const best = hits.sort((a, b) => score(b) - score(a))[0];
      return indexRange(model, best, best + t.quote.exact.length);
    };
    // In its own anchor first; then anywhere in the article (the text may have moved).
    const whole = doc.createRange();
    whole.selectNodeContents(article);
    const range = tryIn(scope) || tryIn(whole);
    return range ? { range } : null;
  }

  function blockRange(anchor) {
    const t = anchor && doc.getElementById(anchor);
    if (!t) return null;
    const r = doc.createRange();
    r.selectNode(t);
    return r;
  }

  // ---- Threads: published + draft comments, with replies -----------------------------------------

  const newId = () => "c-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const isDraft = (m) => state.comments.includes(m);

  /** Roots (no inReplyTo) with every reply that points into them, oldest first. */
  function threads() {
    const all = [...published, ...state.comments];
    const byId = new Map(all.map((m) => [m.id, m]));
    const rootOf = (m) => { let r = m, guard = 0; while (r.inReplyTo && byId.has(r.inReplyTo) && guard++ < 50) r = byId.get(r.inReplyTo); return r; };
    const map = new Map();
    for (const m of all) if (!m.inReplyTo) map.set(m.id, { root: m, replies: [] });
    for (const m of all) if (m.inReplyTo) { const t = map.get(rootOf(m).id); if (t) t.replies.push(m); }
    const list = [...map.values()];
    for (const t of list) {
      t.replies.sort((a, b) => a.created.localeCompare(b.created));
      const verdict = [...t.replies].reverse().find((r) => typeof r.resolves === "boolean");
      t.resolved = !!(verdict && verdict.resolves);
      t.draft = isDraft(t.root);
      t.drafts = [t.root, ...t.replies].filter(isDraft).length;
    }
    // Published threads first (as they were written), then this browser's drafts.
    return list.sort((a, b) => (a.draft - b.draft) || a.root.created.localeCompare(b.root.created));
  }

  // ---- Rendering: highlights, pins ------------------------------------------------------------------

  let current = [];
  function relocateAll() {
    current = threads();
    located.clear();
    for (const t of current) located.set(t.root.id, t.root.target ? locate(t.root) : null);
    paint();
  }

  const visible = (t) => (active || showOnPage) && (showResolved || !t.resolved || t.drafts > 0);

  function paint() {
    if (window.CSS && CSS.highlights && window.Highlight) {
      const ranges = current.filter((t) => visible(t) && t.root.target && t.root.target.quote && located.get(t.root.id)).map((t) => located.get(t.root.id).range);
      CSS.highlights.set("bh-review", new Highlight(...ranges));
    }
    pinLayer.replaceChildren();
    const used = [];
    current.forEach((t, i) => {
      const loc = located.get(t.root.id);
      if (!loc || !visible(t)) return;
      const rect = firstRect(loc.range);
      if (!rect) return;
      const right = article.getBoundingClientRect().right;
      const vw = doc.documentElement.clientWidth, narrow = vw < 640; // phones: no margin to sit in, so a smaller pin hugs the edge
      let top = rect.top + scrollY;
      // Don't stack pins: each button is 24px square (theme/review.css), so a pin goes just below the one it would cover.
      for (let u = used.find((v) => Math.abs(v - top) < 24); u !== undefined; u = used.find((v) => Math.abs(v - top) < 24)) top = u + 24;
      used.push(top);
      const n = 1 + t.replies.length;
      const pin = el("button", {
        type: "button",
        class: `bh-review-pin kind-${t.root.kind}${t.draft ? " is-draft" : ""}${t.resolved ? " is-resolved" : ""}`,
        text: String(i + 1),
        "data-thread": String(i + 1),
        title: `${t.root.body.slice(0, 100)}${n > 1 ? ` (${n} messages)` : ""}`,
        // The name holds the pin's visible number (WCAG 2.5.3) and names the message count drawn beside it.
        "aria-label": `Thread ${i + 1}${t.draft ? " (your draft)" : ""}${n > 1 ? `, ${n} messages` : ""}: ${t.root.body.slice(0, 80)}`,
        style: `top:${top}px;left:${narrow ? vw - 22 : Math.min(right + 6, vw - 30)}px`,
        onclick: () => openThread(t),
      });
      if (n > 1) pin.dataset.count = String(n); // drawn by CSS: generated text is not part of the pin's visible text, which stays its number
      pinLayer.append(pin);
    });
    pinLayer.hidden = !pinLayer.children.length; // an empty "Review comments" landmark would lead nowhere
    renderPanel();
    updateCount();
  }

  function firstRect(range) {
    const rects = [...range.getClientRects()].filter((r) => r.width || r.height);
    return rects[0] || range.getBoundingClientRect();
  }

  // ---- Changes since a comment (theme/modules/diff.js does the work) -------------------------------

  const COMMIT = /^[0-9a-f]{7,40}$/;
  /** Whether the page may differ from what a message's author saw: another commit, or local edits on top of the same one. */
  const mayDiffer = (m) => !!bh.siteRoot && typeof m.commit === "string" && COMMIT.test(m.commit) && (m.commit !== build().commit || build().dirty === true);

  /** Show the page's changes since `commit`; with a thread, go to the ones where its comment is. */
  function showChanges(commit, t) {
    const target = t && t.root.target;
    const opts = target ? { section: target.anchor, quote: target.quote ? target.quote.exact : "" } : {};
    return bh.loadModule("diff.js").then(() => (bh.diff ? bh.diff.show(commit, opts) : null)).then((res) => {
      if (!res) announce("No record of the changes since that version");
      else if (!res.total) announce("Nothing on this page has changed since then");
      else if (t) announce(res.here ? `${res.here} change${res.here === 1 ? "" : "s"} here since this comment` : `Nothing here has changed since this comment (${res.total} elsewhere)`);
      return res;
    });
  }

  /** The versions this page can be compared with: one per commit that a thread's first message names, oldest first. */
  function baselines() {
    const seen = new Map();
    for (const t of current) {
      const m = t.root;
      if (mayDiffer(m) && !seen.has(m.commit)) seen.set(m.commit, `${new Date(m.created).toLocaleDateString()} · ${m.author || m.reviewer || "a reviewer"}’s comment (${m.commit.slice(0, 7)})`);
    }
    return [...seen];
  }

  // ---- Popover: composer & thread ---------------------------------------------------------------------

  function closePop() {
    if (pop) pop.remove();
    pop = null;
    if (window.CSS && CSS.highlights) CSS.highlights.delete("bh-review-active");
  }

  function placePop(rect) {
    const vw = doc.documentElement.clientWidth, w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.max(8, Math.min(rect.left, vw - w - 8));
    const below = rect.bottom + 10 + h < innerHeight || rect.top - 10 - h < 60;
    pop.style.left = `${left + scrollX}px`;
    pop.style.top = `${(below ? rect.bottom + 10 : rect.top - 10 - h) + scrollY}px`;
  }

  function stamp() { const b = build(); return { created: new Date().toISOString(), commit: b.commit, dirty: b.dirty, author: state.reviewer || null }; }

  function composer(target, existing, rect, range) {
    closePop();
    const kind = el("select", { class: "bh-review-kind", "aria-label": "Kind" }, KINDS.map((k) => el("option", { value: k, text: k[0].toUpperCase() + k.slice(1), selected: existing ? existing.kind === k : k === "comment" })));
    const body = el("textarea", { class: "bh-review-body", rows: "4", placeholder: "Your comment…", "aria-label": "Comment" });
    body.value = existing ? existing.body : "";
    const suggestion = el("textarea", { class: "bh-review-suggestion", rows: "2", placeholder: "Suggested replacement text (optional)", "aria-label": "Suggested replacement" });
    suggestion.value = existing && existing.suggestion ? existing.suggestion : "";
    const sugWrap = el("div", { class: "bh-review-sugwrap" }, [suggestion]);
    const syncKind = () => { sugWrap.hidden = kind.value !== "suggestion"; };
    kind.addEventListener("change", syncKind);
    const quote = target.quote ? target.quote.exact : target.label ? `${target.anchorKind === "section" ? "Section" : "Block"}: ${target.label}` : "This page";
    const saveIt = () => {
      if (!body.value.trim()) { body.focus(); return; }
      const sug = kind.value === "suggestion" && suggestion.value.trim() ? suggestion.value.trim() : undefined;
      if (existing) {
        Object.assign(existing, { kind: kind.value, body: body.value.trim(), suggestion: sug, updated: new Date().toISOString() });
      } else {
        const t = { ...target };
        delete t.label;
        state.comments.push({ id: newId(), ...stamp(), kind: kind.value, body: body.value.trim(), ...(sug ? { suggestion: sug } : {}), target: t });
      }
      save();
      closePop();
      relocateAll();
      announce(existing ? "Comment updated" : "Comment saved in this browser");
    };
    pop = el("div", { class: "bh-review-pop bh-review-ui", role: "dialog", "aria-label": existing ? "Edit comment" : "New comment" }, [
      el("blockquote", { class: "bh-review-quote", text: quote.length > 160 ? quote.slice(0, 157) + "…" : quote }),
      el("div", { class: "bh-review-row" }, [kind]),
      body, sugWrap,
      el("div", { class: "bh-review-actions" }, [
        el("span", { class: "muted bh-review-hint", text: "⌘/Ctrl + Enter to save" }),
        el("button", { type: "button", class: "btn ghost", text: "Cancel", onclick: closePop }),
        el("button", { type: "button", class: "btn primary", text: existing ? "Update" : "Save", onclick: saveIt }),
      ]),
    ]);
    pop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.stopPropagation(); closePop(); }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveIt(); }
    });
    doc.body.append(pop);
    syncKind();
    placePop(rect);
    if (range && window.CSS && CSS.highlights && window.Highlight) CSS.highlights.set("bh-review-active", new Highlight(range));
    body.focus();
  }

  function message(m, t) {
    const draft = isDraft(m);
    const who = m.author || m.reviewer || (draft ? "You" : "Anonymous");
    return el("li", { class: `bh-review-msg${draft ? " is-draft" : ""}` }, [
      el("div", { class: "bh-review-msg-head" }, [
        el("strong", { text: who }),
        el("span", { class: "muted", text: new Date(m.created).toLocaleString() }),
        draft ? el("span", { class: "badge plain draft", text: "draft · not yet submitted" }) : null,
        m.resolves === true ? el("span", { class: "badge resolved", text: "resolved" }) : m.resolves === false ? el("span", { class: "badge open", text: "reopened" }) : null,
      ]),
      el("p", { class: "bh-review-text", text: m.body }),
      m.suggestion ? el("p", { class: "bh-review-suggested" }, [el("strong", { text: "Suggest: " }), m.suggestion]) : null,
      draft ? el("div", { class: "bh-review-msg-actions" }, [
        m === t.root
          ? el("button", { type: "button", class: "btn ghost", text: "Edit", onclick: () => { const loc = located.get(t.root.id); composer(t.root.target, m, loc ? firstRect(loc.range) : { left: 40, top: 120, bottom: 140 }, loc && loc.range); } })
          : null,
        el("button", { type: "button", class: "btn ghost", text: "Delete draft", onclick: () => remove(m) }),
      ]) : null,
    ]);
  }

  function openThread(t) {
    closePop();
    // relocateAll() rebuilds the thread objects (on a resize, or while goTo waits for its scroll), so a caller
    // holding an older one would open it as "Thread 0", placed by a pin that cannot be found (#352).
    t = current.find((x) => x.root.id === t.root.id) || t;
    const loc = located.get(t.root.id);
    const i = current.indexOf(t) + 1;
    const reply = el("textarea", { class: "bh-review-body", rows: "3", placeholder: "Reply…", "aria-label": "Reply" });
    const resolve = el("input", { type: "checkbox" });
    const sendReply = () => {
      if (!reply.value.trim() && !resolve.checked) { reply.focus(); return; }
      state.comments.push({
        id: newId(), ...stamp(), kind: "comment", inReplyTo: t.root.id,
        body: reply.value.trim() || (t.resolved ? "Reopened." : "Resolved."),
        ...(resolve.checked ? { resolves: !t.resolved } : {}),
      });
      save();
      relocateAll();
      const again = current.find((x) => x.root.id === t.root.id);
      if (again) openThread(again);
      announce("Reply saved in this browser; export it to submit");
    };
    pop = el("div", { class: "bh-review-pop bh-review-ui", role: "dialog", "aria-label": `Thread ${i}` }, [
      el("div", { class: "bh-review-head" }, [
        el("span", { class: `badge kind-${t.root.kind}`, text: t.root.kind }),
        el("span", { class: "muted", text: `#${i}` }),
        t.resolved ? el("span", { class: "badge resolved", text: "resolved" }) : null,
        !loc && t.root.target ? el("span", { class: "badge warn", text: "outdated" }) : null,
      ]),
      t.root.target && t.root.target.quote ? el("blockquote", { class: "bh-review-quote", text: t.root.target.quote.exact }) : null,
      !loc && t.root.commit && build().repo ? el("p", { class: "muted bh-review-hint" }, [
        "The text this refers to has changed. ",
        el("a", { href: `https://github.com/${build().repo}/blob/${t.root.commit}/${docPath()}`, target: "_blank", rel: "noopener", text: "See it as it was" }),
      ]) : null,
      el("ol", { class: "bh-review-msgs" }, [t.root, ...t.replies].map((m) => message(m, t))),
      mayDiffer(t.root) ? el("button", { type: "button", class: "btn bh-review-since", text: "Changes since this comment", onclick: () => { closePop(); showChanges(t.root.commit, t); } }) : null,
      reply,
      el("div", { class: "bh-review-actions" }, [
        el("label", { class: "bh-review-resolve" }, [resolve, t.resolved ? " Reopen" : " Mark resolved"]),
        el("button", { type: "button", class: "btn ghost", text: "Close", onclick: closePop }),
        el("button", { type: "button", class: "btn primary", text: "Reply", onclick: sendReply }),
      ]),
    ]);
    pop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.stopPropagation(); closePop(); }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(); }
    });
    doc.body.append(pop);
    placePop(loc ? firstRect(loc.range) : pinRect(t));
    if (loc && t.root.target.quote && window.CSS && CSS.highlights && window.Highlight) CSS.highlights.set("bh-review-active", new Highlight(loc.range));
    reply.focus({ preventScroll: true });
  }

  function pinRect(t) {
    const pin = pinLayer.querySelector(`[data-thread="${current.indexOf(t) + 1}"]`);
    return pin ? pin.getBoundingClientRect() : { left: 40, top: 120, bottom: 140, right: 60 };
  }

  function remove(m) {
    // Deleting a draft root also deletes your draft replies to it.
    state.comments = state.comments.filter((x) => x !== m && x.inReplyTo !== m.id);
    save();
    closePop();
    relocateAll();
    announce("Draft deleted");
  }

  // ---- Selection & block buttons (review mode only) -------------------------------------------------------

  function onSelection() {
    if (!active) return;
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !article.contains(sel.getRangeAt(0).commonAncestorContainer) || (pop && pop.contains(sel.anchorNode))) {
      selBtn.hidden = true;
      return;
    }
    const rects = [...sel.getRangeAt(0).getClientRects()];
    const last = rects[rects.length - 1];
    if (!last) return;
    selBtn.hidden = false;
    selBtn.style.left = `${Math.min(last.right + scrollX + 6, doc.documentElement.clientWidth - 110 + scrollX)}px`;
    selBtn.style.top = `${last.bottom + scrollY + 6}px`;
  }

  function commentOnSelection() {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const target = targetFromSelection(sel);
    if (!target) { announce("Select text inside the document to comment on it"); return; }
    const range = sel.getRangeAt(0).cloneRange();
    selBtn.hidden = true;
    composer(target, null, firstRect(range), range);
    sel.removeAllRanges();
  }

  function addBlockButtons() {
    const blocks = [...headings(), ...article.querySelectorAll(BLOCKS)];
    for (const b of blocks) {
      // A list may only hold li, so its button goes in the first item (as bh.js does for the link button).
      const host = b.matches("ul, ol") ? b.querySelector(":scope > li") : b;
      if (!host) continue; // a list with no item yet has nowhere valid to put it
      if (host.querySelector(":scope > .bh-review-add")) continue;
      const btn = el("button", {
        type: "button", class: "bh-review-add", text: "+ Comment", title: "Comment on this " + (isHeading(b) ? "section" : "block"),
        onclick: (e) => { e.stopPropagation(); composer(targetForBlock(b), null, b.getBoundingClientRect(), null); },
      });
      host.append(btn);
    }
  }
  function removeBlockButtons() { article.querySelectorAll(".bh-review-add").forEach((b) => b.remove()); }

  // ---- Panel: threads, drafts, export ---------------------------------------------------------------------

  function goTo(t) {
    if (!ROOMY.matches) setCollapsed(true); // or the open panel would cover the thread
    const loc = located.get(t.root.id);
    if (loc) {
      // The node the range starts at. A section or block comment's range selects the heading or block, so its start
      // container is the parent (the article): scrolling that to the centre lands mid-article (#352).
      const { startContainer: sc, startOffset } = loc.range;
      const start = sc.nodeType === 1 ? sc.childNodes[startOffset] || sc : sc.parentElement;
      const anchor = start.nodeType === 1 ? start : start.parentElement;
      anchor.scrollIntoView({ block: "center", behavior: bh.reducedMotion.matches ? "instant" : "smooth" });
      setTimeout(() => openThread(t), 350);
    } else {
      openThread(t);
    }
  }

  function threadItem(t) {
    const loc = located.get(t.root.id);
    const i = current.indexOf(t) + 1;
    const n = 1 + t.replies.length;
    const where = t.root.target && t.root.target.quote ? `“${t.root.target.quote.exact.slice(0, 60)}${t.root.target.quote.exact.length > 60 ? "…" : ""}”` : `#${(t.root.target && t.root.target.anchor) || "top"}`;
    const status = [t.resolved ? "resolved" : null, !loc && t.root.target ? "outdated" : null, n > 1 ? `${n} messages` : null, t.drafts ? `${t.drafts} draft${t.drafts === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
    return el("li", { class: `${loc ? "" : "is-outdated"}${t.resolved ? " is-resolved" : ""}` }, [
      el("button", { type: "button", class: "bh-review-item", onclick: () => goTo(t) }, [
        el("span", { class: `bh-review-num kind-${t.root.kind}${t.draft ? " is-draft" : ""}`, text: String(i) }),
        el("span", { class: "bh-review-item-text" }, [
          el("strong", { text: t.root.body.length > 90 ? t.root.body.slice(0, 87) + "…" : t.root.body }),
          el("span", { class: "muted", text: where + (status ? ` · ${status}` : "") }),
        ]),
      ]),
    ]);
  }

  function renderPanel() {
    if (!panel) return;
    const pub = current.filter((t) => !t.draft);
    const open = pub.filter((t) => !t.resolved);
    const shownPub = pub.filter((t) => showResolved || !t.resolved || t.drafts);
    const mine = current.filter((t) => t.draft);
    const draftCount = state.comments.length;
    panel.querySelector(".bh-review-pubhead").textContent = pub.length ? `Discussion · ${open.length} open${pub.length - open.length ? `, ${pub.length - open.length} resolved` : ""}` : "Discussion";
    panel.querySelector(".bh-review-publist").replaceChildren(...(shownPub.length ? shownPub.map(threadItem) : [el("li", { class: "muted", text: pub.length ? "All threads are resolved." : "No published comments on this page yet." })]));
    panel.querySelector(".bh-review-mylist").replaceChildren(...(mine.length ? mine.map(threadItem) : [el("li", { class: "muted", text: "Select text and press Comment, or use + Comment on a section. Reply from any thread." })]));
    panel.querySelector(".bh-review-mine").textContent = draftCount ? `Your drafts · ${draftCount} not yet submitted` : "Your drafts";
    panel.querySelector(".bh-review-summary").textContent = [open.length ? `${open.length} open` : "", draftCount ? `${draftCount} draft${draftCount === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
    panel.querySelectorAll("[data-export]").forEach((b) => { b.disabled = !draftCount; });
    panel.querySelector("[data-clear]").disabled = !draftCount;
    panel.querySelector(".bh-review-resolved").hidden = pub.length === open.length;
    const since = panel.querySelector(".bh-review-since-select"), bases = baselines(), shownBase = bh.diff ? bh.diff.base : null;
    since.replaceChildren(el("option", { value: "", text: "Off" }), ...bases.map(([commit, label]) => el("option", { value: commit, text: label })));
    if (shownBase && !bases.some(([commit]) => commit === shownBase)) since.append(el("option", { value: shownBase, text: shownBase.slice(0, 7) }));
    since.value = shownBase || "";
    panel.querySelector(".bh-review-changes").hidden = !bases.length && !shownBase;
  }

  function buildPanel() {
    const reviewer = el("input", { type: "text", class: "bh-review-reviewer", placeholder: "Your name (optional)", "aria-label": "Your name", value: state.reviewer });
    reviewer.addEventListener("input", () => { state.reviewer = reviewer.value.trim(); save(); });
    const clear = el("button", { type: "button", class: "btn ghost", "data-clear": "", text: "Delete all drafts…" });
    let armed = false;
    clear.addEventListener("click", () => {
      if (!armed) { armed = true; clear.textContent = "Click again to delete your drafts"; setTimeout(() => { armed = false; clear.textContent = "Delete all drafts…"; }, 3000); return; }
      state.comments = [];
      save();
      relocateAll();
      announce("Drafts deleted");
    });
    const resolvedToggle = el("input", { type: "checkbox" });
    resolvedToggle.addEventListener("change", () => { showResolved = resolvedToggle.checked; paint(); });
    const since = el("select", { class: "bh-review-since-select" });
    since.addEventListener("change", () => { if (since.value) showChanges(since.value, null); else if (bh.diff) bh.diff.hide(); });
    const pageToggle = el("input", { type: "checkbox", checked: showOnPage });
    pageToggle.addEventListener("change", () => { showOnPage = pageToggle.checked; bh.storage(() => localStorage.setItem("bh-review/v1/show", showOnPage ? "on" : "off")); paint(); });
    panel = el("aside", { class: "bh-review-panel bh-review-ui", id: "bh-review-panel", "aria-label": "Review" }, [
      el("div", { class: "bh-review-panel-head" }, [
        el("span", { class: "bh-review-title" }, [el("strong", { text: "Review" }), el("span", { class: "muted bh-review-summary" })]),
        el("button", { type: "button", class: "btn ghost bh-review-collapse", "aria-controls": "bh-review-panel", onclick: () => setCollapsed(!panel.classList.contains("is-collapsed")) }),
        el("button", { type: "button", class: "btn ghost", text: "Done", onclick: () => setActive(false) }),
      ]),
      el("p", { class: "bh-review-sec bh-review-pubhead" }),
      el("ol", { class: "bh-review-list bh-review-publist" }),
      el("label", { class: "bh-review-check bh-review-resolved" }, [resolvedToggle, " Show resolved threads"]),
      el("label", { class: "bh-review-label bh-review-changes" }, ["Show changes since", since]),
      el("p", { class: "bh-review-sec bh-review-mine" }),
      el("ol", { class: "bh-review-list bh-review-mylist" }),
      el("label", { class: "bh-review-label" }, ["Your name", reviewer]),
      el("div", { class: "bh-review-export" }, [
        el("button", { type: "button", class: "btn primary", "data-export": "json", text: "Download drafts .json", onclick: () => exportFile(false) }),
        el("button", { type: "button", class: "btn", "data-export": "gz", text: ".json.gz", onclick: () => exportFile(true) }),
      ]),
      el("p", { class: "bh-review-help muted", text: "Drafts stay in this browser until they are published. To submit: add the file to reviews/inbox/ in a pull request (GitHub → Add file → Upload files). Once merged, they appear here for everyone. You can export again with new drafts: unchanged messages are published once. Editing an already-submitted draft causes an id conflict; submit a new reply instead." }),
      clear,
      el("label", { class: "bh-review-check" }, [pageToggle, " Show comments on the page when not reviewing"]),
    ]);
    doc.body.append(panel);
  }

  /** Collapse the panel to its head (a bar) or open it again; review mode stays on either way. */
  function setCollapsed(on) {
    if (!panel) return;
    panel.classList.toggle("is-collapsed", on);
    const btn = panel.querySelector(".bh-review-collapse");
    btn.textContent = on ? "Show panel" : "Hide panel";
    btn.setAttribute("aria-expanded", String(!on));
  }

  function reviewFile() {
    const b = build();
    return {
      format: FORMAT,
      repo: b.repo,
      document: docPath(),
      title: doc.title,
      url: location.href.split("#")[0].split("?")[0],
      build: { commit: b.commit, dirty: b.dirty, builtAt: b.builtAt },
      reviewer: state.reviewer || null,
      exported: new Date().toISOString(),
      comments: state.comments.map((c) => {
        const out = { ...c, author: c.author || state.reviewer || null };
        if (!c.inReplyTo && c.target) out.outdated = !located.get(c.id);
        return out;
      }),
    };
  }

  async function exportFile(gzip) {
    const json = JSON.stringify(reviewFile(), null, 2) + "\n";
    const stampStr = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
    const slug = docPath().split("/").pop().replace(/\.html$/, "");
    const who = (state.reviewer || "anonymous").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "anonymous";
    let blob = new Blob([json], { type: "application/json" });
    let name = `review-${slug}-${stampStr}-${who}.json`;
    if (gzip && window.CompressionStream) {
      blob = await new Response(blob.stream().pipeThrough(new CompressionStream("gzip"))).blob();
      blob = new Blob([blob], { type: "application/gzip" });
      name += ".gz";
    } else if (gzip) {
      announce("This browser can't gzip; downloading plain JSON instead");
    }
    const a = el("a", { href: URL.createObjectURL(blob), download: name });
    doc.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    announce(`Downloaded ${name}`);
  }

  // ---- Mode, count, announcements ------------------------------------------------------------------------------

  function announce(msg) { if (bh.toast) bh.toast(msg); if (liveRegion) liveRegion.textContent = msg; }

  function updateCount() {
    const badge = doc.querySelector(".bh-review-count");
    if (!badge) return;
    const open = current.filter((t) => !t.resolved).length;
    badge.hidden = !open && !state.comments.length;
    badge.textContent = String(open);
    badge.classList.toggle("has-drafts", state.comments.length > 0);
    const btn = doc.querySelector(".bh-review-btn");
    if (btn) {
      const text = `${open} open thread${open === 1 ? "" : "s"}${state.comments.length ? `, ${state.comments.length} unsubmitted draft${state.comments.length === 1 ? "" : "s"}` : ""}`;
      btn.title = `Review: ${text}`;
      // The badge shows the open count, so the name has to contain it (WCAG 2.5.3) and says what it counts. No
      // parentheses: axe's name match drops a parenthetical, and with it the count.
      btn.setAttribute("aria-label", badge.hidden ? "Review: comment on this page" : `Review: comment on this page, ${text}`);
    }
  }

  function setActive(on) {
    active = on;
    root.classList.toggle("bh-reviewing", on);
    const btn = doc.querySelector(".bh-review-btn");
    if (btn) btn.setAttribute("aria-pressed", String(on));
    if (on) { if (!panel) buildPanel(); addBlockButtons(); setCollapsed(!ROOMY.matches); panel.hidden = false; renderPanel(); }
    else { if (panel) panel.hidden = true; removeBlockButtons(); selBtn.hidden = true; closePop(); }
    requestAnimationFrame(paint);
  }

  let started = false;
  // bh.js sets data-review="off" on a private page before anything can load this module: an exported
  // review quotes the page, and the panel says to submit it in a public pull request (#210).
  const off = () => doc.body.dataset.review === "off";
  function start(review) {
    if (!article || off()) return Promise.resolve();
    const go = () => {
      if (!started) {
        started = true;
        load();
        pinLayer = el("div", { class: "bh-review-pins bh-review-ui", role: "region", "aria-label": "Review comments" });
        selBtn = el("button", { type: "button", class: "btn primary bh-review-selbtn bh-review-ui", text: "Comment", hidden: true, onmousedown: (e) => e.preventDefault(), onclick: commentOnSelection });
        liveRegion = el("p", { class: "visually-hidden bh-review-ui", "aria-live": "polite" });
        doc.body.append(pinLayer, selBtn, liveRegion);
        doc.addEventListener("selectionchange", () => requestAnimationFrame(onSelection));
        doc.addEventListener("pointerdown", (e) => { if (pop && !pop.contains(e.target) && !e.target.closest(".bh-review-pin, .bh-review-selbtn, .bh-review-add")) closePop(); });
        doc.addEventListener("keydown", (e) => { if (e.key === "Escape" && pop) closePop(); });
        let t = 0;
        const later = () => { clearTimeout(t); t = setTimeout(relocateAll, 150); };
        addEventListener("resize", later);
        doc.addEventListener("bh-diff", () => renderPanel()); // the panel's "Show changes since" follows the page
        new ResizeObserver(later).observe(article);
        relocateAll();
      }
      if (review) setActive(true);
    };
    // Optional data: the build stamp (commit) and the published threads. Both exist on
    // GitHub Pages and under `npm run serve`; bundles inline them.
    const need = [];
    if (bh.siteRoot && !window.BH_BUILD) need.push(new URL("theme/build.js", bh.siteRoot).href);
    if (bh.siteRoot && !window.BH_REVIEWS) need.push(new URL("theme/reviews.js", bh.siteRoot).href);
    return Promise.all(need.map((u) => bh.loadScript(u).catch(() => {}))).then(go);
  }

  function toggle() { return start(false).then(() => { if (started) setActive(!active); }); }

  bh.review = { start, toggle, get comments() { return state.comments; }, get threads() { return current; }, file: reviewFile, relocate: relocateAll };
  window.bhModules = Object.assign(window.bhModules || {}, { "review.js": true });
})();
