import { closeDuplicates, groupBySite } from './lib/actions.js';

async function updateBadge() {
  const tabs = await chrome.tabs.query({});
  const count = tabs.length;
  await chrome.action.setBadgeText({ text: count > 999 ? '999+' : String(count) });
  await chrome.action.setBadgeBackgroundColor({
    color: count > 50 ? '#ef4444' : count > 20 ? '#f59e0b' : '#6366f1',
  });
  await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
}

async function flash(text) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
  setTimeout(updateBadge, 1500);
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'close-duplicates') {
    const closed = await closeDuplicates();
    await flash(closed ? `-${closed}` : '0');
  } else if (command === 'group-by-site') {
    const groups = await groupBySite();
    await flash(`${groups}g`);
  }
});

for (const event of [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onReplaced]) {
  event.addListener(() => updateBadge());
}
chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
