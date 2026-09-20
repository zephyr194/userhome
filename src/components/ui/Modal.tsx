import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import type { ReactNode } from "react";
import { classNames } from "./classNames";

export function Modal({
  busy = false,
  children,
  className,
  footer,
  onClose,
  open,
  title,
}: {
  busy?: boolean;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
  onClose: () => void;
  open: boolean;
  title: ReactNode;
}) {
  return (
    <Dialog
      className="relative z-50"
      onClose={() => {
        if (!busy) onClose();
      }}
      open={open}
    >
      <DialogBackdrop
        className="fixed inset-0 bg-neutral-950/55 transition-opacity data-closed:opacity-0"
        transition
      />
      <div className="fixed inset-0 overflow-y-auto p-6">
        <div className="flex min-h-full items-center justify-center">
          <DialogPanel
            className={classNames(
              "w-full max-w-xl rounded-lg border border-border bg-surface text-foreground shadow-xl",
              "transition duration-150 data-closed:scale-95 data-closed:opacity-0",
              className,
            )}
            transition
          >
            <div className="border-b border-border px-5 py-4">
              <DialogTitle className="text-base font-semibold">
                {title}
              </DialogTitle>
            </div>
            <div className="px-5 py-4 text-sm">{children}</div>
            {footer ? (
              <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
                {footer}
              </div>
            ) : null}
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
