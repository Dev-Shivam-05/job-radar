// State lives on this repo's `state` branch, checked out at ./state (a second checkout in Actions).
// Everything in it is public job data: no names, tokens or chat ids.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const stateDir = () => resolve(process.env.RADAR_STATE_DIR || 'state');
const p = (rel) => join(stateDir(), rel);

export function readJson(rel, fallback = null) {
  if (!existsSync(p(rel))) return fallback;
  return JSON.parse(readFileSync(p(rel), 'utf8'));
}

export function writeJson(rel, value) {
  mkdirSync(dirname(p(rel)), { recursive: true });
  writeFileSync(p(rel), `${JSON.stringify(value, null, 1)}\n`);
}

export function readJsonl(rel) {
  if (!existsSync(p(rel))) return [];
  return readFileSync(p(rel), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export function appendJsonl(rel, value) {
  mkdirSync(dirname(p(rel)), { recursive: true });
  appendFileSync(p(rel), `${JSON.stringify(value)}\n`);
}

const git = (args) => execFileSync('git', ['-C', stateDir(), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// RADAR_COMMIT=0 keeps everything uncommitted (tests, local dry runs); RADAR_PUSH=0 commits without pushing.
// The engine appends /company additions to this branch, so a push first rebases onto it.
export function commitState(message) {
  if (process.env.RADAR_COMMIT === '0') return false;
  git(['add', '-A']);
  if (!git(['status', '--porcelain']).trim()) return false;
  git(['commit', '-q', '-m', message]);
  if (process.env.RADAR_PUSH !== '0') pushWithRetry();
  return true;
}

// The messages are already sent when state is pushed, so a lost push means the next run sends the same roles again.
// The usual cause is the engine pushing a /company addition between our pull and our push: pull again and retry.
export const PUSH_ATTEMPTS = 4;
function pushWithRetry() {
  for (let attempt = 1; ; attempt++) {
    try {
      git(['pull', '-q', '--rebase', 'origin', 'state']);
      git(['push', '-q', 'origin', 'HEAD:state']);
      return;
    } catch (err) {
      try {
        git(['rebase', '--abort']);
      } catch {
        /* no rebase in progress */
      }
      if (attempt >= PUSH_ATTEMPTS) throw err;
      // 1, 2, 4 s. A synchronous wait is fine: this runs once, at the very end of a run.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000 * 2 ** (attempt - 1));
    }
  }
}
