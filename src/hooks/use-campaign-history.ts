"use client";
import { useCallback, useReducer } from "react";
import { campaignHistoryReducer } from "@/domain/campaign-editor";
import type { CampaignDraft } from "@/domain/campaign";
export type CampaignHistoryControls = { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean };
export function useCampaignHistory(initial: CampaignDraft | null) {
  const [state, dispatch] = useReducer(campaignHistoryReducer, { present: initial, past: [], future: [] });
  const setDraft = useCallback((draft: CampaignDraft | null) => dispatch({ type: "edit", draft }), []);
  const resetDraft = useCallback((draft: CampaignDraft | null) => dispatch({ type: "reset", draft }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  return { draft: state.present, setDraft, resetDraft, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
