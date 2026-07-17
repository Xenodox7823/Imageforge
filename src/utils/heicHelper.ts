/**
 * Utility to dynamically load heic2any from CDN and convert HEIC/HEIF files to JPEG.
 */

let heic2anyPromise: Promise<any> | null = null;

export const loadHeic2Any = (): Promise<any> => {
  if (heic2anyPromise) return heic2anyPromise;

  heic2anyPromise = new Promise((resolve, reject) => {
    if ((window as any).heic2any) {
      resolve((window as any).heic2any);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
    script.async = true;
    script.onload = () => {
      resolve((window as any).heic2any);
    };
    script.onerror = () => {
      heic2anyPromise = null; // Reset to retry on next attempt
      reject(new Error('Failed to load HEIC converter library.'));
    };
    document.head.appendChild(script);
  });

  return heic2anyPromise;
};

export const convertHeicToJpeg = async (file: File): Promise<File> => {
  try {
    const heic2any = await loadHeic2Any();
    const convertedBlob = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.9
    });
    const resultBlob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
    return new File([resultBlob], file.name.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg'), {
      type: 'image/jpeg',
      lastModified: file.lastModified
    });
  } catch (err) {
    throw new Error('HEIC conversion failed: ' + (err instanceof Error ? err.message : String(err)));
  }
};
