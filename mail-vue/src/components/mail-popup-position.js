export function positionMailboxPopup(element,anchor,width,avoid,alignEnd=false) {
  const view=window.visualViewport;
  const x=view?.offsetLeft||0,y=view?.offsetTop||0,w=view?.width||document.documentElement.clientWidth,h=view?.height||document.documentElement.clientHeight;
  const size=Math.min(width,Math.max(0,w-16));
  const bounds=anchor.getBoundingClientRect(), vertical=avoid?.getBoundingClientRect() || bounds;
  const below=y+h-8-vertical.bottom-4, above=vertical.top-y-12;
  const desired=Math.min(element.scrollHeight,h-16);
  const down=below>=desired || below>=above;
  const maxHeight=avoid ? Math.max(0,down ? below : above) : Math.max(0,h-16);
  const top=down ? Math.min(vertical.bottom+4,y+h-8-Math.min(maxHeight,desired)) : Math.max(y+8,vertical.top-4-Math.min(maxHeight,desired));
  return {width:size+'px',maxHeight:maxHeight+'px',left:Math.max(x+8,Math.min(alignEnd ? bounds.right-size : bounds.left,x+w-size-8))+'px',top:top+'px'};
}
