// 本机启动器：双击根目录的 .cmd 即可运行，不依赖 Qoder。
// 流程：端口已在服务 → 直接开浏览器；缺构建产物或源码较新 → 先构建；再起 preview-server。
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const port = Number(process.env.PORT ?? 4173);
const base = `http://127.0.0.1:${port}/`;
const health = `${base}functions/v1/app/health`;

const WATCHED = ["src", "lib", "components", "hooks"].map((dir) => join(root, dir));
const WATCHED_FILES = ["index.html", "package.json", "vite.config.ts", "tsconfig.json"].map((f) =>
  join(root, f),
);

function newestMtime(target) {
  let newest = 0;
  const walk = (path) => {
    const info = statSync(path);
    if (info.isDirectory()) for (const name of readdirSync(path)) walk(join(path, name));
    else if (info.mtimeMs > newest) newest = info.mtimeMs;
  };
  if (!existsSync(target)) return 0;
  walk(target);
  return newest;
}

async function up() {
  try {
    const res = await fetch(health, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function openBrowser(target) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", target]]
      : process.platform === "darwin"
        ? ["open", [target]]
        : ["xdg-open", [target]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
}

function run(command) {
  return new Promise((ok, fail) => {
    const child = spawn(command, { cwd: root, stdio: "inherit", shell: true });
    child.on("error", fail);
    child.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`${command} 退出码 ${code}`))));
  });
}

if (await up()) {
  console.log(`页面已在运行：${base}`);
  openBrowser(base);
  process.exit(0);
}

const distIndex = join(root, "dist", "index.html");
const builtAt = existsSync(distIndex) ? statSync(distIndex).mtimeMs : 0;
const sourceAt = Math.max(...WATCHED.map(newestMtime), ...WATCHED_FILES.map(newestMtime));

if (builtAt === 0 || sourceAt > builtAt) {
  if (!existsSync(join(root, "node_modules"))) {
    console.error("缺少依赖目录 node_modules，请先在本目录运行一次：npm install");
    process.exit(1);
  }
  console.log(builtAt === 0 ? "首次启动，正在构建前端…" : "检测到前端源码有改动，正在重新构建…");
  try {
    await run("npm run build");
  } catch (err) {
    console.error(`构建失败：${err.message}`);
    process.exit(1);
  }
}

const server = spawn(process.execPath, [join(root, "dev", "preview-server.mjs")], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PORT: String(port) },
});

let announced = false;
const deadline = Date.now() + 20_000;
while (Date.now() < deadline && server.exitCode === null) {
  if (await up()) {
    announced = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 300));
}

if (!announced) {
  console.error(`预览服务未能在 ${base} 就绪。`);
  server.kill();
  process.exit(1);
}

console.log(`\n波动率观测台已就绪：${base}`);
console.log("保持此窗口开启即可访问；关闭窗口或按 Ctrl+C 停止。\n");
openBrowser(base);

process.on("SIGINT", () => server.kill());
server.on("exit", (code) => {
  console.log("预览服务已停止。");
  process.exit(code ?? 0);
});
