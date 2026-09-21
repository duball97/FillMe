importScripts("vault.js");

let unlockedVault = null;
let vaultLockTimer;
let pendingLogin = null;

function refreshVaultLock() {
  clearTimeout(vaultLockTimer);
  vaultLockTimer = setTimeout(() => { unlockedVault = null; }, 15 * 60 * 1000);
}

chrome.runtime.onInstalled.addListener(async () => {
  const { profile } = await chrome.storage.local.get("profile");
  if (!profile) {
    await chrome.storage.local.set({ profile: {} });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "fillFromPopup" && sender.tab?.id) {
    chrome.tabs.sendMessage(sender.tab.id, { type: "fillForm" });
    sendResponse({ ok: true });
  }
  if (message.type === "vaultStatus") {
    chrome.storage.local.get("encryptedVault").then(({ encryptedVault }) => {
      sendResponse({ configured: Boolean(encryptedVault), unlocked: Boolean(unlockedVault), entryCount: unlockedVault?.entries?.length || 0, entries: unlockedVault?.entries?.map(({ id, name, kind, website, hostname }) => ({ id, name, kind, website, hostname })) || [] });
    });
    return true;
  }
  if (message.type === "vaultCreate") {
    encryptVault({ entries: [] }, message.password).then(async (encryptedVault) => {
      await chrome.storage.local.set({ encryptedVault });
      unlockedVault = { entries: [] };
      refreshVaultLock();
      sendResponse({ ok: true });
    }).catch(() => sendResponse({ ok: false, error: "Could not create the vault" }));
    return true;
  }
  if (message.type === "vaultUnlock") {
    chrome.storage.local.get("encryptedVault").then(async ({ encryptedVault }) => {
      try {
        unlockedVault = await decryptVault(encryptedVault, message.password);
        refreshVaultLock();
        sendResponse({ ok: true, entries: unlockedVault.entries?.map(({ id, name, kind, website, hostname }) => ({ id, name, kind, website, hostname })) || [] });
      } catch {
        sendResponse({ ok: false, error: "Incorrect vault password" });
      }
    }).catch(() => sendResponse({ ok: false, error: "Could not unlock the vault" }));
    return true;
  }
  if (message.type === "vaultLock") {
    unlockedVault = null;
    clearTimeout(vaultLockTimer);
    sendResponse({ ok: true });
  }
  if (message.type === "vaultSaveEntry") {
    if (!unlockedVault) {
      sendResponse({ ok: false, error: "Unlock the vault first" });
      return true;
    }
    const entry = { ...message.entry, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    unlockedVault.entries = [...(unlockedVault.entries || []), entry];
    chrome.storage.local.get("encryptedVault").then(async ({ encryptedVault }) => {
      const next = await encryptVault(unlockedVault, message.password);
      await chrome.storage.local.set({ encryptedVault: next });
      refreshVaultLock();
      sendResponse({ ok: true, entry: { id: entry.id, name: entry.name, kind: entry.kind, website: entry.website, hostname: entry.hostname } });
    }).catch(() => sendResponse({ ok: false, error: "Could not save the entry" }));
    return true;
  }
  if (message.type === "loginCandidate") {
    if (message.candidate?.username && message.candidate?.password) {
      pendingLogin = { ...message.candidate, capturedAt: Date.now() };
      setTimeout(() => {
        if (pendingLogin && Date.now() - pendingLogin.capturedAt > 10 * 60 * 1000) pendingLogin = null;
      }, 10 * 60 * 1000);
    }
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === "pendingLogin") {
    const fresh = pendingLogin && Date.now() - pendingLogin.capturedAt < 10 * 60 * 1000;
    sendResponse({ candidate: fresh ? pendingLogin : null });
    return true;
  }
  if (message.type === "clearPendingLogin") {
    pendingLogin = null;
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === "fillVaultFields" && sender.tab?.id) {
    if (!unlockedVault) {
      sendResponse({ ok: false, locked: true, count: 0 });
      return true;
    }
    refreshVaultLock();
    const origin = message.origin || (sender.tab.url ? new URL(sender.tab.url).origin : "");
    const hostname = message.hostname || (sender.tab.url ? new URL(sender.tab.url).hostname : "");
    chrome.tabs.sendMessage(sender.tab.id, { type: "applyVault", entries: unlockedVault.entries || [], origin, hostname }).then(sendResponse).catch(() => sendResponse({ ok: false, count: 0 }));
    return true;
  }
  return true;
});
