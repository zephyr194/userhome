import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import { useCallback, useRef, type ReactNode } from "react";
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
  const initialFocusRef = useRef<HTMLElement | null>(null);
  const setPanelRef = useCallback((panel: HTMLDivElement | null) => {
    initialFocusRef.current =
      panel?.querySelector<HTMLElement>(
        "[data-modal-cancel]:not(:disabled)",
      ) ?? null;
  }, []);

  return (
    <Dialog
      className="relative z-50"
      initialFocus={initialFocusRef}
      onClose={() => {
        if (!busy) onClose();
      }}
      open={open}
    >
      <DialogBackdrop
        className="fixed inset-0 bg-neutral-950/55 transition-opacity data-closed:opacity-0"
        transition
      />
      <div className="fixed inset-0 overflow-hidden p-ui-xl sm:p-ui-3xl">
        <div className="flex h-full items-center justify-center">
          <DialogPanel
            ref={setPanelRef}
            aria-busy={busy || undefined}
            className={classNames(
              "max-h-full w-full max-w-xl overflow-y-auto rounded-panel border border-border bg-surface text-foreground shadow-sm",
              "transition-opacity duration-150 data-closed:opacity-0",
              className,
            )}
            onKeyDown={(event) => {
              if (busy && event.key === "Escape") {
                event.preventDefault();
              }
            }}
            transition
          >
            <div className="border-b border-border px-ui-3xl py-ui-2xl">
              <DialogTitle as="div" className="text-base font-semibold">
                {title}
              </DialogTitle>
            </div>
            <div className="px-ui-3xl py-ui-2xl text-sm">{children}</div>
            {footer ? (
              <div className="flex flex-wrap justify-end gap-ui-md border-t border-border px-ui-3xl py-ui-2xl">
                {footer}
              </div>
            ) : null}
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
