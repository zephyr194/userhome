import { SecretReplacementField } from "../../../components/ui";

export function SecretField({ name, label }: { name: string; label: string }) {
  return <SecretReplacementField label={label} name={name} placeholder="留空则保留现有值" />;
}
