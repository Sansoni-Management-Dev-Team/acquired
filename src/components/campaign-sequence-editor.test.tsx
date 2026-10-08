import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Node, Edge, ReactFlowProps } from "@xyflow/react";
import { campaignDefinition } from "@/domain/campaign";
import type { CampaignDraft, CampaignStep } from "@/domain/campaign";

const capture = vi.hoisted(() => ({ flow: null as ReactFlowProps<Node, Edge> | null }));

vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: ReactFlowProps<Node, Edge>) => { capture.flow = props; return <div>{props.nodes?.map(node => <div key={node.id}>{node.data.label as React.ReactNode}</div>)}{props.children}</div>; },
  Background: () => null,
  Controls: () => null,
  MiniMap: () => <div>Sequence minimap</div>,
}));
import { CampaignSequenceEditor } from "./campaign-sequence-editor";

it.each(["whatsapp", "linkedin"] as const)("offers and edits a saved %s node", kind => {
  const step: CampaignStep = { id: "b03dfa99-0b7c-47c5-9a76-a815e171b822", kind, title: "Follow-up", body: "Hi {{first_name}}" };
  const html = renderToStaticMarkup(<CampaignSequenceEditor draft={{ steps: [step] }} selectedStepId={step.id} onChange={() => {}} onSelect={() => {}} />);
  expect(html).toContain("WhatsApp");
  expect(html).toContain("LinkedIn");
  expect(html.match(/draggable="true"/g)).toHaveLength(4);
  expect(html).toContain(`${kind === "whatsapp" ? "WhatsApp" : "LinkedIn"} settings`);
  expect(html).toContain("Hi {{first_name}}");
  expect(html).not.toContain("Days to wait");
  expect(html).not.toContain(">Subject<");
  expect(html).not.toContain("To publish:");
});

it("renders branch nodes, allocation controls and separate path editing", () => {
  const first: CampaignStep = { id: "b03dfa99-0b7c-47c5-9a76-a815e171b822", kind: "email", title: "Introduction", subject: "Hello", body: "Hi" };
  const split = { id: "57cff001-6c6b-46c1-bd2e-594b3216f116", afterStepId: first.id, title: "Variants", percentage: 30,
    pathA: [{ id: "65caf381-c46a-42ea-88f1-4b2dc5a007ee", kind: "wait" as const, title: "One day", days: 1 }, { ...first, id: "4fd7f1b2-7367-4a94-8129-cb1cf4954ad0", title: "Variant A" }],
    pathB: [{ id: "e928b197-2cc0-4d6a-80ed-77b1b6622ef3", kind: "wait" as const, title: "Five days", days: 5 }, { ...first, id: "fb27389c-b213-4323-ab03-decc48ecb3b0", title: "Variant B" }],
  };
  const draft = { steps: [first], splits: [split] };
  const html = renderToStaticMarkup(<CampaignSequenceEditor draft={draft} selectedStepId={split.id} onChange={() => {}} onSelect={() => {}} />);
  for (const text of ["Split path settings", "Path A allocation (%)", "Path A: 30%", "Path B: 70%", "Variant A", "Variant B", "Edit path A", "Edit path B"]) expect(html).toContain(text);
  expect(html).not.toContain("To publish:");
  const branch = renderToStaticMarkup(<CampaignSequenceEditor draft={draft} selectedStepId={split.pathB[1].id} onChange={() => {}} onSelect={() => {}} />);
  expect(branch).toContain("Variants · Path B"); expect(branch).toContain("Email settings");
});

function deleteButton(id: string) {
  const node = capture.flow!.nodes!.find(node => node.id === id)!;
  const label = node.data.label as React.ReactElement<{ children: React.ReactNode }>;
  return React.Children.toArray(label.props.children).find(child => React.isValidElement(child) && child.type === "button" && String((child.props as React.ButtonHTMLAttributes<HTMLButtonElement>)["aria-label"]).startsWith("Delete")) as React.ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement>>;
}

