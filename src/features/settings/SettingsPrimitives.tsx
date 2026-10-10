import type {
  FieldsetHTMLAttributes,
  HTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
} from "react";
import { Button, Modal, Panel, StatusBadge } from "../../components/ui";
import type { StatusBadgeProps } from "../../components/ui/StatusBadge";
import { classNames } from "../../components/ui/classNames";

export function SettingsForm({
  busy = false,
  children,
  className,
}: {
  busy?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-busy={busy || undefined}
      className={classNames("grid min-w-0 gap-ui-xl", className)}
    >
      {children}
    </div>
  );
}

export function SettingsFieldList({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <Panel
      className={classNames(
        "min-w-0 divide-y divide-border overflow-hidden",
        className,
      )}
      {...props}
    >
      {children}
    </Panel>
  );
}

const FIELD_CLASSES =
  "flex min-w-0 flex-col gap-ui-lg px-ui-2xl py-ui-xl sm:flex-row sm:items-center sm:justify-between sm:gap-ui-3xl";

export function SettingsField({
  children,
  description,
  label,
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & {
  description: ReactNode;
  label: ReactNode;
}) {
  return (
    <label className={classNames(FIELD_CLASSES, className)} {...props}>
      <span className="min-w-0">
        <strong className="block break-words text-sm font-semibold">
          {label}
        </strong>
        <small className="mt-ui-xs block break-words text-xs leading-relaxed text-muted-foreground">
          {description}
        </small>
      </span>
      <span className="flex min-w-0 shrink-0 items-center sm:justify-end">
        {children}
      </span>
    </label>
  );
}

export function SettingsValueField({
  children,
  description,
  label,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  description: ReactNode;
  label: ReactNode;
}) {
  return (
    <div className={classNames(FIELD_CLASSES, className)} {...props}>
      <span className="min-w-0">
        <strong className="block break-words text-sm font-semibold">
          {label}
        </strong>
        <small className="mt-ui-xs block break-words text-xs leading-relaxed text-muted-foreground">
          {description}
        </small>
      </span>
      <span className="flex min-w-0 shrink-0 items-center text-xs font-semibold text-muted-foreground sm:justify-end">
        {children}
      </span>
    </div>
  );
}

export function SettingsChoiceGroup({
  children,
  description,
  legend,
  className,
  ...props
}: FieldsetHTMLAttributes<HTMLFieldSetElement> & {
  description: ReactNode;
  legend: ReactNode;
}) {
  return (
    <fieldset
      className={classNames(
        "grid min-w-0 gap-ui-lg border-0 p-0",
        className,
      )}
      {...props}
    >
      <legend className="text-sm font-semibold">{legend}</legend>
      <p className="m-0 break-words text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
      {children}
    </fieldset>
  );
}

export function SettingsChoice({
  children,
  description,
  label,
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & {
  description: ReactNode;
  label: ReactNode;
}) {
  return (
    <label
      className={classNames(
        "flex min-w-0 items-start gap-ui-lg rounded-control border border-border bg-surface px-ui-2xl py-ui-xl",
        "has-[input:checked]:border-selection-border has-[input:checked]:bg-selection",
        className,
      )}
      {...props}
    >
      {children}
      <span className="min-w-0">
        <strong className="block break-words text-sm font-semibold">
          {label}
        </strong>
        <small className="mt-ui-xs block break-words text-xs leading-relaxed text-muted-foreground">
          {description}
        </small>
      </span>
    </label>
  );
}

export function SettingsSection({
  children,
  description,
  headingId,
  title,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  description?: ReactNode;
  headingId?: string;
  title: ReactNode;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className={classNames("grid min-w-0 gap-ui-lg", className)}
      {...props}
    >
      <div className="min-w-0">
        <h3
          className="m-0 break-words text-sm font-semibold"
          id={headingId}
        >
          {title}
        </h3>
        {description ? (
          <p className="mt-ui-xs mb-0 break-words text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function SettingsFeedback({
  error,
  status,
  statusTone = "success",
}: {
  error?: string;
  status?: string;
  statusTone?: "neutral" | "success";
}) {
  if (!error && !status) return null;

  return (
    <p
      className={classNames(
        "m-0 rounded-control border px-ui-xl py-ui-lg text-xs leading-relaxed",
        error
          ? "border-danger-border bg-danger-soft text-danger"
          : statusTone === "success"
            ? "border-success-border bg-success-soft text-success"
            : "border-border bg-surface-muted text-muted-foreground",
      )}
      role={error ? "alert" : "status"}
    >
      {error ?? status}
    </p>
  );
}

export function SettingsActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={classNames(
        "flex flex-wrap justify-end gap-ui-md border-t border-border pt-ui-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SettingsDangerZone({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: ReactNode;
  title: ReactNode;
}) {
  return (
    <section className="rounded-panel border border-danger-border bg-danger-soft p-ui-2xl">
      <h3 className="m-0 text-sm font-semibold text-danger">{title}</h3>
      <p className="mt-ui-xs mb-0 break-words text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
      <SettingsActions className="border-danger-border">
        {children}
      </SettingsActions>
    </section>
  );
}

export function SettingsConfirmationDialog({
  action,
  busy,
  cancelLabel,
  children,
  error,
  errorStatus = "操作失败",
  eyebrow,
  onCancel,
  status,
  statusTone = "warning",
  title,
  titleId,
}: {
  action?: ReactNode;
  busy: boolean;
  cancelLabel: string;
  children: ReactNode;
  error?: string;
  errorStatus?: string;
  eyebrow: string;
  onCancel: () => void;
  status: string;
  statusTone?: StatusBadgeProps["tone"];
  title: string;
  titleId: string;
}) {
  return (
    <Modal
      busy={busy}
      footer={
        <>
          <Button
            data-modal-cancel
            disabled={busy}
            onClick={onCancel}
            size="sm"
          >
            {cancelLabel}
          </Button>
          {action}
        </>
      }
      onClose={onCancel}
      open
      title={
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-ui-xl">
          <div className="min-w-0">
            <p className="m-0 break-words text-xs font-semibold uppercase tracking-widest text-danger">
              {eyebrow}
            </p>
            <h3
              className="m-0 break-words text-base font-semibold leading-snug"
              id={titleId}
            >
              {title}
            </h3>
          </div>
          <StatusBadge tone={error ? "danger" : statusTone}>
            {error ? errorStatus : status}
          </StatusBadge>
        </div>
      }
    >
      <div className="grid min-w-0 gap-ui-3xl">
        {children}

        <SettingsFeedback error={error} />
      </div>
    </Modal>
  );
}
