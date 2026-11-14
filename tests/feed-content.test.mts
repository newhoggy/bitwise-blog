// The article → feed content conversion (scripts/feed-content.mts), tested on small pages.
import assert from "node:assert/strict";
import { test } from "node:test";
import { feedContent, feedInteractives } from "../scripts/feed-content.mts";

const PAGE = "https://blog.test/docs/post.html";
const page = (article: string, rest = "") => `<!doctype html><html><head><title>T</title><style>p{color:red}</style><script>var head=1</script></head>
<body><main class="bh-page"><article class="bh-article">${article}</article></main>${rest}</body></html>`;
const content = (article: string, hidden: string[] = [], rest = "") =>
  feedContent(page(article, rest), { pageUrl: PAGE, hidden: (u) => hidden.includes(u) });

test("only the article is taken, and the hero's eyebrow, h1, meta list and the footer are left out", () => {
  const out = content(`<header class="bh-hero"><p class="eyebrow">Explainer</p><h1>Title</h1><p class="lede">The lede.</p><dl class="bh-meta" data-auto></dl>
    <span class="bh-hero-mark" data-bh-logo aria-hidden="true"></span></header><p>Body.</p>
    <footer class="bh-footer"><span><a href="../index.html">All</a></span></footer>`, [], "<template id=\"t\"><p>Popup text</p></template>");
  assert.match(out, /<p>The lede\.<\/p>/);
  assert.match(out, /<p>Body\.<\/p>/);
  for (const gone of ["Explainer", "Title", "<dl", "<header", "All", "Popup text", "var head", "color:red"]) assert.ok(!out.includes(gone), `${gone} should be gone:\n${out}`);
});

test("scripts, styles, templates, controls, hidden parts and data-feed-omit blocks are stripped with their content", () => {
  const out = content(`<p>Keep.</p><script>alert("x < y")</script><style>.a{}</style><template><p>T</p></template>
    <button type="button">Copy link</button><label>Rate <input type="range" value="3"></label><canvas></canvas><iframe src="x.html"></iframe>
    <p hidden>Hidden.</p><p aria-hidden="true">Decor.</p><p data-feed-omit>Hover the underlines.</p><div data-feed-omit><button>B</button></div>`);
  assert.equal(out.replace(/\s+/g, ""), "<p>Keep.</p>");
});

test("every attribute outside the allow-list goes: data-* hooks, class, id, style, role, handlers", () => {
  const out = content(`<h2 id="why" class="x" data-bh-anchor>Why</h2><p style="color:red" onclick="steal()" role="note" tabindex="0" data-ref="fig:a">Text</p>
    <table data-linkable id="t"><tr><th scope="col" colspan="2">H</th></tr></table><details class="predict" id="p" open><summary>Q</summary>A</details>`);
  assert.match(out, /<h2>Why<\/h2>/);
  assert.match(out, /<p>Text<\/p>/);
  assert.match(out, /<th scope="col" colspan="2">H<\/th>/);
  assert.match(out, /<details open><summary>Q<\/summary>A<\/details>/);
  assert.doesNotMatch(out, /\b(?:data-[\w-]+|class|id|style|role|tabindex|onclick)\b=?/);
});

test("spans and <bh-…> components are unwrapped to their text; a sidenote becomes a numbered note", () => {
  const out = content(`<p>One <span class="quote-ctx no-glossary" data-ctx="g">"quoted"</span> and <span data-ref="f:a">a part</span>.<span class="sidenote">An <em>aside</em>.</span></p>
    <bh-tabs><section data-label="A"><p>Tab A</p></section></bh-tabs><p>Two.<span class="sidenote">Second.</span></p>`);
  assert.match(out, /<p>One "quoted" and a part\.<sup>\[1\]<\/sup><\/p>/);
  assert.match(out, /<section><p>Tab A<\/p><\/section>/);
  assert.doesNotMatch(out, /<\/?(?:span|bh-tabs)\b/);
  assert.match(out, /<p>Two\.<sup>\[2\]<\/sup><\/p>/);
  assert.match(out, /<hr>\n<p><strong>Notes<\/strong><\/p>\n<ol>\n<li>An <em>aside<\/em>\.<\/li>\n<li>Second\.<\/li>\n<\/ol>$/);
});

