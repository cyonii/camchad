export function camChadManualChunks(id: string): string | void {
  if (!id.includes('/node_modules/')) {
    return undefined;
  }

  if (id.includes('/@mediapipe/')) {
    return 'vendor-mediapipe';
  }

  if (id.includes('/recharts/') || id.includes('/d3-')) {
    return 'vendor-charts';
  }

  if (id.includes('/lucide-react/')) {
    return 'vendor-icons';
  }

  if (id.includes('/react/') || id.includes('/react-dom/')) {
    return 'vendor-react';
  }

  return undefined;
}
