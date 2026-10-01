// State on the `state` branch (spec "How the pieces talk"):
//   sources.json            { "<source key>": { first_read, last_read, error, error_at } }
//   seen/<source key>.json  { "<job key>": last-confirmed ISO }, one file per source so a run rewrites only what changed
//   run.json                { started_at } of the last run, so a GitHub fallback run right after one is skipped
//   pending.json            roles held by quiet hours, sent at 07:00 IST if still ≤ 72 h old
//   days/<IST date>.jsonl   every new role that passed the filters: sent / over_limit (the engine reads this for
//                           /apply_<code> and the nightly status line)
//   companies-added.json    { companies: [...] } appended by the engine's /company command
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { appendJsonl, readJson, readJsonl, writeJson } from './lib/state.mjs';
import { DAY_MS } from './lib/time.mjs';

const seed = JSON.parse(readFileSync(new URL('../companies.json', import.meta.url), 'utf8'));

export const SEEN_KEEP_DAYS = 180; // career roles stay listed for months (phase-18 R6)

export const companyKey = (c) => `${c.ats}:${c.slug}`;
// Same hash as the engine's phase-18 radar, so /apply_<code> works for both.
export const codeOf = (job) => createHash('sha1').update(`radar:${job.key}`).digest('hex').slice(0, 6);

export function allCompanies() {
  const added = readJson('companies-added.json', { companies: [] }).companies;
  const byKey = new Map([...seed.companies, ...added].map((c) => [companyKey(c), c]));
  return [...byKey.values()];
}

const seenFile = (sourceKey) => `seen/${sourceKey.replace(/[^A-Za-z0-9._-]+/g, '-')}.json`;

export function loadSeen(sourceKey, nowMs) {
  const all = readJson(seenFile(sourceKey), {});
  return Object.fromEntries(Object.entries(all).filter(([, at]) => nowMs - Date.parse(at) <= SEEN_KEEP_DAYS * DAY_MS));
}
export const saveSeen = (sourceKey, seen) => writeJson(seenFile(sourceKey), seen);

export const loadSources = () => readJson('sources.json', {});
export const saveSources = (s) => writeJson('sources.json', s);
export const loadPending = () => readJson('pending.json', {});
export const savePending = (p) => writeJson('pending.json', p);
export const loadRun = () => readJson('run.json', {});
export const saveRun = (r) => writeJson('run.json', r);

// Company + title, letters and digits only: the same role read from a board and from Himalayas has two keys.
export const roleKey = (job) => `${job.company ?? ''}|${job.title ?? ''}`.toLowerCase().replace(/[^a-z0-9|]+/g, '');

export function appendDay(date, job, status, nowMs) {
  const row = {
    at: new Date(nowMs).toISOString(), key: job.key, company: job.company, ats: job.ats, title: job.title,
    location: job.location, url: job.url, posted_at: job.postedMs ? new Date(job.postedMs).toISOString() : null,
    hourly: Boolean(job.hourly), status, sent: status === 'sent',
  };
  // Workday/Workable give a day, not a time: posted_at is then an estimate, and age_days is what the board said.
  if (job.dayOnly) Object.assign(row, { posted_day_only: true, age_days: job.ageDays ?? null });
  if (row.sent) Object.assign(row, { code: codeOf(job), text: String(job.text ?? '').slice(0, 4000) });
  appendJsonl(`days/${date}.jsonl`, row);
}

export const sentOn = (date) => readJsonl(`days/${date}.jsonl`).filter((r) => r.sent).length;
// roleKey → the sources it was sent from today. One company can list two roles with one title (two cities), so only
// the same title from a different source counts as a duplicate.
export function sentRolesOn(date) {
  const roles = new Map();
  for (const r of readJsonl(`days/${date}.jsonl`).filter((x) => x.sent)) roles.set(roleKey(r), new Set([...(roles.get(roleKey(r)) ?? []), r.ats]));
  return roles;
}
export const isDuplicate = (roles, job) => [...(roles.get(roleKey(job)) ?? [])].some((ats) => ats !== job.ats);
export const addSent = (roles, job) => roles.set(roleKey(job), new Set([...(roles.get(roleKey(job)) ?? []), job.ats]));
