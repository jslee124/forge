import type { ProviderProfile } from "@forge/config";
import { EFFORT_ARGUMENTS } from "./slash-commands.js";
export const BUILTIN_NATIVE_MODELS = [
  {
    provider: "deepseek",
    id: "deepseek-flash",
    label: "DeepSeek V4.1 Flash",
    defaultEffort: "high",
  },
  {
    provider: "deepseek",
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    defaultEffort: "high",
  },
  {
    provider: "openai",
    id: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    defaultEffort: "low",
  },
  {
    provider: "openai",
    id: "gpt-5.4",
    label: "GPT-5.4",
    defaultEffort: "high",
  },
] as const;
export interface ModelCatalogEntry {
  engine: "native" | "codex";
  provider: string;
  id: string;
  label: string;
  efforts: string[];
  defaultEffort: string;
}
export function nativeModelCatalog(
  providers: Readonly<Record<string, ProviderProfile>>,
): ModelCatalogEntry[] {
  const configured = Object.entries(providers).flatMap(([provider, profile]) =>
    (profile.models ?? []).map((model) => {
      const efforts = !model.reasoningGears
        ? ["none"]
        : EFFORT_ARGUMENTS.filter(
            (x) =>
              x !== "ultra" && Object.hasOwn(model.reasoningGears || {}, x),
          );
      return {
        engine: "native" as const,
        provider,
        id: model.id,
        label:
          model.id === "deepseek-v4-flash" ||
          model.id === "deepseek-v4-flash-vision-exp"
            ? `${model.name ?? model.id} (compatibility alias)`
            : (model.name ?? model.id),
        efforts: efforts.length ? [...efforts] : ["none"],
        defaultEffort: efforts.includes("medium")
          ? "medium"
          : (efforts[0] ?? "none"),
      };
    }),
  );
  return [
    ...configured,
    ...BUILTIN_NATIVE_MODELS.filter(
      (x) =>
        !configured.some((c) => c.provider === x.provider && c.id === x.id),
    ).map((x) => ({
      ...x,
      engine: "native" as const,
      efforts:
        x.provider === "deepseek"
          ? ["low", "high", "max"]
          : EFFORT_ARGUMENTS.filter((x) => x !== "ultra"),
    })),
  ];
}
