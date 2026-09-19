import { useEffect, useRef, type ReactNode } from "react";

/** Paper folds, kept deliberately simple so the mark reads at small sizes. */
export function LogoMark() {
  return (
    <svg className="brand-pigeon" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M5 29 19 26 33 15 40 20 30 33 16 36Z" fill="#bfcee2" />
      <path d="M19 26 33 15 40 20 30 27Z" fill="#f8fbff" />
      <path d="m40 20 6 3-8 1Z" fill="#d97706" />
      <path d="m5 29 12 7 1-9Z" fill="#8da9cb" />
      <g className="pigeon-wing">
        <path d="M18 29 12 5 32 20Z" fill="#eff5fd" />
        <path d="m12 5 11 21 9-6Z" fill="#d8e5f6" />
        <path d="m12 5 6 24 5-3Z" fill="#a8c1e0" />
      </g>
      <path d="m19 29 11-2-1 7Z" fill="#e4eefb" />
      <circle cx="35.4" cy="20.3" r="1" fill="#334155" />
    </svg>
  );
}

function Letter({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 100 74" aria-hidden="true">
      <rect x="5" y="5" width="90" height="64" rx="3" fill="#fff" stroke="#c4d6ea" />
      <path d="M6 7 50 42 94 7" fill="#f5f8fe" stroke="#b9cde7" />
      <path d="m6 67 30-27m58 27L65 40" fill="none" stroke="#d6e2f1" />
      <circle cx="50" cy="39" r="5" fill="#edc574" />
    </svg>
  );
}

/** Decorative only: the page remains fully usable without this layer. */
export function SkyScene() {
  return (
    <div className="sky-scene" aria-hidden="true">
      <div className="sky-haze sky-haze--one" />
      <div className="sky-haze sky-haze--two" />
      <svg className="sky-arcs" viewBox="0 0 1600 1000" preserveAspectRatio="none">
        <g fill="none" strokeLinecap="round">
          <path className="sky-arc sky-arc--one" d="M-220 750C210 960 980 920 1560 160S2060-300 1800-260" stroke="white" strokeWidth="1.5" />
          <path className="sky-arc sky-arc--two" d="M-110 1050C430 1190 1480 730 1670-110" stroke="white" strokeWidth="1" opacity=".62" />
          <path className="sky-arc sky-arc--three" d="M470-220C1450-70 1580 460 1040 770S220 1100-80 980" stroke="white" strokeWidth="1" opacity=".5" />
          <path className="sky-light-streak" d="M830 770C1110 650 1360 410 1540 160" stroke="white" strokeWidth="4" opacity=".42" />
        </g>
      </svg>
      <div className="sky-pigeon-flight">
        <svg className="hero-pigeon" viewBox="0 0 600 460">
          <path d="m72 294 167-26 195-108 75 39-99 74-115 67-107 4Z" fill="#c2d4ee" />
          <path d="m72 294 132 20-16 30Z" fill="#a7bfdf" />
          <path d="m72 294 83 72 33-22Z" fill="#f5f8fd" />
          <path d="m239 268 195-108 75 39-109 43Z" fill="#fff" />
          <path d="m400 242 109-43-99 74-115 67Z" fill="#e2ebf9" />
          <path d="m509 199 51 17-67 5Z" fill="#db9a39" />
          <path d="m509 199 51 17-57-4Z" fill="#f6d08a" />
          <g className="hero-pigeon-wing">
            <path d="M238 290 161 52 408 203Z" fill="#fff" />
            <path d="m161 52 133 214 114-63Z" fill="#eff4fc" />
            <path d="m161 52 77 238 56-24Z" fill="#d0dff2" />
            <path d="m161 52 133 214" fill="none" stroke="#fff" strokeWidth="1.5" opacity=".8" />
          </g>
          <path d="m238 290 162-48-105 98Z" fill="#f9fbff" />
          <path d="m238 290 57 50-9-37Z" fill="#b9cde8" />
          <path d="m434 160 16 55 59-16Z" fill="#f3f7fd" />
          <circle cx="472" cy="197" r="3.2" fill="#486582" />
        </svg>
      </div>
      <Letter className="sky-letter sky-letter--one" />
      <Letter className="sky-letter sky-letter--two" />
      <svg className="sky-feather" viewBox="0 0 150 230">
        <path d="M119 14C58 20 15 70 25 135c3 21 18 41 36 50C105 146 142 62 119 14Z" fill="#fff" opacity=".75" />
        <path d="M117 19C101 83 72 153 39 216M100 68l-42 9m28 29-48 4m32 33-28-1m64-94 15 29m-28 10 13 27m-30 17 12 16" fill="none" stroke="#c1d3ed" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <svg className="sky-sparkle sky-sparkle--one" viewBox="0 0 24 24">
        <path d="m12 0 2 10 10 2-10 2-2 10-2-10L0 12l10-2Z" fill="white" />
      </svg>
      <svg className="sky-sparkle sky-sparkle--two" viewBox="0 0 24 24">
        <path d="m12 0 2 10 10 2-10 2-2 10-2-10L0 12l10-2Z" fill="white" />
      </svg>
    </div>
  );
}

function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches || !("IntersectionObserver" in window)) {
      node.classList.add("is-visible");
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        node.classList.add("is-visible");
        observer.disconnect();
      }
    }, { threshold: 0.08, rootMargin: "0px 0px -32px 0px" });
    node.classList.add("reveal-ready");
    observer.observe(node);

    const onPreference = () => {
      if (motion.matches) {
        node.classList.add("is-visible");
        observer.disconnect();
      }
    };
    motion.addEventListener("change", onPreference);
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", onPreference);
      node.classList.remove("reveal-ready");
    };
  }, []);

  return ref;
}

export function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useScrollReveal();
  return <div ref={ref} className={`reveal ${className}`.trim()}>{children}</div>;
}

/** A visual response to existing buttons; never intercepts their handlers. */
export function FlightFeedback() {
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: number | undefined;
    const clearFlight = () => {
      document.querySelectorAll<SVGElement>(".brand-pigeon.is-flying").forEach((mark) => mark.classList.remove("is-flying"));
    };
    const onClick = (event: MouseEvent) => {
      if (motion.matches || !(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>("[data-pigeon-check]");
      if (!button || button.disabled) return;
      window.clearTimeout(timer);
      document.querySelectorAll<SVGElement>(".brand-pigeon").forEach((mark) => {
        mark.classList.remove("is-flying");
        // Flush only this tiny icon so a second click restarts the flap.
        mark.getBoundingClientRect();
        mark.classList.add("is-flying");
      });
      timer = window.setTimeout(clearFlight, 1200);
    };
    const onPreference = () => {
      if (motion.matches) {
        window.clearTimeout(timer);
        clearFlight();
      }
    };
    document.addEventListener("click", onClick, true);
    motion.addEventListener("change", onPreference);
    return () => {
      document.removeEventListener("click", onClick, true);
      motion.removeEventListener("change", onPreference);
      window.clearTimeout(timer);
      clearFlight();
    };
  }, []);

  return null;
}
