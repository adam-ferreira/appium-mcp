import type { ContentResult, FastMCP } from 'fastmcp';
import { z } from 'zod';
import { getDriver, getPlatformName, PLATFORM } from '../../session-store.js';
import { execute } from '../../command.js';

// iOS: maps UIDeviceBatteryState values to human-readable strings.
//
// These four integers are Apple's, not Appium's: UIKit's `UIDeviceBatteryState`,
// unchanged since iOS 3.0. We used to import them from
// appium-xcuitest-driver/build/lib/commands/enum.js, but v12 added an `exports`
// field that closes every deep subpath, so that import no longer resolves.
// Reaching into a driver's internals for four stable constants was the fragile
// part — declaring them here removes the coupling entirely.
//
// @see https://developer.apple.com/documentation/uikit/uidevice/batterystate-swift.enum
const IOS_BATTERY_STATES: Record<number, string> = {
  0: 'unknown', // UIDeviceBatteryStateUnknown
  1: 'unplugged', // UIDeviceBatteryStateUnplugged
  2: 'charging', // UIDeviceBatteryStateCharging
  3: 'full', // UIDeviceBatteryStateFull
};

// Android: state matches BatteryManager constants
const ANDROID_BATTERY_STATES: Record<number, string> = {
  1: 'unknown',
  2: 'charging',
  3: 'discharging',
  4: 'not charging',
  5: 'full',
};

function formatBatteryInfo(
  platform: string,
  raw: { level?: number; state?: number }
): Record<string, string> {
  const levelPercent = Math.round((raw.level ?? 0) * 100);
  const states =
    platform === PLATFORM.ios ? IOS_BATTERY_STATES : ANDROID_BATTERY_STATES;
  return {
    platform: platform === PLATFORM.ios ? 'iOS' : 'Android',
    level: `${levelPercent}%`,
    state: states[raw.state ?? -1] ?? 'unknown',
  };
}

export default function batteryInfo(server: FastMCP): void {
  server.addTool({
    name: 'appium_mobile_get_battery_info',
    description:
      'Get the current battery level and charging state of the device. Works on both iOS and Android.',
    parameters: z.object({
      sessionId: z
        .string()
        .optional()
        .describe('Session ID to target. If omitted, uses the active session.'),
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
    execute: async (
      args: { sessionId?: string },
      _context: Record<string, unknown> | undefined
    ): Promise<ContentResult> => {
      const driver = getDriver(args.sessionId);
      if (!driver) {
        throw new Error('No driver found');
      }

      try {
        const platform = getPlatformName(driver);
        const raw = await execute(driver, 'mobile: batteryInfo', {});
        const formatted = formatBatteryInfo(platform, raw);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text',
              text: `Failed to get battery info. Error: ${message}`,
            },
          ],
        };
      }
    },
  });
}
