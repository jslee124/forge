const SECRET_FIELD =
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret)/iu;

export function configuredSecrets(env: NodeJS.ProcessEnv): readonly string[] {
  return Object.entries(env)
    .filter(
      ([name, value]) =>
        value !== undefined &&
        value.length >= 4 &&
        /(?:KEY|TOKEN|SECRET|PASSWORD|AUTH)/iu.test(name),
    )
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length);
}

export function redactValue(
  value: unknown,
  secrets: readonly string[],
): unknown {
  if (typeof value === "string") return redactString(value, secrets);
  if (Array.isArray(value))
    return value.map((item) => redactValue(item, secrets));
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SECRET_FIELD.test(key) ? "[REDACTED]" : redactValue(item, secrets),
    ]),
  );
}

function redactString(value: string, secrets: readonly string[]): string {
  let redacted = value;
  for (const secret of secrets) {
    redacted = redacted.replaceAll(secret, "[REDACTED]");
  }
  return redacted
    .replace(/\bBearer\s+\S+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED]")
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu,
      "[REDACTED]",
    );
}
