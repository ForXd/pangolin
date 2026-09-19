export function port(value: number, name: string, allowZero = false): number {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1) || value > 65535) {
    throw new RangeError(`${name} must be an integer between ${allowZero ? 0 : 1} and 65535`);
  }
  return value;
}
export function host(value: string, name: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new TypeError(`${name} must be a nonempty string`);
  return value;
}
export function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
