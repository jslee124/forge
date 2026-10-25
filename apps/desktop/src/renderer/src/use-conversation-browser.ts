import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  BrowsedSession,
  DesktopState,
} from "../../shared/application-protocol.js";
import {
  type ConversationPosition,
  captureConversation,
  restoreConversation,
  restoreConversationScroll,
} from "./conversation-view.js";

/** Read-only navigation is independent of run identity, approval queues and execution configuration. */
export function useConversationBrowser({
  state,
  panel,
  tab,
  setPanel,
  setTab,
  onError,
  onNavigate,
}: {
  state: DesktopState | undefined;
  panel: boolean;
  tab: string;
  setPanel: (open: boolean) => void;
  setTab: (tab: string) => void;
  onError: (cause: unknown) => void;
  onNavigate: () => void;
}) {
  const [viewed, setViewed] = useState<BrowsedSession>();
  const viewedRef = useRef(viewed);
  viewedRef.current = viewed;
  const [viewLoading, setViewLoading] = useState(false);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const shellRef = useRef<HTMLElement>(null);
  const positions = useRef(new Map<string, ConversationPosition>());
  const restoring = useRef<string | undefined>(undefined);
  const saveRef = useRef<() => void>(() => {});
  const key =
    viewed?.sessionId || state?.sessionId || `new:${state?.cwd ?? ""}`;
  const savePosition = () => {
    if (!shellRef.current) return;
    positions.current.set(
      key,
      captureConversation(
        shellRef.current,
        panel,
        tab,
        (viewed?.runHistory ?? state?.runHistory)?.selected?.summary.runId,
      ),
    );
    if (positions.current.size > 50) {
      const oldest = positions.current.keys().next().value;
      if (oldest && oldest !== key) positions.current.delete(oldest);
    }
  };
  saveRef.current = savePosition;
  useLayoutEffect(() => {
    restoring.current = key;
    const position = positions.current.get(key);
    setPanel(
      Boolean(
        position?.panel && (!viewedRef.current || position.tab === "context"),
      ),
    );
    setTab(viewedRef.current ? "context" : (position?.tab ?? "files"));
  }, [key, setPanel, setTab]);
  useLayoutEffect(() => {
    if (restoring.current !== key) return;
    const position = positions.current.get(key);
    const expectedTab = viewedRef.current
      ? "context"
      : (position?.tab ?? "files");
    const expectedPanel = Boolean(
      position?.panel && (!viewedRef.current || position.tab === "context"),
    );
    if (panel !== expectedPanel || tab !== expectedTab) return;
    if (position && shellRef.current)
      restoreConversation(shellRef.current, position);
    restoring.current = undefined;
    // Native disclosure toggles can mount the recorded diff after this layout pass.
    const frame = requestAnimationFrame(() => {
      if (position && shellRef.current)
        restoreConversationScroll(shellRef.current, position);
    });
    return () => cancelAnimationFrame(frame);
  }, [key, panel, tab]);
  const invalidateRead = () => {
    request.current++;
    setViewLoading(false);
  };
  const clearBrowsing = () => {
    invalidateRead();
    setViewed(undefined);
  };
  const returnToExecution = () => {
    savePosition();
    clearBrowsing();
    onNavigate();
  };
  const readSession = async (
    sessionId: string,
    runId?: string,
    before?: number,
  ) => {
    const api = window.forgeDesktop;
    if (!api) return;
    savePosition();
    const serial = ++request.current;
    setViewLoading(true);
    try {
      const selected =
        runId ??
        (before === undefined
          ? positions.current.get(sessionId)?.runId
          : undefined);
      const next = await api.manage({
        type: "browse-session",
        sessionId,
        ...(selected ? { runId: selected } : {}),
        ...(before !== undefined ? { before } : {}),
      });
      if (serial !== request.current || !next.browsedSession) return;
      saveRef.current();
      return next.browsedSession;
    } catch (cause) {
      if (serial === request.current) onError(cause);
    } finally {
      if (serial === request.current) setViewLoading(false);
    }
  };
  const browseSession = async (
    sessionId: string,
    runId?: string,
    before?: number,
  ) => {
    const view = await readSession(sessionId, runId, before);
    if (view) {
      setViewed(view);
      onNavigate();
    }
  };
  const prepareExecutionView = (sessionId: string, openFiles: boolean) => {
    const previous = positions.current.get(sessionId);
    const position: ConversationPosition = {
      ...(previous ?? {
        scrollTop: 0,
        panelScrollTop: 0,
        expanded: [],
        panel: true,
        tab: "files",
      }),
      ...(openFiles ? { panel: true, tab: "files" } : {}),
    };
    positions.current.set(sessionId, position);
    return position;
  };
  return {
    viewed,
    viewedRef,
    viewLoading,
    shellRef,
    key,
    savePosition,
    invalidateRead,
    clearBrowsing,
    returnToExecution,
    browseSession,
    readSession,
    prepareExecutionView,
  };
}
