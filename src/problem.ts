export interface HttpResult {
  status: number;
  body: string;
  requestId: string | null;
}

interface ProblemBody {
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
  requestId?: string;
  cell?: string;
  url?: string;
}

function asProblem(value: unknown): ProblemBody | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const problem: ProblemBody = {};
  if (typeof record.title === 'string') problem.title = record.title;
  if (typeof record.status === 'number') problem.status = record.status;
  if (typeof record.detail === 'string') problem.detail = record.detail;
  if (typeof record.code === 'string') problem.code = record.code;
  if (typeof record.requestId === 'string') problem.requestId = record.requestId;
  if (typeof record.cell === 'string') problem.cell = record.cell;
  if (typeof record.url === 'string') problem.url = record.url;
  if (!problem.code && !problem.detail && !problem.title) return undefined;
  return problem;
}

/** Format an RFC 9457 problem+json error. The key is never included. */
export function describeProblem(result: HttpResult): string {
  let problem: ProblemBody | undefined;
  try {
    problem = asProblem(JSON.parse(result.body));
  } catch {
    problem = undefined;
  }
  const status = problem?.status ?? result.status;
  const code = problem?.code;
  const detail = problem?.detail || problem?.title;
  const requestId = problem?.requestId || result.requestId || '';
  const parts = [`HTTP ${status}`];
  if (code) parts.push(code);
  const head = parts.join(' ');
  const extra: string[] = [];
  if (detail) extra.push(detail);
  if (problem?.cell) extra.push(`cell ${problem.cell}`);
  if (problem?.url) extra.push(problem.url);
  if (requestId) extra.push(`requestId ${requestId}`);
  if (!problem) {
    const snippet = result.body.trim().replace(/\s+/g, ' ').slice(0, 200);
    if (snippet) extra.push(snippet);
  }
  return extra.length ? `${head}: ${extra.join('; ')}` : head;
}
