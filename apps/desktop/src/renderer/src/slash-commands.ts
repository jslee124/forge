export const commands = [
  ["help", "查看命令", "Show commands"],
  ["new", "新建任务", "New task"],
  ["clear", "清空当前上下文", "Clear context"],
  ["context", "查看上下文", "Context status"],
  ["compact", "压缩上下文", "Compact context"],
  ["model", "选择模型", "Choose model"],
  ["resume", "恢复历史任务", "Resume task"],
  ["permissions", "权限设置", "Permissions"],
  ["plugins", "插件设置", "Plugins"],
  ["login", "连接设置", "Connections"],
  ["resources", "资源诊断 · 尚未接入", "Resources · not connected"],
  ["logout", "退出账号 · 尚未接入", "Sign out · not connected"],
  ["delete-model", "删除模型 · 尚未接入", "Delete model · not connected"],
  ["effort", "推理强度 · 尚未接入", "Reasoning effort · not connected"],
  ["update-dismiss", "版本提示 · 不适用", "Update notice · not applicable"],
  ["exit", "关闭窗口", "Close window"],
] as const;
export function parseSlash(text: string) {
  const match = /^\/([a-z-]+)(?:\s+(.*))?$/is.exec(text.trim());
  return match
    ? { name: match[1]!.toLowerCase(), args: match[2]?.trim() ?? "" }
    : undefined;
}
export function suggestions(text: string) {
  return /^\/[a-z-]*$/i.test(text)
    ? commands.filter(([name]) => name.startsWith(text.slice(1).toLowerCase()))
    : [];
}
