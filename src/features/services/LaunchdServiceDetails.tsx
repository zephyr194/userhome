import type { ReactNode } from "react";
import { Panel, StatusBadge } from "../../components/ui";
import type {
  LaunchdConfigFile,
  LaunchdService,
  LaunchdSourceReport,
} from "../../ipc/services";
import { LaunchdActionPanel } from "./LaunchdActionPanel";
import { isActionable } from "./launchdActionModel";
import {
  correlationText,
  domainLabel,
  evidenceFor,
  exitText,
  fileKindText,
  isHomebrewLabel,
  issueText,
  keepAliveText,
  linkStateText,
  ownershipSummary,
  parseStatusText,
  scopeLabel,
  sourceLabel,
  sourceProblems,
  sourceReasonText,
  sourceStatusLabel,
  statusPresentation,
  type EvidenceState,
} from "./launchdModel";

const WRAP = "break-words [overflow-wrap:anywhere]";

const LABEL_SOURCE_TEXTS: Record<LaunchdService["labelSource"], string> = {
  LAUNCHCTL: "launchctl（已加载任务）",
  PLIST: "配置文件中的 Label",
  FILE_NAME: "文件名（配置文件没有可用的 Label）",
};

function Row({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="min-w-0 bg-surface-muted px-ui-12 py-ui-8">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-ui-4 text-sm font-medium ${WRAP}`}>{children}</dd>
    </div>
  );
}

function Section({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="border-b border-border px-ui-16 py-ui-12 last:border-b-0">
      <h4 className="text-sm font-semibold">{title}</h4>
      <div className="mt-ui-8 grid min-w-0 gap-ui-8">{children}</div>
    </section>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className={`font-mono text-xs ${WRAP}`}>{children}</span>;
}

function yesNo(value: boolean | undefined): string {
  if (value === undefined) return "未设置";
  return value ? "是" : "否";
}

function ConfigFileSection({ file }: { file: LaunchdConfigFile }) {
  const plist = file.details;
  const [first, ...rest] = plist?.programArguments ?? [];
  return (
    <div className="min-w-0 rounded-control bg-surface-muted px-ui-8 py-ui-8">
      <p className={`text-sm font-medium ${WRAP}`}>
        <Mono>{file.path}</Mono>
      </p>
      <dl className="mt-ui-8 grid min-w-0 gap-ui-8 text-xs">
        <Row label="所在目录">{sourceLabel(file.directory)}</Row>
        <Row label="按目录归类">
          {scopeLabel(file.scope)}
          {file.isApplePath ? "（Apple 系统路径）" : ""}
        </Row>
        <Row label="文件类型">
          {fileKindText(file.kind)}
          {file.ownerUid === undefined ? "" : `，所有者 UID ${file.ownerUid}`}
        </Row>
        {file.linkTarget ? (
          <Row label="链接目标">
            {linkStateText(file.linkTarget.state)}
            {file.linkTarget.display ? (
              <>
                {"："}
                <Mono>{file.linkTarget.display}</Mono>
              </>
            ) : null}
          </Row>
        ) : null}
        <Row label="内容读取">{parseStatusText(file.parseStatus)}</Row>
        {plist ? (
          <>
            <Row label="可执行文件">
              {plist.program ?? first ? (
                <Mono>{plist.program ?? first}</Mono>
              ) : (
                "未设置"
              )}
            </Row>
            <Row label="启动参数">
              {plist.programArguments.length === 0 ? (
                "未设置"
              ) : (
                <ol className="grid min-w-0 gap-ui-4">
                  {(plist.program === undefined ? rest : plist.programArguments).map(
                    (argument, index) => (
                      <li key={`${index}-${argument}`}>
                        <Mono>{argument}</Mono>
                      </li>
                    ),
                  )}
                </ol>
              )}
              <span className="mt-ui-4 block text-xs font-normal text-muted-foreground">
                含密钥特征的参数值已由后端遮盖，此处不会还原。
                {plist.argumentsTruncated ? "参数过多，已截断显示。" : ""}
              </span>
            </Row>
            <Row label="环境变量">
              {plist.environmentKeys.length === 0 ? (
                "无"
              ) : (
                <span className="flex min-w-0 flex-wrap gap-ui-8">
                  {plist.environmentKeys.map((key) => (
                    <StatusBadge key={key}>
                      <Mono>{key}</Mono>
                    </StatusBadge>
                  ))}
                </span>
              )}
              <span className="mt-ui-4 block text-xs font-normal text-muted-foreground">
                仅显示变量名，值不会读取或显示。
              </span>
            </Row>
            <Row label="RunAtLoad">{yesNo(plist.runAtLoad)}</Row>
            <Row label="KeepAlive">
              {plist.keepAlive ? (
                <>
                  {keepAliveText(plist.keepAlive.mode)}
                  {plist.keepAlive.conditions.length > 0 ? (
                    <span className="mt-ui-4 block font-mono text-xs font-normal">
                      条件：{plist.keepAlive.conditions.join("、")}
                    </span>
                  ) : null}
                </>
              ) : (
                "未设置"
              )}
            </Row>
            <Row label="标准输出">
              {plist.standardOutPath ? (
                <Mono>{plist.standardOutPath}</Mono>
              ) : (
                "未设置"
              )}
            </Row>
            <Row label="标准错误">
              {plist.standardErrorPath ? (
                <Mono>{plist.standardErrorPath}</Mono>
              ) : (
                "未设置"
              )}
            </Row>
            <Row label="Disabled">{yesNo(plist.disabled)}</Row>
            <Row label="UserName">{plist.userName ?? "未设置"}</Row>
          </>
        ) : null}
      </dl>
    </div>
  );
}

function SourcesSection({
  sources,
}: {
  sources: readonly LaunchdSourceReport[];
}) {
  return (
    <ul className="grid min-w-0 gap-ui-8" aria-label="发现来源">
      {sources.map((report) => {
        const failed =
          report.status !== "COMPLETE" || report.failedFiles > 0;
        return (
          <li
            className="min-w-0 rounded-control bg-surface-muted px-ui-12 py-ui-8 text-xs"
            key={report.source}
          >
            <span className="flex min-w-0 flex-wrap items-center gap-ui-8">
              <Mono>{sourceLabel(report.source)}</Mono>
              <StatusBadge tone={failed ? "warning" : "success"}>
                {sourceStatusLabel(report.status)}
              </StatusBadge>
              <span className="text-muted-foreground">
                {report.items} 项
              </span>
            </span>
            {report.reason ? (
              <span className={`mt-ui-4 block text-muted-foreground ${WRAP}`}>
                {sourceReasonText(report.reason)}
              </span>
            ) : null}
            {report.failedFiles > 0 ? (
              <span className="mt-ui-4 block text-warning">
                {report.failedFiles} 个文件未能读取。
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function LaunchdServiceDetails({
  evidence,
  onChanged,
  service,
  sources,
}: {
  evidence: EvidenceState;
  /** Called after an action, so the list is read again. */
  onChanged?: () => void;
  service: LaunchdService;
  sources: readonly LaunchdSourceReport[];
}) {
  const status = statusPresentation(service);
  const ownership = ownershipSummary(service);
  const problems = sourceProblems(sources);
  const brew =
    evidence.status === "ready"
      ? evidenceFor(service, evidence.summaries)
      : undefined;

  return (
    <Panel className="min-w-0" aria-labelledby="service-details-heading">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-ui-12 border-b border-border px-ui-16 py-ui-12">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            任务详情
          </p>
          <h3
            className={`mt-ui-4 text-lg font-semibold ${WRAP}`}
            id="service-details-heading"
          >
            {service.label}
          </h3>
          <p className="mt-ui-4 break-all font-mono text-xs text-muted-foreground">
            {service.id}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-ui-8">
          <StatusBadge>{scopeLabel(service.scope)}</StatusBadge>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          <StatusBadge>{ownership.label}</StatusBadge>
          <StatusBadge tone={ownership.modifiable ? "success" : "warning"}>
            {ownership.badge}
          </StatusBadge>
        </div>
      </header>

      <Section title="加载与运行">
        <dl className="grid min-w-0 gap-px overflow-hidden rounded-control bg-border sm:grid-cols-2">
          <Row label="状态">{status.label}</Row>
          <Row label="PID">
            {service.pid === undefined ? "无" : String(service.pid)}
          </Row>
          <Row label="上次退出">{exitText(service.lastExit)}</Row>
          <Row label="域">
            {domainLabel(service.domain)}（<Mono>{service.domainTarget}</Mono>）
          </Row>
        </dl>
        <p className="text-xs leading-relaxed text-muted-foreground" role="status">
          {status.detail}
          {service.lastExit && service.lastExit.value !== 0
            ? "非零退出码只是 launchd 记录的上次退出状态，不是错误结论。"
            : ""}
        </p>
      </Section>

      <Section title="归属与可修改性">
        <dl className="grid min-w-0 gap-px overflow-hidden rounded-control bg-border sm:grid-cols-2">
          <Row label="归属">{ownership.label}</Row>
          <Row label="可修改性">{ownership.badge}</Row>
        </dl>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {ownership.description}
        </p>
        {ownership.reasons.length > 0 ? (
          <div className="min-w-0 rounded-control bg-surface-muted px-ui-12 py-ui-8 text-xs">
            <p className="font-semibold">只读原因</p>
            <ul className="mt-ui-4 grid gap-ui-4" aria-label="只读原因">
              {ownership.reasons.map((reason) => (
                <li className={WRAP} key={reason}>
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="min-w-0 rounded-control bg-surface-muted px-ui-12 py-ui-8 text-xs">
          <p className="font-semibold">判定依据</p>
          <ul className="mt-ui-4 grid gap-ui-4" aria-label="判定依据">
            {ownership.evidence.map((item) => (
              <li className={WRAP} key={item}>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground" role="status">
          {ownership.note}
        </p>
      </Section>

      {isActionable(service) ? (
        <LaunchdActionPanel
          key={service.id}
          service={service}
          onChanged={onChanged}
        />
      ) : null}

      <Section title="来源与归属依据">
        <dl className="grid min-w-0 gap-px overflow-hidden rounded-control bg-border sm:grid-cols-2">
          <Row label="按目录归类">{scopeLabel(service.scope)}</Row>
          <Row label="label 来源">{LABEL_SOURCE_TEXTS[service.labelSource]}</Row>
          <Row label="配置文件状态">{correlationText(service)}</Row>
        </dl>
        <p className="text-xs leading-relaxed text-muted-foreground">
          仅按目录归类，不是归属判定；归属与可修改性见上方「归属与可修改性」。动作入口只出现在后端判定归属于 UserHome 的任务上，且不提供删除配置文件、接管或批量操作。
        </p>
        {service.issues.length > 0 ? (
          <ul
            className="grid gap-ui-4 rounded-control border border-warning-border bg-warning-soft px-ui-12 py-ui-8 text-xs text-warning"
            aria-label="发现的问题"
          >
            {service.issues.map((issue) => (
              <li key={issue}>{issueText(issue)}</li>
            ))}
          </ul>
        ) : null}
        {isHomebrewLabel(service.label) ? (
          <div className="min-w-0 rounded-control bg-surface-muted px-ui-12 py-ui-8 text-xs">
            <p className="font-semibold">Homebrew 来源证据</p>
            {evidence.status === "loading" ? (
              <p className="mt-ui-4 text-muted-foreground">
                正在读取 Homebrew 服务信息…
              </p>
            ) : evidence.status === "unavailable" ? (
              <p className="mt-ui-4 text-warning" role="status">
                Homebrew 证据不可用：无法读取 brew services，不影响上方的 launchd 结果。
              </p>
            ) : brew ? (
              <p className={`mt-ui-4 text-muted-foreground ${WRAP}`}>
                brew services 也列出了「{brew.displayName}」（状态 {brew.status}
                {brew.user ? `，用户 ${brew.user}` : ""}
                ）。仅作证据，不作为发现来源，也不据此判定归属。
              </p>
            ) : (
              <p className="mt-ui-4 text-muted-foreground">
                brew services 中没有对应项（仅作证据，不影响 launchd 结果）。
              </p>
            )}
          </div>
        ) : null}
      </Section>

      <Section title={`配置文件（${service.configFiles.length}）`}>
        {service.configFiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            没有找到配置文件。
            {service.configPresence === "UNKNOWN"
              ? "扫描位置未能完整读取，无法确认是否存在。"
              : "已扫描的位置中没有同 label 的 plist；其他位置（例如应用包内）也可能定义该任务。"}
          </p>
        ) : (
          service.configFiles.map((file) => (
            <ConfigFileSection file={file} key={file.path} />
          ))
        )}
      </Section>

      <Section title="发现来源">
        {problems.length > 0 ? (
          <p
            className="rounded-control border border-warning-border bg-warning-soft px-ui-12 py-ui-8 text-xs leading-relaxed text-warning"
            role="status"
          >
            部分来源未能完整读取，加载与运行状态可能不完整。
          </p>
        ) : null}
        <SourcesSection sources={sources} />
      </Section>
    </Panel>
  );
}
