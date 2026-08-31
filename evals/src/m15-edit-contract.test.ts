import { toModelToolDefinitions } from "@forge/tools";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { toolsForEditContract } from "./edit-tool-contract.js";

describe("Milestone 15 edit selection baselines", () => {
  it("freezes legacy, union, and flat model-facing candidates", () => {
    expect(
      toModelToolDefinitions(toolsForEditContract("legacy")).map(
        ({ name }) => name,
      ),
    ).toEqual([
      "list_files",
      "read_file",
      "search",
      "create_file",
      "apply_patch",
      "run_command",
    ]);
    for (const contract of ["union", "flat"] as const) {
      const definitions = toModelToolDefinitions(
        toolsForEditContract(contract),
      );
      expect(definitions.map(({ name }) => name)).toEqual([
        "list_files",
        "read_file",
        "search",
        "edit_file",
        "run_command",
      ]);
      expect(
        definitions.every((definition) => !("execute" in definition)),
      ).toBe(true);
    }
  });

  it("keeps the selected product schema flat while preserving runtime branch validation", () => {
    const [definition] = toModelToolDefinitions(
      toolsForEditContract("flat"),
    ).filter(({ name }) => name === "edit_file");
    if (!definition) throw new Error("Expected edit_file definition.");
    const jsonSchema = z.toJSONSchema(definition.inputSchema);
    expect(jsonSchema).toMatchObject({
      type: "object",
      properties: { operation: { enum: ["create", "replace", "rewrite"] } },
      required: ["operation", "path"],
    });
    expect(jsonSchema).not.toHaveProperty("anyOf");
    expect(jsonSchema).not.toHaveProperty("oneOf");

    expect(
      definition.inputSchema.safeParse({
        operation: "replace",
        path: "src/file.ts",
        content: "wrong branch field",
      }).success,
    ).toBe(false);
  });
});
