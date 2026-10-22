import { useId } from "react";
import { Button, InfoTip } from "../../components/ui";
import type { LaunchctlEnvironment } from "../../ipc/environment";
import { LazySecretValue } from "./LazySecretValue";

export type LaunchctlState =
  | { status: "loading" }
  | { status: "ready"; environment: LaunchctlEnvironment }
  | { status: "failed"; message: string };

export interface LaunchctlViewProps {
  state: LaunchctlState;
  onReveal: (key: string) => Promise<string>;
  onRetry: () => void;
}

function formatReadAt(readAt: string): string {
  const date = new Date(readAt);
  return Number.isNaN(date.getTime()) ? readAt : date.toLocaleString("zh-CN");
}

/** The login session variables, read-only: names are visible, secret values stay masked until asked for. */
export function LaunchctlView({ state, onReveal, onRetry }: LaunchctlViewProps) {
  const headingId = useId();
  const loading = state.status === "loading";
  const environment = state.status === "ready" ? state.environment : undefined;

  return (
    <section
      aria-labelledby={headingId}
      className="launchctl-view flex min-w-0 flex-col gap-ui-12"
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-ui-12 border-b border-line pb-ui-12">
        <div className="flex min-w-0 flex-col gap-ui-4">
          <div className="flex min-w-0 items-center gap-ui-4">
            <h2 className="text-group font-semibold text-foreground" id={headingId}>
              macOS 登录会话（只读）
            </h2>
            <InfoTip
              description="显示 GUI 应用启动时继承的环境变量，只读，不会修改系统。"
              title="登录会话变量"
            />
          </div>
          {environment ? (
            <p className="text-aux text-muted-foreground">
              读取时间：{formatReadAt(environment.readAt)}
            </p>
          ) : null}
        </div>
        <Button disabled={loading} onClick={onRetry} size="sm" variant="secondary">
          重新读取
        </Button>
      </header>

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
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-0 table-fixed border-collapse text-left">
            <caption className="sr-only">登录会话的环境变量</caption>
            <thead>
              <tr className="border-b border-line">
                <th className="w-[38%] py-ui-8 pr-ui-12 text-aux font-normal text-muted-foreground" scope="col">
                  变量名
                </th>
                <th className="py-ui-8 text-aux font-normal text-muted-foreground" scope="col">
                  值
                </th>
              </tr>
            </thead>
            <tbody>
              {environment.entries.map((entry) => (
                <tr className="border-b border-line align-top" key={entry.key}>
                  <th
                    className="break-all py-ui-8 pr-ui-12 font-mono text-aux font-normal text-foreground"
                    scope="row"
                  >
                    {entry.key}
                  </th>
                  <td className="min-w-0 py-ui-8">
                    {entry.secret ? (
                      <LazySecretValue
                        label={entry.key}
                        load={() => onReveal(entry.key)}
                        resetKey={entry.key}
                      />
                    ) : (
                      <code className="block break-all rounded-control bg-surface-muted px-ui-8 py-ui-2 font-mono text-aux text-foreground">
                        {entry.value === "" ? (
                          <span className="font-sans text-muted-foreground">（空值）</span>
                        ) : (
                          entry.value
                        )}
                      </code>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
