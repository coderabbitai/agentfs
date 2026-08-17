export function serializeJson(label: string, value: unknown): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError(`${label} must be JSON-serializable`);
  }
  if (serialized === undefined) {
    throw new TypeError(`${label} must be JSON-serializable`);
  }
  return serialized;
}

export function parseStoredJson(label: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const wrapped = new TypeError(`${label} contains invalid JSON`);
    Object.defineProperty(wrapped, 'cause', {
      configurable: true,
      value: error,
      writable: true,
    });
    throw wrapped;
  }
}
