import type { ReactNode } from "react";
import { InfoTip } from "../../components/ui";

/** 一行右侧的同名提示：一句文字，点开或悬停才列出位置（不含值）。 */
export function SameNameHint({
  description,
  label,
  title,
}: {
  description: ReactNode;
  label: string;
  title: string;
}) {
  return (
    <span className="ml-auto flex min-w-0 items-center gap-ui-4">
      <span className="text-meta text-muted-foreground">{label}</span>
      <InfoTip description={description} title={title} />
    </span>
  );
}
