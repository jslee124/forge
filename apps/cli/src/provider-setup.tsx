import {
  PROVIDER_APIS,
  type ProviderApi,
  ProviderEndpointError,
  type ProviderModelProfile,
  type ProviderProfile,
  parseProviderBaseUrl,
  RESERVED_PROVIDER_ROUTES,
  type ReasoningEffort,
} from "@forge/config";
import {
  canDiscoverModels,
  type DiscoveredModel,
  discoverModels,
} from "@forge/model-compat";
import { Box, Text, useInput } from "ink";
import type React from "react";
import { useCallback, useState } from "react";

/** Route names must match the configuration schema. */
const ROUTE_NAME = /^[a-z][a-z0-9-]{0,63}$/u;

/** Gears offered by the wizard, in escalation order. */
const OFFERED_GEARS: readonly ReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Steps of the wizard, in order. */
type Step =
  | "route"
  | "base-url"
  | "api"
  | "key"
  | "models"
  | "manual-model"
  | "gears";

export interface ProviderSetupResult {
  readonly route: string;
  readonly profile: ProviderProfile;
  /** The model to select once the route is saved. */
  readonly model: string;
  /** Present only when the user entered a key that must be stored. */
  readonly apiKey?: string;
}

export interface ProviderSetupProps {
  readonly existingRoutes: readonly string[];
  readonly onComplete: (result: ProviderSetupResult) => void;
  readonly onCancel: () => void;
  /** Injected for tests; defaults to the real network probe. */
  readonly discover?: typeof discoverModels;
}

/**
 * Guided setup for one third-party provider route.
 *
 * Discovery is offered but never required: a protocol without a readable
 * listing, an endpoint that publishes none, and an unreachable endpoint all
 * fall through to hand entry with the reason shown, because the point of the
 * route is to reach an endpoint Forge does not know.
 */
