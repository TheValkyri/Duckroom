/**
 * Server-only environment helpers.
 *
 * Secrets must never be read from Vite's VITE_* namespace because those values
 * can be exposed to the browser bundle. This module intentionally only reads
 * process.env and fails closed when a required secret is missing.
 */
export function requireServerEnv(name: string): string {
  const value = typeof process !== "undefined" ? process.env?.[name] : undefined;
  if (!value?.trim()) {
    throw new Error(`[SERVER_CONFIG] Missing required environment variable: ${name}`);
  }
  return value.trim();
}

export function getOptionalServerEnv(name: string): string | undefined {
  const value = typeof process !== "undefined" ? process.env?.[name] : undefined;
  return value?.trim() || undefined;
}
