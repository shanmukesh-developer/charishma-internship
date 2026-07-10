"use client";
import React, { useState, useEffect, useMemo } from "react";

// Deterministic placeholder images
const FALLBACK_IMAGES = [
  "/assets/placeholder.png",
  "/assets/placeholder_premium.png",
];

// Choose a placeholder based on alt text (stable across renders)
const getFallback = (alt: string) => {
  const index = Math.abs(
    alt.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  ) % FALLBACK_IMAGES.length;
  return FALLBACK_IMAGES[index];
};

interface SafeImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string | { src: string } | undefined | null;
  fallback?: string;
  fill?: boolean; // when true, image fills its container absolutely
  priority?: boolean; // eager loading if true
  alt?: string;
}

const resolveSrc = (src: any, fallbackUrl: string) => {
  let finalSrc = typeof src === "string" ? src : src?.src;
  
  if (!finalSrc || 
      finalSrc === "null" || 
      finalSrc === "undefined" || 
      finalSrc === "" ||
      finalSrc.includes("placeholder")) {
    return fallbackUrl;
  }
  return finalSrc;
};

export default function SafeImage({
  src,
  alt = "Image",
  className,
  style,
  fill = false,
  priority = false,
  fallback,
  ...rest
}: SafeImageProps) {
  const deterministicFallback = fallback ?? getFallback(alt);
  
  const resolvedUrl = typeof src === "string" ? src : src?.src;

  const resolved = useMemo(() => {
    return resolveSrc(src, deterministicFallback);
  }, [resolvedUrl, deterministicFallback]);

  // Initialize state synchronously
  const [imgSrc, setImgSrc] = useState<string>(resolved);

  // Update when resolved URL value changes
  useEffect(() => {
    setImgSrc(resolved);
  }, [resolved]);

  // Styles for fill mode (absolute covering)
  const containerStyle: React.CSSProperties = fill
    ? {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
      }
    : {};

  const mergedStyle: React.CSSProperties = { ...containerStyle, ...style };

  const handleError = () => {
    // Switch to fallback if the original source fails on network
    if (imgSrc !== deterministicFallback) {
      setImgSrc(deterministicFallback);
    }
  };

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imgSrc}
      alt={alt}
      className={className}
      style={mergedStyle}
      loading={priority ? "eager" : "lazy"}
      onError={handleError}
      {...rest}
    />
  );
}
