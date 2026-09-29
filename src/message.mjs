// One Telegram message per role. Plain text, no parse mode: titles come from strangers.
import { codeOf } from './store.mjs';
import { ago, istLabel } from './lib/time.mjs';

const LABEL = {
  greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', smartrecruiters: 'SmartRecruiters', workday: 'Workday',
  workable: 'Workable', recruitee: 'Recruitee', himalayas: 'Himalayas', jobicy: 'Jobicy',
};
const VIA = { himalayas: 'via himalayas.app', jobicy: 'via jobicy.com' }; // both ask to be credited with the link
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// W3: "Posted 29 Sep 09:00 IST (18 min ago)"; day-only sources say "Posted today".
export function postedText(job, nowMs) {
  if (job.postedMs == null) return `Posted: date not stated · first seen ${istLabel(job.firstSeenMs ?? nowMs)}`;
  if (job.dayOnly) {
    const days = job.ageDays ?? Math.floor((nowMs - job.postedMs) / 86400000);
    return days <= 0 ? 'Posted today' : days === 1 ? 'Posted yesterday' : `Posted ${days} days ago`;
  }
  return `Posted ${istLabel(job.postedMs)} (${ago(job.postedMs, nowMs)})`;
}

export function radarMessage(job, nowMs) {
  const meta = [oneLine(job.location), postedText(job, nowMs), job.employment ? oneLine(job.employment) : null, job.pay].filter(Boolean);
  const lines = [`[${oneLine(job.company)} · ${LABEL[job.ats] ?? job.ats}] ${oneLine(job.title)}`, meta.join(' · ')];
  if (job.hourly) lines.push('💰 Hourly / contract');
  if (job.url) lines.push(job.url);
  if (VIA[job.ats]) lines.push(VIA[job.ats]);
  lines.push(`Application kit: /apply_${codeOf(job)}`);
  return lines.join('\n').slice(0, 4096);
}
