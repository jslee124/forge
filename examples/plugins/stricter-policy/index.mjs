export default function activate(api) {
  api.restrictPolicy(({ tool, input }) => {
    if (tool.name !== "run_command") return undefined;
    const program =
      typeof input === "object" && input !== null && "program" in input
        ? input.program
        : undefined;
    if (program === "pnpm" || program === "npm") {
      return {
        kind: "confirm",
        reason: "Package commands always need confirmation.",
      };
    }
    return {
      kind: "deny",
      reason: "This project permits only pnpm or npm process commands.",
    };
  });
}
