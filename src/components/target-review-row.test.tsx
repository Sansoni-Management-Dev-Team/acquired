import { expect, it, vi } from "vitest";
import type { KeyboardEvent, MouseEvent } from "react";
import { TargetReviewRow } from "./target-review-row";

function row() {
  const onReview = vi.fn();
  return { onReview, props: TargetReviewRow({ companyName: "Food Safety Culture", onReview, children: null }).props };
}
function click(interactive = false, selecting = false) {
  return { target: { closest: vi.fn(() => interactive ? {} : null) }, currentTarget: { ownerDocument: { getSelection: () => ({ isCollapsed: !selecting }) } } } as unknown as MouseEvent<HTMLTableRowElement>;
}
it("opens review from a non-interactive cell, with a named keyboard focus target", () => {
  const { props, onReview } = row();
  props.onClick(click());
  expect(onReview).toHaveBeenCalledOnce();
  expect(props.tabIndex).toBe(0);
  expect(props["aria-label"]).toBe("Review Food Safety Culture");
});
it("leaves interactive descendants and text selection alone", () => {
  const { props, onReview } = row();
  props.onClick(click(true));
  props.onClick(click(false, true));
  expect(onReview).not.toHaveBeenCalled();
});
it.each(["Enter", " "])("opens a focused row with %s and prevents its default action", key => {
  const { props, onReview } = row();
  const target = {};
  const preventDefault = vi.fn();
  props.onKeyDown({ key, target, currentTarget: target, preventDefault } as unknown as KeyboardEvent<HTMLTableRowElement>);
  expect(onReview).toHaveBeenCalledOnce();
  expect(preventDefault).toHaveBeenCalledOnce();
});
it("does not intercept child keyboard events or unrelated keys", () => {
  const { props, onReview } = row();
  const target = {};
  const preventDefault = vi.fn();
  props.onKeyDown({ key: "Enter", target: {}, currentTarget: target, preventDefault } as unknown as KeyboardEvent<HTMLTableRowElement>);
  props.onKeyDown({ key: "ArrowDown", target, currentTarget: target, preventDefault } as unknown as KeyboardEvent<HTMLTableRowElement>);
  expect(onReview).not.toHaveBeenCalled();
  expect(preventDefault).not.toHaveBeenCalled();
});
