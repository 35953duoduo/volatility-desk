// 本地生产预览：静态服务 dist/ + 同源转发 /functions/v1/app（与线上一致的路径契约）
// 仅用于开发验证，不参与站点打包。
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handler } from "../functions/handler.ts";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const dist = join(root, "dist");
const port = Number(process.env.PORT ?? 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

async function serveStatic(req, res, pathname) {
  const rel = normalize(pathname).replace(/^([/\\])+/, "");
  let file = join(dist, rel);
  if (!file.startsWith(dist)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, "index.html");
  } catch {
    file = join(dist, "index.html");
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  try {
    if (pathname.startsWith("/functions/")) {
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
      const response = await handler(
        new Request("http://preview.local" + pathname + url.search, {
          method: req.method ?? "GET",
          headers,
        }),
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    await serveStatic(req, res, pathname);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end(String(err));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log("preview: http://127.0.0.1:" + port + "/");
});
