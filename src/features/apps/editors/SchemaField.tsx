import { Button, SecretReplacementField, SelectField, TextAreaField, TextField } from "../../../components/ui";
import type { SchemaField as SchemaFieldDefinition, SchemaPatchValue, SchemaValue } from "../../../ipc/config";

function currentValue(field: SchemaFieldDefinition, draft: SchemaPatchValue | undefined): SchemaValue | undefined {
  if (draft) {
    if (draft.kind === "SECRET") return undefined;
    switch (draft.kind) {
      case "BOOLEAN": return { kind: "BOOLEAN", value: draft.value };
      case "STRING": return { kind: "STRING", value: draft.value };
      case "INTEGER": return { kind: "INTEGER", value: draft.value };
      case "ENUM": return { kind: "ENUM", value: draft.value };
      case "STRING_LIST": return { kind: "STRING_LIST", value: draft.value };
    }
  }
  return field.current.state === "VALUE" ? field.current.value : undefined;
}

export function SchemaField({ disabled, draft, field, onChange }: { disabled: boolean; draft?: SchemaPatchValue; field: SchemaFieldDefinition; onChange: (value: SchemaPatchValue | undefined) => void; }) {
  const value = currentValue(field, draft);
  const common = { disabled, label: field.label, description: field.description, name: field.fieldId };
  let control;
  switch (field.fieldType.kind) {
    case "BOOLEAN":
      control = <SelectField {...common} value={value?.kind === "BOOLEAN" ? String(value.value) : "-"} options={[{ value: "-", label: "保持当前值" }, { value: "true", label: "启用" }, { value: "false", label: "禁用" }]} onValueChange={(next) => onChange(next === "-" ? undefined : { kind: "BOOLEAN", value: next === "true" })} />;
      break;
    case "STRING":
      control = <TextField {...common} minLength={field.fieldType.minimumLength} maxLength={field.fieldType.maximumLength} pattern={field.fieldType.pattern} value={value?.kind === "STRING" ? value.value : ""} placeholder={field.current.state === "UNSET" ? "未设置" : undefined} onValueChange={(next) => onChange(next ? { kind: "STRING", value: next } : undefined)} />;
      break;
    case "INTEGER":
      control = <TextField {...common} type="number" min={field.fieldType.minimum} max={field.fieldType.maximum} value={value?.kind === "INTEGER" ? String(value.value) : ""} placeholder="未设置" onValueChange={(next) => onChange(next === "" ? undefined : { kind: "INTEGER", value: Number.parseInt(next, 10) })} />;
      break;
    case "ENUM":
      control = <SelectField {...common} value={value?.kind === "ENUM" ? value.value : "-"} options={[{ value: "-", label: "保持当前值" }, ...field.fieldType.options.map((option) => ({ value: option.value, label: option.label }))]} onValueChange={(next) => onChange(next === "-" ? undefined : { kind: "ENUM", value: next })} />;
      break;
    case "STRING_LIST":
      control = <TextAreaField {...common} rows={4} value={value?.kind === "STRING_LIST" ? value.value.join("\n") : ""} placeholder="每行一个值" onValueChange={(next) => onChange({ kind: "STRING_LIST", value: next.split("\n") })} />;
      break;
    case "SECRET":
      control = <SecretReplacementField {...common} value={draft?.kind === "SECRET" ? draft.replacement : ""} placeholder="输入新值以替换；当前值不会读取" onValueChange={(next) => onChange(next ? { kind: "SECRET", replacement: next } : undefined)} />;
      break;
  }
  return <div className="grid gap-2 rounded-lg bg-surface-muted p-3"><div className="flex justify-end">{draft && field.fieldType.kind !== "SECRET" ? <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(undefined)}>撤销</Button> : null}</div>{control}{field.fieldType.kind === "SECRET" ? <p className="text-xs text-muted-foreground">replacement-only：当前值、默认值和 diff 均不会显示该 secret。</p> : null}</div>;
}
