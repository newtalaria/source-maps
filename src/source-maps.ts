import { randomUUID } from 'node:crypto';
import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const SEGMENT = /^[A-Za-z0-9._~+-]+$/;
const SAFE_DEBUG_ID = /^[A-Za-z0-9._~+-]{1,80}$/;
const DEBUG_COMMENT = /\/\/# debugId=([^\s]+)/;

export interface SourceMapPayload {
  release: string;
  fileName: string;
  debugId?: string;
  gzipBytes: string;
}

export async function prepareSourceMaps(input: {
  directory: string;
  release: string;
  silverstripeCombineFiles: boolean;
}): Promise<SourceMapPayload[]> {
  const maps = await collectMaps(input.directory);
  if (maps.length === 0) {
    throw new Error(`No JavaScript source maps under ${input.directory}`);
  }
  const payloads: SourceMapPayload[] = [];
  for (const file of maps) {
    const prepared = await prepareArtifact(input.directory, file);
    const json = input.silverstripeCombineFiles
      ? shiftForSilverstripeCombine(prepared.json)
      : prepared.json;
    if (!fileNameOk(prepared.fileName)) {
      throw new Error(
        `${prepared.fileName}: file name must be a served artifact path, such as static/js/main.js`,
      );
    }
    const payload: SourceMapPayload = {
      release: input.release,
      fileName: prepared.fileName,
      gzipBytes: gzipSync(Buffer.from(json, 'utf8')).toString('base64'),
    };
    if (prepared.debugId) payload.debugId = prepared.debugId;
    payloads.push(payload);
  }
  return payloads;
}

/** One empty generated line, matching Silverstripe's header before the first combined file. */
function shiftForSilverstripeCombine(jsonText: string): string {
  const parsed = parseMap(jsonText);
  if (!parsed) return jsonText;
  const mappings = parsed.mappings;
  if (typeof mappings !== 'string' || mappings.length === 0) return jsonText;
  parsed.mappings = `;${mappings}`;
  return `${JSON.stringify(parsed)}\n`;
}

async function collectMaps(root: string): Promise<string[]> {
  const out: string[] = [];
  await walk(root, out);
  out.sort();
  return out;
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.js.map')) {
      out.push(full);
    }
  }
}

function fileNameOk(name: string): boolean {
  if (!name || name.length > 200 || name.includes('\\')) return false;
  const parts = name.split('/');
  return (
    parts.length > 0 &&
    parts.every((part) => part !== '.' && part !== '..' && SEGMENT.test(part))
  );
}

async function prepareArtifact(
  root: string,
  mapPath: string,
): Promise<{ fileName: string; debugId?: string; json: string }> {
  const jsonText = await readFile(mapPath, 'utf8');
  const parsed = parseMap(jsonText);
  const jsPath = mapPath.slice(0, -'.map'.length);
  const sibling = jsPath.endsWith('.js') && jsPath !== mapPath && (await exists(jsPath));
  if (!sibling || !parsed) {
    return {
      fileName: path.basename(mapPath).replace(/\.map$/, ''),
      debugId: debugIdOf(parsed),
      json: jsonText,
    };
  }
  let js = await readFile(jsPath, 'utf8');
  const fromJs = safeDebugId(js.match(DEBUG_COMMENT)?.[1]);
  const fromMap = safeDebugId(debugIdOf(parsed));
  const debugId = fromJs || fromMap || randomUUID();
  if (!fromJs) {
    const body = js.endsWith('\n') ? js : `${js}\n`;
    js = `${body}${debugIdSnippet(debugId)}\n`;
    await writeFile(jsPath, js);
  }
  let json = jsonText;
  if (fromMap !== debugId) {
    parsed.debugId = debugId;
    json = `${JSON.stringify(parsed)}\n`;
    await writeFile(mapPath, json);
  }
  return {
    fileName: path.relative(root, jsPath).split(path.sep).join('/'),
    debugId,
    json,
  };
}

function debugIdSnippet(debugId: string): string {
  return `;try{(function(id){var g=globalThis.__talariaDebugIds||(globalThis.__talariaDebugIds={});function put(url){if(!url)return;g[url]=id;var clean=String(url).split("?")[0].split("#")[0].replace(/:\\d+:\\d+$/,"");g[clean]=id;}try{if(typeof document!=="undefined"&&document.currentScript&&document.currentScript.src)put(document.currentScript.src);}catch(e){}try{var stack=(new Error).stack||"";var matches=stack.match(/https?:\\/\\/[^)\\s]+/g)||[];for(var i=0;i<matches.length;i++)put(matches[i]);}catch(e){}})("${debugId}")}catch(e){}\n//# debugId=${debugId}`;
}

function parseMap(jsonText: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function safeDebugId(value: string | undefined): string | undefined {
  if (!value || !SAFE_DEBUG_ID.test(value)) return undefined;
  return value;
}

function debugIdOf(parsed: Record<string, unknown> | undefined): string | undefined {
  if (!parsed) return undefined;
  const value = parsed.debugId ?? parsed.debug_id;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
