import { Box, Text } from "ink";
import type React from "react";

import { terminalHyperlink } from "../hyperlink.js";
import type { PendingSignIn } from "./types.js";

export function SignInPanel({
  prompt,
  env,
}: {
  readonly prompt: PendingSignIn;
  readonly env: NodeJS.ProcessEnv;
}): React.JSX.Element {
  const link = terminalHyperlink(prompt.url, { env, isTTY: true });
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color="cyan">
        Login
      </Text>
      <Box marginTop={1}>
        <Text dimColor>
          {prompt.userCode === undefined
            ? "Browser didn't open? Use the URL below to sign in."
            : "Open the URL below and enter the code to sign in."}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color="cyan" underline>
          {link}
        </Text>
      </Box>
      {prompt.userCode === undefined ? null : (
        <Box marginTop={1}>
          <Text>
            Code:{" "}
            <Text bold color="cyan">
              {prompt.userCode}
            </Text>
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>Waiting for sign-in to complete · Ctrl+C cancel</Text>
      </Box>
    </Box>
  );
}
