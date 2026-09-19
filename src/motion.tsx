// Purely presentational motion helpers for Pigeon.
// No dependencies beyond React. All motion is disabled by prefers-reduced-motion in CSS.
import { createElement, useEffect, useRef, useState } from "react";
import type { CSSProperties, ElementType, ReactNode } from "react";

/** Tiny scroll-reveal hook: adds `is-in` once the element enters the viewport. */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, shown } as const;
}

/** Wraps a block so it fades/rises into place when scrolled to. */
export function Reveal({
  children,
  className = "",
  delay = 0,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "section" | "li" | "article";
}) {
  const { ref, shown } = useReveal<HTMLElement>();
  return createElement(
    Tag as ElementType,
    {
      ref,
      className: "reveal " + (shown ? "is-in " : "") + className,
      style: delay ? { transitionDelay: delay + "ms" } : undefined,
    },
    children,
  );
}

/**
 * Class-toggle helper: makes every pigeon mark on the page flap for ~1.2s.
 * Safe to call from any click handler; it never touches data or mutations.
 */
export function flapPigeon(ms = 1200) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.add("pigeon-flapping");
  window.clearTimeout((flapPigeon as unknown as { _t?: number })._t);
  (flapPigeon as unknown as { _t?: number })._t = window.setTimeout(() => {
    root.classList.remove("pigeon-flapping");
  }, ms);
}

/** Full-bleed daylight sky: pale gradient, slow drifting light streaks, a low warm glow. */
export function SkyBackdrop({ variant = "hero" }: { variant?: "hero" | "app" }) {
  return (
    <div className={"sky sky-" + variant} aria-hidden="true">
      <div className="sky-wash" />
      <svg className="sky-arcs" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="arcLum" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="45%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="72%" stopColor="#fff7e6" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="arcGold" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0" />
            <stop offset="50%" stopColor="#f0a833" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </linearGradient>
          <filter id="arcBlur" x="-20%" y="-60%" width="140%" height="220%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>
        <g filter="url(#arcBlur)">
          <path className="arc arc-1" d="M-200 250 C 300 90, 900 120, 1700 40" stroke="url(#arcLum)" />
          <path className="arc arc-2" d="M-200 430 C 380 250, 1000 300, 1700 190" stroke="url(#arcGold)" />
          <path className="arc arc-3" d="M-200 640 C 320 520, 1060 560, 1700 420" stroke="url(#arcLum)" />
        </g>
        <path className="arc arc-hair" d="M-200 330 C 340 170, 960 210, 1700 110" stroke="url(#arcGold)" />
        <path className="arc arc-hair arc-hair-2" d="M-200 720 C 420 610, 1020 650, 1700 520" stroke="url(#arcLum)" />
      </svg>
      <div className="sky-horizon" />
      <div className="sky-motes">
        {Array.from({ length: 14 }).map((_, i) => (
          <i key={i} style={{ "--i": i } as CSSProperties} />
        ))}
      </div>
      <div className="sky-vignette" />
    </div>
  );
}

/** Origami carrier pigeon in slate paper. Glides in on load, then idles with a slow float. */
export function PigeonGlider() {
  return (
    <div className="glider" aria-hidden="true">
      <svg className="glider-svg" viewBox="0 0 320 200" fill="none">
        <defs>
          <linearGradient id="paperA" x1="0.1" y1="0" x2="0.9" y2="1">
            <stop offset="0%" stopColor="#334155" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#0f172a" stopOpacity="0.92" />
          </linearGradient>
          <linearGradient id="paperB" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#475569" stopOpacity="0.92" />
            <stop offset="100%" stopColor="#1e293b" stopOpacity="0.95" />
          </linearGradient>
          <linearGradient id="paperC" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#0f172a" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#3f4f6b" stopOpacity="0.85" />
          </linearGradient>
        </defs>
        {/* trailing light streak */}
        <path className="glider-trail" d="M12 138 C 80 128, 120 116, 158 104" stroke="#ffffff" strokeWidth="1.4" />
        {/* body */}
        <path className="g-body" d="M150 104 L286 62 L214 132 L176 128 Z" fill="url(#paperA)" />
        {/* tail */}
        <path className="g-tail" d="M150 104 L176 128 L128 146 Z" fill="url(#paperC)" />
        {/* far wing */}
        <path className="g-wing g-wing-far" d="M196 112 L250 34 L214 122 Z" fill="url(#paperB)" />
        {/* near wing */}
        <path className="g-wing g-wing-near" d="M190 110 L142 30 L226 100 Z" fill="url(#paperB)" />
        {/* beak + eye */}
        <path className="g-beak" d="M286 62 L306 66 L285 74 Z" fill="#d97706" />
        <circle className="g-eye" cx="272" cy="72" r="2.6" fill="#fbfaf6" />
      </svg>
    </div>
  );
}

/** Small brand mark used in the topbar and eyebrow; flaps when `flapPigeon()` fires. */
export function PigeonMark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="markSky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e0e7ff" />
          <stop offset="100%" stopColor="#dbeafe" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="31" height="31" rx="7" fill="url(#markSky)" stroke="rgba(15,23,42,0.12)" />
      <g className="mark-bird">
        <path d="M8 18 L23 11 L15 21 L11 20 Z" fill="#0f172a" />
        <path className="mark-wing" d="M13 18 L11 8 L21 15 Z" fill="#475569" />
        <path d="M23 11 L26 12 L22.6 13.6 Z" fill="#d97706" />
      </g>
    </svg>
  );
}

/** Three drifting dots for "checking / pending" states. */
export function PulseDots({ label }: { label?: string }) {
  return (
    <span className="pulse-dots" role="status">
      <i />
      <i />
      <i />
      {label ? <span className="pulse-label">{label}</span> : null}
    </span>
  );
}
