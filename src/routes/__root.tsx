import React, { useEffect } from "react";

// Root layout / route wrapper
// Adds a client-side visitor tracker that records anonymous visitor id in localStorage
// and sends POST requests on initial load and on history navigation events.
// This file is intentionally client-safe (guards against server execution) and
// silently swallows errors so it never interrupts the app.

function makeVisitorId() {
  // simple compact id - not crypto-secure but fine for anonymous tracking
  return (
    "v_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
  );
}

export default function Root({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      let id = localStorage.getItem("jb_v");
      if (!id) {
        id = makeVisitorId();
        try {
          localStorage.setItem("jb_v", id);
        } catch (e) {
          // ignore quota/privacy errors
        }
      }

      const endpoint =
        "https://wake-zen-planner.lovable.app/api/public/track";

      const sendTrack = () => {
        try {
          const payload = {
            path: window.location.pathname,
            referrer: document.referrer,
            utm_source:
              new URLSearchParams(window.location.search).get("utm_source") || "",
            visitor: id,
          };

          // Use fetch with keepalive so the browser can send it during navigation/unload.
          fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            keepalive: true,
          }).catch(() => {
            /* intentionally ignore errors */
          });
        } catch (e) {
          // swallow any errors
        }
      };

      // Initial page view
      sendTrack();

      // Track SPA-like navigations by wrapping history methods
      const origPush = history.pushState;
      const origReplace = history.replaceState;

      // Override but preserve original behaviour
      history.pushState = function (...args: any[]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = origPush.apply(this, args as any);
        try {
          sendTrack();
        } catch (e) {
          /* ignore */
        }
        return result;
      } as any;

      history.replaceState = function (...args: any[]) {
        const result = origReplace.apply(this, args as any);
        try {
          sendTrack();
        } catch (e) {
          /* ignore */
        }
        return result;
      } as any;

      // popstate for back/forward
      window.addEventListener("popstate", sendTrack);

      return () => {
        // best-effort cleanup
        try {
          window.removeEventListener("popstate", sendTrack);
        } catch (e) {
          /* ignore */
        }
        // Note: deliberately not restoring history methods to avoid surprising runtime
      };
    } catch (e) {
      // swallow any unexpected errors
    }
  }, []);

  return <>{children}</>;
}
