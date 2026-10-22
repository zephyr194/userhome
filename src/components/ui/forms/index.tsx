import {
  Button as HeadlessButton,
  Checkbox,
  Description,
  Field,
  Fieldset,
  Input,
  Label,
  Legend,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
  Radio,
  RadioGroup,
  Switch,
  Textarea,
} from "@headlessui/react";
import { useState } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from "react";
import { Button } from "../Button";
import { classNames } from "../classNames";
import { Modal } from "../Modal";

interface FieldCopyProps {
  className?: string;
  description?: ReactNode;
  disabled?: boolean;
  error?: ReactNode;
  label: ReactNode;
  required?: boolean;
}

const CONTROL_BASE =
  "w-full min-w-0 rounded-control border border-control-border bg-surface px-ui-8 text-body text-foreground disabled:cursor-not-allowed disabled:opacity-50";

function RequiredMark({ required }: { required?: boolean }) {
  return required ? (
    <span className="text-danger" aria-hidden="true">
      {" "}*
    </span>
  ) : null;
}

export function FieldFrame({
  children,
  className,
  description,
  disabled,
  error,
  label,
  required,
}: FieldCopyProps & { children: ReactNode }) {
  return (
    <Field
      className={classNames("grid min-w-0 gap-ui-4", className)}
      disabled={disabled}
    >
      <Label className="break-words text-body font-semibold text-foreground">
        {label}
        <RequiredMark required={required} />
      </Label>
      {description ? (
        <Description className="break-words text-aux text-muted-foreground">
          {description}
        </Description>
      ) : null}
      {children}
      {error ? (
        <Description
          className="break-words text-aux text-danger"
          role="alert"
        >
          {error}
        </Description>
      ) : null}
    </Field>
  );
}

type TextInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "disabled" | "onChange" | "required"
> &
  FieldCopyProps & {
    inputClassName?: string;
    inputRef?: Ref<HTMLInputElement>;
    invalid?: boolean;
    onValueChange?: (value: string) => void;
  };

export function TextField({
  className,
  description,
  disabled,
  error,
  inputClassName,
  inputRef,
  invalid = Boolean(error),
  label,
  onValueChange,
  required,
  ...props
}: TextInputProps) {
  return (
    <FieldFrame
      className={className}
      description={description}
      disabled={disabled}
      error={error}
      label={label}
      required={required}
    >
      <Input
        {...props}
        ref={inputRef}
        className={classNames(CONTROL_BASE, "h-control-md", inputClassName)}
        disabled={disabled}
        invalid={invalid}
        required={required}
        onChange={(event) => onValueChange?.(event.currentTarget.value)}
      />
    </FieldFrame>
  );
}

type AreaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "className" | "disabled" | "onChange" | "required"
> &
  FieldCopyProps & {
    emphasis?: boolean;
    expandable?: boolean;
    inputClassName?: string;
    invalid?: boolean;
    onValueChange?: (value: string) => void;
  };

export function TextAreaField({
  className,
  description,
  disabled,
  emphasis = false,
  error,
  expandable = false,
  inputClassName,
  invalid = Boolean(error),
  label,
  onValueChange,
  required,
  value,
  ...props
}: AreaProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const expandLabel = `在独立框中打开${typeof label === "string" ? label : "文本"}`;

  return (
    <FieldFrame
      className={className}
      description={description}
      disabled={disabled}
      error={error}
      label={label}
      required={required}
    >
      <div className="relative min-w-0">
        <Textarea
          {...props}
          className={classNames(
            CONTROL_BASE,
            "min-h-24 resize-y py-ui-8",
            emphasis && "field-emphasis",
            expandable && "pe-control-sm",
            inputClassName,
          )}
          disabled={disabled}
          invalid={invalid}
          required={required}
          value={value}
          onChange={(event) => onValueChange?.(event.currentTarget.value)}
        />
        {expandable ? (
          <HeadlessButton
            aria-label={expandLabel}
            className="absolute top-ui-4 right-ui-4 grid size-control-sm place-items-center rounded-control text-muted-foreground enabled:hover:bg-surface-muted enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onClick={() => {
              setDraft(String(value ?? ""));
              setEditing(true);
            }}
          >
            <svg {...ICON_PROPS} aria-hidden="true" className="size-3">
              <path d="M7.5 1.5h3v3M4.5 10.5h-3v-3M10.5 1.5 7 5M1.5 10.5 5 7" />
            </svg>
          </HeadlessButton>
        ) : null}
        {expandable && editing ? (
          <Modal
            footer={
              <>
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  取消
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    onValueChange?.(draft);
                    setEditing(false);
                  }}
                >
                  完成
                </Button>
              </>
            }
            onClose={() => setEditing(false)}
            open
            title={label}
          >
            <TextAreaField
              data-modal-initial-focus=""
              description={description}
              error={error}
              inputClassName="font-mono text-xs"
              label={label}
              onValueChange={setDraft}
              rows={16}
              spellCheck={false}
              value={draft}
            />
          </Modal>
        ) : null}
      </div>
    </FieldFrame>
  );
}

