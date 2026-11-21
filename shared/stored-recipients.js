export function storedRecipients(value) {
  try {
    const entries =
      typeof value === "string" ? JSON.parse(value || "[]") : value;
    if (!Array.isArray(entries)) return [];
    return entries.map((entry) =>
      typeof entry === "string" ? { address: entry } : entry,
    );
  } catch {
    return [];
  }
}

// Mailing-list groups can appear in the To and Cc headers of received mail.
export function mailboxEntries(value) {
  return storedRecipients(value).flatMap((entry) => {
    if (Array.isArray(entry?.group)) return mailboxEntries(entry.group);
    return typeof entry?.address === "string" && entry.address.trim()
      ? [entry]
      : [];
  });
}
