/**
 * Tool to attach to an existing Appium session (local or remote)
 */
import { z } from 'zod';
import { FastMCP } from 'fastmcp';
import { setSession } from '../../session-store.js';
import log from '../../logger.js';
import WebDriver from 'webdriver';

function getPortFromUrl(url: URL): number {
  if (url.port) return parseInt(url.port, 10);
  return url.protocol === 'https:' ? 443 : 80;
}

export default function attachSession(server: FastMCP): void {
  (server as any).addTool({
    name: 'attach_session',
    description:
      'Attach to an existing Appium session on a local or remote server. ' +
      'Use this to connect to a session created by another process (e.g. IntelliJ test, Appium Inspector). ' +
      'The session must already exist on the Appium server.',
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
      try {
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
        return {
          content: [
            {
              type: 'text' as const,
              text: `Attached to session ${args.sessionId} on ${serverUrl}.\nPlatform: ${platform === 'ios' ? 'iOS' : 'Android'}\nYou can now use all Appium tools on this session.`,
            },
          ],
        };
      } catch (error: any) {
        log.error('Failed to attach to session:', error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to attach to session ${args.sessionId}: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
