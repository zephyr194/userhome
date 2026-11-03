export const MAX_INPUT_BYTES = 1024 * 1024;

export function exceedsInputLimit(text: string): boolean {
  return new TextEncoder().encode(text).byteLength > MAX_INPUT_BYTES;
}
