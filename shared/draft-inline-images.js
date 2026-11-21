// Both runtimes pass the same LinkeDOM parser so stored markup and byte counts agree.
export function extractDraftImages(content, files, parseHTML, createId, invalidImage) {
  if (!content || (!content.includes('data:') && !content.includes('&'))) return null;
  const {document}=parseHTML('<html><body>'+content+'</body></html>');
  let attachments;
  for (const image of document.querySelectorAll('img')) {
    const source=image.getAttribute('src') || '';
    if (!source.startsWith('data:image/')) continue;
    const match=/^data:(image\/(?:png|jpeg|gif|webp|heic|avif));base64,([\s\S]+)$/.exec(source);
    if (!match) {
      if (invalidImage) throw invalidImage();
      continue;
    }
    attachments ??= [...files];
    const [,type,body]=match;
    const existing=attachments.find(file=>file.contentId && typeof file.content==='string' &&
      file.content.replace(/^data:[^,]*;base64,/, '')===body);
    const contentId=existing?.contentId || createId();
    if (!existing) attachments.push({filename:'inline-'+contentId+'.'+type.split('/')[1],content:body,contentType:type,contentId});
    image.setAttribute('src','cid:'+contentId);
  }
  return attachments ? {content:document.body.innerHTML,attachments} : null;
}
