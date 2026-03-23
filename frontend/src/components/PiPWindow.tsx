"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  children: React.ReactNode;
  onClose: () => void;
  width?: number;
  height?: number;
}

export default function PiPWindow({
  children,
  onClose,
  width = 480,
  height = 720,
}: Props) {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const closedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let pipWin: Window | null = null;
    closedRef.current = false;

    pipWin = window.open("", "_blank", `width=${width},height=${height},popup=yes`);
    if (!pipWin) {
      onCloseRef.current();
      return;
    }

    pipWin.document.title = "F1 Replay — PiP";
    pipWin.document.body.style.margin = "0";
    pipWin.document.body.style.padding = "0";
    pipWin.document.body.style.backgroundColor = "#0B0B11";
    pipWin.document.body.style.color = "#e5e7eb";
    pipWin.document.body.style.overflow = "hidden";

    // Add base tag so relative URLs (fonts, images) resolve correctly
    const base = pipWin.document.createElement('base');
    base.href = window.location.origin;
    pipWin.document.head.appendChild(base);

    // Apply main window's classes to PiP window so fonts and theme variables work
    pipWin.document.documentElement.className = document.documentElement.className;
    pipWin.document.body.className = document.body.className;

    // Copy stylesheets from the main document
    Array.from(document.head.querySelectorAll('style, link[rel="stylesheet"]')).forEach(node => {
      pipWin!.document.head.appendChild(node.cloneNode(true));
    });

    // Copy constructed/adopted stylesheets (used by CSS-in-JS / Next.js)
    try {
      if (document.adoptedStyleSheets?.length) {
        const sheets: CSSStyleSheet[] = [];
        for (const sheet of document.adoptedStyleSheets) {
          const clone = new CSSStyleSheet();
          const rules = Array.from(sheet.cssRules).map(r => r.cssText).join("\n");
          clone.replaceSync(rules);
          sheets.push(clone);
        }
        pipWin!.document.adoptedStyleSheets = sheets;
      }
    } catch {}

    // Observe new <style>/<link> nodes added dynamically by Next.js
    const headObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((n) => {
          if (n instanceof HTMLStyleElement || (n instanceof HTMLLinkElement && n.rel === "stylesheet")) {
            pipWin?.document.head.appendChild(n.cloneNode(true));
          }
        });
      }
    });
    headObserver.observe(document.head, { childList: true });

    const mount = pipWin.document.createElement("div");
    mount.id = "pip-root";
    mount.style.width = "100%";
    mount.style.height = "100vh";
    mount.style.display = "flex";
    mount.style.flexDirection = "column";
    pipWin.document.body.appendChild(mount);
    containerRef.current = mount;

    pipWin.addEventListener("beforeunload", () => {
      if (!closedRef.current) {
        closedRef.current = true;
        onCloseRef.current();
      }
    });

    // Close PiP when main window unloads/navigates
    const handleMainUnload = () => {
      if (pipWin && !pipWin.closed) {
        pipWin.close();
      }
    };
    window.addEventListener("beforeunload", handleMainUnload);
    window.addEventListener("pagehide", handleMainUnload);

    setPipWindow(pipWin);

    return () => {
      closedRef.current = true;
      headObserver.disconnect();
      window.removeEventListener("beforeunload", handleMainUnload);
      window.removeEventListener("pagehide", handleMainUnload);
      if (pipWin && !pipWin.closed) {
        pipWin.close();
      }
      setPipWindow(null);
      containerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pipWindow || !containerRef.current) return null;

  return createPortal(children, containerRef.current);
}
