// 서버 번들(ESM). node_modules 패키지는 번들에 넣지 않고 그대로 사용한다.
import { build } from "esbuild";
import {copyFile} from 'node:fs/promises';

await build({
  entryPoints: ["server/index.ts"],
  outfile: "dist/server/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
  logLevel: "info",
});

// The raster isolate is plain ESM in dev and production; it deliberately does
// not inherit TSX, a second font cache, or the main application's state.
await copyFile('server/services/readingCardRasterWorker.mjs','dist/server/readingCardRasterWorker.mjs');
await copyFile('server/services/readingCardArtwork.mjs','dist/server/readingCardArtwork.mjs');
