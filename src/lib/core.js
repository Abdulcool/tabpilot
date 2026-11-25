// Pure, browser-agnostic logic. Kept free of `chrome.*` so it can be unit tested in Node.

export const GROUP_COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

const RESTORABLE_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'ftp:']);

export function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function domainOf(url) {
  const parsed = parseUrl(url);
  if (!parsed || !parsed.hostname) return null;
  return parsed.hostname.toLowerCase().replace(/^www\./, '');
}

export function normalizeUrl(url, { ignoreHash = true } = {}) {
  const parsed = parseUrl(url);
  if (!parsed) return url;
  if (ignoreHash) parsed.hash = '';
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  const out = parsed.toString();
  return parsed.pathname === '/' && !parsed.search && !parsed.hash ? out.slice(0, -1) : out;
}

// Returns ids of tabs to close so each URL stays open exactly once.
// The survivor is the active tab if there is one, then a pinned tab, then the leftmost.
export function findDuplicates(tabs, options) {
  const buckets = new Map();
  for (const tab of tabs) {
    if (!tab.url) continue;
    const key = normalizeUrl(tab.url, options);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(tab);
  }
  const toClose = [];
  for (const group of buckets.values()) {
    if (group.length < 2) continue;
    const ranked = [...group].sort(
      (a, b) =>
        Number(Boolean(b.active)) - Number(Boolean(a.active)) ||
        Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
        (a.windowId ?? 0) - (b.windowId ?? 0) ||
        (a.index ?? 0) - (b.index ?? 0),
    );
    toClose.push(...ranked.slice(1).map((t) => t.id));
  }
  return toClose;
}

export function colorForDomain(domain) {
  let hash = 0;
  for (const ch of domain) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return GROUP_COLORS[hash % GROUP_COLORS.length];
}

// Groups unpinned web tabs by site. Only sites with at least `minSize` tabs get a group.
export function groupByDomain(tabs, { minSize = 2 } = {}) {
  const byDomain = new Map();
  for (const tab of tabs) {
    if (tab.pinned) continue;
    const parsed = parseUrl(tab.url);
    if (!parsed || !/^https?:$/.test(parsed.protocol)) continue;
    const domain = domainOf(tab.url);
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(tab.id);
  }
  return [...byDomain.entries()]
    .filter(([, ids]) => ids.length >= minSize)
    .map(([domain, tabIds]) => ({
      title: prettyDomain(domain),
      color: colorForDomain(domain),
      domain,
      tabIds,
    }))
    .sort((a, b) => b.tabIds.length - a.tabIds.length || a.domain.localeCompare(b.domain));
}

export function prettyDomain(domain) {
  const parts = domain.split('.');
  const name = parts.length > 2 ? parts[parts.length - 2] : parts[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Fuzzy subsequence score. Returns -1 when `query` is not a subsequence of `text`.
export function fuzzyScore(query, text) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const exact = t.indexOf(q);
  if (exact !== -1) {
    const wordStart = exact === 0 || /[\s/._\-:|]/.test(t[exact - 1]);
    return 1000 + q.length * 10 + (wordStart ? 200 : 0) - Math.min(exact, 100);
  }
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return -1;
    streak = found === ti ? streak + 1 : 0;
    const wordStart = found === 0 || /[\s/._\-:|]/.test(t[found - 1]);
    score += 1 + streak * 3 + (wordStart ? 5 : 0);
    ti = found + 1;
  }
  return score;
}

// Every whitespace-separated token must match the title or URL.
export function searchTabs(tabs, query) {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...tabs];
  const scored = [];
  for (const tab of tabs) {
    const title = tab.title || '';
    const url = tab.url || '';
    let total = 0;
    let ok = true;
    for (const token of tokens) {
      const best = Math.max(fuzzyScore(token, title) * 1.5, fuzzyScore(token, url));
      if (best < 0) {
        ok = false;
        break;
      }
      total += best;
    }
    if (ok) scored.push({ tab, score: total });
  }
  return scored
    .sort((a, b) => b.score - a.score || (b.tab.lastAccessed ?? 0) - (a.tab.lastAccessed ?? 0))
    .map((s) => s.tab);
}

export function isRestorable(url) {
  const parsed = parseUrl(url);
  return Boolean(parsed && RESTORABLE_PROTOCOLS.has(parsed.protocol));
}

export function createSession(windows, { name, now = Date.now() } = {}) {
  const cleaned = windows
    .map((win) => ({
      tabs: (win.tabs || [])
        .filter((t) => isRestorable(t.url))
        .map((t) => ({ url: t.url, title: t.title || t.url, pinned: Boolean(t.pinned) })),
    }))
    .filter((win) => win.tabs.length > 0);
  const tabCount = cleaned.reduce((n, w) => n + w.tabs.length, 0);
  return {
    id: `s_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: name?.trim() || defaultSessionName(now),
    createdAt: now,
    tabCount,
    windows: cleaned,
  };
}

export function defaultSessionName(now) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `Session ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function relativeTime(then, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  const units = [
    ['y', 31536000],
    ['mo', 2592000],
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
  ];
  for (const [label, size] of units) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${label} ago`;
  }
  return 'just now';
}