function deletionDraft(): CampaignDraft {
  const first: CampaignStep = { id: "first", kind: "email", title: "Introduction", subject: "Hi", body: "Hello" };
  const wait: CampaignStep = { id: "wait", kind: "wait", title: "Wait", days: 3 };
  const split = { id: "split", title: "Variants", afterStepId: first.id, percentage: 50,
    pathA: [{ ...wait, id: "a-wait" }, { ...first, id: "a-message" }],
    pathB: [{ ...wait, id: "b-wait" }, { ...first, id: "b-message" }],
  };
  return { steps: [first, wait, { ...first, id: "last", title: "Last" }], splits: [split] };
}

it("deletes the last message and allows a new message on the empty flow", () => {
  const step: CampaignStep = { id: crypto.randomUUID(), kind: "email", title: "Thoughtful follow-up", subject: "Hi", body: "Hello" };
  const onChange = vi.fn(), onSelect = vi.fn();
  renderToStaticMarkup(<CampaignSequenceEditor draft={{ steps: [step] }} selectedStepId={step.id} onChange={onChange} onSelect={onSelect} />);
  const button = deleteButton(step.id);
  expect(button.props.disabled).toBe(false);
  button.props.onClick!({ stopPropagation: vi.fn() } as unknown as React.MouseEvent<HTMLButtonElement>);
  expect(onChange).toHaveBeenCalledWith({ steps: [] });
  expect(onSelect).toHaveBeenCalledWith(null);
  renderToStaticMarkup(<CampaignSequenceEditor draft={onChange.mock.lastCall![0]} selectedStepId={null} onChange={onChange} onSelect={onSelect} />);
  expect(capture.flow!.nodes!.map(node => node.id)).toEqual(["start", "end"]);
  const edge = capture.flow!.edges![0];
  expect(edge).toMatchObject({ source: "start", target: "end" });
  (edge.data!.onInsert as (kind: string) => void)("email");
  expect(onChange.mock.lastCall![0].steps).toHaveLength(1);
  expect(campaignDefinition.safeParse({ ...onChange.mock.lastCall![0], schemaVersion: 1 }).success).toBe(true);
});

it("deletes a connection without deleting its nodes and restores it using their handles", () => {
  const step: CampaignStep = { id: crypto.randomUUID(), kind: "email", title: "Follow-up", subject: "Hi", body: "Hello" };
  const draft = { steps: [step] };
  const onChange = vi.fn(), onSelect = vi.fn();
  renderToStaticMarkup(<CampaignSequenceEditor draft={draft} selectedStepId={step.id} onChange={onChange} onSelect={onSelect} />);
  const edge = capture.flow!.edges!.find(edge => edge.source === "start")!;
  (edge.data!.onDelete as () => void)();
  const disconnected = onChange.mock.lastCall![0] as CampaignDraft;
  expect(disconnected.steps).toEqual(draft.steps);
  expect(disconnected.disconnectedConnections).toEqual([{ source: "start", target: step.id }]);
  const html = renderToStaticMarkup(<CampaignSequenceEditor draft={disconnected} selectedStepId={null} onChange={onChange} onSelect={onSelect} />);
  expect(html).toContain("Reconnect deleted connections before publishing");
  expect(capture.flow!.edges!.some(edge => edge.source === "start")).toBe(false);
  const connection = { source: "start", target: step.id, sourceHandle: null, targetHandle: null };
  expect(capture.flow!.isValidConnection!(connection)).toBe(true);
  capture.flow!.onConnect!(connection);
  expect(onChange.mock.lastCall![0]).toEqual(draft);
});

it("deletes a split from its node icon and selects its anchor when a branch was selected", () => {
  const draft = deletionDraft();
  const onChange = vi.fn(), onSelect = vi.fn();
  renderToStaticMarkup(<CampaignSequenceEditor draft={draft} selectedStepId="b-message" onChange={onChange} onSelect={onSelect} />);
  const button = deleteButton("split");
  expect(button.props["aria-label"]).toBe("Delete split Variants and both paths");
  expect(button.props.className).toContain("nodrag nopan");
  const stopPropagation = vi.fn();
  button.props.onClick!({ stopPropagation } as unknown as React.MouseEvent<HTMLButtonElement>);
  expect(stopPropagation).toHaveBeenCalledOnce();
  expect(onChange).toHaveBeenCalledWith({ ...draft, splits: [] });
  expect(onSelect).toHaveBeenCalledWith("first");
});

