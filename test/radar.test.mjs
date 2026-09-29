import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';

process.env.RADAR_RETRY_SCALE = '0';
process.env.RADAR_COMMIT = '0';

const { dropReason, hourly, isFresh } = await import('../src/filter.mjs');
const boards = await import('../src/sources/boards.mjs');
const { toJob: jobicyJob } = await import('../src/sources/jobicy.mjs');
const { postedText, radarMessage } = await import('../src/message.mjs');
const { runRadar, MAX_SENT_PER_DAY } = await import('../src/run.mjs');
const { codeOf } = await import('../src/store.mjs');

const H = 3600 * 1000;
const T = Date.parse('2026-09-30T03:30:00Z'); // 09:00 IST, outside quiet hours
const c = { name: 'Acme', ats: 'greenhouse', slug: 'acme' };

describe('readers', () => {
  it('Greenhouse uses first_published, never updated_at', () => {
    const [a, b] = boards.fromGreenhouse(c, { jobs: [
      { id: 1, title: 'AI Engineer', location: { name: 'Remote, Bangalore' }, absolute_url: 'u1', first_published: '2026-05-22T10:00:00Z', updated_at: '2026-09-29T10:00:00Z' },
      { id: 2, title: 'AI Engineer', location: { name: 'India' }, absolute_url: 'u2', updated_at: '2026-09-29T10:00:00Z' },
    ] });
    assert.equal(a.postedMs, Date.parse('2026-05-22T10:00:00Z'));
    assert.equal(b.postedMs, null);
    assert.equal(a.key, 'greenhouse:acme:1');
    assert.match(a.detail, /boards\/acme\/jobs\/1$/);
  });

  it('Workday ages are day-only', () => {
    assert.equal(boards.workdayAgeDays('Posted Today'), 0);
    assert.equal(boards.workdayAgeDays('Posted Yesterday'), 1);
    assert.equal(boards.workdayAgeDays('Posted 30+ Days Ago'), 31);
    const [j] = boards.fromWorkday({ name: 'Infobip', ats: 'workday', slug: 'infobip', wd: 'wd3', site: 'InfobipCareers' }, [{ title: 'Solution Engineer', locationsText: 'Mumbai, India', postedOn: 'Posted 2 Days Ago', externalPath: '/job/x' }], T);
    assert.equal(j.dayOnly, true);
    assert.equal(j.postedMs, T - 48 * H);
    assert.equal(postedText(j, T), 'Posted 2 days ago');
  });

  it('Workable dates are day-only; Recruitee times parse', () => {
    const [w] = boards.fromWorkable({ name: 'HF', ats: 'workable', slug: 'huggingface' }, { jobs: [{ title: 'ML Engineer', shortcode: 'AB', country: 'India', telecommuting: true, published_on: '2026-09-29', url: 'w' }] }, T);
    assert.equal(w.dayOnly, true);
    assert.equal(w.ageDays, 1);
    const [r] = boards.fromRecruitee({ name: 'R', ats: 'recruitee', slug: 'r' }, { offers: [{ id: 5, title: 'Backend Developer', location: 'Pune, India', published_at: '2026-09-30 02:00:00 UTC', careers_url: 'r', employment_type_code: 'contract' }] });
    assert.equal(r.postedMs, Date.parse('2026-09-30T02:00:00Z'));
    assert.equal(hourly(r), true);
  });

  it('Jobicy keeps "Anywhere" and drops a country list', () => {
    const any = jobicyJob({ id: 1, jobTitle: 'Full Stack Developer', companyName: 'X', jobGeo: 'Anywhere', url: 'j', pubDate: '2026-09-29T03:35:16+00:00' });
    const usa = jobicyJob({ id: 2, jobTitle: 'Full Stack Developer', companyName: 'X', jobGeo: 'USA', url: 'j' });
    assert.equal(dropReason(any), null);
    assert.equal(dropReason(usa), 'location');
  });
});

describe('rules', () => {
  it('keeps Indian and remote engineering roles, drops senior and non-engineering', () => {
    assert.equal(dropReason({ title: 'Solution Engineering Intern', location: 'Mumbai, India' }), null);
    assert.equal(dropReason({ title: 'Software Engineer', location: 'Remote · Remote' }), null);
    assert.equal(dropReason({ title: 'Senior Frontend Engineer', location: 'Zagreb' }), 'seniority');
    assert.equal(dropReason({ title: 'Sales Executive', location: 'Hyderabad' }), 'role');
    assert.equal(dropReason({ title: 'Backend Engineer', location: 'Remote (US)' }), 'location');
  });

  it('W2: 71 h is fresh, 73 h is not; undated counts only after the first read', () => {
    assert.equal(isFresh({ postedMs: T - 71 * H }, T, true), true);
    assert.equal(isFresh({ postedMs: T - 73 * H }, T, true), false);
    assert.equal(isFresh({ postedMs: null }, T, true), false);
    assert.equal(isFresh({ postedMs: null }, T, false), true);
  });

  it('W8: hourly / contract tag', () => {
    assert.equal(hourly({ title: 'Developer', employment: 'Contract' }), true);
    assert.equal(hourly({ title: 'Developer', employment: 'FullTime', text: 'We pay USD 40/hr' }), true);
    assert.equal(hourly({ title: 'Developer', employment: 'FullTime', text: 'Paid trial of 3 days' }), true);
    assert.equal(hourly({ title: 'Developer', employment: 'FullTime', text: 'Great team' }), false);
  });

  it('W3: the message shows the posted time and how long ago', () => {
    const job = { key: 'ashby:acme:1', company: 'Acme', ats: 'ashby', title: 'AI Engineer', location: 'India', url: 'https://x', postedMs: T - 18 * 60000, employment: 'Contract', hourly: true };
    const text = radarMessage(job, T);
    assert.match(text, /^\[Acme · Ashby\] AI Engineer\nIndia · Posted 30 Sep 08:42 IST \(18 min ago\) · Contract\n💰 Hourly \/ contract\nhttps:\/\/x\nApplication kit: \/apply_[0-9a-f]{6}$/);
    assert.equal(text.split('/apply_')[1], codeOf(job));
  });
});

