import { normalizeUrl, relativeTime, searchTabs } from './lib/core.js';
import {
  closeDuplicates,
  deleteSession,
  focusTab,
  getSessions,
  groupBySite,
  restoreSession,
  saveSession,
  ungroupAll,
} from './lib/actions.js';

const els = {
  search: document.getElementById('search'),
  results: document.getElementById('results'),
  sessions: document.getElementById('sessions'),
  sessionsSection: document.getElementById('sessions-section'),
  sessionCount: document.getElementById('session-count'),
  noSessions: document.getElementById('no-sessions'),
  tabCount: document.getElementById('tab-count'),
  status: document.getElementById('status'),
};

const state = {
  tabs: [],
  dupKeys: new Set(),
  filtered: [],
  selected: 0,
  statusTimer: null,
};

function showStatus(message, { error = false } = {}) {
  els.status.textContent = message;
  els.status.classList.toggle('error', error);
  clearTimeout(state.statusTimer);
  state.statusTimer = setTimeout(() => {
    els.status.textContent = '';
  }, 2600);
}

async function refresh() {
  state.tabs = await chrome.tabs.query({});
  state.dupKeys = new Set();
  const counts = new Map();
  for (const tab of state.tabs) {
    if (!tab.url) continue;
    const key = normalizeUrl(tab.url);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [key, n] of counts) if (n > 1) state.dupKeys.add(key);
  els.tabCount.textContent = `${state.tabs.length} tab${state.tabs.length === 1 ? '' : 's'}`;
  renderResults();
  await renderSessions();
}

