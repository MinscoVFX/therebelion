// Global test setup: filter noisy, expected warnings to keep output clean.
// We preserve unexpected errors while silencing repetitive, known noise.

const SILENCED_PATTERNS: RegExp[] = [
  /Failed to check known pool/, // useDbcPoolDiscovery exploratory warnings
  /Meteora API returned empty body/, // benign no-op API placeholder
  /bigint: Failed to load bindings/, // environment-specific optional dependency
  /RPC missing: set RPC_ENDPOINT/, // expected in tests intentionally lacking RPC
  /Attempt \d+ failed: Error: API error/, // retry noise from instant exit hook
];

function shouldSilence(msg?: unknown): boolean {
  if (typeof msg !== 'string') return false;
  return SILENCED_PATTERNS.some((r) => r.test(msg));
}

const originalWarn = console.warn;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
console.warn = (...args: any[]) => {
  if (args.some((a) => shouldSilence(a))) return; // swallow
  originalWarn(...args);
};

const originalError = console.error;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
console.error = (...args: any[]) => {
  if (args.some((a) => shouldSilence(a))) return; // swallow expected pattern
  originalError(...args);
};

// Optionally we could track unexpected noise volume and fail if above threshold.
// For now, keep minimal to avoid altering existing test behavior.
