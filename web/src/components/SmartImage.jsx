'use client';

import Image from 'next/image';

export default function SmartImage({
  src,
  alt = '',
  className,
  width = 800,
  height = 600,
  sizes = '(max-width: 768px) 100vw, 800px',
  priority = false,
  fill = false,
  style,
  ...rest
}) {
  if (!src) return null;

  if (fill) {
    return (
      <div className={className} style={{ position: 'relative', width: '100%', height: '100%', ...style }}>
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          loading={priority ? 'eager' : 'lazy'}
          style={{ objectFit: 'cover' }}
          {...rest}
        />
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      className={className}
      priority={priority}
      loading={priority ? 'eager' : 'lazy'}
      style={style}
      {...rest}
    />
  );
}