it("uses the node icon to remove an unselected step without changing the selected node", () => {
  const draft = deletionDraft();
  const onChange = vi.fn(), onSelect = vi.fn();
  renderToStaticMarkup(<CampaignSequenceEditor draft={draft} selectedStepId="split" onChange={onChange} onSelect={onSelect} />);
  expect(deleteButton("first").props.disabled).toBe(true);
  expect(deleteButton("a-message").props.disabled).toBe(true);
  deleteButton("last").props.onClick!({ stopPropagation: vi.fn() } as unknown as React.MouseEvent<HTMLButtonElement>);
  expect(onChange).toHaveBeenCalledWith({ ...draft, steps: draft.steps.slice(0, 2) });
  expect(onSelect).not.toHaveBeenCalled();
});

it("moves a split freely without changing its anchor or branches", () => {
  const draft = deletionDraft();
  const onChange = vi.fn(), onSelect = vi.fn();
  renderToStaticMarkup(<CampaignSequenceEditor draft={draft} selectedStepId="split" onChange={onChange} onSelect={onSelect} />);
  const flow = capture.flow!;
  const splitNode = flow.nodes!.find(node => node.id === "split")!;
  const anchor = flow.nodes!.find(node => node.id === "last")!;
  expect(splitNode.draggable).toBe(true);
  flow.onNodeDragStop!({} as MouseEvent, { ...splitNode, position: { x: anchor.position.x, y: anchor.position.y + 120 } }, []);
  expect(onChange).toHaveBeenCalledWith({ ...draft, splits: [{ ...draft.splits![0], position: { x: anchor.position.x, y: anchor.position.y + 120 } }] });
  expect(onSelect).toHaveBeenCalledWith("split");
});

it("renders history, clipboard and live status controls and supplies validated editable edges", () => {
  const draft = deletionDraft();
  const html = renderToStaticMarkup(<CampaignSequenceEditor draft={draft} selectedStepId="split" onChange={() => {}} onSelect={() => {}} history={{ canUndo: true, canRedo: true, undo: () => {}, redo: () => {} }} />);
  for (const label of ["Undo", "Redo", "Duplicate", "Copy", "Paste", "Live status", "Sequence minimap", "Copy path A", "Duplicate A to B"]) expect(html).toContain(label);
  expect(capture.flow!.nodesConnectable).toBe(true);
  expect(capture.flow!.onReconnect).toBeTypeOf("function");
  expect(capture.flow!.edges!.find(edge => edge.source === "first" && edge.target === "split")?.reconnectable).toBe("target");
  expect(capture.flow!.edges!.every(edge => edge.type === "campaign")).toBe(true);
  expect(capture.flow!.isValidConnection!({ source: "first", target: "first", sourceHandle: null, targetHandle: null })).toBe(false);
});

it.each(["first", "a-message", "wait"])("persists free movement of %s without changing execution order", id => {
  const draft = deletionDraft();
  const onChange = vi.fn();
  renderToStaticMarkup(<CampaignSequenceEditor draft={draft} selectedStepId={id} onChange={onChange} onSelect={() => {}} />);
  const node = capture.flow!.nodes!.find(node => node.id === id)!;
  const position = { x: -150, y: 800 };
  capture.flow!.onNodeDragStop!({} as MouseEvent, { ...node, position }, []);
  const next = onChange.mock.calls[0][0] as CampaignDraft;
  expect(next.steps.map(step => step.id)).toEqual(draft.steps.map(step => step.id));
  expect(next.splits![0].afterStepId).toBe(draft.splits![0].afterStepId);
  renderToStaticMarkup(<CampaignSequenceEditor draft={next} selectedStepId={id} onChange={() => {}} onSelect={() => {}} />);
  expect(capture.flow!.nodes!.find(node => node.id === id)!.position).toEqual(position);
});

