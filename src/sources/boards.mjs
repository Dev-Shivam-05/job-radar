// Company career boards through their public, keyless job-board APIs (spec W1). Each reader returns jobs:
// { key, company, ats, title, location, text, url, postedMs (null = unknown), dayOnly, employment, detail? }.
// The key shape `<ats>:<slug>:<id>` matches the engine's phase-18 radar, so /apply_<code> codes stay the same.
import { htmlToText } from '../lib/html.mjs';
import { DAY_MS } from '../lib/time.mjs';

export const WORKDAY_PAGE = 20;
export const WORKDAY_MAX_PAGES = 10;

const ms = (iso) => (iso ? Date.parse(iso) || null : null);
const job = (c, id, fields) => ({ key: `${c.ats}:${c.slug}:${id}`, company: c.name, ats: c.ats, dayOnly: false, ...fields });

export function boardUrl(c) {
  switch (c.ats) {
    // No `content=true`: descriptions of every role on every run would be megabytes. `enrich` reads the few new ones.
    case 'greenhouse': return `https://boards-api.greenhouse.io/v1/boards/${c.slug}/jobs`;
    case 'lever': return `https://api.lever.co/v0/postings/${c.slug}?mode=json`;
    case 'ashby': return `https://api.ashbyhq.com/posting-api/job-board/${c.slug}`;
    case 'smartrecruiters': return `https://api.smartrecruiters.com/v1/companies/${c.slug}/postings?limit=100`;
    case 'workday': return `https://${c.slug}.${c.wd}.myworkdayjobs.com/wday/cxs/${c.slug}/${c.site}/jobs`;
    case 'workable': return `https://apply.workable.com/api/v1/widget/accounts/${c.slug}`;
    case 'recruitee': return `https://${c.slug}.recruitee.com/api/offers/`;
    default: throw new Error(`unknown ATS ${c.ats}`);
  }
}

// `first_published` only: Greenhouse bumps `updated_at` on old roles (GitLab's May 2026 role said updated today).
export const fromGreenhouse = (c, body) => (body?.jobs ?? []).map((j) => job(c, j.id, {
  title: j.title ?? '', location: j.location?.name ?? '', text: '', url: j.absolute_url,
  postedMs: ms(j.first_published), employment: null,
  detail: `https://boards-api.greenhouse.io/v1/boards/${c.slug}/jobs/${j.id}`,
}));

