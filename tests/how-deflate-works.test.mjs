// The archived single-page DEFLATE explainer: its numbers must stay real (see support/deflate-suite.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineDeflateTests } from "./support/deflate-suite.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
defineDeflateTests({ PAGE: fs.readFileSync(path.join(ROOT, "docs/how-deflate-works.html"), "utf8"), series: false, file: "how-deflate-works.html" });
