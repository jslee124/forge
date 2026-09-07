import { create } from "zustand";
import type { Locale } from "./i18n.js";

export type View = "home" | "workbench" | "settings";
export type TaskId = "login" | "refactor" | "research" | "generated";
export type TaskStatus =
  | "running"
  | "approval"
  | "failed"
  | "stopped"
  | "completed";
export type Engine = "forge" | "codex";

type DesktopUiState = {
  view: View;
  selectedTask: TaskId;
  locale: Locale;
  panelOpen: boolean;
  drafts: Record<TaskId, string>;
  homeDraft: string;
  homeError: boolean;
  folder: string | null;
  model: string;
  engine: Engine;
  statuses: Record<TaskId, TaskStatus>;
  setView: (view: View) => void;
  selectTask: (task: TaskId) => void;
  setLocale: (locale: Locale) => void;
  togglePanel: () => void;
  setDraft: (task: TaskId, value: string) => void;
  setHomeDraft: (value: string) => void;
  chooseFolder: () => void;
  setModel: (model: string) => void;
  setEngine: (engine: Engine) => void;
  createTask: () => boolean;
  stopTask: (task: TaskId) => void;
  resolveApproval: (approved: boolean) => void;
  retryTask: () => void;
};

export const initialStatuses: Record<TaskId, TaskStatus> = {
  login: "running",
  refactor: "approval",
  research: "failed",
  generated: "completed",
};

export const useDesktopStore = create<DesktopUiState>((set, get) => ({
  view: "workbench",
  selectedTask: "login",
  locale: "zh-CN",
  panelOpen: true,
  drafts: { login: "", refactor: "", research: "", generated: "" },
  homeDraft: "",
  homeError: false,
  folder: null,
  model: "Claude 3.5 Sonnet",
  engine: "forge",
  statuses: initialStatuses,
  setView: (view) => set({ view }),
  selectTask: (selectedTask) => set({ selectedTask, view: "workbench" }),
  setLocale: (locale) => set({ locale }),
  togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),
  setDraft: (task, value) =>
    set((state) => ({ drafts: { ...state.drafts, [task]: value } })),
  setHomeDraft: (homeDraft) => set({ homeDraft, homeError: false }),
  chooseFolder: () => set({ folder: "/Users/mori/codes/forge" }),
  setModel: (model) => set({ model }),
  setEngine: (engine) => set({ engine }),
  createTask: () => {
    if (!get().homeDraft.trim()) {
      set({ homeError: true });
      return false;
    }
    set((state) => ({
      view: "workbench",
      selectedTask: "generated",
      drafts: { ...state.drafts, generated: state.homeDraft },
      homeDraft: "",
      homeError: false,
      statuses: { ...state.statuses, generated: "completed" },
    }));
    return true;
  },
  stopTask: (task) =>
    set((state) => ({ statuses: { ...state.statuses, [task]: "stopped" } })),
  resolveApproval: (approved) =>
    set((state) => ({
      statuses: {
        ...state.statuses,
        refactor: approved ? "completed" : "stopped",
      },
    })),
  retryTask: () =>
    set((state) => ({
      statuses: { ...state.statuses, research: "completed" },
    })),
}));
