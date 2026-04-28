import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
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
  return dirname(require.resolve(`${packageName}/package.json`));
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
