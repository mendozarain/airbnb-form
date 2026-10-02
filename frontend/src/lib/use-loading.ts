import { useEffect, useRef, useState } from "react";

/**
 * Rotating loading label: after a few seconds it changes so a slow load still looks alive.
 */
export function useLoadingMessage(base: string, active = true) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (!active) {
      setStage(0);
      return;
    }
    const first = window.setTimeout(() => setStage(1), 3000);
    const second = window.setTimeout(() => setStage(2), 9000);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, [active]);
  return [base, "Still working…", "Almost there…"][stage];
}

/** Shows after ~150ms (no flash on fast loads) and stays at least ~400ms once shown. */
export function useDelayedLoading(loading: boolean) {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    if (loading) {
      const timer = window.setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, 150);
      return () => window.clearTimeout(timer);
    }
    if (!visible) return;
    const remaining = Math.max(0, 400 - (Date.now() - shownAt.current));
    const timer = window.setTimeout(() => setVisible(false), remaining);
    return () => window.clearTimeout(timer);
  }, [loading, visible]);
  return visible;
}
