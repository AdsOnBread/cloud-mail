// Display names are presentation text. Delivery always uses the separately validated address.
export function cleanRecipientName(value) {
  return typeof value === 'string' ? Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/gu,' ').trim()).slice(0,256).join('') : '';
}
export function recipientName(names,address) {
  const key=address.toLowerCase();
  if (!names || !Object.hasOwn(names,key)) return '';
  const value=cleanRecipientName(names[key]);
  return value.toLowerCase()===key ? '' : value;
}
