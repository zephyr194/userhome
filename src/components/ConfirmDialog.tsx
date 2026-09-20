import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import {
  Children,
  isValidElement,
  useCallback,
  useRef,
  type ElementType,
  type ReactNode,
} from "react";
import { classNames } from "./ui/classNames";

const PANEL_CLASSES = [
  "max-h-full w-full max-w-[620px] overflow-y-auto rounded-lg border border-border bg-surface px-5 py-4 text-sm text-foreground shadow-xl",
  "transition duration-150 data-closed:scale-95 data-closed:opacity-0",
  "[&_h3]:mb-2.5 [&_h3]:mt-1.5 [&_h3]:text-base [&_h3]:font-semibold",
];

function bindDialogTitle(children: ReactNode, titleId: string) {
  return Children.map(children, (child) => {
    if (!isValidElement<{ id?: string }>(child) || child.props.id !== titleId) {
      return child;
    }

    return (
      <DialogTitle
        key={child.key}
        as={child.type as ElementType}
        {...child.props}
      />
    );
  });
}

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
  const initialFocusRef = useRef<HTMLElement | null>(null);
  const setPanelRef = useCallback((panel: HTMLDivElement | null) => {
    initialFocusRef.current =
      panel?.querySelector<HTMLElement>(
        "[data-dialog-cancel]:not(:disabled)",
      ) ?? null;
  }, []);

  if (typeof document === "undefined") {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-neutral-950/55 p-6">
        <section
          aria-busy={busy || undefined}
          aria-labelledby={titleId}
          aria-modal="true"
          className={classNames(...PANEL_CLASSES, className)}
          role="dialog"
        >
          {children}
        </section>
      </div>
    );
  }

  return (
    <Dialog
      className="relative z-50"
      initialFocus={initialFocusRef}
      onClose={() => {
        if (!busy) onCancel();
      }}
      open
    >
      <DialogBackdrop
        className="fixed inset-0 bg-neutral-950/55 transition-opacity data-closed:opacity-0"
        transition
      />
      <div className="fixed inset-0 overflow-hidden p-6">
        <div className="flex h-full items-center justify-center">
          <DialogPanel
            ref={setPanelRef}
            aria-busy={busy || undefined}
            className={classNames(...PANEL_CLASSES, className)}
            onKeyDown={(event) => {
              if (busy && event.key === "Escape") {
                event.preventDefault();
              }
            }}
            transition
          >
            {bindDialogTitle(children, titleId)}
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
