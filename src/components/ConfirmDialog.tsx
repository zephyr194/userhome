import type { ReactNode } from "react";
import { Modal } from "./ui";

export function ConfirmDialog({
  bodyClassName,
  busy = false,
  children,
  onCancel,
  titleId,
}: {
  bodyClassName: string;
  busy?: boolean;
  children: ReactNode;
  onCancel: () => void;
  titleId: string;
}) {
  return (
    <Modal
      bodyClassName={bodyClassName}
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
