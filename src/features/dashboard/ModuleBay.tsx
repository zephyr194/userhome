import { Button, Panel } from "../../components/ui";
import { ActionRow } from "../../components/ui/ActionRow";
import { StatusMark } from "./StatusMark";
import type { BayFigure, BayStatus } from "./overviewBays";

export function ModuleBay({
  actionLabel,
  busy = false,
  detail,
  figure,
  id,
  onOpen,
  onRead,
  readLabel = "读取摘要",
  status,
  title,
}: {
  actionLabel: string;
  busy?: boolean;
  detail?: string;
  figure: BayFigure;
  id: string;
  onOpen: () => void;
  onRead?: () => void;
  readLabel?: string;
  status: BayStatus;
  title: string;
}) {
  const headingId = `${id}-heading`;
  return (
    <Panel aria-labelledby={headingId} className="overview-bay">
      <header className="overview-bay__head">
        <h2 id={headingId}>{title}</h2>
        <span className="overview-bay__state">
          <StatusMark busy={busy} tone={status.tone} />
          <span>{status.label}</span>
        </span>
      </header>
      <dl className="overview-bay__figure">
        <dt>{figure.label}</dt>
        <dd>{figure.value}</dd>
      </dl>
      {detail ? <p className="overview-bay__detail">{detail}</p> : null}
      <ActionRow className="overview-bay__actions">
        {onRead ? (
          <Button size="sm" variant="secondary" onClick={onRead}>
            {readLabel}
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={onOpen}>
          {actionLabel}
        </Button>
      </ActionRow>
    </Panel>
  );
}
