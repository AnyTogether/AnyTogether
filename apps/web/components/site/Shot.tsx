import { type ShotName, shots } from "@/lib/shots";
import type { ReactNode } from "react";

type ShotProps = {
  name: ShotName;
  alt: string;
  /** The sizes attribute: how wide the picture is drawn, so the browser fetches the right file. */
  sizes: string;
  /** The page's largest picture: fetched first, never lazily. */
  priority?: boolean;
};

/** A product picture: AVIF, then WebP, in the width the layout needs; its size known up front so
 *  nothing moves when it arrives. */
export function Shot({ name, alt, sizes, priority = false }: ShotProps) {
  const shot = shots[name];
  const set = (format: string) => shot.widths.map((w) => `/shots/${name}-${w}.${format} ${w}w`).join(", ");
  const fallback = shot.widths[Math.min(1, shot.widths.length - 1)];
  return (
    <picture>
      <source type="image/avif" srcSet={set("avif")} sizes={sizes} />
      <source type="image/webp" srcSet={set("webp")} sizes={sizes} />
      <img
        src={`/shots/${name}-${fallback}.webp`}
        width={shot.w}
        height={shot.h}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        decoding={priority ? "sync" : "async"}
        fetchPriority={priority ? "high" : "auto"}
      />
    </picture>
  );
}

/** A launcher picture on the Mac: the screen itself, no window drawn around it. */
export function MacFrame({
  children,
  className = "",
}: { children: ReactNode; title?: string; className?: string }) {
  return (
    <figure className={`device mac ${className}`}>
      <div className="screen">{children}</div>
    </figure>
  );
}

/** A launcher picture on a PC, the same way. */
export function PcFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <figure className={`device pc ${className}`}>
      <div className="screen">{children}</div>
    </figure>
  );
}

/** A phone held sideways, as it is while it is the controller. */
export function PhoneFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <figure className={`device phone ${className}`}>
      <div className="screen">{children}</div>
    </figure>
  );
}

/** A picture of the website's own pages. */
export function BrowserFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <figure className={`device browser ${className}`}>
      <div className="screen">{children}</div>
    </figure>
  );
}
