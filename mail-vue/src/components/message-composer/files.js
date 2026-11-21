export const photoTypes = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/heic", "image/avif"];
export const hasFiles = transfer => Array.from(transfer?.types || []).includes("Files");

export function transferFiles(transfer) {
  if (Array.from(transfer.items || []).some(item => item.webkitGetAsEntry?.()?.isDirectory))
    throw new Error("Choose files inside the folder to attach them.");
  const files = Array.from(transfer.files || []);
  if (!files.length) throw new Error("Could not read these files. Choose them from your device.");
  return files;
}

// Clipboard applications sometimes include a bitmap preview of a rich-text selection.
export function hasRichSelection(transfer) {
  const html = transfer.getData("text/html");
  if (!html) return false;
  const template = document.createElement("template");
  template.innerHTML = html;
  return Boolean(template.content.textContent.trim());
}

export function planFiles(files, mode, form, content) {
  const existing = form.attachments.filter(file => !file.contentId);
  const template = document.createElement("template");
  template.innerHTML = content;
  const embedded = [...template.content.querySelectorAll("img")].filter(image =>
    /^(?:data:image\/|cid:)/i.test(image.getAttribute("src") || ""));
  const photos = [], attachments = [];
  for (const file of files) {
    if (!file.size) throw new Error((file.name || "This file") + " is empty.");
    if (mode === "photos" && !photoTypes.includes(file.type))
      throw new Error("Choose a PNG, JPEG, GIF, WebP, HEIC or AVIF image.");
    if (mode !== "attachments" && !form.plainText && photoTypes.includes(file.type)) photos.push(file);
    else attachments.push(file);
  }
  if (photos.length && embedded.length + photos.length > 10)
    throw new Error("A message can contain up to 10 inline photos.");
  if (attachments.length && existing.length + attachments.length > 10)
    throw new Error("A message can have at most 10 attachments.");
  const encoded = bytes => 4 * Math.ceil(bytes / 3);
  const bodyBytes = new TextEncoder().encode(content).length;
  const fileBytes = [...existing, ...files].reduce((sum, file) => sum + encoded(Number(file.size) || 0), 0);
  if (bodyBytes + fileBytes > 5 * 1024 * 1024)
    throw new Error("These files would exceed the 5 MiB message limit.");
  return { photos, attachments };
}
