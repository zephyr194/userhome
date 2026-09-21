import type { ConfigVariantResolution } from "../../ipc/config";
import { CONFIG_STATE_PRESENTATION } from "./configPresentation";

export function ConfigVariantSelector({
  currentVariantId,
  disabled = false,
  variants,
  onChange,
}: {
  currentVariantId: string;
  disabled?: boolean;
  variants: readonly ConfigVariantResolution[];
  onChange: (variantId: string) => void;
}) {
  if (variants.length <= 1) return null;

  return (
    <label className="block min-w-0 text-xs font-medium text-muted-foreground">
      路径变体
      <select
        aria-label="配置路径变体"
        className="mt-1.5 block min-h-9 w-full min-w-0 rounded-md border border-border bg-surface px-2.5 py-1.5 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        disabled={disabled}
        value={currentVariantId}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {variants.map((variant) => (
          <option key={variant.variantId} value={variant.variantId}>
            {variant.displayPath} —{" "}
            {CONFIG_STATE_PRESENTATION[variant.state].label}
            {variant.selected ? "（当前优先）" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
