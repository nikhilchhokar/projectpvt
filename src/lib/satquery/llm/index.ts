/**
 * Language-layer resolution.
 *
 * Picks the best available provider once per process and remembers the result.
 * Callers get a `LocalLLMProvider` and cannot tell which implementation they
 * received -- which is the entire point of the abstraction.
 */

import { DeterministicLanguageProvider } from "./deterministic";
import { PocketLLMProvider, readPocketLLMConfig } from "./pocketllm";
import type { LocalLLMProvider } from "./provider";

export type { LocalLLMProvider } from "./provider";
export { DeterministicLanguageProvider } from "./deterministic";
export { PocketLLMProvider } from "./pocketllm";
export { intentLabel } from "./deterministic";

let resolved: Promise<LocalLLMProvider> | null = null;

async function pick(): Promise<LocalLLMProvider> {
  const config = readPocketLLMConfig();
  if (config) {
    const provider = new PocketLLMProvider(config);
    if (await provider.isAvailable()) return provider;
    console.warn(
      `[satquery] ${config.displayName} configured at ${config.url} but not reachable; using the deterministic interpreter.`,
    );
  }
  return new DeterministicLanguageProvider();
}

export function languageProvider(): Promise<LocalLLMProvider> {
  if (!resolved) resolved = pick();
  return resolved;
}

/** Test hook: drop the memoised provider so the next call re-resolves. */
export function resetLanguageProvider(): void {
  resolved = null;
}