export interface SelectOption<T extends string = string> {
  disabled?: boolean;
  label: ReactNode;
  value: T;
}

type SharedSelectProps<T extends string> = FieldCopyProps & {
  defaultValue?: T;
  form?: string;
  inputClassName?: string;
  invalid?: boolean;
  name?: string;
  onValueChange?: (value: T) => void;
  options: readonly SelectOption<T>[];
  value?: T;
};

const ICON_PROPS = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  strokeWidth: 1.5,
  viewBox: "0 0 12 12",
} as const;

export function SelectField<T extends string>({
  className,
  defaultValue,
  description,
  disabled,
  error,
  form,
  inputClassName,
  invalid = Boolean(error),
  label,
  name,
  onValueChange,
  options,
  required,
  value,
}: SharedSelectProps<T>) {
  return (
    <FieldFrame
      className={className}
      description={description}
      disabled={disabled}
      error={error}
      label={label}
      required={required}
    >
      <Listbox
        defaultValue={defaultValue}
        disabled={disabled}
        form={form}
        invalid={invalid}
        name={name}
        onChange={(next) => onValueChange?.(next)}
        value={value}
      >
        {({ value: current }) => (
          <>
            <ListboxButton
              aria-invalid={invalid || undefined}
              className={classNames(
                CONTROL_BASE,
                "flex h-control-md items-center justify-between gap-ui-8 text-left focus-visible:border-focus aria-[invalid=true]:border-danger",
                inputClassName,
              )}
            >
              <span className="min-w-0 truncate">
                {options.find((option) => option.value === current)?.label}
              </span>
              <svg
                {...ICON_PROPS}
                aria-hidden="true"
                className="size-3 shrink-0 text-muted-foreground"
              >
                <path d="M3 4.5 6 7.5 9 4.5" />
              </svg>
            </ListboxButton>
            <ListboxOptions
              anchor="bottom start"
              className="mt-ui-4 max-h-56 w-(--button-width) overflow-y-auto rounded-panel bg-surface-raised p-ui-4 text-body text-foreground shadow-[var(--app-shadow-raised)] ring-1 ring-line ring-inset"
            >
              {options.map((option) => (
                <ListboxOption
                  key={option.value}
                  className="group flex h-control-md cursor-pointer items-center justify-between gap-ui-8 rounded-control px-ui-8 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-focus:bg-surface-muted"
                  disabled={option.disabled}
                  value={option.value}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  <svg
                    {...ICON_PROPS}
                    aria-hidden="true"
                    className="hidden size-3 shrink-0 text-primary group-data-selected:block"
                  >
                    <path d="M2.5 6.25 5 8.5 9.5 3.5" />
                  </svg>
                </ListboxOption>
              ))}
            </ListboxOptions>
          </>
        )}
      </Listbox>
    </FieldFrame>
  );
}

interface ToggleCopyProps extends FieldCopyProps {
  checked?: boolean;
  defaultChecked?: boolean;
  form?: string;
  name?: string;
  onCheckedChange?: (checked: boolean) => void;
  value?: string;
}

function ToggleFrame({
  className,
  control,
  description,
  disabled,
  error,
  label,
}: FieldCopyProps & { control: ReactNode }) {
  return (
    <Field
      className={classNames(
        "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-ui-8 gap-y-ui-4",
        className,
      )}
      disabled={disabled}
    >
      {control}
      <Label className="min-w-0 cursor-pointer break-words text-body text-foreground data-disabled:cursor-not-allowed">
        {label}
      </Label>
      {description ? (
        <Description className="col-start-2 break-words text-aux text-muted-foreground">
          {description}
        </Description>
      ) : null}
      {error ? (
        <Description
          className="col-start-2 break-words text-aux text-danger"
          role="alert"
        >
          {error}
        </Description>
      ) : null}
    </Field>
  );
}

