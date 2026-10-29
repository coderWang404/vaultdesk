export function isTrustedRendererUrl(url: string, target: string): boolean {
  try {
    const parsed = new URL(url);
    const expected = new URL(target);
    return (
      parsed.protocol === expected.protocol &&
      parsed.host === expected.host &&
      parsed.pathname === expected.pathname &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}
