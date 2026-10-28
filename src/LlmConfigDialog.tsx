import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  LlmError,
  MODEL_NOTE_FALLBACK,
  MODEL_OPTIONS,
  saveConfig,
  testConnection,
  type LlmConfig,
} from "@/lib/deepseek";

function message(err: unknown): string {
  if (err instanceof LlmError) return err.message;
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return "请求超时，未自动重试。";
    return err.message;
  }
  return String(err);
}

/** 添加 / 修改 DeepSeek 模型：密钥只写入本机浏览器，保存后立即做一次最小连通性测试 */
export default function LlmConfigDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: LlmConfig | null;
  onSaved: (cfg: LlmConfig) => void;
}) {
  const [draft, setDraft] = useState({ apiKey: "", model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL });
  const [testing, setTesting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNote, setFormNote] = useState<string | null>(null);
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft({ apiKey: initial?.apiKey ?? "", model: initial?.model ?? DEFAULT_MODEL, baseUrl: initial?.baseUrl ?? DEFAULT_BASE_URL });
    setFormError(null);
    setFormNote(null);
    const timer = window.setTimeout(() => keyRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [open, initial]);

  async function submitForm() {
    setFormError(null);
    setFormNote(null);
    let saved: LlmConfig;
    try {
      saved = saveConfig(draft);
    } catch (err) {
      setFormError(message(err));
      return;
    }
    onSaved(saved);
    setTesting(true);
    try {
      const probe = await testConnection(saved);
      setFormNote(`连接成功：${probe.model} 回复「${probe.reply || "—"}」，测试消耗 ${probe.usage.totalTokens ?? "—"} tokens。`);
      window.setTimeout(() => onOpenChange(false), 900);
    } catch (err) {
      setFormError(message(err) + "（密钥已保存在本机，可修正后重试）");
    } finally {
      setTesting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>添加 DeepSeek 模型</DialogTitle>
          <DialogDescription>
            在 platform.deepseek.com 生成 API Key 后粘贴到此处。密钥只写入本机浏览器存储，调用时由浏览器直接发给 DeepSeek 官方接口，本站服务端不会收到它。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-[11px] text-muted-foreground">API Key</Label>
            <Input
              ref={keyRef}
              className="tnum mt-1"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft.apiKey}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              placeholder="sk-..."
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-[11px] text-muted-foreground">模型名</Label>
              <Input
                className="tnum mt-1"
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                placeholder={DEFAULT_MODEL}
                spellCheck={false}
              />
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {MODEL_OPTIONS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setDraft({ ...draft, model: m.id })}
                    className={
                      "tnum rounded-full border px-2 py-0.5 text-[11px] transition-colors " +
                      (draft.model.trim() === m.id
                        ? "border-[var(--d-rv21)]/60 bg-[var(--d-rv21)]/10 text-[var(--d-rv21)]"
                        : "border-border text-muted-foreground hover:text-foreground")
                    }
                  >
                    {m.id}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                {MODEL_OPTIONS.find((m) => m.id === draft.model.trim())?.note ?? MODEL_NOTE_FALLBACK}
              </p>
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">接口地址</Label>
              <Input
                className="tnum mt-1"
                value={draft.baseUrl}
                onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                placeholder={DEFAULT_BASE_URL}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">官方默认 https://api.deepseek.com，仅支持 HTTPS。</p>
            </div>
          </div>
          {formError ? (
            <Alert className="border-[var(--d-red)]/35 bg-[var(--d-red)]/5">
              <AlertTitle>连接测试失败</AlertTitle>
              <AlertDescription className="text-xs leading-relaxed">{formError}</AlertDescription>
            </Alert>
          ) : null}
          {formNote ? <p className="text-[11px] text-[var(--d-mint)]">{formNote}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submitForm} disabled={testing || !draft.apiKey.trim()}>
            {testing ? "测试连接中…" : "保存并测试连接"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