describe('run', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'radar-'));
    process.env.RADAR_STATE_DIR = dir;
  });
  const role = (id, postedMs, extra = {}) => ({ key: `ashby:acme:${id}`, company: 'Acme', ats: 'ashby', title: 'Software Engineer', location: 'Bengaluru, India', text: '', url: `https://jobs/${id}`, postedMs, dayOnly: false, employment: 'FullTime', ...extra });
  const source = (jobs) => [{ key: 'ashby:acme', host: 'ashby', read: async () => jobs() }];
  const env = { RADAR: 'on' };
  const day = (date) => readFileSync(join(dir, 'days', `${date}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

  it('off means no network at all', async () => {
    const r = await runRadar({ env: {}, sources: [{ key: 'x', host: 'x', read: () => assert.fail('read') }] });
    assert.equal(r.skipped, 'RADAR is not on');
  });

  it('first read sends only roles posted ≤ 72 h ago; a second run with no change sends nothing', async () => {
    const sent = [];
    const jobs = [role(1, T - 60 * 60000), role(2, T - 73 * H), role(3, null)];
    const r = await runRadar({ env, nowMs: T, send: async (m) => sent.push(m), sources: source(() => jobs) });
    assert.equal(r.sent, 1);
    assert.match(sent[0], /jobs\/1/);
    const again = await runRadar({ env, nowMs: T + 20 * 60000, send: async (m) => sent.push(m), sources: source(() => jobs) });
    assert.equal(again.sent, 0);
  });

  it('a role posted at T is sent by the run at T + 20 min', async () => {
    const sent = [];
    const jobs = [];
    await runRadar({ env, nowMs: T, send: async (m) => sent.push(m), sources: source(() => jobs) });
    jobs.push(role(9, T + 1 * 60000));
    const r = await runRadar({ env, nowMs: T + 20 * 60000, send: async (m) => sent.push(m), sources: source(() => jobs) });
    assert.equal(r.sent, 1);
    assert.match(sent[0], /Posted 30 Sep 09:01 IST \(19 min ago\)/);
    assert.equal(day('2026-09-30')[0].status, 'sent');
  });

  it('W7: the 26th role of a day is not sent and is recorded over_limit, newest first', async () => {
    const sent = [];
    const jobs = Array.from({ length: 30 }, (_, i) => role(i, T - (i + 1) * 60000));
    const r = await runRadar({ env, nowMs: T, send: async (m) => sent.push(m), sources: source(() => jobs) });
    assert.equal(r.sent, MAX_SENT_PER_DAY);
    assert.equal(r.over_limit, 5);
    assert.match(sent[0], /jobs\/0\n/);
    const rows = day('2026-09-30');
    assert.equal(rows.filter((x) => x.status === 'over_limit').length, 5);
    assert.ok(rows.filter((x) => x.sent).every((x) => /^[0-9a-f]{6}$/.test(x.code)));
  });

  it('quiet hours hold roles until 07:00 IST', async () => {
    const night = Date.parse('2026-09-29T19:00:00Z'); // 00:30 IST
    const sent = [];
    const r = await runRadar({ env, nowMs: night, send: async (m) => sent.push(m), sources: source(() => [role(1, night - H)]) });
    assert.equal(r.held, 1);
    assert.equal(sent.length, 0);
    const morning = Date.parse('2026-09-30T01:40:00Z'); // 07:10 IST
    const m = await runRadar({ env, nowMs: morning, send: async (x) => sent.push(x), sources: source(() => [role(1, night - H)]) });
    assert.equal(m.sent, 1);
  });

  it('a failing board does not stop the others', async () => {
    const sent = [];
    const r = await runRadar({
      env, nowMs: T, send: async (m) => sent.push(m),
      sources: [{ key: 'bad', host: 'a', read: async () => { throw new Error('HTTP 404'); } }, ...source(() => [role(1, T - H)])],
    });
    assert.equal(r.read, 1);
    assert.equal(r.errors.length, 1);
    assert.equal(r.sent, 1);
  });

  it('a source with `every` is skipped until it is due', async () => {
    let reads = 0;
    const s = [{ key: 'jobicy', host: 'jobicy', every: H, read: async () => { reads++; return []; } }];
    await runRadar({ env, nowMs: T, send: async () => {}, sources: s });
    await runRadar({ env, nowMs: T + 20 * 60000, send: async () => {}, sources: s });
    await runRadar({ env, nowMs: T + 60 * 60000, send: async () => {}, sources: s });
    assert.equal(reads, 2);
  });
});

it('W5: nothing in src/ reads Telegram updates', () => {
  const files = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));
  for (const f of files(new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /['"`/]getUpdates/, f);
  }
});
