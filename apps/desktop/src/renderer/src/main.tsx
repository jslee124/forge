import { ArrowCounterClockwise } from "@phosphor-icons/react/ArrowCounterClockwise";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { CaretUp } from "@phosphor-icons/react/CaretUp";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Circle } from "@phosphor-icons/react/Circle";
import { Code } from "@phosphor-icons/react/Code";
import { FileCode } from "@phosphor-icons/react/FileCode";
import { FileText } from "@phosphor-icons/react/FileText";
import { Folder } from "@phosphor-icons/react/Folder";
import { GearSix } from "@phosphor-icons/react/GearSix";
import { House } from "@phosphor-icons/react/House";
import { Paperclip } from "@phosphor-icons/react/Paperclip";
import { Plus } from "@phosphor-icons/react/Plus";
import { SidebarSimple } from "@phosphor-icons/react/SidebarSimple";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { Square } from "@phosphor-icons/react/Square";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import React from "react";
import ReactDOM from "react-dom/client";
import { useTranslation } from "react-i18next";
import type { AgentHealth } from "../../shared/desktop-api.js";
import logoUrl from "./assets/forge-logo.svg";
import i18n, { type Locale } from "./i18n.js";
import { LiveWorkbench } from "./live-workbench.js";
import { Markdown } from "./markdown.js";
import { Select } from "./select.js";
import {
  type Engine,
  type TaskId,
  type TaskStatus,
  useDesktopStore,
} from "./store.js";
import "./styles.css";

const taskIds: TaskId[] = ["login", "refactor", "research"];

function StatusPill({ status }: { status: TaskStatus }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <span className={`status-pill status-${status}`}>
      <span className="status-dot" />
      {t(`status.${status}`)}
    </span>
  );
}

function Sidebar(): React.JSX.Element {
  const { t } = useTranslation();
  const selectedTask = useDesktopStore((state) => state.selectedTask);
  const statuses = useDesktopStore((state) => state.statuses);
  const selectTask = useDesktopStore((state) => state.selectTask);
  const setView = useDesktopStore((state) => state.setView);
  const view = useDesktopStore((state) => state.view);

  return (
    <aside className="sidebar">
      <button
        type="button"
        className="brand"
        aria-label={t("common.home")}
        onClick={() => setView("home")}
      >
        <img src={logoUrl} alt="Forge" />
      </button>
      <button
        type="button"
        className="new-task"
        onClick={() => setView("home")}
      >
        <Plus size={18} />
        {t("common.newTask")}
      </button>
      <nav aria-label={t("common.recentTasks")}>
        <p className="nav-label">{t("common.recentTasks")}</p>
        {taskIds.map((task) => (
          <button
            type="button"
            key={task}
            className={`task-link ${view === "workbench" && selectedTask === task ? "active" : ""}`}
            onClick={() => selectTask(task)}
          >
            <FileText size={17} />
            <span>{t(`tasks.${task}`)}</span>
            <span
              className={`task-indicator status-${statuses[task]}`}
              title={t(`status.${statuses[task]}`)}
            />
          </button>
        ))}
      </nav>
      <div className="project-block">
        <p className="nav-label">{t("common.project")}</p>
        <button type="button" className="project-link">
          <Code size={17} />
          <span>forge</span>
        </button>
      </div>
      <div className="sidebar-footer">
        <button
          type="button"
          className={view === "home" ? "footer-link active" : "footer-link"}
          onClick={() => setView("home")}
        >
          <House size={18} />
          <span>{t("common.home")}</span>
        </button>
        <button
          type="button"
          className={view === "settings" ? "footer-link active" : "footer-link"}
          onClick={() => setView("settings")}
        >
          <GearSix size={18} />
          <span>{t("common.settings")}</span>
        </button>
      </div>
    </aside>
  );
}

