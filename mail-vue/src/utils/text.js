export function getTextWidth(text, font = '14px sans-serif') {
    // Set the canvas resolution explicitly
    const canvas = document.createElement('canvas');
    canvas.width = 2000; // Use a large canvas
    canvas.style.width = '1000px'; // Keep CSS scaling separate from the canvas resolution
    const ctx = canvas.getContext('2d');
    ctx.font = font;
    return ctx.measureText(text).width;
}