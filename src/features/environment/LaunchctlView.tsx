import { useId, useState } from "react";
import { ActionRow, Button, InfoTip } from "../../components/ui";
import type {
  LaunchctlChange,
  LaunchctlEntry,
  LaunchctlEnvironment,
  LaunchctlSetPreview,
} from "../../ipc/environment";
import {
  LaunchctlRemoveDialog,
  LaunchctlSetDialog,
  type LaunchctlSetInput,
} from "./LaunchctlDialogs";
import { VariableChainTable } from "./VariableChainTable";
import { launchctlVariableRows } from "./variableChainModel";

export type LaunchctlState =
  | { status: "loading" }
  | { status: "ready"; environment: LaunchctlEnvironment }
  | { status: "failed"; message: string };

export interface LaunchctlViewProps {
  state: LaunchctlState;
  onReveal: (key: string) => Promise<string>;
  onRetry: () => void;
  onPreview: (key: string, value: string) => Promise<LaunchctlSetPreview>;
  onSet: (input: LaunchctlSetInput) => Promise<LaunchctlChange>;
  onUnset: (key: string, expectedCurrent: string | null) => Promise<LaunchctlChange>;
}

type LaunchctlDialog =
  | { kind: "set"; entry?: LaunchctlEntry }
  | { kind: "remove"; key: string };

function formatReadAt(readAt: string): string {
  const date = new Date(readAt);
  return Number.isNaN(date.getTime()) ? readAt : date.toLocaleString("zh-CN");
}

/**
 * The login session variables. Names are visible and secret values stay masked
 * until asked for. Setting, modifying and removing go through a dialog; the
 * list is re-read from the change result, so the scroll position stays put.
 */
export function LaunchctlView({
  onPreview,
  onReveal,
  onRetry,
  onSet,
  onUnset,
  state,
}: LaunchctlViewProps) {
  const headingId = useId();
  const [dialog, setDialog] = useState<LaunchctlDialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const loading = state.status === "loading";
  const environment = state.status === "ready" ? state.environment : undefined;

  function completeChange(change: LaunchctlChange, verb: string, key: string) {
    setDialog(null);
    setNotice(`${verb} ${key}。${change.note}`);
    setRevision((count) => count + 1);
  }

  return (
    <section
      aria-labelledby={headingId}
      className="launchctl-view flex min-w-0 flex-col gap-ui-12"
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-ui-12 pt-ui-16 pb-ui-12">
        <div className="flex min-w-0 flex-col gap-ui-4">
          <div className="flex min-w-0 items-center gap-ui-4">
            <h2 className="text-group font-semibold text-foreground" id={headingId}>
              macOS 登录会话
            </h2>
            <InfoTip
              description="显示 GUI 应用启动时继承的环境变量。可以设置、修改或移除变量，只影响之后启动的应用。"
              title="登录会话变量"
            />
          </div>
          {environment ? (
            <p className="text-aux text-muted-foreground">
              读取时间：{formatReadAt(environment.readAt)}
            </p>
          ) : null}
        </div>
        <ActionRow>
          <Button disabled={loading} onClick={onRetry} size="sm" variant="secondary">
            重新读取
          </Button>
          <Button
            disabled={loading}
            onClick={() => setDialog({ kind: "set" })}
            size="sm"
            variant="primary"
          >
            设置变量
          </Button>
        </ActionRow>
      </header>

      {notice !== null ? (
        <p className="border border-line px-ui-12 py-ui-8 text-aux text-foreground" role="status">
          {notice}
        </p>
      ) : null}

      {state.status === "loading" ? (
        <div className="flex flex-col gap-ui-8" role="status">
          <p className="text-aux text-muted-foreground">正在读取登录会话的环境变量…</p>
          {[0, 1, 2].map((row) => (
            <span
              aria-hidden="true"
              className="block h-control-md bg-surface-muted"
              key={row}
            />
          ))}
        </div>
      ) : null}

      {state.status === "failed" ? (
        <div className="flex flex-col items-start gap-ui-8" role="alert">
          <p className="text-body text-foreground">无法读取登录会话的环境变量。</p>
          <p className="text-aux text-muted-foreground">原因：{state.message}</p>
          <Button onClick={onRetry} size="sm" variant="secondary">
            重试
          </Button>
        </div>
      ) : null}

      {environment?.partial ? (
        <p className="border border-line px-ui-12 py-ui-8 text-aux text-foreground" role="status">
          部分变量没有读出，下面的列表可能不完整。重新读取后可以再试一次。
        </p>
      ) : null}

      {environment && environment.entries.length === 0 ? (
        <div className="flex flex-col gap-ui-4">
          <p className="text-body text-foreground">登录会话里没有可见的环境变量。</p>
          <p className="text-aux text-muted-foreground">
            只有通过 launchctl 设置的变量会出现在这里，终端里设置的变量不会出现。
          </p>
        </div>
      ) : null}

      {environment && environment.entries.length > 0 ? (
        <VariableChainTable
          key={`${environment.readAt}:${revision}`}
          label="登录会话的环境变量"
          onEdit={(row) =>
            setDialog({
              kind: "set",
              entry: environment.entries.find((entry) => entry.key === row.name),
            })
          }
          onRemove={(row) => setDialog({ kind: "remove", key: row.name })}
          onRevealFinal={(row) => onReveal(row.name)}
          rows={launchctlVariableRows(environment.entries)}
        />
      ) : null}

      {dialog?.kind === "set" ? (
        <LaunchctlSetDialog
          entry={dialog.entry}
          onClose={() => setDialog(null)}
          onDone={(change, key) => completeChange(change, dialog.entry ? "已修改" : "已设置", key)}
          onPreview={onPreview}
          onSet={onSet}
        />
      ) : null}
      {dialog?.kind === "remove" ? (
        <LaunchctlRemoveDialog
          entryKey={dialog.key}
          onCancel={() => setDialog(null)}
          onDone={(change, key) => completeChange(change, "已移除", key)}
          onPreview={(key) => onPreview(key, "")}
          onRemove={onUnset}
        />
      ) : null}
    </section>
  );
}
