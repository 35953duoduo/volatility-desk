import { Monitor, Moon, Sun } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { THEME_OPTIONS, useTheme, type ThemeMode } from "@/lib/theme";

const ICONS: Record<ThemeMode, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

/** 同花顺式的白天 / 夜晚 / 跟随系统切换；选择写入 localStorage，刷新后保持 */
export default function ThemeToggle() {
  const { mode, resolved, setMode } = useTheme();

  return (
    <ToggleGroup
      type="single"
      value={mode}
      onValueChange={(value) => value && setMode(value as ThemeMode)}
      variant="outline"
      size="sm"
      spacing={0}
      aria-label="页面主题"
      className="theme-fade shadow-xs"
    >
      {THEME_OPTIONS.map((option) => {
        const Icon = ICONS[option.value];
        return (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            size="sm"
            className="h-8 gap-1 px-2 text-[11px]"
            title={option.value === "system" ? `${option.title}（当前${resolved === "dark" ? "夜晚" : "白天"}）` : option.title}
            aria-label={option.title}
          >
            <Icon className="size-3.5" />
            {option.label}
            {option.value === "system" ? (
              <span className="tnum opacity-70">{resolved === "dark" ? "·夜" : "·昼"}</span>
            ) : null}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