function Home(): React.JSX.Element {
  const { t } = useTranslation();
  const homeDraft = useDesktopStore((state) => state.homeDraft);
  const homeError = useDesktopStore((state) => state.homeError);
  const folder = useDesktopStore((state) => state.folder);
  const setHomeDraft = useDesktopStore((state) => state.setHomeDraft);
  const chooseFolder = useDesktopStore((state) => state.chooseFolder);
  const createTask = useDesktopStore((state) => state.createTask);
  const model = useDesktopStore((state) => state.model);
  const setModel = useDesktopStore((state) => state.setModel);
  const examples = ["exampleCode", "exampleFiles", "exampleResearch"];

  return (
    <section className="home-view">
      <div className="home-copy">
        <span className="eyebrow">{t("home.eyebrow")}</span>
        <h1>{t("home.title")}</h1>
        <p>{t("home.subtitle")}</p>
      </div>
      <div className={`home-composer ${homeError ? "has-error" : ""}`}>
        <textarea
          value={homeDraft}
          onChange={(event) => setHomeDraft(event.target.value)}
          placeholder={t("home.placeholder")}
          aria-label={t("home.placeholder")}
        />
        {homeError ? (
          <p className="field-error">
            <WarningCircle size={16} />
            {t("errors.emptyPrompt")}
          </p>
        ) : null}
        <div className="composer-actions">
          <div className="composer-tools">
            <button type="button" className="icon-text">
              <Paperclip size={18} />
              {t("home.material")}
            </button>
            <button type="button" className="icon-text" onClick={chooseFolder}>
              <Folder size={18} />
              {folder ?? t("home.chooseFolder")}
            </button>
          </div>
          <div className="composer-submit">
            <Select
              ariaLabel={t("workbench.model")}
              value={model}
              onValueChange={setModel}
              options={[
                { value: "Claude 3.5 Sonnet", label: "Claude 3.5 Sonnet" },
                { value: "GPT-5.4", label: "GPT-5.4" },
              ]}
            />
            <button
              type="button"
              className="round-submit"
              onClick={createTask}
              aria-label={t("home.send")}
            >
              <ArrowRight size={18} weight="bold" />
            </button>
          </div>
        </div>
      </div>
      <div className="examples">
        <span>{t("home.examples")}</span>
        {examples.map((key) => (
          <button
            type="button"
            key={key}
            onClick={() => setHomeDraft(t(`home.${key}`))}
          >
            {t(`home.${key}`)}
          </button>
        ))}
      </div>
    </section>
  );
}

function ApprovalCard(): React.JSX.Element {
  const { t } = useTranslation();
  const resolveApproval = useDesktopStore((state) => state.resolveApproval);
  return (
    <section className="notice-card approval-card">
      <div className="notice-title">
        <WarningCircle size={20} weight="fill" />
        <strong>{t("workbench.approvalTitle")}</strong>
      </div>
      <p>{t("workbench.approvalBody")}</p>
      <code>CI=true pnpm exec vitest run src/login.test.ts</code>
      <div className="notice-actions">
        <button
          type="button"
          className="secondary"
          onClick={() => resolveApproval(false)}
        >
          {t("common.deny")}
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => resolveApproval(true)}
        >
          {t("common.approve")}
        </button>
      </div>
    </section>
  );
}

