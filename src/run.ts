import { stat } from 'node:fs/promises';
import { uploadSourceMaps, type UploadSourceMapsOptions } from '@newtalaria/cli';
import { scrubSecrets, resolveActionRelease, resolveApiUrl, assertSafeUrl, resolveMapDirectory } from './config.js';

export interface ActionIo {
  getInput: (name: string) => string;
  setOutput: (name: string, value: string) => void;
  setSecret: (secret: string) => void;
  setFailed: (message: string) => void;
  info: (message: string) => void;
  error: (message: string) => void;
  env: NodeJS.ProcessEnv;
  workspace: string;
  upload?: (options: UploadSourceMapsOptions) => Promise<number>;
}

export async function run(io: ActionIo): Promise<void> {
  const upload = io.upload ?? uploadSourceMaps;
  const info = (line: string) => io.info(scrubSecrets(line));
  const error = (line: string) => io.error(scrubSecrets(line));
  try {
    const key = io.env.TALARIA_RELEASE_KEY?.trim() ?? '';
    if (!key) {
      throw new Error('Set TALARIA_RELEASE_KEY to a releases:write key.');
    }
    io.setSecret(key);

    const release = resolveActionRelease({
      release: io.getInput('release'),
      env: io.env,
    });
    const url = resolveApiUrl(io.getInput('url'), io.env.TALARIA_URL);
    assertSafeUrl(url);

    const sourcemapsPath = io.getInput('sourcemaps').trim();
    const setCommits = io.getInput('set-commits').trim().toLowerCase();

    io.setOutput('release', release);
    // Set commit-sha output from env if available
    const commitSha = io.env.GITHUB_SHA ?? io.env.CI_COMMIT_SHA ?? '';
    if (commitSha) {
      io.setOutput('commit-sha', commitSha);
    }

    const env: NodeJS.ProcessEnv = { ...io.env, TALARIA_RELEASE_KEY: key };
    delete env.TALARIA_API_KEY;

    // Upload source maps if sourcemaps input is provided
    if (sourcemapsPath) {
      const directory = resolveMapDirectory(io.workspace, sourcemapsPath);
      const infoStat = await stat(directory).catch(() => undefined);
      if (!infoStat?.isDirectory()) {
        throw new Error('sourcemaps path is not a directory of built source maps');
      }

      const argv = [
        'sourcemaps',
        'upload',
        directory,
        '--release',
        release,
        '--url',
        url,
      ];
      if (io.getInput('silverstripe-combine-files').trim().toLowerCase() === 'true') {
        argv.push('--silverstripe-combine-files');
      }

      const code = await upload({
        cwd: io.workspace,
        argv,
        env,
        log: info,
        error,
      });
      if (code !== 0) {
        throw new Error('Source map upload failed');
      }
    }

    // Create release with commits if set-commits is 'auto'
    if (setCommits === 'auto') {
      // For now, log that this feature is coming
      // The actual implementation will call the CLI's releases create command
      info('set-commits: auto - This will be implemented with the CLI releases command');
    }
  } catch (err) {
    io.setFailed(scrubSecrets(err instanceof Error ? err.message : String(err)));
  }
}
