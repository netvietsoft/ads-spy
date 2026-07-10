'use client';
import { useState } from 'react';
import { shAssetProxy } from '../api';

const SH_STATIC = 'https://sh.static.shophunter.io';
export function ShLogo({ internal, external, title, size = 24 }: { internal?: string; external?: string; title?: string; size?: number }) {
  const chain = [internal ? `${SH_STATIC}/${internal}` : '', external || ''].filter(Boolean);
  const [i, setI] = useState(0);
  const src = chain[i];
  if (!src) {
    return (
      <span className="shlogo-fallback" style={{ width: size, height: size, fontSize: Math.round(size * 0.6) }} title={title}>🏪</span>
    );
  }
  return (
    <img src={shAssetProxy(src)} alt={title || ''} width={size} height={size}
      style={{ borderRadius: 6, objectFit: 'cover', flex: '0 0 auto' }} loading="lazy"
      onError={() => setI((n) => n + 1)} />
  );
}
