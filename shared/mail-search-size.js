export const sizeUnits = {MB:1024 * 1024, KB:1024, Bytes:1};

// A blank value leaves size unrestricted. A zero threshold is a valid search.
export function sizeCriterion({sizeValue,sizeUnit='MB',sizeOperator='larger'}) {
  if (!/^\d+$/.test(String(sizeValue ?? '')) || !Object.hasOwn(sizeUnits,sizeUnit) ||
      !['larger','smaller'].includes(sizeOperator)) return null;
  const bytes=Number(sizeValue)*sizeUnits[sizeUnit];
  return Number.isSafeInteger(bytes) ? {bytes,larger:sizeOperator==='larger'} : null;
}

export function matchesSize(bytes,criterion) {
  return !criterion || (criterion.larger ? bytes>criterion.bytes : bytes<criterion.bytes);
}

const encoder=new TextEncoder();
export function storedMessageBytes({subject='',text='',content=''},fileBytes=0) {
  return [subject,text,content].reduce((sum,value)=>sum+encoder.encode(value || '').byteLength,fileBytes);
}

export function fileContentBytes(file) {
  if (Number.isSafeInteger(file.size) && file.size>=0) return file.size;
  const value=file.content;
  if (typeof value!=='string') return value?.byteLength ?? value?.size ?? 0;
  return base64Bytes(value);
}

export function base64Bytes(value) {
  const data=value.slice(value.indexOf(',')+1).replace(/\s/g,'');
  return Math.max(0,Math.floor(data.length*3/4)-(data.endsWith('==') ? 2 : Number(data.endsWith('='))));
}
