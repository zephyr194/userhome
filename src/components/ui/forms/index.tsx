import {
  Checkbox,
  Description,
  Field,
  Fieldset,
  Input,
  Label,
  Legend,
  Radio,
  RadioGroup,
  Select,
  Switch,
  Textarea,
} from "@headlessui/react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { classNames } from "../classNames";

interface FieldCopyProps {
  className?: string;
  description?: ReactNode;
  disabled?: boolean;
  error?: ReactNode;
  label: ReactNode;
  required?: boolean;
}

const CONTROL_CLASSES =
  "min-h-control-md w-full min-w-0 rounded-control border border-control-border bg-surface px-ui-lg py-ui-sm text-body text-foreground disabled:cursor-not-allowed disabled:opacity-50";

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
      className={classNames("grid min-w-0 gap-ui-xs", className)}
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
    invalid?: boolean;
    onValueChange?: (value: string) => void;
  };

export function TextField({
  className,
  description,
  disabled,
  error,
  inputClassName,
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
        className={classNames(CONTROL_CLASSES, inputClassName)}
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
    inputClassName?: string;
    invalid?: boolean;
    onValueChange?: (value: string) => void;
  };

export function TextAreaField({
  className,
  description,
  disabled,
  error,
  inputClassName,
  invalid = Boolean(error),
  label,
  onValueChange,
  required,
  ...props
}: AreaProps) {
  return (
    <FieldFrame
      className={className}
      description={description}
      disabled={disabled}
      error={error}
      label={label}
      required={required}
    >
      <Textarea
        {...props}
        className={classNames(
          CONTROL_CLASSES,
          "min-h-24 resize-y py-ui-lg",
          inputClassName,
        )}
        disabled={disabled}
        invalid={invalid}
        required={required}
        onChange={(event) => onValueChange?.(event.currentTarget.value)}
      />
    </FieldFrame>
  );
}

export interface SelectOption<T extends string = string> {
  disabled?: boolean;
  label: ReactNode;
  value: T;
}

type SharedSelectProps<T extends string> = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "children" | "className" | "disabled" | "onChange" | "required"
> &
  FieldCopyProps & {
    inputClassName?: string;
    invalid?: boolean;
    onValueChange?: (value: T) => void;
    options: readonly SelectOption<T>[];
  };

export function SelectField<T extends string>({
  className,
  description,
  disabled,
  error,
  inputClassName,
  invalid = Boolean(error),
  label,
  onValueChange,
  options,
  required,
  ...props
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
      <Select
        {...props}
        className={classNames(CONTROL_CLASSES, inputClassName)}
        disabled={disabled}
        invalid={invalid}
        required={required}
        onChange={(event) =>
          onValueChange?.(event.currentTarget.value as T)
        }
      >
        {options.map((option) => (
          <option
            key={option.value}
            disabled={option.disabled}
            value={option.value}
          >
            {option.label}
          </option>
        ))}
      </Select>
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
    <FieldFrame
      className={className}
      description={description}
      disabled={disabled}
      error={error}
      label={label}
    >
      <Checkbox
        checked={checked}
        className="group flex min-h-control-sm w-fit min-w-control-sm items-center gap-ui-sm rounded-control bg-surface-muted px-ui-sm text-body disabled:cursor-not-allowed disabled:opacity-50"
        defaultChecked={defaultChecked}
        disabled={disabled}
        form={form}
        name={name}
        onChange={onCheckedChange}
        value={value}
      >
        <span
          className="grid size-4 place-items-center rounded-sm border border-control-border bg-surface group-data-checked:bg-primary"
          aria-hidden="true"
        >
          <span className="hidden text-primary-foreground group-data-checked:block">
            ✓
          </span>
        </span>
      </Checkbox>
    </FieldFrame>
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
    <FieldFrame
      className={className}
      description={description}
      disabled={disabled}
      error={error}
      label={label}
    >
      <Switch
        checked={checked}
        className="group relative h-5 w-9 rounded-full bg-surface-muted data-checked:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
        defaultChecked={defaultChecked}
        disabled={disabled}
        form={form}
        name={name}
        onChange={onCheckedChange}
        value={value}
      >
        <span className="absolute top-0.5 left-0.5 size-4 rounded-full bg-surface-raised transition-transform group-data-checked:translate-x-4" />
      </Switch>
    </FieldFrame>
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
      className={classNames("grid min-w-0 gap-ui-lg", className)}
      disabled={disabled}
    >
      <Legend className="text-group font-semibold text-foreground">
        {label}
      </Legend>
      <RadioGroup
        className="grid min-w-0 gap-ui-sm sm:grid-cols-2"
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
            className="group grid min-w-0 cursor-pointer gap-ui-xs rounded-control border border-control-border bg-surface px-ui-lg py-ui-md data-checked:border-selection-border data-checked:bg-selection disabled:cursor-not-allowed disabled:opacity-50"
            disabled={option.disabled}
            value={option.value}
          >
            <span className="text-body font-semibold">{option.label}</span>
            {option.description ? (
              <span className="text-aux text-muted-foreground">
                {option.description}
              </span>
            ) : null}
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
