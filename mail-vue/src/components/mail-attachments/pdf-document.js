import {getDocument, GlobalWorkerOptions, version} from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc=workerURL;

export function openPdf(data) {
    const assets=new URL(import.meta.env.BASE_URL+'pdf/'+version+'/',document.baseURI).href;
    return getDocument({
      data,isEvalSupported:false,enableXfa:false,
      wasmUrl:assets+'wasm/',cMapUrl:assets+'cmaps/',cMapPacked:true,
      standardFontDataUrl:assets+'standard_fonts/',iccUrl:assets+'iccs/'
    });
}

export async function firstPageThumbnail(blob,signal) {
  const data=await blob.arrayBuffer();
  signal.throwIfAborted();
  const task=openPdf(data);
  let rendering,closing;
  const destroy=()=>closing ||= task.destroy();
  const abort=()=>{rendering?.cancel();destroy().catch(()=>{});};
  signal.addEventListener("abort",abort,{once:true});
  try {
    const pdf=await task.promise;
    const page=await pdf.getPage(1);
    signal.throwIfAborted();
    const width=page.getViewport({scale:1}).width;
    const viewport=page.getViewport({scale:Math.min(2,360/width)});
    const canvas=document.createElement("canvas");
    canvas.width=Math.ceil(viewport.width);
    canvas.height=Math.min(240,Math.ceil(viewport.height));
    rendering=page.render({canvas,viewport});
    await rendering.promise;
    return await new Promise(resolve=>canvas.toBlob(resolve));
  } finally {
    signal.removeEventListener("abort",abort);
    await destroy();
  }
}
