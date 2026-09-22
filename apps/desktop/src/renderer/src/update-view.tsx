import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  UpdateCommand,
  UpdateStatus,
} from "../../shared/update-protocol.js";

// Update preferences/status live outside agent/session state and never enter prompts.
export function UpdateView({ compact = false }: { compact?: boolean }) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [status, setStatus] = useState<UpdateStatus>();
  const [error, setError] = useState("");
  async function command(value: UpdateCommand) {
    try {
      setError("");
      setStatus(await window.forgeDesktop.update(value));
    } catch (error) {
      setError(String(error));
    }
  }
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void window.forgeDesktop
        ?.update?.({ type: "status" })
        .then((value) => {
          if (alive) setStatus(value);
        })
        .catch((error: unknown) => {
          if (alive) setError(String(error));
        });
    };
    refresh();
    const interval = setInterval(refresh, 750);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);
  if (!status)
    return compact ? null : (
      <p role="status">
        {error || (zh ? "正在读取版本…" : "Reading version…")}
      </p>
    );
  const labels = zh
    ? {
        unchecked: "尚未检查",
        checking: "正在检查…",
        current: "已是最新版本",
        available: "发现新版本",
        downloading: "正在下载…",
        verifying: "正在校验…",
        verified: "安装器已校验",
        failed: "更新失败",
      }
    : {
        unchecked: "Not checked",
        checking: "Checking…",
        current: "Up to date",
        available: "Update available",
        downloading: "Downloading…",
        verifying: "Verifying…",
        verified: "Installer verified",
        failed: "Update failed",
      };
  const busy = ["checking", "downloading", "verifying"].includes(status.phase);
  const action =
    status.phase === "verified"
      ? "open"
      : status.phase === "available" ||
          (status.phase === "failed" && status.retry === "download")
        ? "download"
        : undefined;
  const label =
    action === "open"
      ? zh
        ? "打开安装器"
        : "Open installer"
      : status.phase === "failed"
        ? zh
          ? "重试下载"
          : "Retry download"
        : zh
          ? "下载更新"
          : "Download update";
  const manual = zh
    ? "请先保存工作，退出旧版 Forge，再将 DMG 中的应用拖入 Applications 替换。打开安装器不会退出 Forge。SHA-256 仅验证完整性；此应用未经签名或公证，系统仍可能提示。"
    : "Save your work, quit the old Forge, then drag the app from the DMG into Applications to replace it. Opening the installer keeps Forge running. SHA-256 verifies integrity only; this app is unsigned and not notarized, so system prompts may remain.";
  const actionButton = action ? (
    <button
      type="button"
      title={`${label} ${status.target ?? ""}${action === "open" ? ` · ${manual}` : ""}`}
      aria-label={`${label} ${status.target ?? ""}`}
      onClick={() => void command({ type: action })}
    >
      {compact ? (
        <>
          <span aria-hidden="true">{action === "open" ? "↗" : "↓"}</span>
          <span className="update-action-text">{label}</span>
        </>
      ) : (
        label
      )}
    </button>
  ) : null;
  if (compact)
    return (
      <div className="update-compact">
        {actionButton}
        {["downloading", "verifying"].includes(status.phase) && (
          <span
            role="status"
            title={labels[status.phase]}
            aria-label={labels[status.phase]}
          >
            ◌
            <span className="update-action-text">
              {labels[status.phase]}
              {status.phase === "downloading" && status.total
                ? ` ${Math.floor(((status.received ?? 0) / status.total) * 100)}%`
                : ""}
            </span>
          </span>
        )}
        {status.phase === "downloading" && (
          <button
            type="button"
            title={zh ? "取消下载" : "Cancel download"}
            aria-label={zh ? "取消下载" : "Cancel download"}
            onClick={() => void command({ type: "cancel" })}
          >
            ×
          </button>
        )}
      </div>
    );
  return (
    <section
      id="settings-updates"
      className="studio-connection-card update-settings"
    >
      <h3>{zh ? "版本与更新" : "Version and updates"}</h3>
      <p>
        {zh ? "桌面构建版本" : "Desktop build"}:{" "}
        <code>
          {status.version ??
            (zh
              ? "缺少构建标识，请手动升级"
              : "Missing build identity; upgrade manually")}
        </code>
      </p>
      <label>
        {zh ? "更新通道" : "Channel"}{" "}
        <select
          disabled={busy}
          value={status.channel}
          onChange={(e) =>
            void command({
              type: "preferences",
              channel: e.target.value as "stable" | "preview",
              startup: status.startup,
            })
          }
        >
          <option value="stable">{zh ? "稳定版" : "Stable"}</option>
          <option value="preview">{zh ? "预览版" : "Preview"}</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          disabled={busy}
          checked={status.startup}
          onChange={(e) =>
            void command({
              type: "preferences",
              channel: status.channel,
              startup: e.target.checked,
            })
          }
        />
        {zh ? "启动时检查更新" : "Check for updates at startup"}
      </label>
      <p role="status">
        {labels[status.phase]} {status.target ?? ""}
      </p>
      <p>
        {zh ? "上次成功检查" : "Last successful check"}:{" "}
        {status.lastCheck
          ? new Date(status.lastCheck).toLocaleString(i18n.language)
          : "—"}
      </p>
      {(status.error || error) && <p role="alert">{status.error || error}</p>}
      {status.phase === "downloading" && (
        <>
          <progress
            aria-label={zh ? "下载进度" : "Download progress"}
            max={status.total}
            value={status.total ? status.received : undefined}
          />
          <span>{Math.round((status.received ?? 0) / 1024 ** 2)} MiB</span>
          <button
            type="button"
            onClick={() => void command({ type: "cancel" })}
          >
            {zh ? "取消下载" : "Cancel download"}
          </button>
        </>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => void command({ type: "check" })}
      >
        {zh ? "检查更新" : "Check for updates"}
      </button>
      {actionButton}
      <p>{manual}</p>
      {status.notes && (
        <details>
          <summary>{zh ? "发行说明" : "Release notes"}</summary>
          <pre>{status.notes}</pre>
        </details>
      )}
    </section>
  );
}
