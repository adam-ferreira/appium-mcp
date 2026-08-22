/**
 * WDA health check utilities — shared across create-session, attach-session, wda-status
 */
import log from '../logger.js';

export interface WdaStatusResult {
  alive: boolean;
  buildInfo?: Record<string, any>;
  sessionId?: string;
  error?: string;
}

/**
 * Probe WDA status endpoint. Returns structured result.
 * Uses native fetch with AbortController for timeout.
 */
export async function probeWdaStatus(
  baseUrl: string,
  timeoutMs: number = 3000
): Promise<WdaStatusResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${baseUrl}/status`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      return { alive: false, error: `HTTP ${response.status}` };
    }

    const body = (await response.json()) as Record<string, any>;
    const value = body?.value ?? {};

    return {
      alive: value.ready === true,
      buildInfo: value.build ?? undefined,
      sessionId: value.sessionId ?? undefined,
    };
  } catch (err: any) {
    const message =
      err.name === 'AbortError'
        ? `Timeout after ${timeoutMs}ms`
        : err.message ?? 'Unknown error';
    return { alive: false, error: message };
  }
}

/**
 * Check if an error is retryable (network-level failure, not logical).
 */
export function isRetryableError(error: any): boolean {
  const msg = error?.message ?? '';
  const code = error?.code ?? '';
  return (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'EPIPE' ||
    msg.includes('ECONNRESET') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('socket hang up')
  );
}

/**
 * Sleep helper for retry backoff.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
