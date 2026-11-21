export const fonts = [
  ["Sans Serif","arial,sans-serif"], ["Serif","times new roman,serif"],
  ["Fixed Width","monospace"], ["Wide","arial black,sans-serif"],
  ["Narrow","arial narrow,sans-serif"], ["Comic Sans MS","comic sans ms,sans-serif"],
  ["Garamond","garamond,times new roman,serif"], ["Georgia","georgia,serif"],
  ["Tahoma","tahoma,sans-serif"], ["Trebuchet MS","trebuchet ms,sans-serif"], ["Verdana","verdana,sans-serif"],
];
export const sizes = [["Small","10px"],["Normal","13px"],["Large","18px"],["Huge","32px"]];
export const colorRows = [
  ["#000000","#444444","#666666","#999999","#cccccc","#eeeeee","#f3f3f3","#ffffff"],
  ["#ff0000","#ff9900","#ffff00","#00ff00","#00ffff","#0000ff","#9900ff","#ff00ff"],
  ["#f4cccc","#fce5cd","#fff2cc","#d9ead3","#d0e0e3","#cfe2f3","#d9d2e9","#ead1dc"],
  ["#ea9999","#f9cb9c","#ffe599","#b6d7a8","#a2c4c9","#9fc5e8","#b4a7d6","#d5a6bd"],
  ["#e06666","#f6b26b","#ffd966","#93c47d","#76a5af","#6fa8dc","#8e7cc3","#c27ba0"],
  ["#cc0000","#e69138","#f1c232","#6aa84f","#45818e","#3d85c6","#674ea7","#a64d79"],
  ["#990000","#b45f06","#bf9000","#38761d","#134f5c","#0b5394","#351c75","#741b47"],
  ["#660000","#783f04","#7f6000","#274e13","#0c343d","#073763","#20124d","#4c1130"],
];

export function currentFont(ed) {
  const first = String(ed.queryCommandValue("FontName") || "").split(",")[0].replace(/["']/g,"").trim().toLowerCase();
  return fonts.find(([,family]) => family.split(",")[0] === first)?.[0] || "Sans Serif";
}
export function currentSize(ed) {
  const value = ed.queryCommandValue("FontSize");
  const pixels = typeof value === "string" && value.endsWith("px") ? parseFloat(value) :
    parseFloat(ed.dom.getStyle(ed.selection.getNode(),"font-size",true));
  if (!Number.isFinite(pixels)) return 1;
  return sizes.reduce((best,[,size],i) => Math.abs(parseInt(size)-pixels) < Math.abs(parseInt(sizes[best][1])-pixels) ? i : best, 1);
}

const shifted = {
  KeyL:"JustifyLeft", KeyE:"JustifyCenter", KeyR:"JustifyRight",
  Digit7:"InsertOrderedList", Digit8:"InsertUnorderedList", Digit9:"mceBlockQuote", KeyX:"Strikethrough",
};
const unshifted = {BracketLeft:"Outdent", BracketRight:"Indent", Backslash:"RemoveFormat"};

// Attach to the editor so shortcuts also work while its formatting bar is hidden.
export function formattingShortcut(ed,event) {
  if (event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey)) return;
  let command=(event.shiftKey ? shifted : unshifted)[event.code], value;
  if (event.shiftKey && ["Digit5","Digit6"].includes(event.code)) {
    const step=event.code === "Digit5" ? -1 : 1;
    const index=fonts.findIndex(([name]) => name === currentFont(ed));
    command="FontName"; value=fonts[(index + step + fonts.length) % fonts.length][1];
  } else if (event.shiftKey && ["Minus","Equal"].includes(event.code)) {
    const step=event.code === "Minus" ? -1 : 1;
    command="FontSize"; value=sizes[Math.max(0,Math.min(sizes.length-1,currentSize(ed)+step))][1];
  }
  if (!command) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  ed.execCommand(command,false,value);
  ed.nodeChanged();
}
