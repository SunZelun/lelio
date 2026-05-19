const SENSITIVE_KEY_PATTERN =
  /(authorization|auth|token|secret|api[_-]?key|apikey|password|passwd|credential|cookie|keychain|private[_-]?key)/i;

const STRING_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]"],
  [/\bBasic\s+[A-Za-z0-9+/=-]+/gi, "Basic [REDACTED]"],
  [/(api[_-]?key|token|secret|password|authorization)=([^&\s]+)/gi, "$1=[REDACTED]"],
  [/(sk-[A-Za-z0-9]{16,})/g, "[REDACTED_API_KEY]"],
  [/(gh[pousr]_[A-Za-z0-9_]{20,})/g, "[REDACTED_TOKEN]"]
];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

export function redactString(value: string): string {
  return STRING_REPLACEMENTS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value
  );
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    return "[REDACTED_DEPTH_LIMIT]";
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    redacted[key] = isSensitiveKey(key) ? "[REDACTED]" : redactValue(nestedValue, depth + 1);
  }
  return redacted;
}

export function redactError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return redactValue({
      name: error.name,
      message: error.message,
      stack: error.stack
    }) as Record<string, unknown>;
  }

  return redactValue({ error }) as Record<string, unknown>;
}
