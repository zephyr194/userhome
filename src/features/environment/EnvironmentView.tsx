import { AsyncState } from "../../components/AsyncState";
import {
  Button,
  StatusBadge,
  SwitchField,
  TextAreaField,
} from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
import type {
  EnvFileOutcome,
  EnvFileView,
  EnvRow,
  ScanOutcome,
} from "../../ipc/environment";
import type { GrantSummary } from "../../ipc/grants";
import {
  checkSettings,
  failureText,
  flagText,
  formatBytes,
  needsFetch,
  partialReasonText,
  sameSettings,
  skipReasonText,
  type EnvironmentState,
  type FileState,
} from "./environmentModel";
import { LazySecretValue } from "./LazySecretValue";

export interface EnvironmentViewProps {
  state: EnvironmentState;
  /** 提示文字（如选择目录被取消、授权失败）。 */
  grantNotice?: { tone: "info" | "error"; text: string };
  addingGrant: boolean;
  onAddGrant: () => void;
  onRevokeGrant: (grantId: string) => void;
  onReloadGrants: () => void;
  onSelectGrant: (grantId: string) => void;
  onPatternsChange: (text: string) => void;
  onRecursiveChange: (recursive: boolean) => void;
  onScan: () => void;
  onSelectFile: (path: string) => void;
  /** 取回一项的明文；只在用户点击“载入值”后调用。 */
  onLoadValue: (row: Extract<EnvRow, { kind: "ENTRY" }>) => Promise<string>;
}

const HEADER_CLASSES =
  "flex min-w-0 flex-wrap items-start justify-between gap-ui-lg border-b border-border bg-surface-muted px-ui-xl py-ui-md";

export function EnvironmentView(props: EnvironmentViewProps) {
  return (
    <section
      aria-labelledby="environment-heading"
      className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] overflow-hidden"
    >
      <div className="grid min-h-0 overflow-hidden grid-rows-[minmax(0,1fr)_minmax(0,1fr)] sm:grid-cols-[360px_minmax(0,1fr)] sm:grid-rows-1">
        <section
          aria-labelledby="environment-heading"
          className="flex min-h-0 min-w-0 flex-col overflow-y-auto overscroll-contain border-b border-border sm:border-r sm:border-b-0"
        >
          <header className={HEADER_CLASSES}>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold" id="environment-heading">
                环境文件
              </h2>
              <p className="mt-ui-xs text-xs text-muted-foreground">
                指定目录中的 dotenv 文件，只读查看
              </p>
            </div>
          </header>
          <GrantsSection {...props} />
          <SettingsSection {...props} />
          <ScanResults {...props} />
        </section>
        <FilePane {...props} />
      </div>
    </section>
  );
}

// ---- directory authorizations ---------------------------------------------

