const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<(p|br|li|div|h\d)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      // One posting with "&#1114112;" must not fail its whole board on every run.
      return code <= 0x10ffff ? String.fromCodePoint(code) : m;
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
