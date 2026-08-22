/**
 * Tool to attach to an existing Appium session (local or remote)
 * Includes retry logic for transient network errors (ECONNRESET, ECONNREFUSED)
 */
import { z } from 'zod';
import { FastMCP } from 'fastmcp';
import { setSession } from '../../session-store.js';
import log from '../../logger.js';
import WebDriver from 'webdriver';
import {
  probeWdaStatus,
  isRetryableError,
  sleep,
} from '../../utils/wda-health.js';

function getPortFromUrl(url: URL): number {
  if (url.port) return parseInt(url.port, 10);
  return url.protocol === 'https:' ? 443 : 80;
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export default function attachSession(server: FastMCP): void {
  (server as any).addTool({
    name: 'attach_session',
    description:
      'Attach to an existing Appium session on a local or remote server. ' +
      'Use this to connect to a session created by another process (e.g. IntelliJ test, Appium Inspector). ' +
      'The session must already exist on the Appium server. ' +
      'Retries automatically on transient network errors (ECONNRESET).',
    parameters: z.object({
      sessionId: z.string().describe('The session ID to attach to.'),
      serverUrl: z
        .string()
        .optional()
        .describe(
          'Appium server URL (e.g. http://localhost:4723). Defaults to http://localhost:4723.'
        ),
      platform: z
        .enum(['android', 'ios'])
        .optional()
        .describe('Platform hint for the session. Defaults to android.'),
    }),
    annotations: { readOnlyHint: false, openWorldHint: false },
    execute: async (args: {
      sessionId: string;
      serverUrl?: string;
      platform?: string;
    }) => {
      const serverUrl = args.serverUrl || 'http://localhost:4723';
      const platform = args.platform || 'android';
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          if (attempt > 0) {
            const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
            log.info(
              `Retry attempt ${attempt}/${MAX_RETRIES} after ${delay}ms...`
            );
            await sleep(delay);

            // Check if the server is still reachable before retrying
            const probe = await probeWdaStatus(serverUrl);
            if (!probe.alive) {
              log.warn(
                `Server at ${serverUrl} is not responding. Aborting retries.`
              );
              break;
            }
          }

          const url = new URL(serverUrl);
          const protocol = url.protocol.replace(':', '') as 'http' | 'https';
          const port = getPortFromUrl(url);
          const user = url.username
            ? decodeURIComponent(url.username)
            : undefined;
          const key = url.password
            ? decodeURIComponent(url.password)
            : undefined;

          log.info(
            `Attaching to session ${args.sessionId} on ${protocol}://${url.hostname}:${port}${url.pathname}`
          );

          const client = WebDriver.attachToSession({
            sessionId: args.sessionId,
            protocol,
            hostname: url.hostname,
            port,
            path: url.pathname,
            ...(user && key ? { user, key } : {}),
          });

          const capabilities: Record<string, any> = {
            platformName: platform === 'ios' ? 'iOS' : 'Android',
            'appium:automationName':
              platform === 'ios' ? 'XCUITest' : 'UiAutomator2',
          };

          setSession(client, args.sessionId, capabilities);
          log.info(`Attached to session ${args.sessionId} successfully.`);

          const retryNote =
            attempt > 0 ? ` (succeeded after ${attempt} retries)` : '';
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `Attached to session ${args.sessionId} on ${serverUrl}${retryNote}.\n` +
                  `Platform: ${platform === 'ios' ? 'iOS' : 'Android'}\n` +
                  `You can now use all Appium tools on this session.`,
              },
            ],
          };
        } catch (error: any) {
          lastError = error;
          if (!isRetryableError(error) || attempt === MAX_RETRIES) {
            break;
          }
          log.warn(
            `Retryable error on attempt ${attempt}: ${error.message}`
          );
        }
      }

      // Build diagnostic message
      log.error('Failed to attach to session:', lastError);
      let diagnostics = '';
      try {
        const probe = await probeWdaStatus(serverUrl);
        diagnostics = probe.alive
          ? 'Server is responding but session attachment failed. The session may no longer exist.'
          : `Server at ${serverUrl} is not responding. Check that WDA/Appium is running.`;
      } catch {
        diagnostics = 'Could not reach server for diagnostics.';
      }

      return {
        content: [
          {
            type: 'text' as const,
            text:
              `Failed to attach to session ${args.sessionId} after ${MAX_RETRIES + 1} attempts: ${lastError?.message}\n\n` +
              `Diagnostics: ${diagnostics}`,
          },
        ],
        isError: true,
      };
    },
  });
}
