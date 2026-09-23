import { z } from "zod";

export const UPDATE_CHANNEL = "forge-desktop:update";
export const updateCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status") }).strict(),
  z.object({ type: z.literal("check") }).strict(),
  z.object({ type: z.literal("download") }).strict(),
  z.object({ type: z.literal("cancel") }).strict(),
  z.object({ type: z.literal("open") }).strict(),
  z
    .object({
      type: z.literal("preferences"),
      channel: z.enum(["stable", "preview"]),
      startup: z.boolean(),
    })
    .strict(),
]);
export type UpdateCommand = z.infer<typeof updateCommandSchema>;
export interface UpdateStatus {
  version: string | null;
  platform: "darwin" | "win32";
  channel: "stable" | "preview";
  startup: boolean;
  phase:
    | "unchecked"
    | "checking"
    | "current"
    | "available"
    | "downloading"
    | "verifying"
    | "verified"
    | "failed";
  lastCheck?: string | undefined;
  target?: string | undefined;
  notes?: string | undefined;
  received?: number | undefined;
  total?: number | undefined;
  error?: string | undefined;
  retry?: "check" | "download" | undefined;
}