function OutcomeCard({
  status,
}: {
  status: TaskStatus;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const retryTask = useDesktopStore((state) => state.retryTask);
  if (status === "approval") return <ApprovalCard />;
  if (status === "failed")
    return (
      <section className="notice-card failure-card">
        <div className="notice-title">
          <WarningCircle size={20} weight="fill" />
          <strong>{t("workbench.failureTitle")}</strong>
        </div>
        <p>{t("workbench.failureBody")}</p>
        <button
          type="button"
          className="secondary inline-action"
          onClick={retryTask}
        >
          <ArrowCounterClockwise size={16} />
          {t("common.retry")}
        </button>
      </section>
    );
  if (status === "stopped")
    return (
      <section className="notice-card neutral-card">
        <p>{t("workbench.stoppedBody")}</p>
      </section>
    );
  if (status === "completed")
    return (
      <section className="notice-card success-card">
        <div className="notice-title">
          <CheckCircle size={20} weight="fill" />
          <strong>{t("status.completed")}</strong>
        </div>
        <p>{t("workbench.completedBody")}</p>
      </section>
    );
  return null;
}

function Conversation({
  task,
  status,
}: {
  task: TaskId;
  status: TaskStatus;
}): React.JSX.Element {
  const { t } = useTranslation();
  const generatedPrompt = useDesktopStore((state) => state.drafts.generated);
  const markdown = `## ${t("workbench.implementation")}\n\n${t("workbench.longBody")}\n\n| ${t("workbench.activity")} | ${t("status.ready")} |\n| --- | --- |\n| Routing | ✓ |\n| Validation | ✓ |\n\n\`\`\`tsx\nexport function Login() {\n  return <Form method="post" />;\n}\n\`\`\``;
  return (
    <div className="conversation">
      <div className="user-row">
        <div className="user-message">
          {task === "generated" ? generatedPrompt : t("workbench.userPrompt")}
        </div>
      </div>
      <p className="assistant-lead">{t("workbench.assistantLead")}</p>
      <section className="activity-list" aria-label={t("workbench.activity")}>
        <div>
          <CheckCircle size={20} weight="fill" />
          <span>{t("workbench.checkStructure")}</span>
        </div>
        <div className={status === "running" ? "active" : "done"}>
          {status === "running" ? (
            <span className="spinner" />
          ) : (
            <CheckCircle size={20} weight="fill" />
          )}
          <span>{t("workbench.buildPage")}</span>
        </div>
        <div>
          <Circle size={20} />
          <span>{t("workbench.verify")}</span>
        </div>
      </section>
      <div className="markdown-body">
        <Markdown>{markdown}</Markdown>
      </div>
      <OutcomeCard status={status} />
    </div>
  );
}

function ResultsPanel(): React.JSX.Element {
  const { t } = useTranslation();
  const togglePanel = useDesktopStore((state) => state.togglePanel);
  return (
    <aside className="results-panel">
      <div className="results-header">
        <div>
          <h2>{t("workbench.changes")}</h2>
          <p>2 {t("workbench.files")}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={togglePanel}
          aria-label={t("common.close")}
        >
          <X size={20} />
        </button>
      </div>
      <div className="file-diff">
        <div className="file-title">
          <FileCode size={17} />
          <strong>src/pages/Login.tsx</strong>
          <span>+120</span>
          <CaretUp size={14} />
        </div>
        <pre>
          <span className="diff-meta">@@ -8,8 +8,120 @@</span>
          {`\n`}
          <span className="diff-add">
            + import {"{"} useState {"}"} from 'react';
          </span>
          {`\n`}
          <span className="diff-add">
            + import {"{"} Form {"}"} from './Form';
          </span>
          {`\n\n`}
          <span className="diff-add">+ export function Login() {"{"}</span>
          {`\n`}
          <span className="diff-add">
            + const [error, setError] = useState(null);
          </span>
          {`\n`}
          <span className="diff-add">
            + return &lt;Form error={"{"}error{"}"} /&gt;;
          </span>
          {`\n`}
          <span className="diff-add">+ {"}"}</span>
        </pre>
      </div>
      <div className="file-diff compact">
        <div className="file-title">
          <FileCode size={17} />
          <strong>src/routes/index.tsx</strong>
          <span>+6</span>
          <CaretUp size={14} />
        </div>
      </div>
      <div className="results-actions">
        <button type="button" className="secondary">
          {t("common.open")}
        </button>
      </div>
    </aside>
  );
}

function Composer({
  task,
  status,
}: {
  task: TaskId;
  status: TaskStatus;
}): React.JSX.Element {
  const { t } = useTranslation();
  const drafts = useDesktopStore((state) => state.drafts);
  const setDraft = useDesktopStore((state) => state.setDraft);
  const stopTask = useDesktopStore((state) => state.stopTask);
  const model = useDesktopStore((state) => state.model);
  const engine = useDesktopStore((state) => state.engine);
  const setModel = useDesktopStore((state) => state.setModel);
  const setEngine = useDesktopStore((state) => state.setEngine);
  return (
    <div className="composer">
      <textarea
        value={drafts[task]}
        onChange={(event) => setDraft(task, event.target.value)}
        placeholder={t("workbench.followup")}
        aria-label={t("workbench.followup")}
      />
      <div className="composer-actions">
        <div className="composer-tools">
          <button
            type="button"
            className="icon-button"
            aria-label={t("home.material")}
          >
            <Paperclip size={20} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t("home.folder")}
          >
            <Folder size={20} />
          </button>
        </div>
        <div className="composer-submit">
          <Select
            ariaLabel={t("workbench.engine")}
            value={engine}
            onValueChange={(value) => setEngine(value as Engine)}
            options={[
              { value: "forge", label: "Forge" },
              { value: "codex", label: "Codex" },
            ]}
          />
          <Select
            ariaLabel={t("workbench.model")}
            value={model}
            onValueChange={setModel}
            options={[
              { value: "Claude 3.5 Sonnet", label: "Claude 3.5 Sonnet" },
              { value: "GPT-5.4", label: "GPT-5.4" },
            ]}
          />
          {status === "running" ? (
            <button
              type="button"
              className="stop-button"
              onClick={() => stopTask(task)}
            >
              <Square size={14} weight="fill" />
              {t("workbench.stop")}
            </button>
          ) : (
            <button type="button" className="primary">
              <ArrowRight size={16} />
              {t("workbench.send")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Workbench(): React.JSX.Element {
  const { t } = useTranslation();
  const task = useDesktopStore((state) => state.selectedTask);
  const status = useDesktopStore((state) => state.statuses[state.selectedTask]);
  const panelOpen = useDesktopStore((state) => state.panelOpen);
  const togglePanel = useDesktopStore((state) => state.togglePanel);
  return (
    <div className={`workbench ${panelOpen ? "panel-visible" : ""}`}>
      <section className="workbench-main">
        <header className="workbench-header">
          <div>
            <div className="title-row">
              <h1>{t(`tasks.${task}`)}</h1>
              <StatusPill status={status} />
            </div>
            <p>{t("workbench.location")} · /Users/mori/codes/forge</p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={togglePanel}
            aria-label={
              panelOpen ? t("workbench.hidePanel") : t("workbench.showPanel")
            }
          >
            <SidebarSimple size={22} />
          </button>
        </header>
        <div className="conversation-scroll">
          <Conversation task={task} status={status} />
        </div>
        <Composer task={task} status={status} />
      </section>
      {panelOpen ? <ResultsPanel /> : null}
    </div>
  );
}

function Settings(): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useDesktopStore((state) => state.locale);
  const setLocale = useDesktopStore((state) => state.setLocale);
  return (
    <section className="settings-view">
      <header>
        <span className="settings-icon">
          <GearSix size={21} />
        </span>
        <div>
          <h1>{t("settings.title")}</h1>
          <p>{t("common.simulation")}</p>
        </div>
      </header>
      <div className="settings-section">
        <h2>{t("settings.general")}</h2>
        <div className="settings-row">
          <div>
            <strong>{t("settings.language")}</strong>
            <p>{t("settings.languageHelp")}</p>
          </div>
          <Select
            ariaLabel={t("settings.language")}
            value={locale}
            onValueChange={(value) => {
              const next =
                value === "system"
                  ? navigator.language.startsWith("zh")
                    ? "zh-CN"
                    : "en"
                  : (value as Locale);
              setLocale(next);
              void i18n.changeLanguage(next);
            }}
            options={[
              { value: "system", label: t("settings.followSystem") },
              { value: "zh-CN", label: t("settings.chinese") },
              { value: "en", label: t("settings.english") },
            ]}
          />
        </div>
      </div>
      <div className="settings-section">
        <h2>{t("settings.appearance")}</h2>
        <p>{t("settings.appearanceHelp")}</p>
      </div>
      <div className="settings-section">
        <h2>{t("settings.about")}</h2>
        <p>{t("settings.aboutHelp")}</p>
      </div>
    </section>
  );
}

function App(): React.JSX.Element {
  const { t } = useTranslation();
  const view = useDesktopStore((state) => state.view);
  const locale = useDesktopStore((state) => state.locale);
  const [agentStatus, setAgentStatus] = React.useState(t("status.ready"));
  React.useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("common.forge");
  }, [locale, t]);
  React.useEffect(() => {
    if (!window.forgeDesktop) {
      setAgentStatus(t("status.ready"));
      return;
    }
    void window.forgeDesktop
      .pingAgent()
      .then((health: AgentHealth) =>
        setAgentStatus(
          health.resourcesAvailable
            ? t("status.ready")
            : t("status.unavailable"),
        ),
      )
      .catch(() => setAgentStatus(t("status.unavailable")));
  }, [t]);
  React.useEffect(
    () =>
      window.forgeDesktop?.onRunEvent((event) => {
        if (
          event.payload.type === "complete" &&
          event.payload.outcome === "interrupted"
        ) {
          setAgentStatus(t("status.interrupted"));
        }
      }),
    [t],
  );
  return (
    <main className="app-shell">
      <div className="prototype-banner">
        <Sparkle size={14} weight="fill" />
        {t("common.simulation")}
        <span>·</span>
        <span>{agentStatus}</span>
      </div>
      <div className="app-frame">
        <Sidebar />
        {view === "home" ? (
          <Home />
        ) : view === "settings" ? (
          <Settings />
        ) : (
          <Workbench />
        )}
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Forge Desktop renderer root is missing");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    {window.forgeDesktop ? <LiveWorkbench /> : <App />}
  </React.StrictMode>,
);