test("an inline SVG and a Mermaid sketch become their text alternative and a link to the figure", () => {
  const out = content(`<figure class="diagram" id="flow-figure"><svg viewBox="0 0 10 10" role="img" aria-label="Ayo&#39;s line &amp; Elena&#39;s"><text>0</text><path class="edge" d="M0 0"/></svg>
    <figcaption>Notice the sign.</figcaption></figure><pre class="mermaid">graph LR; A--&gt;B</pre>`);
  assert.match(out, /<figure><p>\[Diagram: Ayo&#39;s line &amp; Elena&#39;s\] <a href="https:\/\/blog\.test\/docs\/post\.html#flow-figure">See the diagram on the page\.<\/a><\/p>/);
  assert.match(out, /<figcaption>Notice the sign\.<\/figcaption><\/figure>/);
  assert.match(out, /<p>\[Diagram\] <a href="https:\/\/blog\.test\/docs\/post\.html">See the diagram on the page\.<\/a><\/p>/);
  assert.doesNotMatch(out, /<svg|<path|graph LR/);
});

test("relative links and images are made absolute against the page URL", () => {
  const cases: [string, string][] = [
    ['<a href="glossary.html#huffman">x</a>', 'href="https://blog.test/docs/glossary.html#huffman"'],
    ['<a href="../index.html">x</a>', 'href="https://blog.test/index.html"'],
    ['<a href="/feed.xml">x</a>', 'href="https://blog.test/feed.xml"'],
    ['<a href="#limits">x</a>', 'href="https://blog.test/docs/post.html#limits"'],
    ['<a href="post.html?a=1&amp;b=2">x</a>', 'href="https://blog.test/docs/post.html?a=1&amp;b=2"'],
    ["<a href='https://elsewhere.test/a?b=\"c\"'>x</a>", 'href="https://elsewhere.test/a?b=%22c%22"'],
    ['<a href="mailto:me@blog.test">x</a>', 'href="mailto:me@blog.test"'],
    ['<img src="assets/fig.png" alt="A &quot;fig&quot;" width="200" data-vr-mask>', '<img src="https://blog.test/docs/assets/fig.png" alt="A &quot;fig&quot;" width="200">'],
    ['<blockquote cite="../x.html">q</blockquote>', '<blockquote cite="https://blog.test/x.html">'],
  ];
  for (const [html, want] of cases) assert.ok(content(html).includes(want), `${html}\n→ ${content(html)}`);
});

test("a link that would run code becomes text, however its scheme is spelled", () => {
  for (const href of ["javascript:alert(1)", " JavaScript:alert(1)", "java&#x09;script:alert(1)", "java&#10;script:alert(1)", "vbscript:x", "data:text/html,<b>x</b>"]) {
    assert.equal(content(`<a href="${href}">x</a>`), "x", href);
  }
  assert.equal(content('<img src="java&#x0A;script:alert(1)" alt="a">'), '<img alt="a">');
});

test("attribute values keep their entities: none is double-escaped, and a bad numeric one neither throws nor reaches the XML", () => {
  assert.equal(content('<img src="a.png" alt="caf&eacute; &rarr; x &amp; y" title=\'say "hi" & bye\'>'),
    '<img src="https://blog.test/docs/a.png" alt="caf&eacute; &rarr; x &amp; y" title="say &quot;hi&quot; &amp; bye">');
  assert.equal(content('<figure id="f"><svg role="img" aria-label="caf&eacute;"></svg></figure>'),
    '<figure><p>[Diagram: caf&eacute;] <a href="https://blog.test/docs/post.html#f">See the diagram on the page.</a></p></figure>');
  assert.equal(content('<a href="x&#9999999;y&#0;.html">x</a>'), '<a href="https://blog.test/docs/x%EF%BF%BDy%EF%BF%BD.html">x</a>');
});

test("media keep the attributes that make them play or pick an image, with every URL absolute", () => {
  assert.equal(content('<video src="v.mp4" poster="p.png" controls muted data-x="1"></video>'),
    '<video src="https://blog.test/docs/v.mp4" poster="https://blog.test/docs/p.png" controls muted></video>');
  assert.equal(content('<img src="a.png" srcset="a.png 1x, ../b.png 2x, javascript:x 3x" alt="">'),
    '<img src="https://blog.test/docs/a.png" srcset="https://blog.test/docs/a.png 1x, https://blog.test/b.png 2x" alt="">');
});

test("links to pages the feed must not reveal become plain text", () => {
  const hidden = ["https://blog.test/docs/an-example.html", "https://blog.test/docs/quiet.html"];
  const out = content(`<p><a href="an-example.html#part"><em>Example</em></a>, <a href="%71uiet.html">quiet</a>,
    <a href="https://blog.test/docs/an-example.html?examples">abs</a>, <a href="https://elsewhere.test/docs/an-example.html">other</a>, <a href="ok.html">ok</a></p>`, hidden);
  assert.match(out, /<p><em>Example<\/em>, quiet,\n    abs, <a href="https:\/\/elsewhere\.test\/docs\/an-example\.html">other<\/a>, <a href="https:\/\/blog\.test\/docs\/ok\.html">ok<\/a><\/p>/);
});

test("text is passed through as authored HTML, so entities and markup survive the XML escaping exactly", () => {
  const article = '<p>Fish &amp; chips &lt;3 — “quoted” &#169; <code>a &lt; b &amp;&amp; c</code></p><pre><code>if (a &lt; b)\n  return;</code></pre>';
  const out = content(article);
  assert.equal(out, article);
  // What bh.mts writes into <content type="html">, and what a reader decodes from it.
  const xml = out.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  assert.doesNotMatch(xml, /[<>]/);
  assert.doesNotMatch(xml, /&(?!(?:amp|lt|gt|quot);)/);
  assert.equal(xml.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&"), article);
});

test("a stray or omitted close tag does not lose content, nest siblings or leave tags open", () => {
  assert.equal(content("<div><p>One</div></span><p>Two"), "<div><p>One</p></div><p>Two</p>");
  assert.equal(content("<ul><li>a<li>b <em>c</em></ul><p>One<p>Two<ul><li>d</ul>"), "<ul><li>a</li><li>b <em>c</em></li></ul><p>One</p><p>Two</p><ul><li>d</li></ul>");
  assert.equal(content("<dl><dt>t<dd>d<dt>u</dl><table><tr><th>h<td>1<tr><td>2</table>"),
    "<dl><dt>t</dt><dd>d</dd><dt>u</dt></dl><table><tr><th>h</th><td>1</td></tr><tr><td>2</td></tr></table>");
  assert.equal(content("<ul><li>a<ul><li>b</ul><li>c</ul>"), "<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>");
});

test("the TL;DR label, drawn by the theme in CSS, is written out", () => {
  assert.equal(content('<div class="tldr"><ul><li>One</li></ul></div>'), "<div><p><strong>TL;DR</strong></p><ul><li>One</li></ul></div>");
});

test("feedInteractives names the outermost components and controls in the article, not those it leaves out", () => {
  const html = page(`<bh-stepper for="f"><bh-step>One</bh-step></bh-stepper><bh-tabs><bh-chart></bh-chart></bh-tabs>
    <p><button>Go</button></p><pre class="mermaid">graph</pre><div data-feed-omit><bh-playground></bh-playground></div><template><input></template>`,
  '<button>Outside the article</button>');
  assert.deepEqual(feedInteractives(html), ["<bh-stepper>", "<bh-tabs>", "<button>", '<pre class="mermaid">']);
  // An anatomy figure: its figure is in the article, its script after it. Left out, it is not reported.
  const anatomy = (figureAttrs: string) => page(`<figure class="iso wide" id="rig" ${figureAttrs}><svg></svg></figure>`, '<script type="module" data-anatomy="rig"></script>');
  assert.deepEqual(feedInteractives(anatomy("")), ["an anatomy figure"]);
  assert.deepEqual(feedInteractives(anatomy("data-feed-omit")), []);
  assert.deepEqual(feedInteractives(page("<p>Prose, <details><summary>a</summary>b</details>, a table and a figure.</p>")), []);
});
