import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function QRBadge({ value, size = 170 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, { width: size * 2, margin: 1 }).then((url) => {
      if (active) setDataUrl(url);
    });
    return () => {
      active = false;
    };
  }, [value, size]);

  if (!dataUrl) return <div style={{ width: size, height: size }} />;
  return <img src={dataUrl} width={size} height={size} style={{ borderRadius: 6 }} alt="QR de pointage" />;
}
