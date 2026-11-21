// A bare mailbox is one recipient. URI punctuation in its local part belongs to
// the mailbox itself, while a plus tag can be displayed literally.
export function mailboxHref(address) {
  const at = address.lastIndexOf("@");
  const local = encodeURIComponent(address.slice(0, at)).replace(/%2B/gi, "+");
  return "mailto:" + local + address.slice(at);
}
