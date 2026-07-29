/**
 * Keeps today's friend/group share on the toolbar icon.
 *
 * This does one job. It holds no state of its own and talks to no one: it
 * wakes on a storage change, recomputes the badge, and goes back to sleep. No
 * message passing, no polling, no network.
 *
 * It runs as a service worker in Chrome and as an event page in Firefox, which
 * differ in how dependencies arrive. Chrome loads them here with
 * importScripts; Firefox has no such function on an event page and lists them
 * in `background.scripts` instead, so by the time this file runs they are
 * already present. Hence the guard rather than an unconditional call.
 */
if (typeof importScripts === 'function') {
  importScripts('../lib/browser-api.js', '../lib/storage.js');
}

const storage = globalThis.FBF.storage;
const api = globalThis.FBF.api;

const BADGE_BG = '#2e9e5b';

async function updateBadge() {
  try {
    const stats = await storage.getStats();
    const summary = storage.summarize(stats, [storage.today()]);

    // Nothing counted yet today, or too little to be meaningful — an early
    // percentage off three posts would be noise presented as a measurement.
    if (summary.classified < 5 || summary.chosenPct == null) {
      await api.action.setBadgeText({ text: '' });
      return;
    }

    await api.action.setBadgeBackgroundColor({ color: BADGE_BG });
    await api.action.setBadgeText({ text: `${summary.chosenPct}%` });
  } catch {
    // A badge is not worth surfacing an error over.
  }
}

api.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[storage.KEY.stats]) updateBadge();
});

api.runtime.onStartup.addListener(updateBadge);
api.runtime.onInstalled.addListener(updateBadge);

updateBadge();
