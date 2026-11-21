export async function dictionaryData(response, extension) {
  if (!response.ok || response.headers.get('content-type')?.includes('text/html'))
    throw new Error('Dictionary unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Hunspell accepts an HTML fallback page as an empty dictionary. Verify the
  // format of the shipped files before allowing an apparently successful scan.
  const header = new TextDecoder().decode(bytes.subarray(0, 8192));
  const pattern = extension === 'aff' ? /^SET[ \t]+UTF-8\b/im : /^[1-9]\d*(?:[ \t]+[^\r\n]*)?\r?\n[^\r\n]/;
  if (!pattern.test(header)) throw new Error('Invalid dictionary');
  return bytes;
}
