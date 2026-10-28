import { useSyncExternalStore } from "react";

/** 主题偏好：白天、夜晚，或跟随系统外观 */
export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<ThemeMode, "system">;

const STORAGE_KEY = "vol-desk-theme";
const META_COLOR: Record<ResolvedTheme, string> = { light: "#f2f5f9", dark: "#060a11" };

export const THEME_OPTIONS: { value: ThemeMode; label: string; title: string }[] = [
  { value: "light", label: "白天", title: "白天模式：浅色行情台" },
  { value: "dark", label: "夜晚", title: "夜晚模式：深色交易终端" },
  { value: "system", label: "系统", title: "跟随系统的深/浅色外观自动切换" },
];

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveMode(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? (systemPrefersDark() ? "dark" : "light") : mode;
}

function readStoredMode(): ThemeMode {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" || value === "system" ? value : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveMode(mode);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META_COLOR[resolved]);
  return resolved;
}

interface ThemeState {
  mode: ThemeMode;
  resolved: ResolvedTheme;
}

let state: ThemeState = { mode: "system", resolved: "light" };
const listeners = new Set<() => void>();
let watchingSystem = false;

function refresh(): void {
  const mode = readStoredMode();
  const next = { mode, resolved: applyTheme(mode) };
  if (next.mode === state.mode && next.resolved === state.resolved) return;
  state = next;
  for (const listener of listeners) listener();
}

function startSystemWatch(): void {
  if (watchingSystem) return;
  watchingSystem = true;
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (readStoredMode() === "system") refresh();
  });
}

function subscribe(listener: () => void): () => void {
  startSystemWatch();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ThemeState {
  return state;
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* 无法持久化时本次会话仍然生效 */
  }
  refresh();
}

/** 供 React 组件读取与切换主题；系统外观变化时同样会重渲染 */
export function useTheme(): ThemeState & { setMode: typeof setThemeMode } {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...current, setMode: setThemeMode };
}

// 与 index.html 的首屏脚本保持一致：SSR 快照与客户端初始状态相同，且保证样式属性已落地。
if (typeof window !== "undefined") {
  const initialMode = readStoredMode();
  state = { mode: initialMode, resolved: applyTheme(initialMode) };
}
