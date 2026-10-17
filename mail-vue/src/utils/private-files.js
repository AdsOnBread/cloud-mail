// Credentials are attached only to this installation's API, never to message-supplied URLs.
export async function privateFile(key) {
  const base = new URL(import.meta.env.VITE_BASE_URL || '/api', location.origin);
  const url = new URL(base.pathname.replace(/\/$/, '') + '/mobile/v1/attachment-by-key', base.origin);
  url.searchParams.set('key', key);
  const response = await fetch(url, { credentials: 'include', headers: { Authorization: localStorage.getItem('token') || '' } });
  if (!response.ok) {
    throw new Error('The attachment is unavailable. Sign in again and retry.');
  }
  return response.blob();
}
export async function privateFileURL(key) { return URL.createObjectURL(await privateFile(key)); }
export function storedKey(src) {
  const match = src?.match(/(?:^|\/|\}\})(attachments\/[^?#]+)/);
  return match ? match[1] : null;
}
export async function inlineDataHTML(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  await Promise.all(Array.from(doc.images).map(async image => {
    const key = storedKey(image.getAttribute('src'));
    if (!key) return;
    const blob = await privateFile(key);
    image.src = await new Promise((resolve,reject) => { const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob); });
  }));
  return doc.body.innerHTML;
}
