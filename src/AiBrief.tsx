import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  LlmError,
  loadConfig,
  maskKey,
  saveConfig,
  searchWeb,
  summarizeBrief,
  type LlmConfig,
  type SearchHit,
} from "@/lib/deepseek";
import { readBriefCache, writeBriefCache, type CachedBrief } from "@/lib/briefCache";

/**
 * 指标背景补充：用访问者自己的 DeepSeek 密钥，先走官方网页检索取公开信息，
 * 再让模型只依据「本站真实指标 + 检索材料」做解读。
 * 明确边界：这不是行情数据源；数值一律以本站接口为准，AI 摘要可能出错。
 */

function message(err: unknown): string {
  if (err instanceof LlmError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

export default function AiBrief({ topic, query, context, disabled = false }: { topic: string; query: string; context: string; disabled?: boolean }) {
  const [cfg, setCfg] = useState<LlmConfig | null>(() => loadConfig());
  const [key, setKey] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CachedBrief | null>(() => readBriefCache(topic, context));
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    setResult(readBriefCache(topic, context));
    setError(null);
  }, [topic, context]);

  async function run(active?: LlmConfig) {
    const config = active ?? loadConfig();
    if (!config) {
      setShowForm(true);
      return;
    }
    setCfg(config);
    setBusy(true);
    setError(null);
    try {
      // 检索失败不阻塞：降级为仅依据本站指标的解读
      let hits: SearchHit[] = [];
      let searched = true;
      try {
        hits = await searchWeb(config, query);
      } catch {
        searched = false;
      }
      const searchText = hits
        .slice(0, 6)
        .map((h) => `- ${h.title}（${h.site || "来源未标注"}${h.date ? " · " + h.date : ""}）\n  ${(h.summary || h.snippet || "").slice(0, 300)}\n  ${h.url}`)
        .join("\n");
      const res = await summarizeBrief(config, { topic, context, searchText });
      const data: CachedBrief = { at: Date.now(), context, brief: res.brief, sources: hits.slice(0, 5), model: res.model, searched };
      writeBriefCache(topic, data);
      if (contextRef.current === context) setResult(data);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveAndRun() {
    setError(null);
    try {
      // 保留「买卖诊断」里已配置的模型与接口地址，这里只补密钥
      const existing = loadConfig();
      const saved = saveConfig({ apiKey: key, model: existing?.model, baseUrl: existing?.baseUrl });
      setKey("");
      setShowForm(false);
      await run(saved);
    } catch (err) {
      setError(message(err));
    }
  }

  const brief = result?.brief ?? null;

  return (
    <div className="mt-2.5 rounded-md border border-border/60 bg-secondary/20 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-[var(--d-price)]/40 bg-[var(--d-price)]/10 text-[10px] text-[var(--d-price)]">
          AI 补充
        </Badge>
        <p className="text-[11px] text-muted-foreground">
          {topic} 的背景信息与解读：DeepSeek 检索公开网页后总结，数值只引用本站指标
          {cfg ? `（本机密钥 ${maskKey(cfg.apiKey)} · ${cfg.model}）` : ""}。
        </p>
        <Button size="sm" variant="outline" className="ml-auto h-7 px-2 text-[11px]" onClick={() => void run()} disabled={busy || disabled}>
          {busy ? "AI 检索中…" : disabled ? "等待本站指标" : brief ? "按最新指标重新生成" : "用 DeepSeek 补充信息"}
        </Button>
      </div>

      {showForm && !cfg ? (
        <div className="mt-2 rounded-md border border-dashed border-border/70 bg-background/40 p-2.5">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            需要先配置 DeepSeek 密钥：只写入本机浏览器（localStorage），仅发往 api.deepseek.com，站点服务端不代持、不转发。也可在「买卖诊断」页完整配置模型与地址。
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-…"
              autoComplete="off"
              className="h-8 w-64 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter" && key.trim() && !busy) void saveAndRun();
              }}
            />
            <Button size="sm" className="h-8 text-[11px]" onClick={() => void saveAndRun()} disabled={!key.trim() || busy}>
              保存并补充
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-[11px]" onClick={() => setShowForm(false)}>
              取消
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 rounded-md border border-[var(--d-red)]/30 bg-[var(--d-red)]/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--d-red)]">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-2 space-y-1.5">
          <p className="text-xs font-semibold">{result.brief.headline}</p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{result.brief.summary}</p>
          {result.brief.bullets.length ? (
            <ul className="list-disc space-y-0.5 pl-4 text-[11px] leading-snug">
              {result.brief.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}
          {result.brief.watch.length ? (
            <p className="text-[11px] leading-snug">
              <span className="font-medium text-[var(--d-vxn)]">观察点：</span>
              {result.brief.watch.join("；")}
            </p>
          ) : null}
          {result.brief.caveats.length ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              <span className="font-medium">限制：</span>
              {result.brief.caveats.join("；")}
            </p>
          ) : null}
          <div className="border-t border-border/50 pt-1.5">
            {result.sources.length ? (
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground">检索来源（AI 检索摘要，非本站行情数据）</p>
                {result.sources.map((s) => (
                  <a
                    key={s.url}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-[11px] text-[var(--d-price)] hover:underline"
                    title={s.url}
                  >
                    {s.title}
                    {s.site ? ` · ${s.site}` : ""}
                    {s.date ? ` · ${s.date}` : ""}
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                {result.searched ? "本次未检索到可用来源，仅依据本站指标解读。" : "检索接口本次不可用，仅依据本站指标解读，未引用外部材料。"}
              </p>
            )}
            <p className="tnum mt-1 text-[10px] text-muted-foreground">
              由 {result.model} 生成于 {new Date(result.at).toLocaleString("zh-CN", { hour12: false })} · AI 摘要可能有错，数值以本站接口为准；不构成投资建议。
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
