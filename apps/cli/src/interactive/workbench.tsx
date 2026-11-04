import { randomUUID } from "node:crypto";
import {
  createPersistentInteractiveSession,
  createSessionWorkspace,
  detectStartupResources,
  loadForgeConfig,
  SessionScheduler,
  sessionConcurrency,
} from "@forge/application";
import {
  configuredSecrets,
  deleteSession,
  FileSessionStore,
  type SessionSummary,
} from "@forge/persistence";
import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AskOptions } from "../ask.js";
import { InteractiveApp, type InteractiveAppProps } from "./app.js";
import type {
  InteractiveSessionHost,
  TuiSessionStatus,
} from "./session-host.js";

interface OpenSession {
  readonly key: string;
  readonly props: InteractiveAppProps;
  readonly host: Omit<InteractiveSessionHost, "visible" | "focused">;
  title: string;
  status: TuiSessionStatus;
}
interface SessionRow {
  key: string;
  title: string;
  cwd: string;
  status: string;
  savedId?: string;
}
export interface InteractiveWorkbenchProps extends InteractiveAppProps {
  readonly startupOptions?: AskOptions;
  /** Session construction can be supplied by tests without replacing the real scheduler or input handling. */
  readonly createSession?: (
    source: InteractiveAppProps,
    saved?: SessionSummary,
  ) => Promise<InteractiveAppProps>;
}

async function createSession(
  source: InteractiveAppProps,
  saved?: SessionSummary,
): Promise<InteractiveAppProps> {
  const initial = await loadForgeConfig({ cwd: source.cwd, env: source.env });
  const cwd =
    saved?.workingDirectory ??
    (await createSessionWorkspace({
      cwd: source.cwd,
      forgeHome: initial.forgeHome,
    }));
  const loaded = await loadForgeConfig({
    cwd,
    env: source.env,
    cli: source.options,
  });
  if (
    saved &&
    (loaded.workspaceRoot !== saved.workspaceRoot ||
      loaded.workingDirectory !== saved.workingDirectory)
  )
    throw new Error("workspace-changed");
  const persistence = await createPersistentInteractiveSession({
    cwd,
    env: source.env,
    ...(saved ? { sessionId: saved.id } : {}),
  });
  const resources = await detectStartupResources({
    forgeHome: loaded.forgeHome,
    workspaceRoot: loaded.workspaceRoot,
    enabledUserPlugins: loaded.config.plugins.enabled,
    disabledModelInvocation: loaded.config.resources.disabledModelInvocation,
  });
  // Recreate workspace/session-bound services; retain the caller's execution/auth transport dependencies.
  const {
    approvalStore: _approvalStore,
    sessionHost: _host,
    updateProjectPluginTrust: _trust,
    ...dependencies
  } = source;
  return {
    ...dependencies,
    cwd,
    options: {
      ...source.options,
      engine: loaded.config.model.engine,
      provider: loaded.config.model.provider,
      model: loaded.config.model.id,
      reasoningEffort: loaded.config.model.reasoningEffort,
      thinking: loaded.config.model.thinking,
      permissionProfile: loaded.config.permissionProfile,
      contextMode: loaded.config.context.mode,
      reservedOutputTokens: loaded.config.context.reservedOutputTokens,
      bufferTokens: loaded.config.context.bufferTokens,
      recentTailTokens: loaded.config.context.recentTailTokens,
      summaryTargetTokens: loaded.config.context.summaryTargetTokens,
    },
    sessionPersistence: persistence,
    approvalWorkspaceRoot: loaded.workspaceRoot,
    permissionProfileSource: loaded.provenance.permissionProfile.label,
    initialProviders: loaded.config.providers,
    detectedResources: resources,
  };
}

