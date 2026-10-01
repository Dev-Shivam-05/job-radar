// One radar run (docs in README.md; spec: the engine repo's docs/spec/radar-wide.md, phase 19).
// Read every due source → rules → new and posted ≤ 72 h → Telegram, at most 25 a day, newest first.
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dropReason, hourly, isFresh } from './filter.mjs';
import { requestJson } from './lib/http.mjs';
import { commitState } from './lib/state.mjs';
import { DAY_MS, HOUR_MS, ist, now } from './lib/time.mjs';
import { radarMessage } from './message.mjs';
import { enrich, readBoard } from './sources/boards.mjs';
import { readHimalayas } from './sources/himalayas.mjs';
import { readJobicy } from './sources/jobicy.mjs';
import {
  SEEN_KEEP_DAYS, addSent, allCompanies, appendDay, companyKey, isDuplicate, loadPending, loadRun, loadSeen, loadSources,
  savePending, saveRun, saveSeen, saveSources, sentOn, sentRolesOn,
} from './store.mjs';
import { sendMessage } from './telegram.mjs';

export const MAX_SENT_PER_DAY = 25; // W7
export const PAUSE_MS = 1000; // phase-18 R3: 1 s between requests to the same host
const SEND_PAUSE_MS = 1100; // Telegram allows about one message a second to one chat
const QUIET_FROM = 23 * 60; // phase-18 R9, same hours as the freelance desk
const QUIET_UNTIL = 7 * 60;
export const isQuiet = (t) => t.minutes >= QUIET_FROM || t.minutes < QUIET_UNTIL;
// A run starts every 20 min; a source due "every hour" must not slip to 80 min because a run started 1 min early.
const SLACK_MS = 5 * 60 * 1000;
const RUN_EVERY_MS = 20 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms * Number(process.env.RADAR_RETRY_SCALE ?? 1)));

// Requests to one host go one after another; different hosts run side by side (W1 needs 300 boards in minutes).
function hostOf(c) {
  if (c.ats === 'workday') return `${c.slug}.${c.wd}.myworkdayjobs.com`;
  if (c.ats === 'recruitee') return `${c.slug}.recruitee.com`;
  return c.ats;
}

export function sourceList() {
  return [
    ...allCompanies().map((c) => ({ key: companyKey(c), host: hostOf(c), read: (ctx) => readBoard(c, ctx) })),
    // Himalayas refreshes its API data once a day; Jobicy's terms allow one automated check an hour.
    { key: 'himalayas', host: 'himalayas', every: DAY_MS, read: readHimalayas },
    { key: 'jobicy', host: 'jobicy', every: HOUR_MS, read: readJobicy },
  ];
}

