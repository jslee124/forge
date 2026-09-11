import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const text = z.string().max(100_000);
export const managementCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state") }).strict(),
  z.object({ type: z.literal("web-install") }).strict(),
  z.object({ type: z.literal("web-enable"), enabled: z.boolean() }).strict(),
  z
    .object({
      type: z.literal("web-configure"),
      provider: z.enum(["auto", "brave", "duckduckgo"]),
    })
    .strict(),
  z
    .object({ type: z.literal("workspace"), cwd: z.string().min(1).max(4096) })
    .strict(),
  z
    .object({
      type: z.literal("create"),
      prompt: z.string().trim().min(1).max(100_000),
    })
    .strict(),
  z.object({ type: z.literal("resume"), sessionId: id }).strict(),
  z.object({ type: z.literal("compact") }).strict(),
  z.object({ type: z.literal("auth-status") }).strict(),
  z.object({ type: z.literal("login") }).strict(),
  z.object({ type: z.literal("cancel-login") }).strict(),
]);
export type ManagementCommand = z.infer<typeof managementCommandSchema>;
export const desktopStateSchema = z
  .object({
    web: z
      .object({
        configurationInvalid: z.boolean(),
        installed: z.boolean(),
        enabled: z.boolean(),
        provider: z.enum(["auto", "brave", "duckduckgo"]),
        actualProvider: z.enum(["brave", "duckduckgo"]),
        braveKeyConfigured: z.boolean(),
        provenance: text,
      })
      .optional(),
    forgeHome: text,
    cwd: text,
    sessionId: z.string(),
    model: text,
    provider: text,
    sessions: z.array(z.object({ id, title: text })).max(1000),
    messages: z
      .array(
        z.object({
          id: z.string(),
          role: z.enum(["user", "assistant"]),
          content: z.string().max(4_194_304),
        }),
      )
      .max(10000),
    context: text,
    auth: z.enum([
      "unknown",
      "unavailable",
      "signed-out",
      "authenticated",
      "signing-in",
      "failed",
    ]),
    loginUrl: z.string().max(8192),
    loginCode: text,
    codexModels: z.array(z.string().max(256)).max(1000),
  })
  .strict();
export type DesktopState = z.infer<typeof desktopStateSchema>;
export const managementReplySchema = z
  .object({
    type: z.literal("management-reply"),
    requestId: id,
    state: desktopStateSchema.optional(),
    error: text.optional(),
  })
  .strict();
export type ManagementReply = z.infer<typeof managementReplySchema>;
export const MANAGEMENT_CHANNEL = "forge-desktop:management";
export const CHOOSE_WORKSPACE_CHANNEL = "forge-desktop:choose-workspace";
export const OPEN_LOGIN_CHANNEL = "forge-desktop:open-login";

export const OPEN_SOURCE_CHANNEL = "forge-desktop:open-source";
export const sourceUrlSchema = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "Only HTTP(S) source URLs without credentials are allowed");
