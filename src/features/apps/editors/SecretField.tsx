export function SecretField({ name, label }: { name: string; label: string }) {
  return (
    <label>
      {label}
      <input
        name={name}
        type="password"
        autoComplete="new-password"
        defaultValue=""
        placeholder="留空则保留现有值"
      />
    </label>
  );
}
