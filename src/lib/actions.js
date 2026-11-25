// Thin wrappers around the chrome.* APIs, shared by the popup and the service worker.
import { createSession, findDuplicates, groupByDomain } from './core.js';

const SESSIONS_KEY = 'sessions';
const STATS_KEY = 'stats';

export async function closeDuplicates() {
  const tabs = await chrome.tabs.query({});
  const ids = findDuplicates(tabs);
  if (ids.length) await chrome.tabs.remove(ids);
  await bumpStat('duplicatesClosed', ids.length);
  return ids.length;
}

export async function groupBySite() {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  let created = 0;
  for (const win of windows) {
    for (const group of groupByDomain(win.tabs)) {
      const groupId = await chrome.tabs.group({
        tabIds: group.tabIds,
        createProperties: { windowId: win.id },
      });
      await chrome.tabGroups.update(groupId, { title: group.title, color: group.color });
      created += 1;
    }
  }
  return created;
}

export async function ungroupAll() {
  const tabs = await chrome.tabs.query({});
  const ids = tabs.filter((t) => t.groupId !== -1).map((t) => t.id);
  if (ids.length) await chrome.tabs.ungroup(ids);
  return ids.length;
}

export async function getSessions() {
  const { [SESSIONS_KEY]: sessions = [] } = await chrome.storage.local.get(SESSIONS_KEY);
  return sessions;
}

export async function saveSession(name) {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  const session = createSession(windows, { name });
  if (session.tabCount === 0) return null;
  const sessions = await getSessions();
  await chrome.storage.local.set({ [SESSIONS_KEY]: [session, ...sessions] });
  return session;
}

export async function deleteSession(id) {
  const sessions = await getSessions();
  await chrome.storage.local.set({ [SESSIONS_KEY]: sessions.filter((s) => s.id !== id) });
}

export async function restoreSession(id) {
  const session = (await getSessions()).find((s) => s.id === id);
  if (!session) return 0;
  for (const win of session.windows) {
    const created = await chrome.windows.create({ url: win.tabs[0].url, focused: true });
    const [first] = created.tabs;
    if (win.tabs[0].pinned) await chrome.tabs.update(first.id, { pinned: true });
    for (const tab of win.tabs.slice(1)) {
      await chrome.tabs.create({
        windowId: created.id,
        url: tab.url,
        pinned: tab.pinned,
        active: false,
      });
    }
  }
  return session.tabCount;
}

export async function focusTab(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

export async function getStats() {
  const { [STATS_KEY]: stats = { duplicatesClosed: 0 } } = await chrome.storage.local.get(
    STATS_KEY,
  );
  return stats;
}

async function bumpStat(key, amount) {
  if (!amount) return;
  const stats = await getStats();
  stats[key] = (stats[key] || 0) + amount;
  await chrome.storage.local.set({ [STATS_KEY]: stats });
}
