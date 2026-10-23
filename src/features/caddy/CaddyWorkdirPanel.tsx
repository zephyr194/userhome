import { ActionRow, Button, StatusBadge } from "../../components/ui";
import { localizeAppErrorMessage } from "../../i18n/errors";
import { useCaddyCopy } from "./caddyCopy";
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
  const { t } = useCaddyCopy();
  const busy = props.action.status === "busy";
  return (
    <section aria-labelledby="caddy-workdir-heading" className="caddy-status__cell grid min-w-0 content-start gap-ui-4">
      <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
        <h2 id="caddy-workdir-heading" className="text-sm font-semibold">
          {t("caddy.workdir.heading")}
        </h2>
        <WorkdirBody {...props} busy={busy} />
      </div>
      {props.legacyPath !== undefined ? (
        <div className="grid gap-ui-4">
          <p role="status" className="m-0 text-aux">
            {t("caddy.workdir.legacyIntro")}
            <span className="font-mono break-all">{props.legacyPath}</span>
            {t("caddy.workdir.legacyOutro")}
          </p>
          <div>
            <Button size="sm" variant="ghost" onClick={props.onDismissLegacy}>
              {t("caddy.workdir.legacyAck")}
            </Button>
          </div>
        </div>
      ) : null}
      <ActionResult action={props.action} />
    </section>
  );
}

interface WorkdirBodyProps extends CaddyWorkdirPanelProps {
  busy: boolean;
}

function WorkdirBody(props: WorkdirBodyProps) {
  const { load } = props;
  const { t, locale } = useCaddyCopy();
  if (load.status === "loading") {
    return (
      <p role="status" className="m-0 text-body text-muted-foreground">
        {t("caddy.workdir.checking")}
      </p>
    );
  }
  if (load.status === "failed") {
    return (
      <>
        <p role="alert" className="m-0 text-body text-danger">
          {t("caddy.workdir.loadFailed", { error: localizeAppErrorMessage(load.error, locale) })}
        </p>
        <Button size="sm" variant="secondary" disabled={props.busy} onClick={props.onRetry}>
          {t("caddy.workdir.recheck")}
        </Button>
      </>
    );
  }
  if (load.workdir.authorized === undefined) {
    return <UnauthorizedBody {...props} defaultPath={load.workdir.defaultDisplayPath} />;
  }
  return <AuthorizedBody {...props} displayPath={load.workdir.authorized.displayPath} />;
}

function UnauthorizedBody(props: WorkdirBodyProps & { defaultPath: string }) {
  const { t } = useCaddyCopy();
  return (
    <>
      <StatusBadge tone="warning">{t("caddy.workdir.unselected")}</StatusBadge>
      <ActionRow>
        <Button
          size="sm"
          variant="primary"
          disabled={props.busy}
          aria-describedby="caddy-workdir-default-note"
          onClick={props.onUseDefault}
        >
          {t("caddy.workdir.useDefault", { path: props.defaultPath })}
        </Button>
        <Button size="sm" variant="secondary" disabled={props.busy} onClick={props.onSelect}>
          {t("caddy.workdir.chooseOther")}
        </Button>
      </ActionRow>
      <p className="m-0 basis-full text-aux text-muted-foreground">
        {t("caddy.workdir.dataNote")}
      </p>
      <p id="caddy-workdir-default-note" className="m-0 basis-full text-aux text-muted-foreground">
        {t("caddy.workdir.defaultNote", { path: props.defaultPath })}
      </p>
    </>
  );
}

function AuthorizedBody(props: WorkdirBodyProps & { displayPath: string }) {
  const { t } = useCaddyCopy();
  if (props.action.status === "confirmRevoke") {
    return (
      <div role="group" aria-label={t("caddy.workdir.confirmRevokeGroup")} className="grid min-w-0 basis-full gap-ui-8">
        <dl className="m-0 flex min-w-0 items-center gap-ui-4">
          <dt className="shrink-0 text-aux text-muted-foreground">{t("caddy.workdir.currentFolder")}</dt>
          <dd className="m-0 min-w-0 truncate font-mono text-aux" title={props.displayPath}>
            {props.displayPath}
          </dd>
        </dl>
        <p className="m-0 text-aux text-muted-foreground">
          {t("caddy.workdir.revokeNote")}
        </p>
        <ActionRow>
          <Button size="sm" variant="danger" disabled={props.busy} onClick={props.onRevoke}>
            {t("caddy.workdir.confirmRevoke")}
          </Button>
          <Button size="sm" variant="secondary" disabled={props.busy} onClick={props.onCancelRevoke}>
            {t("common.cancel")}
          </Button>
        </ActionRow>
      </div>
    );
  }
  return (
    <>
      <StatusBadge tone="success">{t("caddy.workdir.authorized")}</StatusBadge>
      <dl className="m-0 flex min-w-0 items-center gap-ui-4">
        <dt className="shrink-0 text-aux text-muted-foreground">{t("caddy.workdir.currentFolder")}</dt>
        <dd className="m-0 min-w-0 truncate font-mono text-aux" title={props.displayPath}>
          {props.displayPath}
        </dd>
      </dl>
      <ActionRow>
        <Button size="sm" variant="secondary" disabled={props.busy} onClick={props.onSelect}>
          {t("caddy.workdir.changeFolder")}
        </Button>
        <Button size="sm" variant="secondary" disabled={props.busy} onClick={props.onConfirmRevoke}>
          {t("caddy.workdir.revoke")}
        </Button>
      </ActionRow>
    </>
  );
}

function ActionResult({ action }: { action: WorkdirAction }) {
  const { t } = useCaddyCopy();
  if (action.status === "busy") {
    return (
      <p role="status" className="m-0 text-aux text-muted-foreground">
        {t("caddy.workdir.busy")}
      </p>
    );
  }
  if (action.status === "notice") {
    return (
      <p role="status" className="m-0 text-aux text-muted-foreground">
        {action.message}
      </p>
    );
  }
  if (action.status === "failed") {
    return (
      <p role="alert" className="m-0 text-aux text-danger">
        {action.message}
      </p>
    );
  }
  return null;
}
