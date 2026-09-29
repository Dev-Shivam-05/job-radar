const IST_OFFSET_MS = 5.5 * 3600 * 1000;
export const HOUR_MS = 3600 * 1000;
export const DAY_MS = 24 * HOUR_MS;

// RADAR_NOW lets tests replay any moment (ISO string, UTC).
export const now = () => (process.env.RADAR_NOW ? new Date(process.env.RADAR_NOW) : new Date());

export function ist(d = now()) {
  const t = new Date(d.getTime() + IST_OFFSET_MS);
  return { date: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "29 Sep 09:00 IST"
export function istLabel(ms) {
  const t = new Date(ms + IST_OFFSET_MS);
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${hh}:${mm} IST`;
}

// "18 min ago", "5 h ago", "3 days ago"
export function ago(ms, nowMs) {
  const d = Math.max(0, nowMs - ms);
  if (d < HOUR_MS) return `${Math.floor(d / 60000)} min ago`;
  if (d < 2 * DAY_MS) return `${Math.floor(d / HOUR_MS)} h ago`;
  return `${Math.floor(d / DAY_MS)} days ago`;
}
