import React, { useState, useEffect } from 'react';
import { Image, ImageProps, ImageSourcePropType } from 'react-native';

const FALLBACK_IMAGE_URI = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&q=80';

interface SafeImageProps extends Omit<ImageProps, 'source'> {
  source?: ImageSourcePropType | { uri?: string | null } | null;
  fallbackUri?: string;
}

export default function SafeImage({
  source,
  fallbackUri = FALLBACK_IMAGE_URI,
  style,
  onError,
  ...props
}: SafeImageProps) {
  const [hasError, setHasError] = useState(false);
  const [imgSource, setImgSource] = useState<ImageSourcePropType>({ uri: fallbackUri });

  // Extract primitive key to prevent infinite useEffect loops on inline object references {{ uri: '...' }}
  const uriKey = typeof source === 'number' ? source : (typeof source === 'object' && source && 'uri' in source ? (source.uri || '') : '');

  useEffect(() => {
    setHasError(false);
    if (!source) {
      setImgSource({ uri: fallbackUri });
      return;
    }

    if (typeof source === 'number') {
      setImgSource(source);
    } else if (typeof source === 'object' && 'uri' in source) {
      if (!source.uri || typeof source.uri !== 'string' || source.uri.trim() === '') {
        setImgSource({ uri: fallbackUri });
      } else {
        setImgSource({ uri: source.uri });
      }
    } else {
      setImgSource({ uri: fallbackUri });
    }
  }, [uriKey, fallbackUri]);

  const handleError = (e: any) => {
    if (!hasError) {
      setHasError(true);
      setImgSource({ uri: fallbackUri });
    }
    if (onError) {
      onError(e);
    }
  };

  return (
    <Image
      {...props}
      source={imgSource}
      style={style}
      onError={handleError}
    />
  );
}
