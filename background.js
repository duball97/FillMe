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
  return true;
});
