import type {
  SchemaField as SchemaFieldDefinition,
  SchemaPatchValue,
  SchemaValue,
} from "../../../ipc/config";
import { Button } from "../../../components/ui";

function currentValue(
  field: SchemaFieldDefinition,
  draft: SchemaPatchValue | undefined,
): SchemaValue | undefined {
  if (draft) {
    if (draft.kind === "SECRET") return undefined;
    switch (draft.kind) {
      case "BOOLEAN":
        return { kind: "BOOLEAN", value: draft.value };
      case "STRING":
        return { kind: "STRING", value: draft.value };
      case "INTEGER":
        return { kind: "INTEGER", value: draft.value };
      case "ENUM":
        return { kind: "ENUM", value: draft.value };
      case "STRING_LIST":
        return { kind: "STRING_LIST", value: draft.value };
    }
  }
  return field.current.state === "VALUE" ? field.current.value : undefined;
}

export function SchemaField({
  disabled,
  draft,
  field,
  onChange,
}: {
  disabled: boolean;
  draft?: SchemaPatchValue;
  field: SchemaFieldDefinition;
  onChange: (value: SchemaPatchValue | undefined) => void;
}) {
  const value = currentValue(field, draft);
  const id = `schema-field-${field.fieldId}`;
  const common = {
    id,
    disabled,
    name: field.fieldId,
  };

  let control;
  switch (field.fieldType.kind) {
    case "BOOLEAN":
      control = (
        <select
          {...common}
          value={
            value?.kind === "BOOLEAN" ? String(value.value) : "-"
          }
          onChange={(event) => {
            if (event.target.value === "-") onChange(undefined);
            else {
              onChange({
                kind: "BOOLEAN",
                value: event.target.value === "true",
              });
            }
          }}
        >
          <option value="-">保持当前值</option>
          <option value="true">启用</option>
          <option value="false">禁用</option>
        </select>
      );
      break;
    case "STRING":
      control = (
        <input
          {...common}
          minLength={field.fieldType.minimumLength}
          maxLength={field.fieldType.maximumLength}
          pattern={field.fieldType.pattern}
          value={value?.kind === "STRING" ? value.value : ""}
          placeholder={
            field.current.state === "UNSET" ? "未设置" : undefined
          }
          onChange={(event) =>
            event.target.value
              ? onChange({ kind: "STRING", value: event.target.value })
              : onChange(undefined)
          }
        />
      );
      break;
    case "INTEGER":
      control = (
        <input
          {...common}
          type="number"
          min={field.fieldType.minimum}
          max={field.fieldType.maximum}
          value={value?.kind === "INTEGER" ? value.value : ""}
          placeholder="未设置"
          onChange={(event) =>
            event.target.value === ""
              ? onChange(undefined)
              : onChange({
                  kind: "INTEGER",
                  value: Number.parseInt(event.target.value, 10),
                })
          }
        />
      );
      break;
    case "ENUM":
      control = (
        <select
          {...common}
          value={value?.kind === "ENUM" ? value.value : "-"}
          onChange={(event) =>
            event.target.value === "-"
              ? onChange(undefined)
              : onChange({
                  kind: "ENUM",
                  value: event.target.value,
                })
          }
        >
          <option value="-">保持当前值</option>
          {field.fieldType.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
      break;
    case "STRING_LIST":
      control = (
        <textarea
          {...common}
          rows={4}
          value={
            value?.kind === "STRING_LIST" ? value.value.join("\n") : ""
          }
          placeholder="每行一个值"
          onChange={(event) => {
            onChange({
              kind: "STRING_LIST",
              value: event.target.value.split("\n"),
            });
          }}
        />
      );
      break;
    case "SECRET":
      control = (
        <input
          {...common}
          type="password"
          value={draft?.kind === "SECRET" ? draft.replacement : ""}
          autoComplete="new-password"
          placeholder="输入新值以替换；当前值不会读取"
          onChange={(event) =>
            onChange(
              event.target.value
                ? { kind: "SECRET", replacement: event.target.value }
                : undefined,
            )
          }
        />
      );
      break;
  }

  return (
    <div className="grid gap-2 rounded-lg border border-border bg-surface-muted p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label
          className="grid min-w-0 flex-1 gap-1 break-words text-sm font-semibold"
          htmlFor={id}
        >
          {field.label}
          <span className="text-xs font-normal leading-relaxed text-muted-foreground">
            {field.description}
          </span>
        </label>
        <div className="flex gap-1">
          {draft && field.fieldType.kind !== "SECRET" ? (
            <Button
              className="shrink-0"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => onChange(undefined)}
            >
              撤销
            </Button>
          ) : null}
        </div>
      </div>
      {control}
      {field.fieldType.kind === "SECRET" ? (
        <p className="text-xs text-muted-foreground">
          replacement-only：当前值、默认值和 diff 均不会显示该 secret。
        </p>
      ) : null}
    </div>
  );
}
