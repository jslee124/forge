import { Box, Text } from "ink";
import type React from "react";

import type { DetectedStartupResources } from "../startup-resources.js";

export function PluginsPanel({
  resources,
}: {
  readonly resources: DetectedStartupResources;
}): React.JSX.Element {
  const projectPlugins = resources.plugins.filter(
    ({ scope }) => scope === "project",
  );
  const userPlugins = resources.plugins.filter(({ scope }) => scope === "user");
  const projectTrusted = projectPlugins.some(
    ({ state }) => state === "trusted",
  );
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      paddingX={1}
      marginTop={1}
    >
      <Text bold color="cyan">
        Plugins
      </Text>
      {projectPlugins.length === 0 ? (
        <Text dimColor>No project plugins were discovered.</Text>
      ) : (
        projectPlugins.map((plugin) => (
          <Box key={plugin.name} flexDirection="column" marginTop={1}>
            <Text>
              <Text bold>{plugin.name}</Text>
              {` @ ${plugin.version} · ${plugin.state}`}
            </Text>
            <Text dimColor>
              Capabilities: {plugin.capabilities.join(", ") || "none"}
            </Text>
          </Box>
        ))
      )}
      {userPlugins.map((plugin) => (
        <Text key={plugin.name} dimColor>
          {plugin.name} @ {plugin.version} · user · {plugin.state}
        </Text>
      ))}
      {projectPlugins.length > 0 ? (
        <Text>
          {projectTrusted ? (
            <>
              <Text bold color="red">
                u
              </Text>{" "}
              revoke project trust
            </>
          ) : (
            <>
              <Text bold color="green">
                t
              </Text>{" "}
              review and trust project plugins
            </>
          )}
          <Text dimColor> · Esc close</Text>
        </Text>
      ) : (
        <Text dimColor>Esc close</Text>
      )}
      <Text dimColor>Skills are listed separately in /resources.</Text>
    </Box>
  );
}

export function ResourcesPanel({
  resources,
}: {
  readonly resources: DetectedStartupResources;
}): React.JSX.Element {
  const diagnostics = resources.diagnostics ?? [];
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      paddingX={1}
      marginTop={1}
    >
      <Text bold color="cyan">
        Resources
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="gray">
          Skills
        </Text>
        {resources.skills.length === 0 ? (
          <Text dimColor>No Skills were discovered.</Text>
        ) : (
          resources.skills.map((skill) => (
            <Box
              key={`${skill.source}:${skill.path}`}
              flexDirection="column"
              marginTop={1}
              paddingLeft={1}
            >
              <Text>
                <Text bold>${skill.name}</Text>
                <Text
                  dimColor
                >{` · ${skill.source} · ${skill.status ?? skill.invocation}${skill.shadowedBy ? ` by ${skill.shadowedBy}` : ""}`}</Text>
              </Text>
              <Text dimColor>{skill.description ?? "No description."}</Text>
            </Box>
          ))
        )}
      </Box>
      {diagnostics.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="yellow">
            Diagnostics
          </Text>
          {diagnostics.map((diagnostic) => (
            <Text key={diagnostic} color="yellow">
              {diagnostic}
            </Text>
          ))}
        </Box>
      ) : null}
      <Box
        borderStyle="single"
        borderColor="gray"
        flexDirection="column"
        marginTop={1}
        paddingX={1}
      >
        <Text bold color="cyan">
          Actions
        </Text>
        <Text color="green">forge resources disable|enable &lt;name&gt;</Text>
        <Text dimColor>
          Toggle automatic invocation for a user-scoped Skill.
        </Text>
        <Text dimColor>
          <Text color="yellow">Esc</Text> close
        </Text>
      </Box>
    </Box>
  );
}

export function PluginTrustPanel({
  cwd,
  intent,
  resources,
}: {
  readonly cwd: string;
  readonly intent: "trust" | "untrust";
  readonly resources: DetectedStartupResources;
}): React.JSX.Element {
  const projectPlugins = resources.plugins.filter(
    ({ scope }) => scope === "project",
  );
  const trusting = intent === "trust";
  return (
    <Box
      borderStyle="round"
      borderColor={trusting ? "yellow" : "red"}
      flexDirection="column"
      paddingX={1}
      marginTop={1}
    >
      <Text bold color={trusting ? "yellow" : "red"}>
        {trusting ? "Trust project plugins?" : "Revoke project plugin trust?"}
      </Text>
      <Text dimColor>Workspace: {cwd}</Text>
      {projectPlugins.map((plugin) => (
        <Text key={plugin.name}>
          {plugin.name}@{plugin.version} · capabilities:{" "}
          {plugin.capabilities.join(", ") || "none"}
        </Text>
      ))}
      {trusting ? (
        <Text color="yellow">
          Warning: trusted plugins run in-process with the full local privileges
          of Forge. Trust applies to this entire workspace, including future
          plugin changes.
        </Text>
      ) : null}
      <Text>
        <Text bold color="green">
          y
        </Text>{" "}
        {trusting ? "trust" : "revoke"}{" "}
        <Text bold color="red">
          n
        </Text>{" "}
        cancel
      </Text>
    </Box>
  );
}
