// Run a command with extra environment variables, on every operating system (inline `VAR=x cmd` does not work in Windows shells):
//   node scripts/with-env.mjs AUTH_MODE=dev DATABASE_URL=postgres://... -- tsx watch src/main.ts
// Variables set here win over the .env file (an environment variable that already exists is never overwritten by --env-file).
import { spawn } from 'node:child_process';

const split = process.argv.indexOf('--');
if (split < 0 || split === process.argv.length - 1) {
  console.error('usage: with-env.mjs KEY=value ... -- command [args]');
  process.exit(2);
}
const env = { ...process.env };
for (const pair of process.argv.slice(2, split)) {
  const at = pair.indexOf('=');
  env[pair.slice(0, at)] = pair.slice(at + 1);
}
const [command, ...args] = process.argv.slice(split + 1);
const child = spawn(command, args, { env, stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
