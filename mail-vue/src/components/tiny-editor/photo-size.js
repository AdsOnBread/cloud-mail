// In a 495 px writing area Gmail offers 198 px and 495 px widths.
// An expanded compose window caps the same landscape photo at 206 px and 515 px.
const fitEdge = 515;

export function photoDimensions(width, height, available, small) {
  if (!(width > 0 && height > 0 && available > 0)) return null;
  const fraction = small ? 0.4 : 1;
  const scale = Math.min(1, Math.min(available, fitEdge) * fraction / width, fitEdge * fraction / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export const defaultPhotoWidth = 'min(100%, ' + fitEdge + 'px)';
export const defaultPhotoHeight = fitEdge + 'px';
