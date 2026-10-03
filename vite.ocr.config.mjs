import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    target: "es2020",
    outDir: "assets/vendor/paddleocr",
    emptyOutDir: true,
    sourcemap: false,
    minify: "esbuild",
    lib: {
      entry: resolve(process.cwd(), "assets/js/paddleocr-entry.js"),
      formats: ["es"],
      fileName: () => "paddleocr.js"
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  },
  worker: {
    format: "es"
  }
});
