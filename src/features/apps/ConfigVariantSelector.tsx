import { SelectField } from "../../components/ui";
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
    <SelectField
      label="路径变体"
      inputClassName="font-mono"
      disabled={disabled}
      value={currentVariantId}
      options={variants.map((variant) => ({
        value: variant.variantId,
        label: `${variant.displayPath} — ${CONFIG_STATE_PRESENTATION[variant.state].label}${variant.selected ? "（当前优先）" : ""}`,
      }))}
      onValueChange={onChange}
    />
  );
}
