// Rules only, no AI (spec W6). R4 location and R5 role are carried over unchanged from the engine's phase 18.
import { HOUR_MS } from './lib/time.mjs';

export const MAX_AGE_HOURS = 72; // W2

const INDIA = /\b(india|bengaluru|bangalore|mumbai|pune|hyderabad|delhi|gurugram|gurgaon|noida|chennai|kolkata|ahmedabad|surat|vadodara|navsari|jaipur|kochi|chandigarh|indore|coimbatore|thiruvananthapuram|anywhere|worldwide|global|apac|asia)\b/i;
const ROLE = /\b(engineer|engineering|developer|sde|software|full[- ]?stack|back[- ]?end|front[- ]?end|ai|ml|llm|automation|forward deployed|solutions?)\b/i;
const SENIOR = /\b(senior|sr|staff|principal|lead|head|director|manager|architect|vp|vice president|chief)\b/i;
const WORK_MODE = /^(remote|hybrid|onsite|on-site|in office|fully remote)$/i;

// W8: what the source says about the type, or what the text says about pay.
const HOURLY_TYPE = /\b(contract|contractor|part[- ]?time|temporary|temp|freelance)\b/i;
const HOURLY_TEXT = /\b(hourly|per hour|freelance|contract role|contract[- ]to[- ]hire|contractual|paid trial|part[- ]time)\b|\/\s?(hr|hour)\b/i;

// A role whose only "place" is Remote (PostHog lists "Remote · Remote · Remote") names no country, so it is kept;
// "Remote (US)" or "Remote - United States" names one and is not.
export function locationOk(job) {
  if (job.locationPending) return true; // Workday "2 Locations": decided after the detail call
  const loc = job.location ?? '';
  if (INDIA.test(loc)) return true;
  const places = loc.split(/[·,|/]/).map((p) => p.trim()).filter((p) => p && !WORK_MODE.test(p));
  return places.length === 0 && /\bremote\b/i.test(loc);
}

export const roleOk = (job) => ROLE.test(job.title ?? '') && !SENIOR.test(job.title ?? '');

// null = kept, else the rule that dropped it.
export function dropReason(job) {
  if (!roleOk(job)) return SENIOR.test(job.title ?? '') ? 'seniority' : 'role';
  if (!locationOk(job)) return 'location';
  return null;
}

// W2: posted ≤ 72 h ago. A source with no date: only roles that appear after its first read are new.
export function isFresh(job, nowMs, firstRead) {
  if (job.postedMs == null) return !firstRead;
  return nowMs - job.postedMs <= MAX_AGE_HOURS * HOUR_MS;
}

export const hourly = (job) => HOURLY_TYPE.test(job.employment ?? '') || HOURLY_TEXT.test(`${job.title}\n${job.text ?? ''}`);