/** Background panels retain their own execution/approval state but never subscribe to keyboard input. */
export function InteractiveWorkbench({
  createSession: buildSession = createSession,
  startupOptions,
  ...initial
}: InteractiveWorkbenchProps): React.JSX.Element {
  const { exit } = useApp();
  const { rows: terminalHeight } = useWindowSize();
  const controllers = useRef(new Map<string, AbortController>());
  const [scheduler] = useState(
    () =>
      new SessionScheduler({ maxConcurrent: sessionConcurrency(initial.env) }),
  );
  const [sessions, setSessions] = useState<OpenSession[]>([]);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const [selected, setSelected] = useState("");
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [listing, setListing] = useState(false);
  const [saved, setSaved] = useState<readonly SessionSummary[]>([]);
  const [index, setIndex] = useState(0);
  const [notice, setNotice] = useState("");
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const [exiting, setExiting] = useState(false);
  const exitingRef = useRef(false);
  const [deletion, setDeletion] = useState<SessionSummary>();
  const [home, setHome] = useState("");
  const mounted = useRef(true);
  const requestExit = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    setExiting(true);
    for (const controller of controllers.current.values())
      controller.abort("workbench closed");
    void scheduler.drain().then(
      () => exit(0),
      (error) => exit(error),
    );
  }, [scheduler, exit]);
  const showSessions = useCallback(() => {
    setIndex(0);
    setListing(true);
    setNotice("");
  }, []);
  const createRef = useRef<() => void>(() => {});
  const makeSession = useCallback(
    (props: InteractiveAppProps, title: string): OpenSession => {
      const key = randomUUID();
      return {
        key,
        props,
        title,
        status: "ready",
        host: {
          newSession: () => createRef.current(),
          showSessions,
          requestExit,
          report: (status) =>
            setSessions((current) => {
              if (
                current.find((session) => session.key === key)?.status ===
                status
              )
                return current;
              return current.map((session) =>
                session.key === key ? { ...session, status } : session,
              );
            }),
          submitted: (prompt) =>
            setSessions((current) =>
              current.map((session) =>
                session.key === key
                  ? {
                      ...session,
                      title: prompt.split(/\r?\n/u)[0]?.slice(0, 80) || "Task",
                    }
                  : session,
              ),
            ),
          schedule: (runId, controller, execute, onState) => {
            controllers.current.set(key, controller);
            return scheduler
              .submit({
                sessionId: key,
                runId,
                signal: controller.signal,
                execute: async () => execute(),
                onState,
              })
              .finally(() => controllers.current.delete(key));
          },
        },
      };
    },
    [scheduler, showSessions, requestExit],
  );
  const startup = useRef(initial);
  // Initial setup runs once. Each subsequent panel is constructed by an explicit new/resume action.
  useEffect(() => {
    const first = makeSession(startup.current, "Current session");
    setSessions([first]);
    setSelected(first.key);
    return () => {
      mounted.current = false;
      for (const controller of controllers.current.values())
        controller.abort("workbench closed");
      scheduler.close();
    };
  }, [makeSession, scheduler]);
  useEffect(() => {
    if (!listing) return;
    let disposed = false;
    void loadForgeConfig({ cwd: initial.cwd, env: initial.env })
      .then(async (loaded) => {
        const entries = await new FileSessionStore(loaded.forgeHome, {
          secrets: configuredSecrets(initial.env),
        }).list();
        if (!disposed) {
          setHome(loaded.forgeHome);
          setSaved(entries);
        }
      })
      .catch((error) => {
        if (!disposed) setNotice(String(error));
      });
    return () => {
      disposed = true;
    };
  }, [listing, initial.cwd, initial.env]);
  const open = async (entry?: SessionSummary) => {
    if (openingRef.current || exitingRef.current) return;
    const existing =
      entry &&
      sessionsRef.current.find(
        (session) => session.props.sessionPersistence?.sessionId === entry.id,
      );
    if (existing) {
      setSelected(existing.key);
      setListing(false);
      return;
    }
    if (sessionsRef.current.length >= 50) {
      setNotice(
        "50 sessions are open. Close an idle view with x in the session list first.",
      );
      return;
    }
    openingRef.current = true;
    setOpening(true);
    setNotice("");
    try {
      const source =
        sessionsRef.current.find(
          (session) => session.key === selectedRef.current,
        )?.props ?? initial;
      const props = await buildSession(
        { ...source, options: startupOptions ?? source.options },
        entry,
      );
      if (!mounted.current || exitingRef.current) return;
      const next = makeSession(props, entry?.title ?? "New session");
      setSessions((current) => [...current, next]);
      setSelected(next.key);
      setListing(false);
    } catch (error) {
      if (mounted.current)
        setNotice(
          `Could not open session: ${error instanceof Error ? error.message : "unknown error"}`,
        );
    } finally {
      openingRef.current = false;
      if (mounted.current) setOpening(false);
    }
  };
  createRef.current = () => {
    void open();
  };
  const openIds = new Set(
    sessions.flatMap((session) =>
      session.props.sessionPersistence?.sessionId
        ? [session.props.sessionPersistence.sessionId]
        : [],
    ),
  );
  const sessionRows: SessionRow[] = [
    ...sessions.map((session) => ({
      key: session.key,
      title: session.title,
      cwd: session.props.cwd,
      status: session.status,
    })),
    ...saved
      .filter((session) => !openIds.has(session.id))
      .map((session) => ({
        key: session.id,
        savedId: session.id,
        title: session.title,
        cwd: session.workingDirectory,
        status: "saved",
      })),
  ];
  const selectedIndex = Math.min(index, Math.max(0, sessionRows.length - 1));
  useInput((input, key) => {
    if (exiting) return;
    if (key.ctrl && input.toLowerCase() === "n") {
      if (!opening) void open();
      return;
    }
    if (key.ctrl && input.toLowerCase() === "p") {
      if (!opening) listing ? setListing(false) : showSessions();
      return;
    }
    if (opening) {
      if (key.ctrl && input.toLowerCase() === "c") requestExit();
      return;
    }
    if (!listing) return;
    if (deletion) {
      if (input.toLowerCase() === "y") {
        const target = deletion;
        setDeletion(undefined);
        void deleteSession(home, target.id).then(
          () => {
            setSaved((current) =>
              current.filter((session) => session.id !== target.id),
            );
            setNotice(
              "Saved conversation deleted; workspace files and branches retained.",
            );
          },
          (error) => setNotice(String(error)),
        );
      } else if (key.escape || key.return || input.toLowerCase() === "n")
        setDeletion(undefined);
      return;
    }
    if (key.escape) {
      setListing(false);
      return;
    }
    if (key.ctrl && input.toLowerCase() === "c") {
      setListing(false);
      return;
    }
    if (key.upArrow || key.downArrow) {
      setIndex(
        (current) =>
          (current + (key.upArrow ? -1 : 1) + sessionRows.length) %
          Math.max(1, sessionRows.length),
      );
      return;
    }
    const row = sessionRows[selectedIndex];
    if (!row) return;
    if (input.toLowerCase() === "x" && !key.ctrl && !row.savedId) {
      if (scheduler.hasSession(row.key)) {
        setNotice("Stop this session before closing its view.");
        return;
      }
      if (sessions.length < 2) {
        setNotice("Keep at least one session open.");
        return;
      }
      const remaining = sessions.filter((session) => session.key !== row.key);
      setSessions(remaining);
      if (selected === row.key) setSelected(remaining[0]?.key ?? "");
      setIndex(0);
      setNotice(
        "View closed; unsent draft discarded. Saved conversation and workspace files retained.",
      );
      return;
    }
    if (key.ctrl && input.toLowerCase() === "d") {
      if (row.savedId)
        setDeletion(saved.find((session) => session.id === row.savedId));
      else
        setNotice(
          "Close the idle view with x before deleting its saved conversation.",
        );
      return;
    }
    if (key.return) {
      if (row.savedId) {
        const entry = saved.find((session) => session.id === row.savedId);
        if (entry) void open(entry);
      } else {
        setSelected(row.key);
        setListing(false);
        setNotice("");
      }
    }
  });
  const firstRow = Math.max(
    0,
    selectedIndex - Math.max(2, Math.floor((terminalHeight - 12) / 2)),
  );
  return (
    <Box flexDirection="column">
      <Box paddingX={1} flexDirection="column">
        <Text bold>
          Sessions {sessions.length} · running {scheduler.running}/
          {scheduler.maxConcurrent} · queued {scheduler.queued}
        </Text>
        <Text dimColor>
          Ctrl+N new · Ctrl+P sessions · Ctrl+C stop selected / exit · PgUp/PgDn
          transcript
        </Text>
        <Text>
          {sessions.find((session) => session.key === selected)?.title ??
            "Opening session…"}
        </Text>
        {notice ? <Text color="yellow">{notice}</Text> : null}
        {opening ? <Text>Opening isolated session…</Text> : null}
        {exiting ? <Text>Stopping all sessions before exit…</Text> : null}
        {listing ? (
          <Box flexDirection="column" borderStyle="round" paddingX={1}>
            <Text bold>Sessions — ↑↓ choose · Enter open · Esc back</Text>
            <Text dimColor>
              x close idle view (discards draft) · Ctrl+D delete saved
              conversation
            </Text>
            {sessionRows
              .slice(firstRow, firstRow + Math.max(3, terminalHeight - 12))
              .map((row, offset) => (
                <Text
                  key={row.key}
                  {...(firstRow + offset === selectedIndex
                    ? { color: "cyan" }
                    : {})}
                >
                  {firstRow + offset === selectedIndex ? "›" : " "} [
                  {row.status}] {row.title} · {row.cwd}
                </Text>
              ))}
            {deletion ? (
              <Text color="yellow">
                Delete “{deletion.title}”? y delete · Enter/Esc cancel
              </Text>
            ) : null}
          </Box>
        ) : null}
      </Box>
      {sessions.map((session) => (
        <InteractiveApp
          key={session.key}
          {...session.props}
          sessionHost={{
            ...session.host,
            visible: !listing && !exiting && session.key === selected,
            focused:
              !listing && !opening && !exiting && session.key === selected,
          }}
        />
      ))}
    </Box>
  );
}
