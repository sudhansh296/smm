"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface LogoProps {
  /** Controls size + shape, e.g. "w-9 h-9 rounded-xl" */
  className?: string;
  /** Fallback-letter size when no logo file is present yet, e.g. "text-base" */
  textClassName?: string;
}

/**
 * Renders /public/logo.png if present, falling back to the "N" placeholder
 * box (same look the app shipped with) if the file is missing or fails to load.
 */
export function Logo({ className = "w-9 h-9 rounded-xl", textClassName = "text-base" }: LogoProps) {
  const [imgFailed, setImgFailed] = useState(false);

  if (imgFailed) {
    return (
      <div className={cn("bg-primary flex items-center justify-center shadow-sm shrink-0", className)}>
        <span className={cn("text-white font-bold", textClassName)}>N</span>
      </div>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src="/logo.png"
      alt="NexusSMM"
      className={cn("object-contain shrink-0", className)}
      onError={() => setImgFailed(true)}
    />
  );
}
