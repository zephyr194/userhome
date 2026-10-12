import type { ReactNode } from "react";
import { Modal } from "./ui";

export function ConfirmDialog({
  busy = false,
  children,
  className,
  onCancel,
  titleId,
}: {
  busy?: boolean;
  children: ReactNode;
  className: string;
  onCancel: () => void;
  titleId: string;
}) {
  return (
    <Modal
      bodyClassName={className}
      busy={busy}
      className="max-w-[620px]"
      onClose={onCancel}
      open
      titleId={titleId}
    >
      {children}
    </Modal>
  );
}
