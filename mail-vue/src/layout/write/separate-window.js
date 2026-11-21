// Only a window opened by this mailbox may return a composer to it. The draft
// and its attachments stay in the mailbox database throughout the handoff.
const prefix = "phooey-compose:";
const children = new Map();
const sessionKey = id => prefix + id;

export function windowState(id, target = window) {
  const state = JSON.parse(target.sessionStorage.getItem(sessionKey(id)) || "null");
  if (!state) throw new Error("This compose window is no longer available.");
  return state;
}
export function saveWindowState(id, state, target = window) {
  target.sessionStorage.setItem(sessionKey(id), JSON.stringify(state));
}
function tell(target, id, action, request) {
  target.postMessage({ type: prefix, id, action, request }, location.origin);
}

export function focusSeparateDraft(id) {
  for (const [child, entry] of children) {
    if (child.closed) { children.delete(child); continue; }
    try {
      entry.check();
      if (child.location.pathname !== "/inbox" || new URL(child.location.href).searchParams.get("composeWindow") !== entry.id) continue;
      if (windowState(entry.id, child).draftId === id) { child.focus(); return true; }
    } catch { /* Window navigated away or the mailbox changed. */ }
  }
  return false;
}

export async function openSeparateWindow(prepare, check) {
  check();
  const id = crypto.randomUUID();
  const child = window.open("about:blank", "_blank", "popup,width=1000,height=720");
  if (!child) throw new Error("Allow pop-ups for phooey! mail to open a separate composer.");
  try {
    const state = await prepare();
    check();
    if (child.closed) throw new Error("The compose window was closed.");
    saveWindowState(id, state, child);
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 30000;
      const timer = setInterval(() => {
        if (child.closed || Date.now() > deadline) finish(false);
      }, 250);
      function finish(success) {
        clearInterval(timer);
        success ? resolve() : reject(new Error("Could not open the separate composer."));
      }
      children.set(child, { id, check, finish });
      child.location.replace("/inbox?composeWindow=" + id);
    });
  } catch (error) {
    children.delete(child);
    child.close();
    throw error;
  }
}

export function receiveComposeWindows(restore) {
  async function receive(event) {
    const child = event.source, entry = children.get(child), data = event.data;
    if (event.origin !== location.origin || !entry || data?.type !== prefix || data.id !== entry.id) return;
    try {
      entry.check();
      if (data.action === "ready" || data.action === "failed") {
        entry.finish(data.action === "ready");
      } else if (data.action === "return" && !entry.returning) {
        entry.returning = true;
        try {
          await restore(windowState(entry.id, child), entry.check);
          tell(child, entry.id, "returned", data.request);
          children.delete(child);
          window.focus();
        } finally { entry.returning = false; }
      }
    } catch {
      if (data.action === "return") tell(child, entry.id, "failed", data.request);
      else entry.finish(false);
    }
  }
  window.addEventListener("message", receive);
  return () => window.removeEventListener("message", receive);
}

export function announceComposeWindow(id, success) {
  if (window.opener && !window.opener.closed) tell(window.opener, id, success ? "ready" : "failed");
}
export function returnComposeWindow(id) {
  const parent = window.opener;
  if (!parent || parent.closed) throw new Error("The original mailbox window is closed. Your message is saved in Drafts.");
  const request = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(false), 10000);
    function finish(success) {
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
      success ? resolve() : reject(new Error("Could not return to the original mailbox. Your message is still open."));
    }
    function receive(event) {
      const data = event.data;
      if (event.origin === location.origin && event.source === parent && data?.type === prefix &&
          data.id === id && data.request === request) finish(data.action === "returned");
    }
    window.addEventListener("message", receive);
    tell(parent, id, "return", request);
  });
}
