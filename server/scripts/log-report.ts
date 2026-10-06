/**
 * Summarize structured API/worker logs: latency percentiles per route, conflicts, error codes, AI failures, job leases.
 *   node dev logs:   npm run dev:api 2>&1 | tee api.log      (or any file of JSON log lines)
 *   then:            npm run log:report -w @tinker/server -- api.log     (or pipe:  cat api.log | npm run log:report -w @tinker/server)
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { formatSummary, summarize } from '../src/infrastructure/observability/log-report.ts';

const file = process.argv[2];
const input = file ? createReadStream(file, 'utf8') : process.stdin;
const lines: string[] = [];
for await (const line of createInterface({ input })) lines.push(line);
console.log(formatSummary(summarize(lines)));
