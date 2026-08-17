export function serializeJson(label, value) {
    let serialized;
    try {
        serialized = JSON.stringify(value);
    }
    catch {
        throw new TypeError(`${label} must be JSON-serializable`);
    }
    if (serialized === undefined) {
        throw new TypeError(`${label} must be JSON-serializable`);
    }
    return serialized;
}
export function parseStoredJson(label, raw) {
    try {
        return JSON.parse(raw);
    }
    catch (error) {
        const wrapped = new TypeError(`${label} contains invalid JSON`);
        wrapped.cause = error;
        throw wrapped;
    }
}
