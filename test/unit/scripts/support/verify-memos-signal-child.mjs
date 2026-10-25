/** Standalone real-signal seam; no Vitest module mocks cross this boundary. */
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { CASES } from '../../../../scripts/verify-memos.mjs';

const [tmpRoot, mode, keep] = process.argv.slice(2);
const repoRoot = join(tmpRoot, 'repo');
const fixture = join(repoRoot, 'test/verification/memos/fixture');
const prompt = id => `tests/ambercast/${id}.test.md`;
const plan = id => `tests/ambercast/${id}.ambercast.plan.json`;
const grounding = id => `tests/ambercast/${id}.ambercast.grounding.json`;
const publishedFiles = ['ambercast.config.json', ...CASES.map(c => plan(c.id)), ...CASES.map(c => grounding(c.id))];
const config = { targets: {
  memos: { baseUrl: 'http://127.0.0.1:5230', locale: 'en-US' },
  'memos-readonly': { baseUrl: 'http://127.0.0.1:5230', locale: 'en-US', healReplayIsolation: 'idempotent' },
  'memos-ja': { baseUrl: 'http://127.0.0.1:5230', locale: 'ja-JP' },
}, secrets: { allow: ['password'] } };
const generatedConfig = { ...config, generated: 'config' };
const containers = new Set();
let removals = 0;
function write(path, text) {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, text);
}
write(join(fixture, 'ambercast.config.json'), JSON.stringify(config));
for (const c of CASES) {
  write(join(fixture, prompt(c.id)), '');
  write(join(fixture, plan(c.id)), '{"seed":"plan"}\n');
  write(join(fixture, grounding(c.id)), '{"seed":"grounding"}\n');
}
const manifest = join(repoRoot, 'pack-manifest.json');
write(manifest, JSON.stringify({ sha: '0123456789abcdef'.repeat(4), dirty: false }));

const rename = fs.renameSync;
let publicationCount = 0;
const published = [];
fs.renameSync = (source, destination) => {
  const file = publishedFiles.find(name => destination === join(fixture, name));
  if (file) {
    publicationCount++;
    if (mode === 'external' && publicationCount === 1) {
      // The acknowledgement proves the parent's real signal was sent while
      // JavaScript still owns the synchronous publication critical section.
      fs.writeSync(1, 'PUBLISH_START\n');
      const deadline = performance.now() + 5000;
      while (!fs.existsSync(join(tmpRoot, 'signal-sent'))) {
        if (performance.now() > deadline) throw new Error('signal handshake timed out');
      }
    }
    if (mode === 'poll' && publicationCount === publishedFiles.length) {
      // Real delivery goes through libuv's signal watcher after this synchronous
      // section. Starting publication in the poll phase leaves delivery pending
      // past the first check phase, requiring a second yield before cleanup policy.
      process.kill(process.pid, 'SIGINT');
      fs.writeSync(1, 'RAISED\n');
    }
  }
  const result = rename(source, destination);
  if (file) published.push(file);
  return result;
};
syncBuiltinESMExports();
// Synchronizing the shared builtin makes main see this exact seam.
const { main } = await import('../../../../scripts/verify-memos.mjs');
const result = (stdout = '') => ({ status: 0, stdout, stderr: '', signal: null, termination: 'none', pgid: process.pid });
let sequence = 0;
const deps = {
  repoRoot, tmpRoot, uid: process.getuid?.(), gid: process.getgid?.(),
  stdout: process.stdout, stderr: process.stderr,
  randomBytes(size) { const bytes = Buffer.alloc(size, 0xab); if (size !== 16) bytes.writeUInt32BE(++sequence); return bytes; },
  clock: { now: () => 0, sleep: async () => {} },
  assertPortFree: async () => {}, readPlaywrightVersion: () => '1.62.1',
  runner: {
    checkDaemon: async () => {}, hasImage: async () => true,
    listContainers: async () => [...containers],
    startContainer: async spec => { containers.add(spec.name); },
    removeContainer: async name => { removals++; containers.delete(name); },
    isRunning: async name => containers.has(name),
    inspectEnv: async () => ['MEMOS_RATE_LIMIT=false'],
  },
  fetch: async url => ({ status: 200, ok: true, json: async () => url.endsWith('/profile') ? { needsSetup: true }
    : url.endsWith('/signin') ? { accessToken: 'token' } : {} }),
  async runProcess(command, args, opts) {
    if (args.includes('pack')) return result(`manifest: ${manifest}\n`);
    if (args.includes('generate')) {
      write(join(opts.cwd, 'ambercast.config.json'), JSON.stringify(generatedConfig));
      for (const c of CASES.filter(c => args.includes(prompt(c.id)))) {
        const generatedPlan = c.target === 'memos-readonly'
          ? JSON.stringify({ targets: { 'memos-readonly': {} }, steps: [
            { id: 'username', kind: 'action', action: 'fill', target: c.target, value: 'verifier' },
            { id: 'password', kind: 'action', action: 'fill-secret', target: c.target, secretRef: '{{secrets.password}}' },
            { id: 'confirmed', kind: 'assert', check: 'text-visible', target: c.target, confirms: ['username', 'password'] },
          ] }) + '\n' : JSON.stringify({ generated: 'plan', steps: [] }) + '\n';
        write(join(opts.cwd, plan(c.id)), generatedPlan);
        write(join(opts.cwd, grounding(c.id)), '{"generated":"grounding"}\n');
      }
    }
    if (args.includes('run')) {
      const runId = args.includes('--resolve') ? 'resolve-run' : 'replay-run';
      const text = JSON.stringify({ runId, results: CASES.filter(c => args.includes(prompt(c.id))).map(c => ({ id: c.id, file: prompt(c.id), steps: [], status: 'passed', aiCalls: 0 })), errors: [] });
      write(join(opts.cwd, 'tests/ambercast/.runs', runId, 'report.json'), text);
      return result(text);
    }
    return result();
  },
};
// Start in an I/O callback so publication continues from the poll phase, as it
// does after a real child exits. A top-level start can deliver SIGINT before
// the first check phase and would incorrectly accept a one-turn yield.
fs.readFile(new URL(import.meta.url), async error => {
  if (error) throw error;
  process.exitCode = await main(['--regenerate', ...(keep === 'keep' ? ['--keep'] : [])], process.platform, deps);
  fs.writeSync(1, `FINAL_STATE ${JSON.stringify({ containers: [...containers], removals, publishedFiles: published,
    runRoots: fs.readdirSync(tmpRoot).filter(name => name.startsWith('ambercast-verify-memos-')) })}\n`);
});
