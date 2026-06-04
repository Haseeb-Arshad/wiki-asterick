import { useEffect, useCallback } from "react";
import { AsteriskMark } from "./AsteriskIcon";

interface HighlightPopupProps {
  position: { x: number; y: number };
  onSave: () => void;
  onClose: () => void;
}

export function HighlightPopup({ position, onSave, onClose }: HighlightPopupProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const popupX = Math.min(position.x, window.innerWidth - 220);
  const popupY = position.y > 80 ? position.y : position.y + 40;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 animate-slide-in"
        style={{
          left: `${popupX}px`,
          top: `${popupY}px`,
          transform: "translate(-50%, -100%)",
        }}
      >
        <div className="flex items-center gap-0.5 bg-ink text-paper rounded shadow-xl overflow-hidden">
          <button
            onClick={onSave}
            className="flex items-center gap-2 px-3 py-2 hover:bg-ink-light transition-colors"
            title="Save highlight"
          >
            <AsteriskMark size={16} className="text-accent" />
            <span className="font-sans text-[13px]">Save highlight</span>
          </button>
          <button
            onClick={onClose}
            className="px-3 py-2 hover:bg-ink-light transition-colors text-paper/60"
            title="Cancel"
          >
            <span className="font-sans text-[13px]">x</span>
          </button>
        </div>
        <div
          className="w-3 h-3 bg-ink rotate-45 mx-auto"
          style={{ marginTop: "-6px" }}
        />
      </div>
    </>
  );
}
