// The platforms a `sources.yaml` entry can name, and the factory that builds an ingester for one.

import type { Ingester, IngesterOptions, SourceConfig } from "./base.mts";
import { GhostIngester } from "./ghost.mts";
import { LessWrongIngester } from "./lesswrong.mts";
import { MediumIngester } from "./medium.mts";
import { SubstackIngester } from "./substack.mts";
import { WordPressIngester } from "./wordpress.mts";

type Factory = new (corpusDir: string, config: SourceConfig, options?: IngesterOptions) => Ingester;

export const PLATFORMS: Record<string, Factory> = {
  substack: SubstackIngester,
  lesswrong: LessWrongIngester,
  medium: MediumIngester,
  wordpress: WordPressIngester,
  ghost: GhostIngester,
};

export function getIngester(source: SourceConfig, corpusDir: string, options?: IngesterOptions): Ingester {
  const platform = source.platform;
  if (!platform) throw new Error(`source config missing 'platform': ${JSON.stringify(source)}`);
  const Platform = Object.hasOwn(PLATFORMS, platform) ? PLATFORMS[platform] : undefined;
  if (!Platform) throw new Error(`unknown platform ${JSON.stringify(platform)}; known: ${Object.keys(PLATFORMS).sort().join(", ")}`);
  return new Platform(corpusDir, source, options);
}
