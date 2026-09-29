// Himalayas remote jobs open to India, full-time and intern (the engine's phase-18 R2 queries). Himalayas says its
// API data refreshes once every 24 hours, so this source is read once per UTC day, not every 20 minutes.
import { htmlToText } from '../lib/html.mjs';

const API = 'https://himalayas.app/jobs/api/search';
export const QUERIES = [
  ['AI engineer', 'Full Time'], ['full stack', 'Full Time'], ['Node.js', 'Full Time'], ['React', 'Full Time'], ['LLM', 'Full Time'],
  ['software', 'Intern'],
];
const PERIOD = { hourly: '/h', weekly: '/week', fortnightly: '/fortnight', monthly: '/month', annual: '/year' };

export const openToIndia = (j) => !j.locationRestrictions?.length || j.locationRestrictions.includes('India');

export function payText(j) {
  const [min, max] = [j.minSalary, j.maxSalary];
  if (min == null && max == null) return null;
  const range = min != null && max != null && min !== max ? `${min}–${max}` : String(max ?? min);
  return `${j.currency ?? 'USD'} ${range}${PERIOD[j.salaryPeriod] ?? ''}`;
}

export const toJob = (j) => ({
  key: `himalayas:${j.guid}`,
  company: j.companyName ?? 'Unknown company',
  ats: 'himalayas',
  dayOnly: false,
  title: j.title ?? '',
  location: `Remote · ${j.locationRestrictions?.length ? j.locationRestrictions.join(', ') : 'worldwide'}`,
  text: htmlToText(j.description ?? j.excerpt ?? ''),
  url: j.applicationLink ?? j.guid,
  postedMs: j.pubDate ? j.pubDate * 1000 : null,
  employment: j.employmentType ?? null,
  pay: payText(j),
  hourlyPay: j.salaryPeriod === 'hourly',
});

export async function readHimalayas({ get, pause }) {
  const jobs = new Map();
  for (const [i, [q, type]] of QUERIES.entries()) {
    if (i > 0) await pause();
    const { body } = await get('himalayas', `${API}?q=${encodeURIComponent(q)}&employment_type=${encodeURIComponent(type)}&sort=recent`, {}, { delays: [] });
    for (const j of body?.jobs ?? []) if (openToIndia(j)) jobs.set(String(j.guid), toJob(j));
  }
  return [...jobs.values()];
}