it("edits an optional connection note without showing a message-body validation error", () => {
  const step: CampaignStep = { id: "b03dfa99-0b7c-47c5-9a76-a815e171b822", kind: "linkedin", action: "connect", title: "Connect", body: "" };
  const html = renderToStaticMarkup(<CampaignSequenceEditor draft={{ steps: [step] }} selectedStepId={step.id} onChange={() => {}} onSelect={() => {}} />);
  expect(html).toContain("Connection note (optional");
  expect(html).toContain("Send connection request");
  expect(html).not.toContain("To publish:");
});

it("offers a split at subscription, renders both introductions and removes it cleanly", () => {
  const first: CampaignStep = { id: "b03dfa99-0b7c-47c5-9a76-a815e171b822", kind: "email", title: "Introduction", subject: "Hello", body: "Hi" };
  const onChange = vi.fn(), onSelect = vi.fn();
  renderToStaticMarkup(<CampaignSequenceEditor draft={{ steps: [first] }} selectedStepId={first.id} onChange={onChange} onSelect={onSelect} />);
  const onSplit = capture.flow!.edges!.find(edge => edge.source === "start")!.data!.onSplit as () => void;
  expect(onSplit).toBeTypeOf("function");
  onSplit();
  const draft = onChange.mock.calls[0][0] as CampaignDraft;
  expect(campaignDefinition.safeParse({ ...draft, schemaVersion: 1 }).success).toBe(true);
  const split = draft.splits![0];
  expect(split.afterStepId).toBe("start");
  expect(split.pathA[0].kind).toBe("email");
  expect(split.pathB[0].kind).toBe("email");
  renderToStaticMarkup(<CampaignSequenceEditor draft={draft} selectedStepId={split.id} onChange={onChange} onSelect={onSelect} />);
  const edges = capture.flow!.edges!;
  expect(edges.some(edge => edge.source === "start" && edge.target === split.id)).toBe(true);
  for (const path of [split.pathA, split.pathB]) {
    expect(edges.some(edge => edge.source === split.id && edge.target === path[0].id)).toBe(true);
    expect(edges.some(edge => edge.source === path[0].id && edge.target === draft.steps[0].id)).toBe(true);
  }
  deleteButton(split.id).props.onClick!({ stopPropagation: vi.fn() } as unknown as React.MouseEvent<HTMLButtonElement>);
  expect(onChange.mock.lastCall![0]).toEqual({ steps: [first], splits: [] });
  expect(onSelect).toHaveBeenLastCalledWith(first.id);
});

it("renders hostile titles and message text as escaped content", () => {
  const step: CampaignStep = { id: "b03dfa99-0b7c-47c5-9a76-a815e171b822", kind: "email", title: '<script>alert("title")</script>', subject: '<img src=x onerror="alert(1)">', body: '</textarea><script>alert("body")</script>' };
  const html = renderToStaticMarkup(<CampaignSequenceEditor draft={{ steps: [step] }} selectedStepId={step.id} onChange={() => {}} onSelect={() => {}} />);
  expect(html).not.toContain("<script>"); expect(html).not.toContain("<img src=x"); expect(html).toContain("&lt;script&gt;");
});

it("does not accept a self-loop or an edge to an unknown node", () => {
  const draft = deletionDraft(); const onChange = vi.fn();
  renderToStaticMarkup(<CampaignSequenceEditor draft={draft} selectedStepId="first" onChange={onChange} onSelect={() => {}} />);
  for (const connection of [{ source: "first", target: "first" }, { source: "missing", target: "a-wait" }, { source: "a-message", target: "missing" }]) {
    expect(capture.flow!.isValidConnection!({ ...connection, sourceHandle: null, targetHandle: null })).toBe(false);
  }
  expect(onChange).not.toHaveBeenCalled();
});