function GrantsSection({
  addingGrant,
  grantNotice,
  onAddGrant,
  onReloadGrants,
  onRevokeGrant,
  onSelectGrant,
  state,
}: EnvironmentViewProps) {
  const { grants } = state;
  return (
    <div className="border-b border-border px-ui-xl py-ui-md">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-ui-md">
        <h3 className="text-sm font-semibold">目录授权</h3>
        <Button disabled={addingGrant} onClick={onAddGrant} size="sm" variant="primary">
          {addingGrant ? "等待选择…" : "添加目录授权…"}
        </Button>
      </div>
      <p className="mt-ui-xs text-xs leading-relaxed text-muted-foreground">
        只能授权用户主目录之下的目录。UserHome 只读取匹配的文件，从不执行或 source 它们。
      </p>
      {grantNotice ? (
        <p
          className={classNames(
            "mt-ui-md text-xs leading-relaxed",
            grantNotice.tone === "error" ? "text-danger" : "text-muted-foreground",
          )}
          role={grantNotice.tone === "error" ? "alert" : "status"}
        >
          {grantNotice.text}
        </p>
      ) : null}
      {grants.status === "loading" ? (
        <AsyncState kind="loading">正在读取目录授权…</AsyncState>
      ) : grants.status === "error" ? (
        <AsyncState kind="error">
          <span className="break-words [overflow-wrap:anywhere]">
            {grants.error.message}
          </span>{" "}
          <Button onClick={onReloadGrants} size="sm">
            重试
          </Button>
        </AsyncState>
      ) : grants.grants.length === 0 ? (
        <AsyncState kind="empty">
          还没有授权目录。点击“添加目录授权…”选择一个项目目录。
        </AsyncState>
      ) : (
        <ul aria-label="已授权目录" className="mt-ui-md grid gap-ui-sm">
          {grants.grants.map((grant) => (
            <GrantRow
              grant={grant}
              key={grant.id}
              onRevoke={() => onRevokeGrant(grant.id)}
              onSelect={() => onSelectGrant(grant.id)}
              selected={grant.id === state.selectedGrantId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function GrantRow({
  grant,
  onRevoke,
  onSelect,
  selected,
}: {
  grant: GrantSummary;
  onRevoke: () => void;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <li className="flex min-w-0 items-center gap-ui-sm">
      <Button
        aria-pressed={selected}
        className={classNames(
          "min-w-0 flex-1 justify-start break-all text-left",
          selected && "border-primary",
        )}
        onClick={onSelect}
        size="sm"
        title={grant.displayPath}
      >
        {grant.displayPath}
      </Button>
      <Button
        aria-label={`撤销 ${grant.displayPath} 的授权`}
        onClick={onRevoke}
        size="sm"
        variant="ghost"
      >
        撤销
      </Button>
    </li>
  );
}

// ---- scan settings ---------------------------------------------------------

function SettingsSection({
  onPatternsChange,
  onRecursiveChange,
  onScan,
  state,
}: EnvironmentViewProps) {
  const check = checkSettings(state.patternsText, state.recursive);
  const scanned = state.scan.status === "ready" ? state.scan.settings : undefined;
  const changed = scanned !== undefined && check.ok && !sameSettings(scanned, check.settings);
  const noGrant = state.selectedGrantId === undefined;
  return (
    <div className="grid gap-ui-md border-b border-border px-ui-xl py-ui-md">
      <h3 className="text-sm font-semibold">扫描设置</h3>
      <TextAreaField
        description="每行一个相对目录的简单 glob：只支持 * 和 ?，不是 shell 或正则；不接受绝对路径和 ..。"
        error={check.ok ? undefined : check.message}
        label="文件 pattern"
        maxLength={2048}
        onValueChange={onPatternsChange}
        rows={3}
        spellCheck={false}
        value={state.patternsText}
      />
      <SwitchField
        checked={state.recursive}
        description="默认只扫描所选目录这一层。开启后最多深入 5 层、检查 2000 个目录项、列出 200 个文件，单个文件读取上限 1 MiB；超过上限只显示部分结果，不会自动放宽。"
        label="递归扫描子目录"
        onCheckedChange={onRecursiveChange}
      />
      <div className="flex min-w-0 flex-wrap items-center gap-ui-md">
        <Button
          disabled={noGrant || !check.ok || state.scan.status === "loading"}
          onClick={onScan}
          variant="primary"
        >
          {state.scan.status === "loading" ? "扫描中…" : "扫描"}
        </Button>
        {changed ? (
          <span className="text-xs text-warning" role="status">
            设置已更改，重新扫描后生效。
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ---- scan results ------------------------------------------------------------

function ScanResults({ onSelectFile, onScan, state }: EnvironmentViewProps) {
  const { scan } = state;
  return (
    <div className="px-ui-xl py-ui-md">
      <h3 className="text-sm font-semibold">扫描结果</h3>
      {scan.status === "idle" ? (
        <AsyncState kind="empty">
          {state.selectedGrantId === undefined
            ? "先添加并选择一个目录授权。"
            : "点击“扫描”列出匹配的环境文件。"}
        </AsyncState>
      ) : scan.status === "loading" ? (
        <AsyncState kind="loading">正在扫描…</AsyncState>
      ) : scan.status === "error" ? (
        <AsyncState kind="error">
          <span className="break-words [overflow-wrap:anywhere]">
            {scan.error.message}
          </span>
          {scan.error.retryable ? (
            <>
              {" "}
              <Button onClick={onScan} size="sm">
                重试
              </Button>
            </>
          ) : null}
        </AsyncState>
      ) : (
        <ScanReady
          onSelectFile={onSelectFile}
          outcome={scan.outcome}
          selectedPath={state.selectedPath}
        />
      )}
    </div>
  );
}

function ScanReady({
  onSelectFile,
  outcome,
  selectedPath,
}: {
  onSelectFile: (path: string) => void;
  outcome: ScanOutcome;
  selectedPath?: string;
}) {
  return (
    <>
      <p className="mt-ui-xs break-all text-xs text-muted-foreground">
        根目录 {outcome.root} · {outcome.recursive ? "递归" : "仅本层"} · 共{" "}
        {outcome.files.length} 个文件
      </p>
      {outcome.partialReasons.length > 0 ? (
        <AsyncState kind="partial">
          这是部分结果，不是完整列表。
          <ul className="mt-ui-xs list-disc pl-ui-3xl">
            {outcome.partialReasons.map((reason) => (
              <li key={reason}>{partialReasonText(reason, outcome.limits)}</li>
            ))}
          </ul>
        </AsyncState>
      ) : null}
      {outcome.files.length === 0 ? (
        <AsyncState kind="empty">没有匹配的环境文件。</AsyncState>
      ) : (
        <ul aria-label="匹配的环境文件" className="mt-ui-md grid gap-ui-xs">
          {outcome.files.map((file) => (
            <li key={file.relativePath}>
              <Button
                aria-current={file.relativePath === selectedPath ? "true" : undefined}
                className={classNames(
                  "h-auto w-full min-w-0 flex-wrap justify-between gap-ui-sm text-left",
                  file.relativePath === selectedPath && "border-primary",
                )}
                onClick={() => onSelectFile(file.relativePath)}
                size="sm"
                title={file.relativePath}
              >
                <span className="min-w-0 break-all font-mono text-aux">
                  {file.relativePath}
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-ui-xs">
                  {file.kind === "TEMPLATE" ? (
                    <StatusBadge tone="warning">模板</StatusBadge>
                  ) : null}
                  {file.symlink ? <StatusBadge>符号链接</StatusBadge> : null}
                  {file.oversized ? (
                    <StatusBadge tone="danger">过大</StatusBadge>
                  ) : null}
                  <span className="text-meta text-muted-foreground">
                    {formatBytes(file.sizeBytes)}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      <details className="mt-ui-md text-xs text-muted-foreground">
        <summary className="cursor-pointer">
          排除规则与已跳过项（{outcome.skippedTotal}）
        </summary>
        <p className="mt-ui-xs leading-relaxed">
          递归时默认不进入：{outcome.exclusions.join("、")}；不跟随目录符号链接；
          越界的符号链接一律拒绝。本次排除了 {outcome.excludedDirectories} 个目录。
        </p>
        {outcome.skipped.length > 0 ? (
          <ul className="mt-ui-xs list-disc pl-ui-3xl">
            {outcome.skipped.map((entry, index) => (
              <li className="break-all" key={`${entry.relativePath ?? ""}:${index}`}>
                {entry.relativePath ?? "（名称无法显示）"}：{skipReasonText(entry.reason)}
              </li>
            ))}
          </ul>
        ) : null}
        {outcome.skippedTotal > outcome.skipped.length ? (
          <p className="mt-ui-xs">还有 {outcome.skippedTotal - outcome.skipped.length} 项未列出。</p>
        ) : null}
      </details>
    </>
  );
}

// ---- file view ---------------------------------------------------------------

function FilePane(props: EnvironmentViewProps) {
  const { state } = props;
  return (
    <section
      aria-labelledby="environment-file-heading"
      className="flex min-h-0 min-w-0 flex-col overflow-y-auto overscroll-contain"
    >
      <header className={HEADER_CLASSES}>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold" id="environment-file-heading">
            文件内容（只读）
          </h2>
          <p className="mt-ui-xs break-all text-xs text-muted-foreground">
            {state.selectedPath ?? "未选择文件"}
          </p>
        </div>
      </header>
      <div className="px-ui-xl py-ui-md">
        <FileBody {...props} file={state.file} />
      </div>
    </section>
  );
}

function FileBody({
  file,
  onLoadValue,
}: EnvironmentViewProps & { file: FileState }) {
  if (file.status === "idle") {
    return <AsyncState kind="empty">选择左侧的文件查看其内容。</AsyncState>;
  }
  if (file.status === "loading") {
    return <AsyncState kind="loading">正在读取 {file.path}…</AsyncState>;
  }
  if (file.status === "error") {
    return (
      <AsyncState kind="error">
        <span className="break-words [overflow-wrap:anywhere]">
          {file.error.message}
        </span>
      </AsyncState>
    );
  }
  return (
    <LoadedFile
      onLoadValue={onLoadValue}
      outcome={file.outcome}
      path={file.path}
    />
  );
}

function LoadedFile({
  onLoadValue,
  outcome,
  path,
}: {
  onLoadValue: EnvironmentViewProps["onLoadValue"];
  outcome: EnvFileOutcome;
  path: string;
}) {
  if (outcome.status === "UNAVAILABLE") {
    return (
      <AsyncState kind="error">
        <strong>{failureText(outcome.reason)}</strong>
        <span className="ml-ui-sm break-words [overflow-wrap:anywhere]">
          {outcome.message}
        </span>
      </AsyncState>
    );
  }
  return <FileRows file={outcome.file} onLoadValue={onLoadValue} path={path} />;
}

function FileRows({
  file,
  onLoadValue,
  path,
}: {
  file: EnvFileView;
  onLoadValue: EnvironmentViewProps["onLoadValue"];
  path: string;
}) {
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-ui-sm text-xs text-muted-foreground">
        <StatusBadge tone={file.kind === "TEMPLATE" ? "warning" : "neutral"}>
          {file.kind === "TEMPLATE" ? "模板文件" : "环境文件"}
        </StatusBadge>
        <span>{formatBytes(file.sizeBytes)}</span>
        <span>{file.lineCount} 行</span>
        <span>{file.entryCount} 项</span>
        <span>{file.secretCount} 项已遮盖</span>
        {file.flaggedCount > 0 ? (
          <StatusBadge tone="warning">{file.flaggedCount} 项需注意</StatusBadge>
        ) : null}
      </div>
      {file.kind === "TEMPLATE" ? (
        <p className="mt-ui-md text-xs leading-relaxed text-muted-foreground">
          模板文件只描述变量，不会与真实环境文件合并成运行时值。
        </p>
      ) : null}
      <p className="mt-ui-md text-xs leading-relaxed text-muted-foreground">
        只读视图：按原文显示，不展开变量、不执行命令。同名键在不同文件之间没有通用优先级，这里不判断哪一个生效。
      </p>
      {file.rowsTruncated ? (
        <AsyncState kind="partial">
          文件行数过多，只显示前 {file.rows.length} 行（共 {file.lineCount} 行）。
        </AsyncState>
      ) : null}
      {file.rows.length === 0 ? (
        <AsyncState kind="empty">文件是空的。</AsyncState>
      ) : (
        <ol aria-label={`${path} 的内容`} className="mt-ui-md grid gap-ui-xs">
          {file.rows.map((row) => (
            <li key={`${row.line}:${row.kind}`}>
              <RowView onLoadValue={onLoadValue} path={path} row={row} />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function LineNumber({ line }: { line: number }) {
  return (
    <span
      aria-label={`第 ${line} 行`}
      className="w-10 shrink-0 select-none text-right font-mono text-meta text-muted-foreground"
    >
      {line}
    </span>
  );
}

function RowView({
  onLoadValue,
  path,
  row,
}: {
  onLoadValue: EnvironmentViewProps["onLoadValue"];
  path: string;
  row: EnvRow;
}) {
  const base = "flex min-w-0 items-start gap-ui-md rounded-control px-ui-md py-ui-xs";
  if (row.kind === "BLANK") {
    return (
      <div className={classNames(base, "text-muted-foreground")}>
        <LineNumber line={row.line} />
        <span className="text-meta">（空行）</span>
      </div>
    );
  }
  if (row.kind === "COMMENT" || row.kind === "UNKNOWN") {
    return (
      <div
        className={classNames(
          base,
          row.kind === "UNKNOWN" ? "bg-warning-soft" : "bg-surface-muted",
        )}
      >
        <LineNumber line={row.line} />
        <div className="min-w-0 flex-1">
          {row.kind === "UNKNOWN" ? (
            <StatusBadge className="mr-ui-sm" tone="warning">
              未识别行，保持原样
            </StatusBadge>
          ) : null}
          {row.withheld || row.text === undefined ? (
            <span className="text-xs text-muted-foreground">
              （疑似含秘密，内容已隐藏）
            </span>
          ) : (
            <code
              className={classNames(
                "break-all font-mono text-aux",
                row.kind === "COMMENT" && "text-muted-foreground",
              )}
            >
              {row.text}
            </code>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className={classNames(base, "bg-surface-muted")}>
      <LineNumber line={row.line} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-ui-sm">
          <code className="break-all font-mono text-aux font-semibold">{row.key}</code>
          {row.exported ? <StatusBadge>export</StatusBadge> : null}
          {row.secret ? <StatusBadge tone="danger">秘密</StatusBadge> : null}
          {row.endLine > row.line ? (
            <span className="text-meta text-muted-foreground">
              第 {row.line}–{row.endLine} 行
            </span>
          ) : null}
        </div>
        <div className="mt-ui-xs min-w-0">
          <EntryValue onLoadValue={onLoadValue} path={path} row={row} />
        </div>
        {row.flags.length > 0 ? (
          <ul className="mt-ui-xs flex flex-wrap gap-ui-sm" aria-label="需要注意">
            {row.flags.map((flag) => (
              <li key={flag}>
                <StatusBadge title={flagText(flag).hint} tone="warning">
                  {flagText(flag).label}
                </StatusBadge>
                <span className="sr-only">{flagText(flag).hint}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function EntryValue({
  onLoadValue,
  path,
  row,
}: {
  onLoadValue: EnvironmentViewProps["onLoadValue"];
  path: string;
  row: Extract<EnvRow, { kind: "ENTRY" }>;
}) {
  if (!row.hasValue) {
    return <span className="text-xs text-muted-foreground">（空值）</span>;
  }
  if (needsFetch(row)) {
    return (
      <LazySecretValue
        label={row.key}
        load={() => onLoadValue(row)}
        resetKey={`${path}:${row.line}:${row.key}`}
      />
    );
  }
  return (
    <code className="break-all rounded-control bg-surface px-ui-md py-ui-xxs font-mono text-aux">
      {row.value}
    </code>
  );
}
