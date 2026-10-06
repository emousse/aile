import { spawn } from 'node:child_process';
import { createServer } from 'vite';
const api = spawn(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', '--watch', 'server/index.ts'], { stdio: 'inherit' });
const vite = await createServer();
await vite.listen(); vite.printUrls();
let stopping = false;
async function stop() { if (stopping) return; stopping = true; api.kill('SIGTERM'); await vite.close(); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
api.once('exit', () => { if (!stopping) void stop(); });
