import { defineConfig } from "vite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STATIC_RUNTIME_FILES = [
  "data.js",
  "unit_focus.js",
  "assess.js",
  "engine.js",
  "board.js",
];

function shortFileHash(filePath) {
  if (!fs.existsSync(filePath)) return "";
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex")
    .slice(0, 8);
}

function tftStaticFileCompatPlugin() {
  return {
    name: "tft-static-file-compat",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        let out = html.replace(
          /<script\b([^>]*\bsrc=["']([^"']*workbench(?:-[^"']+)?\.js)["'][^>]*)>\s*<\/script>/gi,
          (_m, _attrs, src) => `<script defer src="${src}"></script>`
        );
        out = out.replace(
          /<link\b([^>]*\brel=["']stylesheet["'][^>]*)>/gi,
          (tag) => tag.replace(/\s+crossorigin(?:=["'][^"']*["'])?/gi, "")
        );
        for (const file of STATIC_RUNTIME_FILES) {
          const hash = shortFileHash(path.resolve(__dirname, file));
          if (!hash) continue;
          const escaped = file.replace(/\./g, "\\.");
          out = out.replace(
            new RegExp(`(<script\\b[^>]*\\bsrc=["'])(?:\\./)?${escaped}(?:\\?[^"']*)?(["'][^>]*>)`, "gi"),
            `$1${file}?v=${hash}$2`
          );
        }
        return out;
      },
    },
    closeBundle() {
      const distDir = path.resolve(__dirname, "dist");
      fs.mkdirSync(distDir, { recursive: true });

      for (const file of STATIC_RUNTIME_FILES) {
        const src = path.resolve(__dirname, file);
        const dest = path.resolve(distDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        }
      }

      const iconsSrc = path.resolve(__dirname, "icons");
      const iconsDest = path.resolve(distDir, "icons");
      if (fs.existsSync(iconsSrc)) {
        fs.cpSync(iconsSrc, iconsDest, { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        format: "iife",
        name: "TFTSandboxApp",
        entryFileNames: "assets/workbench-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  plugins: [tftStaticFileCompatPlugin()],
});
