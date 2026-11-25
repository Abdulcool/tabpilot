// Tests the chrome.* wrapper layer against a minimal mock of the extension APIs.
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

function makeChrome(seed = {}) {
  const state = {
    tabs: seed.tabs || [],
    storage: {},
    removed: [],
    created: [],
    groups: [],
    nextTabId: 1000,
    nextGroupId: 100,
  };
  return {
    state,
    tabs: {
      query: async () => state.tabs.filter((t) => !state.removed.includes(t.id)),
      remove: async (ids) => {
        state.removed.push(...ids);
      },
      group: async ({ tabIds }) => {
        const id = state.nextGroupId++;
        state.groups.push({ id, tabIds });
        return id;
      },
      ungroup: async () => {},
      create: async (props) => {
        const t = { id: state.nextTabId++, ...props };
        state.created.push({ type: 'tab', props });
        return t;
      },
      update: async () => {},
    },
    tabGroups: {
      update: async (id, props) => {
        const g = state.groups.find((x) => x.id === id);
        if (g) Object.assign(g, props);
      },
    },
    windows: {
      getAll: async () => seed.windows || [{ id: 1, tabs: state.tabs.filter((t) => !state.removed.includes(t.id)) }],
      create: async (props) => {
        state.created.push({ type: 'window', props });
        return { id: 50, tabs: [{ id: state.nextTabId++ }] };
      },
      update: async () => {},
    },
    storage: {
      local: {
        get: async (key) => ({ [key]: state.storage[key] }),
        set: async (obj) => Object.assign(state.storage, obj),
      },
    },
  };
}

const tab = (over) => ({
  id: 1,
  url: 'https://example.com/a',
  title: 'Example',
  pinned: false,
  windowId: 1,
  index: 0,
  ...over,
});

let actions;

beforeEach(async () => {
  actions = await import('../src/lib/actions.js');
});

describe('closeDuplicates', () => {
  it('removes duplicate tabs and bumps stats', async () => {
    globalThis.chrome = makeChrome({
      tabs: [tab({ id: 1 }), tab({ id: 2 }), tab({ id: 3, url: 'https://b.com' })],
    });
    const closed = await actions.closeDuplicates();
    assert.equal(closed, 1);
    assert.deepEqual(chrome.state.removed, [2]);
    assert.equal(chrome.state.storage.stats.duplicatesClosed, 1);
  });
});

describe('groupBySite', () => {
  it('groups same-site tabs and labels groups', async () => {
    globalThis.chrome = makeChrome({
      tabs: [
        tab({ id: 1, url: 'https://github.com/a' }),
        tab({ id: 2, url: 'https://github.com/b' }),
        tab({ id: 3, url: 'https://google.com' }),
      ],
      windows: [
        {
          id: 1,
          tabs: [
            tab({ id: 1, url: 'https://github.com/a' }),
            tab({ id: 2, url: 'https://github.com/b' }),
            tab({ id: 3, url: 'https://google.com' }),
          ],
        },
      ],
    });
    const groups = await actions.groupBySite();
    assert.equal(groups, 1);
    assert.equal(chrome.state.groups[0].title, 'Github');
    assert.ok(chrome.state.groups[0].color);
  });
});

describe('sessions', () => {
  it('saves, lists, restores and deletes a session', async () => {
    globalThis.chrome = makeChrome({
      windows: [{ id: 1, tabs: [tab({ url: 'https://a.com' }), tab({ url: 'https://b.com' })] }],
    });
    const saved = await actions.saveSession('Work');
    assert.equal(saved.tabCount, 2);
    const sessions = await actions.getSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].name, 'Work');

    const restored = await actions.restoreSession(saved.id);
    assert.equal(restored, 2);
    const windowsCreated = chrome.state.created.filter((c) => c.type === 'window');
    const tabsCreated = chrome.state.created.filter((c) => c.type === 'tab');
    assert.equal(windowsCreated.length, 1);
    assert.equal(tabsCreated.length, 1); // first tab comes from windows.create
    assert.equal(tabsCreated[0].props.url, 'https://b.com');

    await actions.deleteSession(saved.id);
    assert.equal((await actions.getSessions()).length, 0);
  });

  it('returns null when nothing restorable is open', async () => {
    globalThis.chrome = makeChrome({
      windows: [{ id: 1, tabs: [tab({ url: 'chrome://newtab' })] }],
    });
    assert.equal(await actions.saveSession('x'), null);
  });
});
