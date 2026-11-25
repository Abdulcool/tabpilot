import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  colorForDomain,
  createSession,
  domainOf,
  findDuplicates,
  fuzzyScore,
  groupByDomain,
  isRestorable,
  normalizeUrl,
  relativeTime,
  searchTabs,
} from '../src/lib/core.js';

const tab = (over) => ({
  id: 1,
  url: 'https://example.com/a',
  title: 'Example',
  pinned: false,
  active: false,
  windowId: 1,
  index: 0,
  lastAccessed: 0,
  ...over,
});

describe('normalizeUrl', () => {
  it('strips fragments', () => {
    assert.equal(normalizeUrl('https://a.com/x#frag'), 'https://a.com/x');
  });
  it('strips trailing slash on root', () => {
    assert.equal(normalizeUrl('https://a.com/'), 'https://a.com');
  });
  it('keeps query strings', () => {
    assert.equal(normalizeUrl('https://a.com/x?q=1'), 'https://a.com/x?q=1');
  });
  it('lowercases host', () => {
    assert.equal(normalizeUrl('https://A.com/X'), 'https://a.com/X');
  });
  it('keeps hash when told to', () => {
    assert.equal(normalizeUrl('https://a.com/x#f', { ignoreHash: false }), 'https://a.com/x#f');
  });
  it('passes through unparseable urls', () => {
    assert.equal(normalizeUrl('not a url %%%'), 'not a url %%%');
  });
});

describe('domainOf', () => {
  it('extracts host without www', () => {
    assert.equal(domainOf('https://www.github.com/x'), 'github.com');
  });
  it('keeps subdomains', () => {
    assert.equal(domainOf('https://mail.google.com/'), 'mail.google.com');
  });
  it('returns null for invalid urls', () => {
    assert.equal(domainOf('nope %%%'), null);
  });
});

describe('findDuplicates', () => {
  it('closes all but one copy', () => {
    const tabs = [
      tab({ id: 1, index: 0 }),
      tab({ id: 2, index: 1 }),
      tab({ id: 3, url: 'https://other.com' }),
    ];
    assert.deepEqual(findDuplicates(tabs).sort(), [2]);
  });
  it('keeps the active tab alive', () => {
    const tabs = [tab({ id: 1, index: 0 }), tab({ id: 2, index: 1, active: true })];
    assert.deepEqual(findDuplicates(tabs), [1]);
  });
  it('keeps pinned tabs over unpinned', () => {
    const tabs = [tab({ id: 1, index: 0 }), tab({ id: 2, index: 1, pinned: true })];
    assert.deepEqual(findDuplicates(tabs), [1]);
  });
  it('treats url differing only by hash as duplicates', () => {
    const tabs = [tab({ id: 1, url: 'https://a.com/x#1' }), tab({ id: 2, url: 'https://a.com/x#2' })];
    assert.equal(findDuplicates(tabs).length, 1);
  });
  it('ignores empty urls and singletons', () => {
    const tabs = [tab({ id: 1, url: '' }), tab({ id: 2, url: 'https://a.com' })];
    assert.deepEqual(findDuplicates(tabs), []);
  });
});

describe('groupByDomain', () => {
  it('groups 2+ tabs of the same site', () => {
    const tabs = [
      tab({ id: 1, url: 'https://github.com/a' }),
      tab({ id: 2, url: 'https://github.com/b' }),
      tab({ id: 3, url: 'https://google.com/x' }),
    ];
    const groups = groupByDomain(tabs);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].domain, 'github.com');
    assert.deepEqual(groups[0].tabIds.sort(), [1, 2]);
    assert.equal(groups[0].title, 'Github');
  });
  it('skips pinned and non-http tabs', () => {
    const tabs = [
      tab({ id: 1, url: 'https://github.com/a', pinned: true }),
      tab({ id: 2, url: 'https://github.com/b' }),
      tab({ id: 3, url: 'chrome://extensions' }),
      tab({ id: 4, url: 'chrome://settings' }),
    ];
    assert.equal(groupByDomain(tabs).length, 0);
  });
  it('assigns stable colors', () => {
    assert.equal(colorForDomain('github.com'), colorForDomain('github.com'));
  });
});

describe('fuzzyScore', () => {
  it('returns -1 when not a subsequence', () => {
    assert.equal(fuzzyScore('xyz', 'github'), -1);
  });
  it('prefers exact substring matches', () => {
    assert.ok(fuzzyScore('git', 'github — pull requests') > fuzzyScore('git', 'legitimate'));
  });
  it('is case insensitive', () => {
    assert.ok(fuzzyScore('GIT', 'github') > 0);
  });
});

describe('searchTabs', () => {
  const tabs = [
    tab({ id: 1, title: 'GitHub - Pull requests', url: 'https://github.com/org/repo/pulls' }),
    tab({ id: 2, title: 'Gmail - Inbox', url: 'https://mail.google.com' }),
    tab({ id: 3, title: 'Stack Overflow', url: 'https://stackoverflow.com/questions/git' }),
  ];
  it('returns all tabs for empty query', () => {
    assert.equal(searchTabs(tabs, '').length, 3);
  });
  it('matches by title', () => {
    const hits = searchTabs(tabs, 'pull');
    assert.deepEqual(hits.map((t) => t.id), [1]);
  });
  it('matches by url', () => {
    const hits = searchTabs(tabs, 'stackoverflow');
    assert.deepEqual(hits.map((t) => t.id), [3]);
  });
  it('requires every token to match', () => {
    assert.equal(searchTabs(tabs, 'git pull').length, 1);
    assert.equal(searchTabs(tabs, 'git zzz').length, 0);
  });
  it('supports fuzzy matching', () => {
    const hits = searchTabs(tabs, 'ghpr');
    assert.deepEqual(hits.map((t) => t.id), [1]);
  });
});

describe('createSession', () => {
  it('collects restorable tabs across windows', () => {
    const windows = [
      { tabs: [tab({ url: 'https://a.com' }), tab({ url: 'chrome://newtab', title: 'New Tab' })] },
      { tabs: [tab({ url: 'https://b.com', pinned: true })] },
    ];
    const s = createSession(windows, { name: 'Work', now: 1700000000000 });
    assert.equal(s.name, 'Work');
    assert.equal(s.tabCount, 2);
    assert.equal(s.windows.length, 2);
    assert.equal(s.windows[1].tabs[0].pinned, true);
  });
  it('drops windows with no restorable tabs', () => {
    const windows = [{ tabs: [tab({ url: 'chrome://extensions' })] }];
    assert.equal(createSession(windows).tabCount, 0);
    assert.equal(createSession(windows).windows.length, 0);
  });
  it('generates a name when missing', () => {
    const s = createSession([{ tabs: [tab()] }], { now: 1700000000000 });
    assert.match(s.name, /^Session \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe('isRestorable', () => {
  it('accepts http(s) and file', () => {
    assert.ok(isRestorable('https://a.com'));
    assert.ok(isRestorable('file:///home/x'));
    assert.ok(!isRestorable('chrome://settings'));
    assert.ok(!isRestorable('about:blank'));
    assert.ok(!isRestorable('chrome-extension://abc/page.html'));
  });
});

describe('relativeTime', () => {
  it('formats human durations', () => {
    const now = 1700000000000;
    assert.equal(relativeTime(now - 5000, now), 'just now');
    assert.equal(relativeTime(now - 90_000, now), '1m ago');
    assert.equal(relativeTime(now - 7_200_000, now), '2h ago');
    assert.equal(relativeTime(now - 3 * 86_400_000, now), '3d ago');
  });
});
