/**
 * Tool to check WebDriverAgent status on a real iOS device.
 * Read-only — does not modify WDA state.
 */
import { z } from 'zod';
import { FastMCP } from 'fastmcp';
import log from '../../logger.js';
import { probeWdaStatus } from '../../utils/wda-health.js';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const STATE_FILE = join(homedir(), '.cache', 'wda-builds', 'state.json');

interface DeviceState {
  udid?: string;
  device_name?: string;
  build_dir?: string;
  xctestrun_path?: string;
  bundle_id?: string;
  team_id?: string;
  cert_cn?: string;
  build_timestamp?: string;
  profile_expiry?: string;
  profile_uuid?: string;
  wda_pid?: number | null;
  iproxy_pid?: number | null;
  wda_url?: string;
}

async function readStateFile(): Promise<
  Record<string, DeviceState> | undefined
> {
  try {
    const content = await readFile(STATE_FILE, 'utf-8');
    const data = JSON.parse(content);
    return data?.devices;
  } catch {
    return undefined;
  }
}

function formatDaysRemaining(isoDate: string): string {
  try {
    const expiry = new Date(isoDate);
    const now = new Date();
    const days = Math.floor(
      (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (days < 0) return `EXPIRED (${Math.abs(days)}d ago)`;
    if (days === 0) return 'EXPIRES TODAY';
    if (days <= 2) return `${days}d remaining (rebuild soon)`;
    return `${days}d remaining`;
  } catch {
    return 'unknown';
  }
}

export default function wdaStatus(server: FastMCP): void {
  (server as any).addTool({
    name: 'wda_status',
    description:
      'Check the status of WebDriverAgent on a real iOS device. ' +
      'Reports WDA health, build info, active session, and signing profile validity. ' +
      'Read-only — does not modify WDA state.',
    parameters: z.object({
      wdaUrl: z
        .string()
        .optional()
        .describe(
          'WDA URL to probe. Defaults to http://localhost:8100'
        ),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: async (args: { wdaUrl?: string }) => {
      const wdaUrl = args.wdaUrl || 'http://localhost:8100';
      const lines: string[] = [];

      // 1. Probe WDA
      log.info(`Checking WDA status at ${wdaUrl}`);
      const probe = await probeWdaStatus(wdaUrl);

      lines.push(`## WDA Status: ${probe.alive ? 'ALIVE' : 'DOWN'}`);
      lines.push(`URL: ${wdaUrl}`);

      if (probe.alive) {
        if (probe.buildInfo) {
          lines.push(`Build: ${JSON.stringify(probe.buildInfo)}`);
        }
        if (probe.sessionId) {
          lines.push(`Active session: ${probe.sessionId}`);
        }
      } else {
        lines.push(`Error: ${probe.error || 'Not responding'}`);
        lines.push('');
        lines.push(
          'To start WDA: `setup-wda.sh --full` or `setup-wda.sh --restart`'
        );
      }

      // 2. Read state file for signing info
      const devices = await readStateFile();
      if (devices) {
        const deviceEntries = Object.values(devices);
        if (deviceEntries.length > 0) {
          lines.push('');
          lines.push('## Device State (from setup-wda.sh)');

          for (const device of deviceEntries) {
            lines.push('');
            lines.push(
              `Device: ${device.device_name || 'unknown'} (${device.udid || '?'})`
            );

            if (device.bundle_id) {
              lines.push(`Bundle ID: ${device.bundle_id}`);
            }

            if (device.build_timestamp) {
              lines.push(`Last build: ${device.build_timestamp}`);
            }

            if (device.profile_expiry) {
              const status = formatDaysRemaining(device.profile_expiry);
              lines.push(`Profile: ${status} (expires ${device.profile_expiry})`);
            }

            if (device.cert_cn) {
              lines.push(`Certificate: ${device.cert_cn}`);
            }

            if (device.wda_pid) {
              lines.push(`WDA PID: ${device.wda_pid}`);
            }

            if (device.iproxy_pid) {
              lines.push(`iproxy PID: ${device.iproxy_pid}`);
            }
          }
        }
      } else {
        lines.push('');
        lines.push(
          'No state file found at ~/.cache/wda-builds/state.json'
        );
        lines.push(
          'Run `setup-wda.sh --full` to build and track WDA state.'
        );
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: lines.join('\n'),
          },
        ],
      };
    },
  });
}
