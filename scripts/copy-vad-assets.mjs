import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const require = createRequire(import.meta.url);
const publicVadDir = join(rootDir, "public", "vad");

const assetSources = [
  {
    packageName: "@ricky0123/vad-web",
    packageRelativeDir: "dist",
    predicate: (fileName) => fileName.endsWith(".onnx") || fileName === "vad.worklet.bundle.min.js"
  },
  {
    packageName: "onnxruntime-web",
    packageRelativeDir: "dist",
    predicate: (fileName) =>
      (fileName.endsWith(".mjs") || fileName.endsWith(".wasm")) &&
      !fileName.endsWith(".map")
  }
];

async function packageDir(packageName) {
  // Try standard resolution first
  try {
    return dirname(require.resolve(`${packageName}/package.json`));
  } catch {
    // Fallback: resolve any exported module and walk up to package root
    const resolved = require.resolve(packageName);
    let dir = dirname(resolved);
    while (dir !== '/' && dir !== '.') {
      if (existsSync(join(dir, 'package.json'))) return dir;
      dir = dirname(dir);
    }
    throw new Error(`Cannot find package directory for ${packageName}`);
  }
}

async function copyAssets() {
  await mkdir(publicVadDir, { recursive: true });

  let copied = 0;

  for (const source of assetSources) {
    const sourceDir = join(await packageDir(source.packageName), source.packageRelativeDir);
    const entries = await readdir(sourceDir);

    for (const entry of entries) {
      if (!source.predicate(entry)) {
        continue;
      }

      const from = join(sourceDir, entry);
      const fileStat = await stat(from);

      if (!fileStat.isFile()) {
        continue;
      }

      await copyFile(from, join(publicVadDir, entry));
      copied += 1;
    }
  }

  console.log(`Copied ${copied} VAD assets to public/vad`);
}

copyAssets().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
