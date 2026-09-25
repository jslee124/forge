import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  DesktopState,
  ManagementCommand,
} from "../../shared/application-protocol.js";
import { ConfirmationDialog } from "./confirmation-dialog.js";
import { ManagementSettings } from "./management-settings.js";
import { type ThemeMode, useTheme } from "./theme.js";
import { UpdateView } from "./update-view.js";
export function SettingsView({
  initialSection,
  state,
  busy,
  onBack,
  manage,
  onOpenLogin,
}: {
  initialSection: string;
  state: DesktopState | undefined;
  busy: boolean;
  onBack: () => void;
  manage: (
    command: Exclude<ManagementCommand, { type: "workspace" }>,
  ) => Promise<DesktopState | undefined>;
  onOpenLogin: () => void;
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [section, setSection] = useState<
    "general" | "models" | "extensions" | "updates"
  >("general");
  const zh = i18n.language.startsWith("zh");
  useEffect(() => {
    const targetSection =
      initialSection === "appearance"
        ? "general"
        : ["credentials", "models", "login"].includes(initialSection)
          ? "models"
          : ["plugins", "resources", "web"].includes(initialSection)
            ? "extensions"
            : "updates";
    setSection(targetSection);
    requestAnimationFrame(() => {
      const target =
        document.getElementById(`settings-${initialSection}`) ??
        document.getElementById(`settings-${targetSection}`);
      if (target instanceof HTMLDetailsElement) target.open = true;
      if (target) {
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: "start" });
      }
    });
  }, [initialSection]);
  return (
    <div className="live-settings">
      <div className="settings-heading">
        <button type="button" className="studio-back" onClick={onBack}>
          {i18n.language.startsWith("zh") ? "返回对话" : "Back to conversation"}
        </button>
        <h2>{t("common.settings")}</h2>
      </div>
      <div className="settings-layout">
        <nav
          className="settings-nav"
          aria-label={zh ? "设置分区" : "Settings sections"}
        >
          {(
            [
              ["general", zh ? "通用" : "General"],
              ["models", zh ? "模型与访问" : "Models & access"],
              ["extensions", zh ? "扩展" : "Extensions"],
              ["updates", zh ? "版本与更新" : "Version & updates"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-current={section === id ? "page" : undefined}
              onClick={() => {
                setSection(id);
                requestAnimationFrame(() =>
                  document.getElementById(`settings-${id}`)?.focus(),
                );
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {section === "general" && (
            <section
              id="settings-general"
              tabIndex={-1}
              aria-label={zh ? "通用" : "General"}
            >
              <section id="settings-appearance" className="studio-appearance">
                <h3>{t("studio.appearance")}</h3>
                <p>{t("studio.appearanceHint")}</p>
                <div className="theme-options">
                  {(["light", "dark", "system"] as ThemeMode[]).map((mode) => (
                    <button
                      type="button"
                      key={mode}
                      aria-pressed={theme.mode === mode}
                      onClick={() => theme.setTheme(mode)}
                    >
                      <span className={`theme-swatch theme-swatch-${mode}`} />
                      {t(`studio.${mode}`)}
                    </button>
                  ))}
                </div>
              </section>
              <label>
                {t("settings.language")}{" "}
                <select
                  data-testid="language"
                  value={i18n.language}
                  onChange={(event) => {
                    void i18n.changeLanguage(event.target.value);
                    document.documentElement.lang = event.target.value;
                  }}
                >
                  <option value="zh-CN">简体中文</option>
                  <option value="en">English</option>
                </select>
              </label>
            </section>
          )}
          {section === "models" && (
            <section
              id="settings-models-access"
              tabIndex={-1}
              aria-label={zh ? "模型与访问" : "Models and access"}
            >
              <section className="studio-connection-card">
                <h3>{t("studio.connection")}</h3>
                <p>
                  Forge home: <code>{state?.forgeHome}</code>
                </p>
                <details>
                  <summary>{zh ? "配置来源" : "Configuration source"}</summary>
                  <p>{t("live.nativeConfig")}</p>
                </details>
              </section>
              <ManagementSettings
                state={state}
                busy={busy}
                manage={manage}
                zh={i18n.language.startsWith("zh")}
                section="models"
              />
              <section
                className="studio-connection-card"
                id="settings-login"
                tabIndex={-1}
              >
                <h3>Codex</h3>
                <p>{t(`live.auth.${state?.auth ?? "unknown"}`)}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void manage({ type: "auth-status" })}
                >
                  {t("live.authCheck")}
                </button>
                <button
                  type="button"
                  disabled={busy || state?.auth === "signing-in"}
                  onClick={() => void manage({ type: "login" })}
                >
                  {t("live.login")}
                </button>
                <button
                  type="button"
                  disabled={busy || state?.auth === "signing-in"}
                  onClick={() => setConfirmLogout(true)}
                >
                  {zh ? "退出 Codex 登录" : "Sign out of Codex"}
                </button>
                {state?.auth === "signing-in" && (
                  <button
                    type="button"
                    onClick={() => void manage({ type: "cancel-login" })}
                  >
                    {t("live.cancelLogin")}
                  </button>
                )}
                {state?.loginUrl && (
                  <div>
                    <button type="button" onClick={onOpenLogin}>
                      {t("live.openLogin")}
                    </button>
                    <code>{state.loginCode}</code>
                  </div>
                )}
                <details>
                  <summary>{zh ? "用量与限制" : "Limits and usage"}</summary>
                  <p>{t("live.codexLimits")}</p>
                </details>
              </section>
            </section>
          )}
          {section === "extensions" && (
            <section
              id="settings-extensions"
              tabIndex={-1}
              aria-label={zh ? "扩展" : "Extensions"}
            >
              <ManagementSettings
                state={state}
                busy={busy}
                manage={manage}
                zh={zh}
                section="extensions"
              />
              <section
                className="web-settings"
                aria-label={t("live.web.title")}
              >
                <h3>{t("live.web.title")}</h3>
                <p>
                  {t("live.web.bundle")}: {state?.web?.provenance}
                </p>
                {state?.web?.configurationInvalid && (
                  <p role="alert">{t("live.errors.web-settings-invalid")}</p>
                )}
                <details>
                  <summary>
                    {zh ? "安装与使用范围" : "Installation and scope"}
                  </summary>
                  <p>{t("live.web.scope")}</p>
                </details>
                <button
                  type="button"
                  disabled={busy || state?.web?.installed}
                  onClick={() => void manage({ type: "web-install" })}
                >
                  {t(
                    state?.web?.installed
                      ? "live.web.installed"
                      : "live.web.install",
                  )}
                </button>
                <label>
                  <input
                    type="checkbox"
                    checked={state?.web?.enabled ?? false}
                    disabled={busy || !state?.web?.installed}
                    onChange={(event) =>
                      void manage({
                        type: "web-enable",
                        enabled: event.target.checked,
                      })
                    }
                  />
                  {t("live.web.enable")}
                </label>
                <label>
                  {t("live.web.provider")}
                  <select
                    value={state?.web?.provider ?? "auto"}
                    disabled={busy || !state?.web?.installed}
                    onChange={(event) =>
                      void manage({
                        type: "web-configure",
                        provider: event.target.value as
                          | "auto"
                          | "brave"
                          | "duckduckgo",
                      })
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="brave">Brave Search</option>
                    <option value="duckduckgo">DuckDuckGo HTML</option>
                  </select>
                </label>
                <p>
                  {t("live.web.actual")}:{" "}
                  {state?.web?.actualProvider === "brave"
                    ? "Brave Search"
                    : "DuckDuckGo HTML"}
                </p>
                <p>
                  {t(
                    state?.web?.braveKeyConfigured
                      ? "live.web.keyReady"
                      : "live.web.keyMissing",
                  )}
                </p>
                <details>
                  <summary>
                    {zh ? "自动选择与报告" : "Automatic selection and reports"}
                  </summary>
                  <p>{t("live.web.auto")}</p>
                  <p>{t("live.web.report")}</p>
                </details>
              </section>
            </section>
          )}
          {section === "updates" && (
            <section
              id="settings-updates"
              tabIndex={-1}
              aria-label={zh ? "版本与更新" : "Version and updates"}
            >
              <UpdateView />
            </section>
          )}
        </div>
      </div>
      {confirmLogout && (
        <ConfirmationDialog
          title={
            i18n.language.startsWith("zh")
              ? "退出 Codex 登录"
              : "Sign out of Codex"
          }
          confirmLabel={
            i18n.language.startsWith("zh") ? "退出登录" : "Sign out"
          }
          cancelLabel={i18n.language.startsWith("zh") ? "取消" : "Cancel"}
          busy={busy}
          onCancel={() => setConfirmLogout(false)}
          onConfirm={() => {
            void manage({
              type: "logout",
              engine: "codex",
              provider: "openai",
            }).then(() => setConfirmLogout(false));
          }}
        >
          <p>
            {i18n.language.startsWith("zh")
              ? "Forge API 凭证将保留。"
              : "Forge API credentials will remain."}
          </p>
        </ConfirmationDialog>
      )}
    </div>
  );
}
