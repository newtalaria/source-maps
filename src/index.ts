import * as core from '@actions/core';
import { scrubSecrets } from './config.js';
import { run } from './run.js';

void run({
  getInput: (name) => core.getInput(name),
  setOutput: (name, value) => core.setOutput(name, value),
  setSecret: (secret) => core.setSecret(secret),
  setFailed: (message) => core.setFailed(message),
  info: (message) => core.info(message),
  error: (message) => core.error(message),
  env: process.env,
  workspace: process.env.GITHUB_WORKSPACE ?? process.cwd(),
}).catch((err: unknown) => {
  core.setFailed(scrubSecrets(err instanceof Error ? err.message : String(err)));
});