export const fromLever = (c, body) => (Array.isArray(body) ? body : []).map((j) => job(c, j.id, {
  title: j.text ?? '', location: [j.categories?.location, ...(j.categories?.allLocations ?? []), j.workplaceType].filter(Boolean).join(' · '),
  text: [j.descriptionPlain, ...(j.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`), j.additionalPlain].filter(Boolean).join('\n'),
  url: j.hostedUrl, postedMs: j.createdAt ?? null, employment: j.categories?.commitment ?? null,
}));

export const fromAshby = (c, body) => (body?.jobs ?? []).filter((j) => j.isListed !== false).map((j) => job(c, j.id, {
  title: j.title ?? '', location: [j.location, ...(j.secondaryLocations ?? []).map((l) => l.location), j.isRemote ? 'Remote' : null, j.workplaceType].filter(Boolean).join(' · '),
  text: j.descriptionPlain ?? htmlToText(j.descriptionHtml ?? ''), url: j.jobUrl, postedMs: ms(j.publishedAt), employment: j.employmentType ?? null,
}));

export const fromSmartRecruiters = (c, body) => (body?.content ?? []).map((j) => job(c, j.id, {
  title: j.name ?? '', location: [j.location?.fullLocation ?? [j.location?.city, j.location?.country].filter(Boolean).join(', '), j.location?.remote ? 'Remote' : null].filter(Boolean).join(' · '),
  text: '', url: `https://jobs.smartrecruiters.com/${c.slug}/${j.id}`, postedMs: ms(j.releasedDate), employment: j.typeOfEmployment?.label ?? null, detail: j.ref ?? null,
}));

// Workable gives a date without a time ("2026-07-30"), so it is a day-only source like Workday (W3).
export const fromWorkable = (c, body, nowMs) => (body?.jobs ?? []).map((j) => {
  const day = ms(j.published_on ?? j.created_at);
  return job(c, j.shortcode, {
    title: j.title ?? '', location: [j.city, j.state, j.country, ...(j.locations ?? []).map((l) => l.country), j.telecommuting ? 'Remote' : null].filter(Boolean).join(' · '),
    text: '', url: j.url ?? j.shortlink, postedMs: day, earliestMs: day, dayOnly: day != null, ageDays: day == null ? null : Math.max(0, Math.floor((nowMs - day) / DAY_MS)),
    employment: j.employment_type ?? null,
  });
});

// Recruitee writes times as "2025-01-02 14:22:42 UTC".
const recruiteeMs = (s) => (s ? ms(String(s).replace(' UTC', 'Z').replace(' ', 'T')) : null);
export const fromRecruitee = (c, body) => (body?.offers ?? []).filter((j) => (j.status ?? 'published') === 'published').map((j) => job(c, j.id, {
  title: j.title ?? '', location: [j.location, ...(j.locations ?? []).map((l) => [l.city, l.country].filter(Boolean).join(', ')), j.remote ? 'Remote' : null].filter(Boolean).join(' · '),
  text: htmlToText(`${j.description ?? ''}\n${j.requirements ?? ''}`), url: j.careers_url, postedMs: recruiteeMs(j.published_at ?? j.created_at),
  employment: j.employment_type_code ?? null,
}));

// Workday says "Posted Today", "Posted Yesterday", "Posted 6 Days Ago" or "Posted 30+ Days Ago".
export function workdayAgeDays(text) {
  const s = String(text ?? '');
  if (/today/i.test(s)) return 0;
  if (/yesterday/i.test(s)) return 1;
  const n = s.match(/(\d+)\+?\s*days?\s*ago/i);
  if (!n) return null;
  return /\+/.test(s) ? Number(n[1]) + 1 : Number(n[1]);
}

// Workday gives days, not times: postedMs is "now minus N days" and the message says "Posted today" (W3).
export const fromWorkday = (c, postings, nowMs) => postings.map((j) => {
  const age = workdayAgeDays(j.postedOn);
  // "2 Locations" names no place; the detail call fills it in, and the location rule runs again then.
  const several = /^\d+ locations?$/i.test(j.locationsText ?? '');
  return job(c, j.externalPath, {
    title: j.title ?? '', location: several ? '' : (j.locationsText ?? ''), locationPending: several, text: '',
    url: `https://${c.slug}.${c.wd}.myworkdayjobs.com/en-US/${c.site}${j.externalPath}`,
    // "Posted 2 Days Ago" can be up to 3 days old, so the 72 h rule is judged on the earliest it can have been posted.
    postedMs: age == null ? null : nowMs - age * DAY_MS, earliestMs: age == null ? null : nowMs - (age + 1) * DAY_MS,
    dayOnly: age != null, ageDays: age, employment: null,
    detail: `https://${c.slug}.${c.wd}.myworkdayjobs.com/wday/cxs/${c.slug}/${c.site}${j.externalPath}`,
  });
});

export async function readBoard(c, { get, nowMs, pause }) {
  const url = boardUrl(c);
  if (c.ats !== 'workday') {
    const { body } = await get(c.ats, url, {}, { delays: [] });
    return { greenhouse: fromGreenhouse, lever: fromLever, ashby: fromAshby, smartrecruiters: fromSmartRecruiters, workable: fromWorkable, recruitee: fromRecruitee }[c.ats](c, body, nowMs);
  }
  const postings = [];
  let total = 0; // Workday sends the total on the first page only; later pages say 0.
  for (let page = 0; page < WORKDAY_MAX_PAGES; page++) {
    if (page > 0) await pause();
    const { body } = await get('workday', url, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: WORKDAY_PAGE, offset: page * WORKDAY_PAGE, searchText: '' }),
    }, { delays: [] });
    const rows = body?.jobPostings ?? [];
    postings.push(...rows);
    if (page === 0) total = body?.total ?? 0;
    if (rows.length < WORKDAY_PAGE || postings.length >= total) break;
  }
  return fromWorkday(c, postings, nowMs);
}

// The description, for the hourly tag (W8) and the /apply kit. Only for new roles that passed the filters.
export async function enrich(j, { get }) {
  if (!j.detail) return j;
  const { body } = await get(`${j.ats} detail`, j.detail, { headers: { accept: 'application/json' } }, { delays: [] });
  let text = '';
  if (j.ats === 'workday') text = htmlToText(body?.jobPostingInfo?.jobDescription ?? '');
  else if (j.ats === 'greenhouse') text = htmlToText(htmlToText(body?.content ?? '')); // escaped HTML: decode twice
  else text = Object.values(body?.jobAd?.sections ?? {}).map((s) => `${s.title ?? ''}\n${htmlToText(s.text ?? '')}`).join('\n');
  const out = { ...j, text: text || j.text, employment: j.employment ?? body?.jobPostingInfo?.timeType ?? null };
  if (j.locationPending) {
    const info = body?.jobPostingInfo ?? {};
    out.location = [info.location, ...(info.additionalLocations ?? [])].filter(Boolean).join(' · ');
    out.locationPending = false;
  }
  return out;
}
