// 本地 Function 服务器（Node 运行时，仅用于开发验证，不参与发布产物）
// 运行： node dev/function-local.mjs
import http from "node:http";
import { handler } from "../functions/handler.ts";

const PORT = Number(process.env.PORT ?? 8000);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const method = (req.method ?? "GET").toUpperCase();
  const request = new Request(url.href, {
    method,
    headers: new Headers(req.headers),
    body: method === "GET" || method === "HEAD" || chunks.length === 0 ? undefined : Buffer.concat(chunks),
  });
  try {
    const response = await handler(request);
    const headers = Object.fromEntries(response.headers.entries());
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "local_server_error", message }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`local function server → http://127.0.0.1:${PORT}/functions/v1/app/health`);
});
