import type { MouseEvent } from "react";

type BackdropEvent = Pick<MouseEvent<HTMLDialogElement>, "target" | "currentTarget" | "clientX" | "clientY">;

function isBackdrop(event: BackdropEvent) {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
}

/** Require the gesture to start and finish outside, so dragging from the panel never dismisses it. */
export function dialogBackdrop(pressed: { current: boolean }, close: () => void) {
  return {
    onPointerDown(event: BackdropEvent) { pressed.current = isBackdrop(event); },
    onPointerCancel() { pressed.current = false; },
    onClick(event: BackdropEvent) {
      const dismiss = pressed.current && isBackdrop(event);
      pressed.current = false;
      if (dismiss) close();
    },
  };
}
