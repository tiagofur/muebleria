/**
 * Client-side image compression utility for mobile & desktop photo uploads.
 * Converts heavy camera photos (10-15MB) into lightweight WebP/JPEG (~200-400KB).
 */

export interface CompressionOptions {
  readonly maxDimension?: number;
  readonly quality?: number;
  readonly mimeType?: 'image/webp' | 'image/jpeg';
}

export async function compressImage(
  file: File | Blob,
  options: CompressionOptions = {},
): Promise<File> {
  const maxDim = options.maxDimension ?? 1920;
  const quality = options.quality ?? 0.82;
  const mimeType = options.mimeType ?? 'image/webp';

  return new Promise((resolve, reject) => {
    // If not in a browser environment with Image/Canvas support, return original
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      if (file instanceof File) {
        resolve(file);
      } else {
        resolve(new File([file], 'photo.webp', { type: mimeType }));
      }
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        let { width, height } = img;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          if (file instanceof File) resolve(file);
          else resolve(new File([file], 'photo.webp', { type: mimeType }));
          return;
        }

        // Draw image smoothly
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              if (file instanceof File) resolve(file);
              else resolve(new File([file], 'photo.webp', { type: mimeType }));
              return;
            }
            const ext = mimeType === 'image/webp' ? '.webp' : '.jpg';
            const originalName = file instanceof File ? file.name : 'photo';
            const baseName = originalName.replace(/\.[^/.]+$/, '');
            const newFile = new File([blob], `${baseName}${ext}`, { type: mimeType });
            resolve(newFile);
          },
          mimeType,
          quality,
        );
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };

    img.src = url;
  });
}
