// LessWrong ingester.
//
// Uses the public GraphQL API at https://www.lesswrong.com/graphql to enumerate posts by user
// slug and fetch each post's htmlBody. No auth is needed for public posts.
//
// Config:
//     - platform: lesswrong
//       user: <slug>               # required: LW user slug (hyphens, not underscores)
//       view: userPosts | top      # optional, default "userPosts"
//                                  #   userPosts = chronological (newest first)
//                                  #   top       = karma-descending (greatest hits)
//       max_posts: <int>           # optional, default unlimited; caps the yielded count
//
// When `view` is not "userPosts", early exit is disabled: `run()` iterates the whole yielded
// list. That is right for a karma sort, where finding posts already on disk doesn't mean we've
// reached already-ingested territory the way it does in chronological order.

import { Ingester, htmlToMarkdown, type IngesterOptions, type PostMetadata, type SourceConfig } from "./base.mts";
import { PLAIN_USER_AGENT } from "./html.mts";

const GRAPHQL_URL = "https://www.lesswrong.com/graphql";
const REQUEST_DELAY_MS = 300;
const VALID_VIEWS = ["userPosts", "top"];
const PAGE_SIZE = 50;

interface LwUser { _id: string; displayName?: string; slug?: string }
interface LwPost { _id: string; slug?: string; title?: string; postedAt?: string; pageUrl?: string; baseScore?: number }

export class LessWrongIngester extends Ingester {
  readonly platform: string = "lesswrong";
  readonly userSlug: string;
  readonly view: string;
  readonly maxPosts: number | undefined;
  private user: LwUser | null = null;

  constructor(corpusDir: string, config: SourceConfig, options?: IngesterOptions) {
    super(corpusDir, config, options);
    if (!config.user) throw new Error("lesswrong source requires 'user' (slug)");
    this.userSlug = String(config.user);

    this.view = config.view ?? "userPosts";
    if (!VALID_VIEWS.includes(this.view)) {
      throw new Error(`lesswrong view must be one of ${JSON.stringify(VALID_VIEWS)}, got ${JSON.stringify(this.view)}`);
    }

    const maxPosts = config.max_posts;
    if (maxPosts != null && (!Number.isInteger(maxPosts) || maxPosts <= 0)) {
      throw new Error("lesswrong max_posts must be a positive integer");
    }
    this.maxPosts = maxPosts ?? undefined;

    if (this.view !== "userPosts") this.supportsEarlyExit = false;
  }

  private async graphql(query: string, variables: Record<string, unknown>): Promise<any> {
    const r = await this.request(GRAPHQL_URL, {
      method: "POST",
      headers: { "User-Agent": PLAIN_USER_AGENT, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const payload: any = await r.json();
    if (payload.errors?.length) throw new Error(`graphql errors: ${JSON.stringify(payload.errors)}`);
    return payload.data ?? {};
  }

  private async resolveUser(): Promise<LwUser> {
    if (this.user) return this.user;
    const data = await this.graphql(
      `query($slug: String!) {
         user(input: { selector: { slug: $slug } }) {
           result { _id displayName slug }
         }
       }`,
      { slug: this.userSlug },
    );
    const result: LwUser | undefined = data.user?.result;
    if (!result) throw new Error(`no such lesswrong user: ${this.userSlug}`);
    return (this.user = result);
  }

  async *listPosts(): AsyncGenerator<PostMetadata> {
    const user = await this.resolveUser();
    const display = user.displayName || this.userSlug;

    let yielded = 0;
    for (let offset = 0; ; offset += PAGE_SIZE) {
      if (this.maxPosts !== undefined && yielded >= this.maxPosts) return;
      const data = await this.graphql(
        `query($userId: String!, $view: String!, $limit: Int!, $offset: Int!) {
           posts(input: { terms: {
             view: $view,
             userId: $userId,
             limit: $limit,
             offset: $offset
           }}) {
             results { _id slug title postedAt pageUrl baseScore }
           }
         }`,
        { userId: user._id, view: this.view, limit: PAGE_SIZE, offset },
      );
      const results: LwPost[] = data.posts?.results ?? [];
      if (!results.length) return;
      for (const p of results) {
        if (this.maxPosts !== undefined && yielded >= this.maxPosts) return;
        const slug = p.slug || p._id;
        yield {
          slug,
          title: p.title || slug,
          url: p.pageUrl || `https://www.lesswrong.com/posts/${p._id}/${slug}`,
          published: (p.postedAt ?? "").slice(0, 10),
          author: display,
          extra: { id: p._id, baseScore: p.baseScore ?? 0 },
        };
        yielded++;
      }
      if (results.length < PAGE_SIZE) return;
      await this.pause(REQUEST_DELAY_MS);
    }
  }

  async fetchPostBody(meta: PostMetadata): Promise<string> {
    await this.pause(REQUEST_DELAY_MS);
    const data = await this.graphql(
      `query($id: String!) {
         post(input: { selector: { _id: $id } }) {
           result { htmlBody }
         }
       }`,
      { id: meta.extra.id },
    );
    const html: string = data.post?.result?.htmlBody ?? "";
    if (!html.trim()) throw new Error("empty htmlBody (possibly draft or deleted)");
    const md = htmlToMarkdown(html);
    if (!md) throw new Error("empty body after conversion");
    return md;
  }
}
