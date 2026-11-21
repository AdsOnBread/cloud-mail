// Thumbnail work shares two slots across all expanded messages in the reader.
const waiting=new Set();
let active=0;
export function queueThumbnail(load,signal) {
  if (signal.aborted) return;
  function cancel(){waiting.delete(start);}
  function start() {
    cancel();
    signal.removeEventListener("abort",cancel);
    active++;
    Promise.resolve().then(()=>{if(!signal.aborted)return load(signal);}).finally(()=>{
      active--;
      waiting.values().next().value?.();
    });
  }
  if (active<2) start();
  else {
    waiting.add(start);
    signal.addEventListener("abort",cancel,{once:true});
  }
}
