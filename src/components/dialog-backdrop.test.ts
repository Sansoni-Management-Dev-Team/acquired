import { expect, it, vi } from "vitest";
import { dialogBackdrop } from "./dialog-backdrop";

function setup() {
  const close = vi.fn();
  const handlers = dialogBackdrop({ current: false }, close);
  const dialog = { getBoundingClientRect: () => ({ left: 100, right: 500, top: 0, bottom: 600 }) } as HTMLDialogElement;
  const event = (x: number, child = false) => ({ target: child ? {} as HTMLElement : dialog, currentTarget: dialog, clientX: x, clientY: 200 });
  return { handlers, close, event };
}
it("dismisses an outside click once through the existing close handler", () => {
  const { handlers, close, event } = setup();
  handlers.onPointerDown(event(50));
  handlers.onClick(event(50));
  handlers.onClick(event(50));
  expect(close).toHaveBeenCalledOnce();
});
it("keeps panel content, padding and inside-to-outside drags open", () => {
  const { handlers, close, event } = setup();
  for (const child of [false, true]) {
    handlers.onPointerDown(event(200, child));
    handlers.onClick(event(200, child));
    handlers.onPointerDown(event(200, child));
    handlers.onClick(event(50));
  }
  expect(close).not.toHaveBeenCalled();
});
it("ignores outside-to-inside drags and cancelled gestures", () => {
  const { handlers, close, event } = setup();
  handlers.onPointerDown(event(50));
  handlers.onClick(event(200));
  handlers.onPointerDown(event(50));
  handlers.onPointerCancel();
  handlers.onClick(event(50));
  expect(close).not.toHaveBeenCalled();
});
