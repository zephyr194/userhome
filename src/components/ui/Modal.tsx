import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import { useCallback, useRef, type ReactNode } from "react";
import { classNames } from "./classNames";

const PANEL_CLASS =
  "flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-panel bg-surface-raised text-foreground ring-1 ring-inset ring-line shadow-[var(--app-shadow-float)]";

export function Modal({
  bodyClassName,
  busy = false,
  children,
  className,
  footer,
  onClose,
  open,
  title,
  titleId,
}: {
  bodyClassName?: string;
  busy?: boolean;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
  onClose: () => void;
  open: boolean;
  title?: ReactNode;
  titleId?: string;
}) {
  const initialFocusRef = useRef<HTMLElement | null>(null);
  const setPanelRef = useCallback((panel: HTMLDivElement | null) => {
    initialFocusRef.current =
      panel?.querySelector<HTMLElement>(
        "[data-modal-initial-focus]:not(:disabled)",
      ) ??
      panel?.querySelector<HTMLElement>(
        "[data-modal-cancel]:not(:disabled), [data-dialog-cancel]:not(:disabled)",
      ) ??
      null;
  }, []);

  if (typeof document === "undefined") {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-backdrop p-ui-12 sm:p-ui-16">
        <section
          aria-busy={busy || undefined}
          aria-labelledby={titleId}
          aria-modal="true"
          className={classNames(PANEL_CLASS, className)}
          role="dialog"
        >
          <ModalFrame
            bodyClassName={bodyClassName}
            footer={footer}
            titleNode={
              title === undefined ? undefined : (
                <div className="min-w-0 break-words text-group font-semibold">{title}</div>
              )
            }
          >
            {children}
          </ModalFrame>
        </section>
      </div>
    );
  }

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
        className="fixed inset-0 bg-backdrop state-transition data-closed:opacity-0"
        transition
      />
      <div className="fixed inset-0 overflow-hidden p-ui-12 sm:p-ui-16">
        <div className="flex h-full items-center justify-center">
          <DialogPanel
            ref={setPanelRef}
            aria-busy={busy || undefined}
            aria-labelledby={titleId}
            className={classNames(
              PANEL_CLASS,
              "motion-dialog data-closed:opacity-0",
              className,
            )}
            onKeyDown={(event) => {
              if (busy && event.key === "Escape") {
                event.preventDefault();
              }
            }}
            transition
          >
            <ModalFrame
              bodyClassName={bodyClassName}
              footer={footer}
              titleNode={
                title === undefined ? undefined : (
                  <DialogTitle as="div" className="min-w-0 break-words text-group font-semibold">
                    {title}
                  </DialogTitle>
                )
              }
            >
              {children}
            </ModalFrame>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}

function ModalFrame({
  bodyClassName,
  children,
  footer,
  titleNode,
}: {
  bodyClassName?: string;
  children: ReactNode;
  footer?: ReactNode;
  titleNode?: ReactNode;
}) {
  return (
    <>
      {titleNode !== undefined ? (
        <div className="shrink-0 border-b border-line px-ui-16 py-ui-12">{titleNode}</div>
      ) : null}
      <div
        className={classNames(
          "min-h-0 flex-1 overflow-y-auto min-w-0 break-words px-ui-16 py-ui-12 text-body",
          bodyClassName,
        )}
      >
        {children}
      </div>
      {footer ? (
        <div className="flex shrink-0 flex-wrap justify-end gap-ui-8 border-t border-line px-ui-16 py-ui-12">
          {footer}
        </div>
      ) : null}
    </>
  );
}
