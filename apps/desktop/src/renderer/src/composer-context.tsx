import { Info } from "@phosphor-icons/react/Info";
import { Plus } from "@phosphor-icons/react/Plus";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { DesktopState } from "../../shared/application-protocol.js";

export function ComposerContext({
  state,
  engine,
  permission,
  onPermission,
  busy,
  onImport,
}: {
  state: DesktopState | undefined;
  engine: "native" | "codex";
  permission: "safe" | "workspace-write";
  onPermission: (value: "safe" | "workspace-write") => void;
  busy: boolean;
  onImport: () => Promise<void>;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const usage = engine === "native" ? state?.contextUsage : undefined;
  const percent = usage
    ? Math.min(100, Math.round((usage.used / usage.total) * 100))
    : undefined;
  return (
    <div className="studio-context-controls">
      <button
        type="button"
        className="studio-add"
        disabled={busy || !state?.cwd}
        title={zh ? "添加文件副本" : "Import a file copy"}
        aria-label={zh ? "添加文件副本" : "Import a file copy"}
        onClick={() => void onImport()}
      >
        <Plus size={18} />
      </button>
      <label className="studio-permission">
        <ShieldCheck size={16} />
        <select
          aria-label={zh ? "当前权限" : "Permissions"}
          disabled={busy}
          value={permission}
          onChange={(e) =>
            onPermission(e.target.value as "safe" | "workspace-write")
          }
        >
          <option value="safe">
            {engine === "codex"
              ? zh
                ? "只读"
                : "Read only"
              : zh
                ? "按需审批"
                : "Ask to approve"}
          </option>
          <option value="workspace-write">
            {zh ? "工作区写入" : "Workspace writes"}
          </option>
        </select>
      </label>
      <details className="studio-permissions-details studio-context-popover">
        <summary aria-label={zh ? "会话授权详情" : "Session grants"}>
          <Info size={16} />
        </summary>
        <div>
          <strong>{zh ? "会话授权" : "Session grants"}</strong>
          <p>
            {zh
              ? "桌面审批仅对单次操作生效，不保存跨运行授权；当前没有可撤销的会话授权。权限下拉框设置下一次运行的策略，不能代替操作审批。"
              : "Desktop approvals apply once and are not retained across runs. There are no session grants to revoke. The policy selector controls the next run, separately from individual approvals."}
          </p>
        </div>
      </details>
      <details className="studio-context-popover studio-context-usage">
        <summary
          title={
            usage
              ? `${usage.used.toLocaleString()} / ${usage.total.toLocaleString()} tokens`
              : zh
                ? "用量暂不可用"
                : "Usage unavailable"
          }
          aria-label={zh ? "上下文详情" : "Context details"}
        >
          <span
            className="studio-context-ring"
            aria-hidden="true"
            style={{ "--usage": `${percent ?? 0}%` } as CSSProperties}
          />
          <span>{percent === undefined ? "—" : `${percent}%`}</span>
        </summary>
        <div>
          <strong>{zh ? "上下文" : "Context"}</strong>
          <p>
            {zh
              ? "Forge transcript 预算估算，不含草稿；运行完成、恢复或压缩后刷新。"
              : "Forge transcript estimate, excluding draft; refreshed after runs, resume or compaction."}
          </p>
          <p>{state?.contextUpdatedAt}</p>
          {usage && <progress max={usage.total} value={usage.used} />}
          <pre>
            {engine === "codex"
              ? zh
                ? "Codex 尚未提供可验证的上下文用量。"
                : "Verified Codex context usage is unavailable."
              : state?.context ||
                (zh ? "尚无活动上下文。" : "No active context.")}
          </pre>
        </div>
      </details>
    </div>
  );
}
