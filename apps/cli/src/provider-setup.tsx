import {
  PROVIDER_APIS,
  type ProviderApi,
  ProviderEndpointError,
  type ProviderModelProfile,
  type ProviderProfile,
  parseProviderBaseUrl,
  RESERVED_PROVIDER_ROUTES,
} from "@forge/config";
import { type DiscoveredModel, discoverModels } from "@forge/model-compat";
import { Box, Text, useInput } from "ink";
import type React from "react";
import { useCallback, useMemo, useRef, useState } from "react";

const ROUTE_NAME = /^[a-z][a-z0-9-]{0,63}$/u;
const GEARS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
type Gear = (typeof GEARS)[number];
type Step =
  | "route"
  | "base-url"
  | "api"
  | "auth"
  | "key"
  | "discovering"
  | "models"
  | "manual-model"
  | "gears"
  | "images";

export interface ProviderSetupResult {
  readonly route: string;
  readonly profile: ProviderProfile;
  readonly model: string;
  readonly apiKey?: string;
}

export interface ProviderSetupProps {
  readonly existingProviders: Readonly<Record<string, ProviderProfile>>;
  readonly initialRoute?: string;
  readonly onComplete: (result: ProviderSetupResult) => void;
  readonly onCancel: () => void;
  readonly discover?: typeof discoverModels;
  readonly discoverExisting?: (
    request: ExistingProviderDiscoveryRequest,
  ) => Promise<readonly DiscoveredModel[]>;
  readonly hasExistingCredential?: (
    route: string,
    profile: ProviderProfile,
  ) => boolean;
}

export interface ExistingProviderDiscoveryRequest {
  readonly route: string;
  readonly profile: ProviderProfile;
  readonly signal: AbortSignal;
}

