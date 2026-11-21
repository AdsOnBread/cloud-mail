import tlds from 'tlds';
import {mailboxHref} from '@/utils/mailto';
import {diffChars, diffWordsWithSpace} from "diff";

// Domains can be entered as displayed, including international characters and
// spaces in the path. URL handles encoding after the host has been identified.
const domainLink = /^(?:[\p{L}\p{M}\p{N}_-]+[.。．｡])+[\p{L}\p{M}\p{N}_-]+(?::\d+)?(?:[/?#].*)?$/u;
const knownSuffixes = new Set(tlds.map(suffix =>
  /^[a-z0-9-]+$/.test(suffix) ? suffix : new URL("https://domain." + suffix).hostname.split(".").at(-1)
));
const bareMailbox = /^[^\s@]+@[^\s@/:?#]+\.[^\s@/:?#]+$/;

// Address links can point to an international domain even when the sending
// mailbox itself supports only ASCII addresses.
const selectedMailbox = /^[a-z\d!#$%&'*+/=?^_`{|}~.-]+@(?:[\p{L}\p{M}\p{N}-]+[.。．｡])+[\p{L}][\p{L}\p{M}\p{N}-]+$/iu;

export function normalizeLinkUrl(value) {
  const raw = value?.trim();
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return "";
  try {
    let candidate = raw;
    const isMailbox = !/^[a-z][a-z\d+.-]*:/i.test(raw) && bareMailbox.test(raw);
    if (domainLink.test(raw)) {
      candidate = "https://" + raw;
      // A dotted mailbox name can contain slash, question mark or hash.
      // Prefer the website only when the prefix parses as a host with a known suffix.
      if (isMailbox) {
        const suffix = URL.canParse(candidate) && new URL(candidate).hostname.split(".").at(-1);
        if (!knownSuffixes.has(suffix)) candidate = mailboxHref(raw);
      }
    } else if (isMailbox) candidate = mailboxHref(raw);
    const url = new URL(candidate);
    return ["https:", "http:", "mailto:", "tel:"].includes(url.protocol)
      ? url.href
      : "";
  } catch {
    return "";
  }
}

// A plain mailbox can be edited as typed. Keep an explicit URI when dropping
// its scheme would change an encoded local part, subject or other parameter.
export function editableLinkUrl(href) {
  const address = href.replace(/^mailto:/i, "");
  if (address === href) return href;
  const destination = normalizeLinkUrl(href);
  if (!destination) return href;
  try {
    const decoded = decodeURI(address);
    if (normalizeLinkUrl(decoded) === destination) return decoded;
  } catch { /* Keep the original spelling of a non-decodable address. */ }
  return normalizeLinkUrl(address) === destination ? address : href;
}

export function shortenLinkDestination(value) {
  const characters = Array.from(value);
  return characters.length > 48
    ? characters.slice(0, 24).join("") + "..." + characters.slice(-24).join("")
    : value;
}

export function selectedWebUrl(text) {
  if (!/^https?:\/\//i.test(text) || /\s/.test(text)) return "";
  return normalizeLinkUrl(text);
}

// Insert link also recognizes selected mailboxes and qualified bare web links.
// Plain URL paste uses selectedWebUrl independently of this explicit command.
export function selectedLinkUrl(text) {
  if (!text || /\s/.test(text)) return "";
  const href = normalizeLinkUrl(text);
  if (!href) return "";
  if (href.startsWith("mailto:")) {
    const mailbox = /^mailto:/i.test(text) ? text.slice(7).split("?")[0] : text;
    return selectedMailbox.test(mailbox) ? href : "";
  }
  if (/^https?:\/\//i.test(text)) return href;
  if (!domainLink.test(text)) return "";
  return text.split(/[.。．｡]/).length > 2 || /[:/?#]/.test(text) ? href : "";
}

// Keep the existing inline elements, including styles on text between separate edits.
export function renameLink(link, label) {
  const original = link.textContent;
  if (original === label) return;
  const walker = link.ownerDocument.createTreeWalker(link, NodeFilter.SHOW_TEXT);
  const runs = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.length) runs.push(node);
  }
  if (!runs.length || (!link.querySelector("img") && link.querySelector("br,[contenteditable=false]"))) {
    link.textContent = label;
    return;
  }
  rewriteTextRuns(runs, original, label);
}

export function rewriteTextRuns(runs, original, label) {
  if (runs.length === 1) {
    runs[0].data = label;
    return;
  }

  const options = {timeout: 35, maxEditLength: 1024};
  const deadline = Date.now() + options.timeout;
  const changes = diffWordsWithSpace(original, label, options);
  if (!changes) {
    // Bound work on very large pasted replacements and retain each run's formatting.
    let offset = 0;
    runs.forEach((node, i) => {
      const end = i === runs.length - 1 ? label.length : offset + node.length;
      node.data = label.slice(offset, end);
      offset = end;
    });
    return;
  }
  // Refine word edits so formatting inside a partially changed word also survives.
  const pieces = [];
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i], next = changes[i + 1];
    if (change.removed && next?.added && !/\s/.test(change.value + next.value)) {
      const timeout = deadline - Date.now();
      const letters = timeout > 0 && diffChars(change.value, next.value, {...options, timeout});
      pieces.push(...(letters || [change, next]));
      i++;
    } else pieces.push(change);
  }
  const output = runs.map(() => "");
  let index = 0, offset = 0, firstRemoved = null;
  for (const change of pieces) {
    if (change.added) {
      const target = firstRemoved ?? (offset ? index : Math.max(0, index - 1));
      output[target] += change.value;
      firstRemoved = null;
      continue;
    }
    firstRemoved = change.removed ? index : null;
    let remaining = change.value.length;
    while (remaining > 0) {
      const text = runs[index].data;
      const take = Math.min(remaining, text.length - offset);
      if (!change.removed) output[index] += text.slice(offset, offset + take);
      remaining -= take;
      offset += take;
      if (offset === text.length) {
        index++;
        offset = 0;
      }
    }
  }
  runs.forEach((node, i) => { node.data = output[i]; });
}