function highlight(text, query) {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  let html = '';
  let last = 0;
  const ranges = [];
  for (const token of tokens) {
    const idx = text.toLowerCase().indexOf(token.toLowerCase());
    if (idx !== -1) ranges.push([idx, idx + token.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  for (const [start, end] of ranges) {
    if (start < last) continue;
    html += escapeHtml(text.slice(last, start)) + '<mark>' + escapeHtml(text.slice(start, end)) + '</mark>';
    last = end;
  }
  return html + escapeHtml(text.slice(last));
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.host.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname.slice(0, 40));
  } catch {
    return url;
  }
}

function renderResults() {
  const query = els.search.value;
  state.filtered = searchTabs(state.tabs, query);
  state.selected = Math.min(state.selected, Math.max(state.filtered.length - 1, 0));
  els.results.innerHTML = '';
  els.sessionsSection.style.display = query.trim() ? 'none' : '';

  const fragment = document.createDocumentFragment();
  state.filtered.forEach((tab, i) => {
    const li = document.createElement('li');
    li.className = 'tab-row' + (i === state.selected ? ' selected' : '');
    li.setAttribute('role', 'option');

    const fav = document.createElement('img');
    fav.src = tab.favIconUrl || '../icons/icon16.png';
    fav.alt = '';
    fav.onerror = () => {
      fav.src = '../icons/icon16.png';
    };

    const text = document.createElement('div');
    text.className = 'tab-text';
    const title = document.createElement('span');
    title.className = 'tab-title';
    title.innerHTML = highlight(tab.title || tab.url || 'Untitled', query);
    const url = document.createElement('span');
    url.className = 'tab-url';
    url.innerHTML = highlight(shortUrl(tab.url || ''), query);
    text.append(title, url);

    const meta = document.createElement('div');
    meta.className = 'tab-meta';
    if (tab.pinned) meta.insertAdjacentHTML('beforeend', '<span class="chip pin">pin</span>');
    if (tab.url && state.dupKeys.has(normalizeUrl(tab.url)))
      meta.insertAdjacentHTML('beforeend', '<span class="chip dup">dup</span>');
    if (tab.active) meta.insertAdjacentHTML('beforeend', '<span class="chip active">active</span>');

    const close = document.createElement('button');
    close.className = 'close-btn';
    close.textContent = '×';
    close.title = 'Close tab';
    close.addEventListener('click', async (event) => {
      event.stopPropagation();
      await chrome.tabs.remove(tab.id);
      await refresh();
    });
    meta.append(close);

    li.append(fav, text, meta);
    li.addEventListener('click', () => focusTab(tab));
    li.addEventListener('mousemove', () => {
      if (state.selected !== i) {
        state.selected = i;
        updateSelection();
      }
    });
    fragment.append(li);
  });
  els.results.append(fragment);
  scrollSelectedIntoView();
}

function updateSelection() {
  [...els.results.children].forEach((li, i) => {
    li.classList.toggle('selected', i === state.selected);
  });
  scrollSelectedIntoView();
}

function scrollSelectedIntoView() {
  els.results.children[state.selected]?.scrollIntoView({ block: 'nearest' });
}

async function renderSessions() {
  const sessions = await getSessions();
  els.sessionCount.textContent = sessions.length ? `· ${sessions.length}` : '';
  els.noSessions.hidden = sessions.length > 0;
  els.sessions.innerHTML = '';
  for (const session of sessions) {
    const li = document.createElement('li');
    li.className = 'session-row';
    li.innerHTML = `
      <div class="session-icon">◧</div>
      <div class="session-info">
        <span class="session-name">${escapeHtml(session.name)}</span>
        <span class="session-meta">${session.tabCount} tabs · ${relativeTime(session.createdAt)}</span>
      </div>
      <div class="session-actions">
        <button class="restore">Restore</button>
        <button class="delete">Delete</button>
      </div>`;
    li.querySelector('.restore').addEventListener('click', async () => {
      await restoreSession(session.id);
      showStatus(`Restored ${session.tabCount} tabs`);
    });
    li.querySelector('.delete').addEventListener('click', async () => {
      await deleteSession(session.id);
      showStatus('Session deleted');
      await renderSessions();
    });
    els.sessions.append(li);
  }
}

async function runDedupe() {
  const closed = await closeDuplicates();
  showStatus(closed ? `Closed ${closed} duplicate${closed === 1 ? '' : 's'}` : 'No duplicates found');
  await refresh();
}

async function runGroup() {
  const groups = await groupBySite();
  showStatus(groups ? `Created ${groups} group${groups === 1 ? '' : 's'}` : 'Nothing to group (need 2+ tabs per site)');
  await refresh();
}

async function runUngroup() {
  const count = await ungroupAll();
  showStatus(count ? `Ungrouped ${count} tabs` : 'No groups to remove');
  await refresh();
}

async function runSave() {
  const session = await saveSession();
  if (session) {
    showStatus(`Saved ${session.tabCount} tabs as “${session.name}”`);
  } else {
    showStatus('Nothing worth saving (only browser-internal pages open)', { error: true });
  }
  await renderSessions();
}

for (const [id, fn] of [
  ['btn-dedupe', runDedupe],
  ['btn-group', runGroup],
  ['btn-ungroup', runUngroup],
  ['btn-save', runSave],
]) {
  document.getElementById(id).addEventListener('click', fn);
}

els.search.addEventListener('input', () => {
  state.selected = 0;
  renderResults();
});

window.addEventListener('keydown', async (event) => {
  const key = event.key;
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    event.preventDefault();
    const delta = key === 'ArrowDown' ? 1 : -1;
    state.selected = Math.max(0, Math.min(state.filtered.length - 1, state.selected + delta));
    updateSelection();
  } else if (key === 'Enter') {
    const tab = state.filtered[state.selected];
    if (tab) focusTab(tab);
  } else if (key === 'Backspace' && !els.search.value) {
    const tab = state.filtered[state.selected];
    if (tab) {
      await chrome.tabs.remove(tab.id);
      await refresh();
    }
  } else if (/^[dgsu]$/i.test(key) && document.activeElement !== els.search) {
    if (key === 'd' || key === 'D') runDedupe();
    else if (key === 'g' || key === 'G') runGroup();
    else if (key === 's' || key === 'S') runSave();
    else if (key === 'u' || key === 'U') runUngroup();
  } else if (key === 'Escape') {
    window.close();
  }
});

refresh();
els.search.focus();
