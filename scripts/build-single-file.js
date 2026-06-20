import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const distHtmlPath = path.join(distDir, "index.html");
const outputPath = path.join(projectRoot, "套利监控MVP-交付版.html");

async function buildSingleFile() {
  const html = await readFile(distHtmlPath, "utf8");
  const cssMatch = html.match(/href="(\/assets\/[^"]+\.css)"/);
  const jsMatch = html.match(/src="(\/assets\/[^"]+\.js)"/);

  if (!cssMatch || !jsMatch) {
    throw new Error("未能从 dist/index.html 中解析 CSS 或 JS 资源路径");
  }

  const cssPath = path.join(distDir, cssMatch[1].replace(/^\//, ""));
  const jsPath = path.join(distDir, jsMatch[1].replace(/^\//, ""));
  const css = await readFile(cssPath, "utf8");
  const js = await readFile(jsPath, "utf8");

  const singleFileHtml = html
    .replace(
      /<script type="module" crossorigin src="[^"]+"><\/script>\s*/u,
      `<script type="module">${js}</script>\n`,
    )
    .replace(
      /<link rel="stylesheet" crossorigin href="[^"]+">/u,
      `<style>${css}</style>`,
    );

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, singleFileHtml, "utf8");

  process.stdout.write(`已生成单文件交付版: ${outputPath}\n`);
}

buildSingleFile().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
