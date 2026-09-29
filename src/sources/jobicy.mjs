// Jobicy remote developer jobs. Its terms: "Automated checks must not run more frequently than once per hour", and
// credit Jobicy with a direct link (the message carries the Jobicy job URL and "via jobicy.com").
import { htmlToText } from '../lib/html.mjs';

const API = 'https://jobicy.com/api/v2/remote-jobs?count=50&industry=dev';

export const toJob = (j) => ({
  key: `jobicy:${j.id}`,
  company: j.companyName ?? 'Unknown company',
  ats: 'jobicy',
  dayOnly: false,
  title: j.jobTitle ?? '',
  // "Anywhere" passes R4; a country list (USA, EMEA, …) does not.
  location: `Remote · ${j.jobGeo ?? 'not stated'}`,
  text: htmlToText(j.jobDescription ?? j.jobExcerpt ?? ''),
  url: j.url,
  postedMs: j.pubDate ? Date.parse(j.pubDate) || null : null,
  employment: Array.isArray(j.jobType) ? j.jobType.join(', ') : (j.jobType ?? null),
});

export async function readJobicy({ get }) {
  const { body } = await get('jobicy', API, {}, { delays: [] });
  return (body?.jobs ?? []).map(toJob);
}