export function ProviderSetup({
  existingRoutes,
  onComplete,
  onCancel,
  discover = discoverModels,
}: ProviderSetupProps): React.JSX.Element {
  const [step, setStep] = useState<Step>("route");
  const [route, setRoute] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiIndex, setApiIndex] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [manualModel, setManualModel] = useState("");
  const [models, setModels] = useState<readonly DiscoveredModel[]>([]);
  const [selected, setSelected] = useState(0);
  const [gears, setGears] = useState<ReadonlySet<ReasoningEffort>>(new Set());
  const [gearIndex, setGearIndex] = useState(0);
  const [notice, setNotice] = useState<string>();
  const [probing, setProbing] = useState(false);

  const api: ProviderApi = PROVIDER_APIS[apiIndex] ?? PROVIDER_APIS[0];

  const finish = useCallback(
    (modelId: string, chosen: ReadonlySet<ReasoningEffort>) => {
      const profileModel: ProviderModelProfile = {
        id: modelId,
        ...(chosen.size === 0
          ? {}
          : {
              // The wire value defaults to the gear name, which is what an
              // OpenAI-compatible endpoint expects; a gateway that spells them
              // differently can be corrected in the configuration file.
              reasoningGears: Object.fromEntries(
                [...chosen].map((gear) => [
                  gear,
                  gear === "none" ? null : gear,
                ]),
              ),
            }),
      };
      const discovered = models.find((entry) => entry.id === modelId);
      onComplete({
        route,
        model: modelId,
        ...(apiKey.trim() === "" ? {} : { apiKey: apiKey.trim() }),
        profile: {
          api,
          baseUrl,
          models: [
            {
              ...profileModel,
              ...(discovered?.contextWindow === undefined
                ? {}
                : { contextWindow: discovered.contextWindow }),
              ...(discovered?.maxOutputTokens === undefined
                ? {}
                : { maxOutputTokens: discovered.maxOutputTokens }),
            },
          ],
        },
      });
    },
    [api, apiKey, baseUrl, models, onComplete, route],
  );

  const probe = useCallback(async () => {
    if (!canDiscoverModels(api)) {
      setNotice(
        `${api} publishes no listing Forge can read; enter a model id.`,
      );
      setStep("manual-model");
      return;
    }
    setProbing(true);
    setNotice(undefined);
    try {
      const found = await discover({
        api,
        baseUrl,
        ...(apiKey.trim() === "" ? {} : { apiKey: apiKey.trim() }),
      });
      if (found.length === 0) {
        setNotice("The endpoint listed no models; enter a model id.");
        setStep("manual-model");
        return;
      }
      setModels(found);
      setSelected(0);
      setStep("models");
    } catch (error) {
      setNotice(
        `${error instanceof Error ? error.message : "discovery failed"}. Enter a model id instead.`,
      );
      setStep("manual-model");
    } finally {
      setProbing(false);
    }
  }, [api, apiKey, baseUrl, discover]);

  useInput((input, key) => {
    if (probing) return;
    if (key.escape) {
      onCancel();
      return;
    }

    if (step === "route") {
      if (key.return) {
        const value = route.trim();
        if (!ROUTE_NAME.test(value)) {
          setNotice(
            "Use lowercase letters, digits, and hyphens, starting with a letter.",
          );
          return;
        }
        if (RESERVED_PROVIDER_ROUTES.includes(value)) {
          setNotice(`"${value}" is reserved for a built-in provider.`);
          return;
        }
        if (existingRoutes.includes(value)) {
          setNotice(`"${value}" already exists and would be replaced.`);
        } else {
          setNotice(undefined);
        }
        setRoute(value);
        setStep("base-url");
        return;
      }
      editText(input, key, setRoute);
      return;
    }

    if (step === "base-url") {
      if (key.return) {
        try {
          setBaseUrl(parseProviderBaseUrl(baseUrl));
          setNotice(undefined);
          setStep("api");
        } catch (error) {
          setNotice(
            error instanceof ProviderEndpointError
              ? error.message
              : "That endpoint is not usable.",
          );
        }
        return;
      }
      editText(input, key, setBaseUrl);
      return;
    }

    if (step === "api") {
      if (key.upArrow || key.downArrow) {
        const delta = key.upArrow ? -1 : 1;
        setApiIndex(
          (current) =>
            (current + delta + PROVIDER_APIS.length) % PROVIDER_APIS.length,
        );
        return;
      }
      if (key.return) {
        setNotice(undefined);
        setStep("key");
      }
      return;
    }

    if (step === "key") {
      if (key.return) {
        void probe();
        return;
      }
      editText(input, key, setApiKey);
      return;
    }

    if (step === "models") {
      if (key.upArrow || key.downArrow) {
        const delta = key.upArrow ? -1 : 1;
        setSelected(
          (current) => (current + delta + models.length) % models.length,
        );
        return;
      }
      if (input.toLocaleLowerCase() === "m") {
        setStep("manual-model");
        return;
      }
      if (key.return) {
        setNotice(undefined);
        setStep("gears");
      }
      return;
    }

    if (step === "manual-model") {
      if (key.return && manualModel.trim() !== "") {
        setNotice(undefined);
        setStep("gears");
        return;
      }
      editText(input, key, setManualModel);
      return;
    }

    // step === "gears"
    if (key.upArrow || key.downArrow) {
      const delta = key.upArrow ? -1 : 1;
      setGearIndex(
        (current) =>
          (current + delta + OFFERED_GEARS.length) % OFFERED_GEARS.length,
      );
      return;
    }
    if (input === " ") {
      const gear = OFFERED_GEARS[gearIndex];
      if (gear === undefined) return;
      setGears((current) => {
        const next = new Set(current);
        if (next.has(gear)) next.delete(gear);
        else next.add(gear);
        return next;
      });
      return;
    }
    if (key.return) {
      const modelId =
        models.length > 0 && manualModel.trim() === ""
          ? (models[selected]?.id ?? "")
          : manualModel.trim();
      if (modelId !== "") finish(modelId, gears);
    }
  });

  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      paddingX={1}
    >
      <Text bold color="cyan">
        Add a provider · {stepTitle(step)}
      </Text>

      {step === "route" ? (
        <Field label="Route name" value={route} hint="for example my-gateway" />
      ) : null}

      {step === "base-url" ? (
        <Field
          label="Base URL"
          value={baseUrl}
          hint="https endpoint, or http on this machine"
        />
      ) : null}

      {step === "api" ? (
        <Box flexDirection="column">
          {PROVIDER_APIS.map((candidate, index) => (
            <Text
              key={candidate}
              bold={index === apiIndex}
              {...(index === apiIndex ? { color: "cyan" as const } : {})}
            >
              {index === apiIndex ? "› " : "  "}
              {candidate}
              {canDiscoverModels(candidate) ? "" : " · models entered by hand"}
            </Text>
          ))}
        </Box>
      ) : null}

      {step === "key" ? (
        <Field
          label="API key"
          value={apiKey === "" ? "" : "•".repeat(Array.from(apiKey).length)}
          hint="stored with owner-only permissions; leave blank to probe unauthenticated"
        />
      ) : null}

      {step === "models" ? (
        <Box flexDirection="column">
          {models.slice(0, 12).map((model, index) => (
            <Text
              key={model.id}
              bold={index === selected}
              {...(index === selected ? { color: "cyan" as const } : {})}
            >
              {index === selected ? "› " : "  "}
              {model.name ?? model.id}
              {model.name === undefined ? "" : ` · ${model.id}`}
            </Text>
          ))}
          {models.length > 12 ? (
            <Text dimColor>…and {models.length - 12} more</Text>
          ) : null}
        </Box>
      ) : null}

      {step === "manual-model" ? (
        <Field
          label="Model id"
          value={manualModel}
          hint="exactly as the endpoint spells it"
        />
      ) : null}

      {step === "gears" ? (
        <Box flexDirection="column">
          {OFFERED_GEARS.map((gear, index) => (
            <Text
              key={gear}
              bold={index === gearIndex}
              {...(index === gearIndex ? { color: "cyan" as const } : {})}
            >
              {index === gearIndex ? "› " : "  "}
              {gears.has(gear) ? "[x] " : "[ ] "}
              {gear}
            </Text>
          ))}
          <Text dimColor>
            Selecting none declares no reasoning support, and no reasoning
            parameter is sent.
          </Text>
        </Box>
      ) : null}

      {probing ? (
        <Text dimColor>Asking the endpoint for its models…</Text>
      ) : null}
      {notice ? <Text color="yellow">⚠ {notice}</Text> : null}
      <Text dimColor>{stepHint(step)}</Text>
    </Box>
  );
}

