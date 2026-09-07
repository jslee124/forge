import { beforeEach, describe, expect, it } from "vitest";
import { initialStatuses, useDesktopStore } from "./store.js";

describe("desktop prototype UI state", () => {
  beforeEach(() =>
    useDesktopStore.setState({
      view: "workbench",
      selectedTask: "login",
      drafts: { login: "", refactor: "", research: "", generated: "" },
      homeDraft: "",
      homeError: false,
      panelOpen: true,
      statuses: initialStatuses,
    }),
  );

  it("retains an independent draft while switching tasks", () => {
    useDesktopStore.getState().setDraft("login", "first draft");
    useDesktopStore.getState().selectTask("research");
    useDesktopStore.getState().setDraft("research", "second draft");
    expect(useDesktopStore.getState().drafts).toMatchObject({
      login: "first draft",
      research: "second draft",
    });
  });

  it("does not create a simulated task without a prompt", () => {
    expect(useDesktopStore.getState().createTask()).toBe(false);
    expect(useDesktopStore.getState().homeError).toBe(true);
    expect(useDesktopStore.getState().view).toBe("workbench");
  });

  it("models approval, stop, retry, and panel interactions without external effects", () => {
    useDesktopStore.getState().resolveApproval(false);
    useDesktopStore.getState().stopTask("login");
    useDesktopStore.getState().retryTask();
    useDesktopStore.getState().togglePanel();
    expect(useDesktopStore.getState().statuses).toEqual({
      login: "stopped",
      refactor: "stopped",
      research: "completed",
      generated: "completed",
    });
    expect(useDesktopStore.getState().panelOpen).toBe(false);
  });

  it("updates simulated folder, model, engine, and generated task state", () => {
    useDesktopStore.getState().chooseFolder();
    useDesktopStore.getState().setModel("GPT-5.4");
    useDesktopStore.getState().setEngine("codex");
    useDesktopStore.getState().setHomeDraft("Summarize this repository");
    expect(useDesktopStore.getState().createTask()).toBe(true);
    expect(useDesktopStore.getState()).toMatchObject({
      folder: "/Users/mori/codes/forge",
      model: "GPT-5.4",
      engine: "codex",
      selectedTask: "generated",
      view: "workbench",
    });
  });
});
