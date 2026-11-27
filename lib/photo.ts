export type CompressedPhotoDraft = {
  id: string;
  base64: string;
  preview: string;
};

export function pickCompressedPhoto(): Promise<CompressedPhotoDraft | null> {
  if (typeof document === 'undefined') return Promise.reject(new Error('Pilih foto hanya tersedia melalui browser.'));
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Gagal membaca gambar.'));
      reader.onload = () => {
        const image = new window.Image();
        image.onerror = () => reject(new Error('File yang dipilih bukan gambar yang valid.'));
        image.onload = () => {
          const scale = Math.min(1, 1440 / Math.max(image.width, image.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const context = canvas.getContext('2d');
          if (!context) return reject(new Error('Browser tidak dapat memproses gambar.'));
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (!blob) return reject(new Error('Gagal mengompres gambar.'));
            if (blob.size > 2 * 1024 * 1024) return reject(new Error('Ukuran gambar setelah kompresi masih lebih dari 2 MB.'));
            const compressedReader = new FileReader();
            compressedReader.onerror = () => reject(new Error('Gagal menyiapkan gambar.'));
            compressedReader.onload = () => {
              const preview = String(compressedReader.result ?? '');
              resolve({ id: crypto.randomUUID(), base64: preview.split(',')[1] ?? '', preview });
            };
            compressedReader.readAsDataURL(blob);
          }, 'image/jpeg', 0.78);
        };
        image.src = String(reader.result ?? '');
      };
      reader.readAsDataURL(file);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