function Field({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text>
        {label}: <Text color="cyan">{value === "" ? "_" : value}</Text>
      </Text>
      <Text dimColor>{hint}</Text>
    </Box>
  );
}

/** Apply one printable keypress or a backspace to a text field. */
function editText(
  input: string,
  key: { readonly backspace?: boolean; readonly delete?: boolean },
  set: (update: (current: string) => string) => void,
): void {
  if (key.backspace || key.delete) {
    set((current) => Array.from(current).slice(0, -1).join(""));
    return;
  }
  if (input !== "") set((current) => current + input);
}

function stepTitle(step: Step): string {
  switch (step) {
    case "route":
      return "name";
    case "base-url":
      return "endpoint";
    case "api":
      return "protocol";
    case "key":
      return "credential";
    case "models":
      return "model";
    case "manual-model":
      return "model by hand";
    case "gears":
      return "reasoning gears";
  }
}

function stepHint(step: Step): string {
  switch (step) {
    case "api":
      return "↑↓ choose · Enter continue · Esc cancel";
    case "key":
      return "Enter continue and look up models · Esc cancel";
    case "models":
      return "↑↓ choose · m enter one by hand · Enter continue · Esc cancel";
    case "gears":
      return "↑↓ move · Space toggle · Enter save · Esc cancel";
    default:
      return "Enter continue · Esc cancel";
  }
}
