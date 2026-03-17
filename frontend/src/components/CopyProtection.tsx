"use client";

import { useEffect } from "react";

export default function CopyProtection() {
  useEffect(() => {
    // Prevent copy
    const handleCopy = (e: ClipboardEvent) => {
      e.preventDefault();
    };

    // Prevent right-click context menu
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    // Prevent Ctrl+C, Ctrl+A, Ctrl+U, Ctrl+S
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        ["c", "a", "u", "s", "p"].includes(e.key.toLowerCase())
      ) {
        // Allow inside input/textarea
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        e.preventDefault();
      }
    };

    document.addEventListener("copy", handleCopy);
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("copy", handleCopy);
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return null;
}