export function ProviderSetup({
  existingProviders,
  initialRoute = "",
  onComplete,
  onCancel,
  discover = discoverModels,
  discoverExisting = ({ profile, signal }) =>
    discover({
      api: profile.api,
      baseUrl: profile.baseUrl,
      signal,
    }),
  hasExistingCredential = (_route, profile) => profile.auth.type === "none",
}: ProviderSetupProps): React.JSX.Element {
  const [step, setStep] = useState<Step>("route");
  const [route, setRoute] = useState(initialRoute);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiIndex, setApiIndex] = useState(0);
  const [authIndex, setAuthIndex] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<readonly DiscoveredModel[]>([]);
  const [modelQuery, setModelQuery] = useState("");
  const [manualModel, setManualModel] = useState("");
  const [selected, setSelected] = useState(0);
  const [gearIndex, setGearIndex] = useState(0);
  const [gears, setGears] = useState<ReadonlySet<Gear>>(new Set());
  const [gearSource, setGearSource] = useState<
    "model-listing" | "manual" | undefined
  >();
  const [supportsImages, setSupportsImages] = useState(false);
  const [notice, setNotice] = useState<string>();
  const probeController = useRef<AbortController | undefined>(undefined);
  const api: ProviderApi = PROVIDER_APIS[apiIndex] ?? PROVIDER_APIS[0];
  const authType = authIndex === 0 ? "bearer" : "none";
  const visibleModels = useMemo(() => {
    const query = modelQuery.trim().toLocaleLowerCase();
    return models
      .filter((model) =>
        query === ""
          ? true
          : `${model.name ?? ""}\n${model.id}`
              .toLocaleLowerCase()
              .includes(query),
      )
      .slice(0, 10);
  }, [modelQuery, models]);
  const visibleIndex =
    visibleModels.length === 0
      ? 0
      : Math.min(selected, visibleModels.length - 1);

  const beginDiscovery = useCallback(() => {
    const controller = new AbortController();
    probeController.current = controller;
    setStep("discovering");
    setNotice(undefined);
    void discover({
      api,
      baseUrl,
      ...(authType === "bearer" ? { apiKey: apiKey.trim() } : {}),
      signal: controller.signal,
    }).then(
      (found) => {
        if (found.length === 0) {
          setNotice("The endpoint listed no models. Enter a model id.");
          setStep("manual-model");
          return;
        }
        setModels(found);
        setSelected(0);
        setModelQuery("");
        setStep("models");
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setNotice(
          `${error instanceof Error ? error.message : "Model discovery failed"}. Enter a model id.`,
        );
        setStep("manual-model");
      },
    );
  }, [api, apiKey, authType, baseUrl, discover]);

  const beginExistingDiscovery = useCallback(
    (routeName: string, profile: ProviderProfile) => {
      setRoute(routeName);
      setBaseUrl(profile.baseUrl);
      setApiIndex(Math.max(0, PROVIDER_APIS.indexOf(profile.api)));
      setAuthIndex(profile.auth.type === "bearer" ? 0 : 1);
      if (
        profile.auth.type === "bearer" &&
        !hasExistingCredential(routeName, profile)
      ) {
        setApiKey("");
        setNotice(
          `Provider "${routeName}" has no active credential. Enter a new API key.`,
        );
        setStep("key");
        return;
      }
      const controller = new AbortController();
      probeController.current = controller;
      setStep("discovering");
      setNotice(`Adding a model to existing provider "${routeName}".`);
      void discoverExisting({
        route: routeName,
        profile,
        signal: controller.signal,
      }).then(
        (found) => {
          const configured = new Set(
            (profile.models ?? []).map(({ id }) => id),
          );
          const available = found.filter(({ id }) => !configured.has(id));
          if (available.length === 0) {
            setNotice(
              "The endpoint listed no additional models. Enter a model id.",
            );
            setStep("manual-model");
            return;
          }
          setModels(available);
          setSelected(0);
          setModelQuery("");
          setStep("models");
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          setNotice(
            `${error instanceof Error ? error.message : "Model discovery failed"}. Enter a model id.`,
          );
          setStep("manual-model");
        },
      );
    },
    [discoverExisting, hasExistingCredential],
  );

  const finish = useCallback(
    (modelId: string) => {
      const discovered = models.find((model) => model.id === modelId);
      const model: ProviderModelProfile = {
        id: modelId,
        ...(discovered?.name ? { name: discovered.name } : {}),
        ...(discovered?.contextWindow
          ? { contextWindow: discovered.contextWindow }
          : {}),
        ...(discovered?.maxOutputTokens
          ? { maxOutputTokens: discovered.maxOutputTokens }
          : {}),
        ...(gears.size === 0
          ? {}
          : {
              reasoningGears: Object.fromEntries(
                [...gears].map((gear) => [gear, gear]),
              ),
            }),
        ...(supportsImages ? { supportsImages: true } : {}),
      };
      onComplete({
        route,
        model: modelId,
        ...(authType === "bearer" && apiKey.trim() !== ""
          ? { apiKey: apiKey.trim() }
          : {}),
        profile: existingProviders[route]
          ? {
              ...existingProviders[route],
              models: [...(existingProviders[route].models ?? []), model],
            }
          : {
              api,
              baseUrl,
              auth: { type: authType },
              models: [model],
            },
      });
    },
    [
      api,
      apiKey,
      authType,
      baseUrl,
      gears,
      existingProviders,
      models,
      onComplete,
      route,
      supportsImages,
    ],
  );

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input.toLocaleLowerCase() === "c")) {
      probeController.current?.abort();
      onCancel();
      return;
    }
    if (step === "discovering") return;

    if (step === "route") {
      if (key.return) {
        const value = route.trim();
        if (!ROUTE_NAME.test(value)) {
          setNotice(
            "Use lowercase letters, digits, and hyphens, starting with a letter.",
          );
        } else if (RESERVED_PROVIDER_ROUTES.includes(value)) {
          setNotice(`"${value}" is reserved.`);
        } else if (existingProviders[value]) {
          beginExistingDiscovery(value, existingProviders[value]);
        } else {
          setRoute(value);
          setNotice(undefined);
          setStep("base-url");
        }
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
              : "That endpoint is invalid.",
          );
        }
        return;
      }
      editText(input, key, setBaseUrl);
      return;
    }
    if (step === "api" || step === "auth") {
      if (key.upArrow || key.downArrow) {
        const delta = key.upArrow ? -1 : 1;
        if (step === "api") {
          setApiIndex(
            (current) =>
              (current + delta + PROVIDER_APIS.length) % PROVIDER_APIS.length,
          );
        } else {
          setAuthIndex((current) => (current + delta + 2) % 2);
        }
      } else if (key.return) {
        setStep(
          step === "api"
            ? "auth"
            : authType === "bearer"
              ? "key"
              : "discovering",
        );
        if (step === "auth" && authType === "none") beginDiscovery();
      }
      return;
    }
    if (step === "key") {
      if (key.return && apiKey.trim() !== "") {
        beginDiscovery();
        return;
      }
      editText(input, key, setApiKey);
      return;
    }
    if (step === "models") {
      if (key.tab) {
        setStep("manual-model");
      } else if (key.upArrow || key.downArrow) {
        const delta = key.upArrow ? -1 : 1;
        setSelected((current) =>
          visibleModels.length === 0
            ? 0
            : (current + delta + visibleModels.length) % visibleModels.length,
        );
      } else if (key.return) {
        const chosen = visibleModels[visibleIndex];
        if (chosen) {
          setManualModel(chosen.id);
          const discoveredGears = chosen.reasoningEfforts?.filter(
            (effort): effort is Gear => GEARS.includes(effort as Gear),
          );
          setGears(new Set(discoveredGears ?? []));
          setGearSource(discoveredGears?.length ? "model-listing" : undefined);
          setStep("gears");
        }
      } else {
        editText(input, key, (update) => {
          setSelected(0);
          setModelQuery(update);
        });
      }
      return;
    }
    if (step === "manual-model") {
      if (key.return && manualModel.trim() !== "") {
        const value = manualModel.trim();
        if (existingProviders[route]?.models?.some(({ id }) => id === value)) {
          setNotice(`Model "${value}" is already configured for "${route}".`);
        } else {
          setManualModel(value);
          setGears(new Set());
          setGearSource(undefined);
          setNotice(undefined);
          setStep("gears");
        }
      } else {
        editText(input, key, setManualModel);
      }
      return;
    }
    if (step === "gears") {
      if (key.upArrow || key.downArrow) {
        const delta = key.upArrow ? -1 : 1;
        setGearIndex(
          (current) => (current + delta + GEARS.length) % GEARS.length,
        );
      } else if (input === " ") {
        const gear = GEARS[gearIndex];
        if (gear) {
          setGearSource("manual");
          setGears((current) => {
            const next = new Set(current);
            if (next.has(gear)) next.delete(gear);
            else next.add(gear);
            return next;
          });
        }
      } else if (key.return) {
        setStep("images");
      }
      return;
    }
    if (step === "images") {
      if (key.upArrow || key.downArrow) {
        setSupportsImages((current) => !current);
      } else if (key.return) {
        finish(manualModel);
      }
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
        {existingProviders[route] ? "Add provider model" : "Add provider route"}
        {" · "}
        {step}
      </Text>
      {step === "route" ? <Field label="Route" value={route} /> : null}
      {step === "base-url" ? <Field label="Base URL" value={baseUrl} /> : null}
      {step === "api" ? (
        <Choices values={PROVIDER_APIS} selected={apiIndex} />
      ) : null}
      {step === "auth" ? (
        <Choices
          values={["bearer API key", "no authentication"]}
          selected={authIndex}
        />
      ) : null}
      {step === "key" ? (
        <Field
          label="API key"
          value={apiKey === "" ? "" : "•".repeat(Array.from(apiKey).length)}
        />
      ) : null}
      {step === "discovering" ? (
        <Text dimColor>Discovering models…</Text>
      ) : null}
      {step === "models" ? (
        <Box flexDirection="column">
          <Field label="Search" value={modelQuery} />
          {visibleModels.map((model, index) => (
            <Text
              key={model.id}
              {...(index === visibleIndex ? { color: "cyan" as const } : {})}
              bold={index === visibleIndex}
            >
              {index === visibleIndex ? "› " : "  "}
              {model.name ?? model.id}
              {model.name ? ` · ${model.id}` : ""}
            </Text>
          ))}
          <Text dimColor>Type to filter · Tab enter model manually</Text>
        </Box>
      ) : null}
      {step === "manual-model" ? (
        <Field label="Model id" value={manualModel} />
      ) : null}
      {step === "gears" ? (
        <Box flexDirection="column">
          {GEARS.map((gear, index) => (
            <Text
              key={gear}
              {...(index === gearIndex ? { color: "cyan" as const } : {})}
              bold={index === gearIndex}
            >
              {index === gearIndex ? "› " : "  "}
              {gears.has(gear) ? "[x]" : "[ ]"} {gear}
            </Text>
          ))}
          <Text dimColor>
            No selection keeps the provider default; it does not disable
            reasoning.
          </Text>
          <Text dimColor>
            {gearSource === "model-listing"
              ? "Source: discovered from /models · Space overrides manually"
              : gearSource === "manual"
                ? "Source: manual override"
                : "No capability metadata · provider default will be used"}
          </Text>
        </Box>
      ) : null}
      {step === "images" ? (
        <Choices
          values={["text only", "supports image input"]}
          selected={supportsImages ? 1 : 0}
        />
      ) : null}
      {notice ? <Text color="yellow">⚠ {notice}</Text> : null}
      <Text dimColor>
        {step === "gears"
          ? "↑↓ move · Space toggle · Enter continue"
          : "↑↓ choose · Enter continue · Esc cancel"}
      </Text>
    </Box>
  );
}

function Field({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): React.JSX.Element {
  return (
    <Text>
      {label}: <Text color="cyan">{value === "" ? "_" : value}</Text>
    </Text>
  );
}

function Choices({
  values,
  selected,
}: {
  readonly values: readonly string[];
  readonly selected: number;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      {values.map((value, index) => (
        <Text
          key={value}
          {...(index === selected ? { color: "cyan" as const } : {})}
          bold={index === selected}
        >
          {index === selected ? "› " : "  "}
          {value}
        </Text>
      ))}
    </Box>
  );
}

function editText(
  input: string,
  key: {
    readonly backspace?: boolean;
    readonly delete?: boolean;
    readonly ctrl?: boolean;
    readonly meta?: boolean;
  },
  set: (update: (current: string) => string) => void,
): void {
  if (key.backspace || key.delete) {
    set((current) => Array.from(current).slice(0, -1).join(""));
  } else if (!key.ctrl && !key.meta && input !== "") {
    set((current) => current + input);
  }
}
