/**
 * Keeps today's friend/group share on the toolbar icon.
 *
 * The worker does this one job. It holds no state of its own and talks to no
 * one: it wakes on a storage change, recomputes the badge, and goes back to
 * sleep. No message passing, no polling, no network.
 */
importScripts('../lib/storage.js');

const storage = globalThis.FBF.storage;

const BADGE_BG = '#2e9e5b';

async function updateBadge() {
  try {
    const stats = await storage.getStats();
    const summary = storage.summarize(stats, [storage.today()]);

    // Nothing counted yet today, or too little to be meaningful — an early
    // percentage off three posts would be noise presented as a measurement.
    if (summary.classified < 5 || summary.chosenPct == null) {
      await chrome.action.setBadgeText({ text: '' });
      return;
    }

    await chrome.action.setBadgeBackgroundColor({ color: BADGE_BG });
    await chrome.action.setBadgeText({ text: `${summary.chosenPct}%` });
  } catch {
    // A badge is not worth surfacing an error over.
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[storage.KEY.stats]) updateBadge();
});

chrome.runtime.onStartup.addListener(updateBadge);
chrome.runtime.onInstalled.addListener(updateBadge);

updateBadge();
