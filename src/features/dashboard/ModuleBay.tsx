import { Button, Panel, StatusBadge } from "../../components/ui";
import type { BayFigure, BayStatus } from "./overviewBays";

export function ModuleBay({
  actionLabel,
  figure,
  id,
  onOpen,
  status,
  title,
}: {
  actionLabel: string;
  figure: BayFigure;
  id: string;
  onOpen: () => void;
  status: BayStatus;
  title: string;
}) {
  const headingId = `${id}-heading`;
  return (
    <Panel aria-labelledby={headingId} className="flex h-full min-w-0 flex-col gap-ui-8 p-ui-16">
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-ui-8">
        <h2 className="m-0 text-group font-semibold text-foreground" id={headingId}>
          {title}
        </h2>
        <span className="flex min-w-0 items-center gap-ui-4">
          {status.attention ? (
            <span className={`status-glyph status-glyph--${status.tone}`} aria-hidden="true" />
          ) : null}
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </span>
      </header>
      <dl className="flex min-w-0 flex-wrap items-baseline gap-ui-8">
        <dt className="text-aux text-muted-foreground">{figure.label}</dt>
        <dd className="font-mono text-body text-foreground">{figure.value}</dd>
      </dl>
      <div>
        <Button size="sm" variant="ghost" onClick={onOpen}>
          {actionLabel}
        </Button>
      </div>
    </Panel>
  );
}
