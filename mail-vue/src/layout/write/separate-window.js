// The same-origin browser windows share the draft database. Only hand off its
// local ID and the state of an empty composer; attachments stay in IndexedDB.
const bridge = "__phooeyComposeWindow";
const prefix = "phooey-compose:";
const children = new Map();

export function windowState(id, target = window) {
  const state = JSON.parse(target.sessionStorage.getItem(prefix + id) || "null");
  if (!state) throw new Error("This compose window is no longer available.");
  return state;
}
export function saveWindowState(id, state, target = window) {
  target.sessionStorage.setItem(prefix + id, JSON.stringify(state));
}

async function sessionStamp(session) {
  session.check();
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(session.token));
  session.check();
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2,"0")).join("");
}
function forget(child, id) {
  children.delete(child);
  sessionStorage.removeItem(prefix + "child:" + id);
}
function isComposer(child,id) {
  try {
    const url = new URL(child.location.href);
    return !child.closed && child.opener === window && url.origin === location.origin &&
      url.pathname === "/inbox" && url.searchParams.get("composeWindow") === id;
  } catch { return false; }
}
function findDraft(id) {
  if (!id) return;
  for (const [child, entry] of children) {
    if (child.closed) { forget(child,entry.id); continue; }
    if (!isComposer(child,entry.id)) continue;
    entry.check();
    if (windowState(entry.id, child).draftId === id) return child;
  }
}
export function focusSeparateDraft(id) {
  const child = findDraft(id);
  if (child) child.focus();
  return Boolean(child);
}
export function separateEditors(ids) {
  return ids.flatMap(id => {
    const child = findDraft(id);
    if (!child) return [];
    const editor = child[bridge]?.discardEditor(id);
    if (!editor) throw new Error("Wait until the separate composer is ready to discard this draft.");
    return [editor];
  });
}
export async function openSeparateWindow(prepare, session) {
  session.check();
  const id = crypto.randomUUID();
  const child = window.open("about:blank", "_blank", "popup,width=1000,height=720");
  if (!child) throw new Error("Allow pop-ups for phooey! mail to open a separate composer.");
  try {
    const state = await prepare();
    const stamp = await sessionStamp(session);
    if (child.closed) throw new Error("The compose window was closed.");
    saveWindowState(id, {...state,stamp}, child);
    sessionStorage.setItem(prefix + "child:" + id, stamp);
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 30000;
      const timer = setInterval(() => {
        if (child.closed || Date.now() > deadline) finish(false);
      }, 250);
      function finish(success) {
        clearInterval(timer);
        success ? resolve() : reject(new Error("Could not open the separate composer."));
      }
      children.set(child, { id, check:session.check, finish });
      child.location.replace("/inbox?composeWindow=" + id);
    });
  } catch (error) {
    forget(child,id);
    child.close();
    throw error;
  }
}

export async function checkWindowSession(state, session) {
  if (state.owner !== session.owner || state.stamp !== await sessionStamp(session))
    throw new Error("This compose window belongs to a different mailbox session.");
}

// Each endpoint lives as long as its document. Reconnect through the actual
// opener after a reload, verifying the grant from when that child was created.
export function receiveComposeWindows({restore, getSession, discardEditor, id}) {
  const discovery = new BroadcastChannel("phooey-compose-windows");
  async function register(child, key) {
    if (!isComposer(child,key)) throw new Error("The compose window changed.");
    const session = getSession(), stamp = await sessionStamp(session);
    if (stamp !== sessionStorage.getItem(prefix + "child:" + key))
      throw new Error("This compose window belongs to a different mailbox session.");
    if (!isComposer(child,key)) throw new Error("The compose window changed.");
    const entry = children.get(child) || {id:key,check:session.check};
    entry.check();
    children.set(child,entry);
    return entry;
  }
  let ready = false;
  const api = {
    discardEditor,
    async accept(child,key) {
      const entry = await register(child,key);
      entry.finish?.(true);
    },
    async restore(child,key) {
      const entry = await register(child,key);
      await restore(windowState(key,child),entry.check);
      forget(child,key);
      window.focus();
    },
    failed(child,key) {
      if (isComposer(child,key)) children.get(child)?.finish?.(false);
    },
  };
  window[bridge] = api;
  function announce() {
    if (ready && window.opener && !window.opener.closed)
      return window.opener[bridge]?.accept(window,id);
  }
  discovery.onmessage = () => { if (id) Promise.resolve().then(announce).catch(()=>{}); };
  discovery.postMessage("discover");
  return {
    async opened() { ready = true; await announce(); },
    failed() { window.opener?.[bridge]?.failed(window,id); },
    stop() { discovery.close(); if (window[bridge] === api) delete window[bridge]; },
  };
}
export async function returnComposeWindow(id) {
  let api;
  try { api = window.opener?.[bridge]; } catch { /* Opener navigated away. */ }
  if (!api || window.opener.closed) throw new Error("Open the original mailbox to return this message. Your draft is still here.");
  await api.restore(window,id);
}