export async function runRadar({ get = requestJson, env = process.env, send = sendMessage, nowMs = now().getTime(), sources = sourceList() } = {}) {
  if (env.RADAR !== 'on') return { skipped: 'RADAR is not on' }; // before any network call
  // GitHub's `schedule` is only a fallback for the cron-job.org dispatches: it runs when they have stopped, not as a
  // second full read of 300 boards right after one.
  const lastRun = loadRun().started_at;
  if (env.GITHUB_EVENT_NAME === 'schedule' && lastRun && nowMs - Date.parse(lastRun) < RUN_EVERY_MS - SLACK_MS) {
    return { skipped: `fallback run, last run started ${lastRun}` };
  }
  saveRun({ started_at: new Date(nowMs).toISOString() });
  const startedMs = Date.now();
  const t = ist(new Date(nowMs));
  const state = loadSources();
  const nowIso = new Date(nowMs).toISOString();
  const pause = () => sleep(PAUSE_MS);
  const out = { date: t.date, read: 0, errors: [], kept: 0, fresh: 0, sent: 0, over_limit: 0, held: 0, expired: 0, send_error: null };
  const fresh = [];

  const due = sources.filter((s) => !s.every || !state[s.key]?.last_read || nowMs - Date.parse(state[s.key].last_read) >= s.every - SLACK_MS);
  const lanes = new Map();
  for (const s of due) lanes.set(s.host, [...(lanes.get(s.host) ?? []), s]);

  const take = (s, jobs) => {
    const firstRead = !state[s.key]?.first_read;
    const seen = loadSeen(s.key, nowMs);
    for (const job of jobs) {
      if (dropReason(job)) continue;
      out.kept++;
      if (seen[job.key]) {
        // A role still listed must not age out of `seen` and come back as new (undated roles have no 72 h rule).
        // Refreshed only at half the keep time, so a run does not rewrite every seen file.
        if (nowMs - Date.parse(seen[job.key]) > (SEEN_KEEP_DAYS * DAY_MS) / 2) seen[job.key] = nowIso;
        continue;
      }
      seen[job.key] = nowIso;
      if (isFresh(job, nowMs, firstRead)) fresh.push({ ...job, firstSeenMs: nowMs });
    }
    saveSeen(s.key, seen);
  };

  await Promise.all([...lanes.values()].map(async (list) => {
    for (const [i, s] of list.entries()) {
      if (i > 0) await pause();
      try {
        take(s, await s.read({ get, nowMs, pause }));
        state[s.key] = { first_read: state[s.key]?.first_read ?? nowIso, last_read: nowIso, error: null };
        out.read++;
      } catch (err) {
        // A failing board is tried again next run; its first read is not marked until it succeeds. last_read stays as
        // it was, or one 429 from Himalayas (read once a day) would skip it for a whole day.
        state[s.key] = { ...state[s.key], error_at: nowIso, error: err.message.slice(0, 200) };
        out.errors.push(`${s.key}: ${err.message.slice(0, 160)}`);
      }
    }
  }));
  out.fresh = fresh.length;

  // Descriptions for the new roles whose list had none (Greenhouse, SmartRecruiters, Workday): the hourly tag and the
  // /apply kit need them. Few per run, so one after another.
  for (const [i, job] of fresh.entries()) {
    if (job.detail) {
      try {
        fresh[i] = await enrich(job, { get });
      } catch {
        /* title, location and link still go out */
      }
      await pause();
    }
    fresh[i].hourly = hourly(fresh[i]) || Boolean(fresh[i].hourlyPay);
    delete fresh[i].detail;
  }
  // A Workday role listed as "2 Locations" is kept only if its real locations pass (or could not be read).
  for (let i = fresh.length - 1; i >= 0; i--) {
    if (fresh[i].locationPending) fresh[i].location = 'Several locations';
    else if (dropReason(fresh[i])) fresh.splice(i, 1);
  }

  const pending = loadPending();
  for (const job of fresh) pending[job.key] = job;
  for (const [key, job] of Object.entries(pending)) {
    // An undated role ages from when it was first seen.
    if (!isFresh({ postedMs: job.postedMs ?? job.firstSeenMs, earliestMs: job.earliestMs }, nowMs, false)) {
      delete pending[key];
      out.expired++;
    }
  }

  if (isQuiet(t)) {
    out.held = Object.keys(pending).length;
  } else {
    // A day-only "Posted today" is stamped with the read time; placing it mid-day keeps it from outranking a role
    // posted 10 minutes ago with an exact time.
    const newest = (j) => (j.postedMs ?? j.firstSeenMs) - (j.dayOnly ? 12 * HOUR_MS : 0);
    const queue = Object.values(pending).sort((a, b) => newest(b) - newest(a));
    let room = MAX_SENT_PER_DAY - sentOn(t.date);
    // The same role on a company board and on Himalayas or Jobicy has two keys; send it once a day.
    const sentRoles = sentRolesOn(t.date);
    for (const job of queue) {
      if (isDuplicate(sentRoles, job)) {
        delete pending[job.key];
        out.duplicate = (out.duplicate ?? 0) + 1;
        continue;
      }
      if (room <= 0) {
        appendDay(t.date, job, 'over_limit', nowMs);
        delete pending[job.key];
        out.over_limit++;
        continue;
      }
      try {
        if (out.sent > 0) await sleep(SEND_PAUSE_MS);
        await send(radarMessage(job, nowMs));
      } catch (err) {
        out.send_error = err.message.slice(0, 200); // the rest stay pending for the next run
        break;
      }
      appendDay(t.date, job, 'sent', nowMs);
      addSent(sentRoles, job);
      delete pending[job.key];
      out.sent++;
      room--;
    }
  }

  savePending(pending);
  saveSources(state);
  out.seconds = Math.round((Date.now() - startedMs) / 1000);
  commitState(`radar: ${t.date} ${String(Math.floor(t.minutes / 60)).padStart(2, '0')}:${String(t.minutes % 60).padStart(2, '0')} IST — ${out.fresh} new, ${out.sent} sent`);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  runRadar()
    .then((r) => {
      if (r.skipped) return console.log(`radar: ${r.skipped}`);
      const { errors, ...summary } = r;
      console.log(`radar ${JSON.stringify(summary)} · ${errors.length} errors`);
      for (const e of errors) console.log(`  error ${e}`);
      // One broken board must not fail the run every 20 minutes; nothing read at all does.
      if (r.read === 0 && errors.length) process.exit(1);
      if (r.send_error) process.exit(1);
    })
    .catch((err) => {
      console.error(`radar failed: ${err.message}`);
      process.exit(1);
    });
}
