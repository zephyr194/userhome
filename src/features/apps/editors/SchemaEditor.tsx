import { useMemo, useState } from "react";
import { Button, Panel, StatusBadge } from "../../../components/ui";
import type {
  ConfigPresetDefinition,
  ConfigSchemaPresentation,
  SchemaFieldPatch,
  SchemaPatchValue,
  SchemaValue,
} from "../../../ipc/config";
import { PresetPicker } from "./PresetPicker";
import { SchemaField } from "./SchemaField";

function presetPatch(value: SchemaValue): SchemaPatchValue {
  return value;
}

export function SchemaEditor({
  disabled,
  presentation,
  onPreview,
}: {
  disabled: boolean;
  presentation: ConfigSchemaPresentation & {
    state: "READY";
    schema: NonNullable<ConfigSchemaPresentation["schema"]>;
    expectedHash: string;
    documentState: NonNullable<ConfigSchemaPresentation["documentState"]>;
  };
  onPreview: (
    fields: SchemaFieldPatch[],
    completeTemplate?: { presetId: string; presetVersion: number },
  ) => void;
}) {
  const [draft, setDraft] = useState(
    () => new Map<string, SchemaPatchValue>(),
  );
  const [fieldGroup, setFieldGroup] = useState<string[]>();
  const [selectedPreset, setSelectedPreset] =
    useState<ConfigPresetDefinition>();
  const schema = presentation.schema;
  const visibleFields = useMemo(
    () =>
      fieldGroup
        ? schema.fields.filter((field) => fieldGroup.includes(field.fieldId))
        : schema.fields,
    [fieldGroup, schema.fields],
  );

  function applyPreset(preset: ConfigPresetDefinition) {
    setSelectedPreset(preset);
    if (preset.kind === "FIELD_GROUP") {
      setFieldGroup(preset.fieldIds);
      return;
    }
    setFieldGroup(undefined);
    setDraft((current) => {
      const next =
        preset.kind === "COMPLETE_TEMPLATE"
          ? new Map<string, SchemaPatchValue>()
          : new Map(current);
      for (const entry of preset.values) {
        next.set(entry.fieldId, presetPatch(entry.value));
      }
      return next;
    });
  }

  function updateField(fieldId: string, value: SchemaPatchValue | undefined) {
    setSelectedPreset((current) =>
      current?.kind === "FIELD_GROUP" ? current : undefined,
    );
    setDraft((current) => {
      const next = new Map(current);
      if (value) next.set(fieldId, value);
      else next.delete(fieldId);
      return next;
    });
  }

  const completeTemplate =
    selectedPreset?.kind === "COMPLETE_TEMPLATE"
      ? {
          presetId: selectedPreset.presetId,
          presetVersion: selectedPreset.presetVersion,
        }
      : undefined;
  const requiresCompleteTemplate =
    presentation.documentState === "MISSING";
  const canPreview =
    draft.size > 0 && (!requiresCompleteTemplate || completeTemplate);

  return (
    <section className="grid min-w-0 gap-2" aria-label="Schema 配置编辑器">
      <Panel className="grid min-w-0 gap-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="break-all text-sm font-semibold">
              {schema.label}
            </h3>
            <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
              {schema.description}
            </p>
          </div>
          <StatusBadge className="max-w-full break-all">
            {schema.schemaId} v{schema.schemaVersion}
          </StatusBadge>
        </div>
        <p className="break-words text-xs text-muted-foreground">
          仅提交已修改字段；未批准预设或版本不匹配时，后端会拒绝写入。
        </p>
      </Panel>

      <PresetPicker
        disabled={disabled}
        presets={presentation.presets}
        selectedPresetId={selectedPreset?.presetId}
        onSelect={applyPreset}
      />

      {fieldGroup ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 break-words text-xs text-muted-foreground">
            当前仅显示所选字段组；已有草稿值未被删除。
          </p>
          <Button
            className="shrink-0"
            size="sm"
            variant="ghost"
            onClick={() => setFieldGroup(undefined)}
          >
            显示全部字段
          </Button>
        </div>
      ) : null}

      <div className="grid min-w-0 gap-2">
        {visibleFields.map((field) => (
          <SchemaField
            disabled={disabled}
            draft={draft.get(field.fieldId)}
            field={field}
            key={field.fieldId}
            onChange={(value) => updateField(field.fieldId, value)}
          />
        ))}
      </div>

      {requiresCompleteTemplate && !completeTemplate ? (
        <Panel className="bg-warning-soft p-3 text-xs text-warning">
          缺失文档只能使用当前可用的完整模板创建；选择其他 preset
          或手动偏离模板后不会授权新建文件。
        </Panel>
      ) : null}

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          草稿包含 {draft.size} 个字段；选择 preset 不会写入磁盘。
        </p>
        <Button
          className="max-w-full"
          variant="primary"
          disabled={disabled || !canPreview}
          onClick={() =>
            onPreview(
              [...draft].map(([fieldId, value]) => ({
                fieldId,
                value:
                  value.kind === "STRING_LIST"
                    ? {
                        ...value,
                        value: value.value
                          .map((entry) => entry.trim())
                          .filter(Boolean),
                      }
                    : value,
              })),
              completeTemplate,
            )
          }
        >
          预览 Schema 修改
        </Button>
      </div>
    </section>
  );
}
