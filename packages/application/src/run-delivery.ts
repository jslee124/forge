import type {
  ProductRunDelivery,
  ProductRunRecord,
  RecordedAction,
} from "@forge/persistence";

/** Only recorded execution facts. Never classify an answer or a command name as verification. */
export function projectRunDelivery(
  record: ProductRunRecord,
): ProductRunDelivery {
  const actions = new Map<string, RecordedAction>();
  for (const { payload } of record.events)
    if (payload.type === "action")
      actions.set(payload.action.actionId, payload.action);
  const files: ProductRunDelivery["files"] = [];
  const commands: ProductRunDelivery["commands"] = [];
  const unresolved: ProductRunDelivery["unresolved"] = [];
  let unstructured = 0;
  for (const action of actions.values()) {
    if (action.status === "succeeded") {
      if (action.tool === "edit_file" && action.facts?.kind === "file")
        files.push({ actionId: action.actionId, facts: action.facts });
      else if (
        action.tool === "run_command" &&
        action.facts?.kind === "command"
      )
        commands.push({ actionId: action.actionId, facts: action.facts });
      else if (action.tool === "edit_file" || action.tool === "run_command")
        unstructured++;
    } else {
      unresolved.push({
        actionId: action.actionId,
        tool: action.tool,
        status:
          action.status === "failed" || action.status === "denied"
            ? action.status
            : action.status === "running" || action.status === "unknown"
              ? "unknown"
              : "not_executed",
      });
    }
  }
  let omitted =
    Math.max(0, files.length - 100) +
    Math.max(0, commands.length - 100) +
    Math.max(0, unresolved.length - 100);
  // Bound this read model independently of the activity DTO. Keep complete path identities.
  let remaining = 262_144;
  function bounded<T>(entries: T[]): T[] {
    return entries
      .slice(-100)
      .reverse()
      .filter((entry) => {
        const size = JSON.stringify(entry).length;
        if (size > remaining) {
          omitted++;
          return false;
        }
        remaining -= size;
        return true;
      })
      .reverse();
  }
  const visibleFiles = bounded(files);
  const visibleCommands = bounded(commands);
  const visibleUnresolved = bounded(unresolved);
  return {
    files: visibleFiles,
    commands: visibleCommands,
    unresolved: visibleUnresolved,
    unstructured,
    omitted,
    incomplete: Boolean(
      record.incomplete ||
        record.summary.journalIncomplete ||
        record.summary.omittedEvents ||
        record.summary.omittedCharacters ||
        omitted ||
        record.summary.engine !== "native",
    ),
  };
}
