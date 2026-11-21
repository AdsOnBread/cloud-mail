export function downloadablePart(file) {
  const disposition=file.disposition?.toLowerCase();
  return Number(file.type || 0)===0 && (disposition==='attachment' || (!file.contentId && disposition!=='inline'));
}
// Credentials are attached only to this installation's API, never to message-supplied URLs.
export async function privateFile(key,signal,token) {
  const base = new URL(import.meta.env.VITE_BASE_URL || '/api', location.origin);
  const url = new URL(base.pathname.replace(/\/$/, '') + '/mobile/v1/attachment-by-key', base.origin);
  url.searchParams.set('key', key);
  const response = await fetch(url, { signal, credentials: 'include', headers: { Authorization: token ?? (localStorage.getItem('token') || '') } });
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
export function inlineImageURL(blob) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
export async function privateImageURL(key) { return inlineImageURL(await privateFile(key)); }
export async function inlineDataHTML(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  await Promise.all(Array.from(doc.images).map(async image => {
    const key = storedKey(image.getAttribute('src'));
    if (!key) return;
    image.src = await privateImageURL(key);
  }));
  return doc.body.innerHTML;
}
