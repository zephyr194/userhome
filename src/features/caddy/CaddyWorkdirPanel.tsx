import { Button, Panel, StatusBadge } from "../../components/ui";
import type { WorkdirAction, WorkdirLoad } from "./caddyWorkdirModel";

interface CaddyWorkdirPanelProps {
  load: WorkdirLoad;
  action: WorkdirAction;
  legacyPath: string | undefined;
  onRetry: () => void;
  onSelect: () => void;
  onUseDefault: () => void;
  onConfirmRevoke: () => void;
  onCancelRevoke: () => void;
  onRevoke: () => void;
  onDismissLegacy: () => void;
}

export function CaddyWorkdirPanel(props: CaddyWorkdirPanelProps) {
  const busy = props.action.status === "busy";
  return (
    <Panel aria-labelledby="caddy-workdir-heading" className="grid gap-ui-8 p-ui-8">
      <h2 id="caddy-workdir-heading" className="text-sm font-semibold">
        工作目录
      </h2>
      <WorkdirBody {...props} busy={busy} />
      {props.legacyPath !== undefined ? (
        <div className="grid gap-ui-8">
          <p role="status" className="m-0 text-body">
            旧应用私有目录中有 Caddy 数据：
            <span className="font-mono text-aux break-all">{props.legacyPath}</span>
            。它们不会自动迁移到工作目录，本应用不会读取或移动这些文件。
          </p>
          <div>
            <Button size="sm" variant="ghost" onClick={props.onDismissLegacy}>
              知道了
            </Button>
          </div>
        </div>
      ) : null}
      <ActionResult action={props.action} />
    </Panel>
  );
}

interface WorkdirBodyProps extends CaddyWorkdirPanelProps {
  busy: boolean;
}

function WorkdirBody(props: WorkdirBodyProps) {
  const { load } = props;
  if (load.status === "loading") {
    return (
      <p role="status" className="m-0 text-body text-muted-foreground">
        正在检查工作目录……
      </p>
    );
  }
  if (load.status === "failed") {
    return (
      <div className="grid gap-ui-8">
        <p role="alert" className="m-0 text-body text-danger">
          无法读取工作目录状态：{load.error.message}
        </p>
        <div>
          <Button size="sm" variant="secondary" disabled={props.busy} onClick={props.onRetry}>
            重新检查
          </Button>
        </div>
      </div>
    );
  }
  if (load.workdir.authorized === undefined) {
    return <UnauthorizedBody {...props} defaultPath={load.workdir.defaultDisplayPath} />;
  }
  return <AuthorizedBody {...props} displayPath={load.workdir.authorized.displayPath} />;
}

function UnauthorizedBody(props: WorkdirBodyProps & { defaultPath: string }) {
  return (
    <div className="grid gap-ui-8">
      <div>
        <StatusBadge tone="warning">未选择</StatusBadge>
      </div>
      <p className="m-0 text-body">
        Caddy 的规则、Caddyfile、检查副本、运行目录和日志都保存在工作目录中。请先选择一个工作目录，之后才能保存或开启 Caddy。
      </p>
      <div className="flex flex-wrap gap-ui-8">
        <Button
          variant="primary"
          disabled={props.busy}
          aria-describedby="caddy-workdir-default-note"
          onClick={props.onUseDefault}
        >
          使用 {props.defaultPath}
        </Button>
        <Button variant="secondary" disabled={props.busy} onClick={props.onSelect}>
          选择其他目录…
        </Button>
      </div>
      <p id="caddy-workdir-default-note" className="m-0 text-aux text-muted-foreground">
        点击“使用 {props.defaultPath}”才会创建该目录，权限为 0700（仅你的账户可访问），并将它设为工作目录。
      </p>
    </div>
  );
}

function AuthorizedBody(props: WorkdirBodyProps & { displayPath: string }) {
  if (props.action.status === "confirmRevoke") {
    return (
      <div role="group" aria-label="确认撤销" className="grid gap-ui-8">
        <dl className="m-0 grid gap-ui-4 text-body">
          <dt className="text-aux text-muted-foreground">当前目录</dt>
          <dd className="m-0 break-all font-mono text-aux">{props.displayPath}</dd>
        </dl>
        <p className="m-0 text-body">
          撤销后 Caddy 功能将回到“需要先选择工作目录”。规则文件保留在原目录，不会被删除。
        </p>
        <div className="flex flex-wrap gap-ui-8">
          <Button variant="danger" disabled={props.busy} onClick={props.onRevoke}>
            确认撤销
          </Button>
          <Button variant="secondary" disabled={props.busy} onClick={props.onCancelRevoke}>
            取消
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-ui-8">
      <div>
        <StatusBadge tone="success">已授权</StatusBadge>
      </div>
      <dl className="m-0 grid gap-ui-4 text-body">
        <dt className="text-aux text-muted-foreground">当前目录</dt>
        <dd className="m-0 break-all font-mono text-aux">{props.displayPath}</dd>
      </dl>
      <div className="flex flex-wrap gap-ui-8">
        <Button variant="secondary" disabled={props.busy} onClick={props.onSelect}>
          更改目录
        </Button>
        <Button variant="secondary" disabled={props.busy} onClick={props.onConfirmRevoke}>
          撤销
        </Button>
      </div>
    </div>
  );
}

function ActionResult({ action }: { action: WorkdirAction }) {
  if (action.status === "busy") {
    return (
      <p role="status" className="m-0 text-body text-muted-foreground">
        正在处理……
      </p>
    );
  }
  if (action.status === "notice") {
    return (
      <p role="status" className="m-0 text-body text-muted-foreground">
        {action.message}
      </p>
    );
  }
  if (action.status === "failed") {
    return (
      <p role="alert" className="m-0 text-body text-danger">
        {action.message}
      </p>
    );
  }
  return null;
}
