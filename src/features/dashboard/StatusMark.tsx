export type StatusTone = "neutral" | "success" | "warning" | "danger";

export function StatusMark({ busy = false, tone }: { busy?: boolean; tone: StatusTone }) {
  return (
    <span
      className={busy ? "status-glyph status-glyph--busy" : `status-glyph status-glyph--${tone}`}
      aria-hidden="true"
    />
  );
}
