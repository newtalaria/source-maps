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
    const url = resolveApiUrl(io.getInput('url'), io.env.TALARIA_BASE_URL);
    assertSafeUrl(url);

    const directory = resolveMapDirectory(io.workspace, io.getInput('path'));
    const infoStat = await stat(directory).catch(() => undefined);
    if (!infoStat?.isDirectory()) {
      throw new Error('path is not a directory of built source maps');
    }

    io.setOutput('release', release);

    const env: NodeJS.ProcessEnv = { ...io.env, TALARIA_RELEASE_KEY: key };
    delete env.TALARIA_API_KEY;

    const code = await upload({
      cwd: io.workspace,
      argv: ['sourcemaps', 'upload', directory, '--release', release, '--url', url],
      env,
      log: info,
      error,
    });
    if (code !== 0) {
      throw new Error('Source map upload failed');
    }
  } catch (err) {
    io.setFailed(scrubSecrets(err instanceof Error ? err.message : String(err)));
  }
}
