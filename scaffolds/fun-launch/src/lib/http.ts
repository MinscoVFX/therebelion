// Shared HTTP helpers for resilient JSON parsing in serverless / flaky network contexts.
// These guard against empty 200 responses or truncated bodies that would otherwise throw
// `Unexpected end of JSON input` when calling response.json().

export interface SafeJsonOptions {
  allowEmptyObject?: boolean; // if true, returns {} instead of null for empty body
  maxPreview?: number; // characters of body to include in thrown errors
}

export async function safeJson<T = any>(
  response: Response,
  opts: SafeJsonOptions = {}
): Promise<T | null> {
  const { allowEmptyObject = false, maxPreview = 200 } = opts;
  let text: string;
  try {
    text = await response.text();
  } catch (e) {
    throw new Error(`Failed to read response body: ${(e as any)?.message || e}`);
  }
  if (!text) {
    return allowEmptyObject ? ({} as T) : null;
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    // Provide helpful diagnostics but truncate to avoid noisy logs
    const preview = text.slice(0, maxPreview).replace(/\s+/g, ' ').trim();
    throw new Error(
      `Failed to parse JSON (status ${response.status}) preview="${preview}" err=${(e as any)?.message}`
    );
  }
}

// Convenience helper: fetch + safeJson + status validation
export interface FetchJsonOptions extends RequestInit {
  expectedStatus?: number | number[]; // defaults to 200
  safeOptions?: SafeJsonOptions;
}

export async function fetchJson<T = any>(
  input: RequestInfo | URL,
  init: FetchJsonOptions = {}
): Promise<T> {
  const { expectedStatus = 200, safeOptions, ...rest } = init;
  const res = await fetch(input, rest);
  const json = await safeJson<T>(res, safeOptions);
  const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  if (!expected.includes(res.status)) {
    const errMsg =
      (json as any)?.error || (json as any)?.message || `Unexpected status ${res.status}`;
    throw new Error(errMsg);
  }
  return json ?? ({} as T);
}