export function CheckboxField({
  checked,
  className,
  defaultChecked,
  description,
  disabled,
  error,
  label,
  name,
  form,
  onCheckedChange,
  value = "on",
}: ToggleCopyProps) {
  return (
    <ToggleFrame
      className={className}
      control={
        <Checkbox
          checked={checked}
          className="group flex h-control-sm w-fit cursor-pointer items-center data-disabled:cursor-not-allowed data-disabled:opacity-50"
          defaultChecked={defaultChecked}
          disabled={disabled}
          form={form}
          name={name}
          onChange={onCheckedChange}
          value={value}
        >
          <span
            className={classNames(
              "grid size-4 place-items-center rounded-control border bg-surface text-primary-foreground group-data-checked:border-primary group-data-checked:bg-primary group-data-focus:border-focus",
              error ? "border-danger" : "border-control-border",
            )}
            aria-hidden="true"
          >
            <svg
              {...ICON_PROPS}
              aria-hidden="true"
              className="size-3 opacity-0 group-data-checked:opacity-100"
            >
              <path d="M2.5 6.25 5 8.5 9.5 3.5" />
            </svg>
          </span>
        </Checkbox>
      }
      description={description}
      disabled={disabled}
      error={error}
      label={label}
    />
  );
}

export function SwitchField({
  checked,
  className,
  defaultChecked,
  description,
  disabled,
  error,
  form,
  label,
  name,
  onCheckedChange,
  value = "on",
}: ToggleCopyProps) {
  return (
    <ToggleFrame
      className={className}
      control={
        <Switch
          checked={checked}
          className="flex h-control-sm w-fit cursor-pointer items-center data-disabled:cursor-not-allowed data-disabled:opacity-50"
          defaultChecked={defaultChecked}
          disabled={disabled}
          form={form}
          name={name}
          onChange={onCheckedChange}
          value={value}
        >
          <span className="switch-track" aria-hidden="true">
            <span className="switch-thumb" />
          </span>
        </Switch>
      }
      description={description}
      disabled={disabled}
      error={error}
      label={label}
    />
  );
}

export interface RadioCardOption<T extends string = string> {
  description?: ReactNode;
  disabled?: boolean;
  label: ReactNode;
  value: T;
}

interface RadioCardGroupProps<T extends string> extends FieldCopyProps {
  defaultValue?: T;
  form?: string;
  name?: string;
  onValueChange?: (value: T) => void;
  options: readonly RadioCardOption<T>[];
  value?: T;
}

export function RadioCardGroup<T extends string>({
  className,
  defaultValue,
  description,
  disabled,
  error,
  form,
  label,
  name,
  onValueChange,
  options,
  value,
}: RadioCardGroupProps<T>) {
  return (
    <Fieldset
      className={classNames("grid min-w-0 gap-ui-8", className)}
      disabled={disabled}
    >
      <Legend className="text-group font-semibold text-foreground">
        {label}
      </Legend>
      <RadioGroup
        className="grid min-w-0 gap-ui-8 sm:grid-cols-2"
        defaultValue={defaultValue}
        disabled={disabled}
        form={form}
        name={name}
        onChange={onValueChange}
        value={value}
      >
        {description ? (
          <Description className="text-aux text-muted-foreground sm:col-span-2">
            {description}
          </Description>
        ) : null}
        {options.map((option) => (
          <Radio
            key={option.value}
            className="group grid min-w-0 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-ui-8 rounded-control border border-control-border bg-surface px-ui-8 py-ui-8 not-data-checked:data-focus:bg-surface-muted data-checked:border-selection-border data-checked:bg-selection disabled:cursor-not-allowed disabled:opacity-50"
            disabled={option.disabled}
            value={option.value}
          >
            <span
              className="grid size-4 shrink-0 place-items-center rounded-full border border-control-border bg-surface group-data-checked:border-primary"
              aria-hidden="true"
            >
              <span className="size-2 rounded-full bg-transparent group-data-checked:bg-primary" />
            </span>
            <span className="grid min-w-0 gap-ui-4">
              <span className="text-body font-semibold">{option.label}</span>
              {option.description ? (
                <span className="text-aux text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </span>
          </Radio>
        ))}
        {error ? (
          <Description
            className="text-aux text-danger sm:col-span-2"
            role="alert"
          >
            {error}
          </Description>
        ) : null}
      </RadioGroup>
    </Fieldset>
  );
}

type SecretProps = Omit<
  TextInputProps,
  "autoComplete" | "defaultValue" | "spellCheck" | "type"
>;

export function SecretReplacementField({ value, ...props }: SecretProps) {
  return (
    <TextField
      {...props}
      {...(value === undefined ? { defaultValue: "" } : { value })}
      autoComplete="new-password"
      spellCheck={false}
      type="password"
    />
  );
}
