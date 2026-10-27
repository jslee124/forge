import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import type { RunEvent } from "../shared/run-protocol.js";

interface ObservedFile {
  sha256: string | null;
  status: "observed" | "missing" | "unavailable";
}
export interface RegressionObservation {
  actionId: string;
  sequence: number;
  source: ObservedFile;
  test: ObservedFile;
}

// Evidence only: these snapshots never authorize an action or restore a grant.
export async function observeRegressionInputs(
  workspace: string,
  actionId: string,
  sequence: number,
): Promise<RegressionObservation> {
  async function digest(name: string): Promise<ObservedFile> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const file = join(workspace, name);
      if (!(await lstat(file)).isFile())
        return { sha256: null, status: "unavailable" };
      handle = await open(
        file,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > 65_536)
        return { sha256: null, status: "unavailable" };
      const buffer = Buffer.alloc(65_537);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 65_536) return { sha256: null, status: "unavailable" };
      return {
        sha256: createHash("sha256")
          .update(buffer.subarray(0, bytesRead))
          .digest("hex"),
        status: "observed",
      };
    } catch (error) {
      return {
        sha256: null,
        status:
          (error as NodeJS.ErrnoException).code === "ENOENT"
            ? "missing"
            : "unavailable",
      };
    } finally {
      await handle?.close();
    }
  }
  const [source, test] = await Promise.all([
    digest("workflow.mjs"),
    digest("regression.test.mjs"),
  ]);
  return { actionId, sequence, source, test };
}

/** A bounded observed regression loop, not proof of assertion relevance or goal success. */
export function autonomousRegressionChecks(
  events: readonly RunEvent[],
  observations: readonly RegressionObservation[],
  seedSourceSha256: string | undefined,
  finalSourceSha256: string | undefined,
  finalTestSha256: string | undefined,
) {
  const command = 'node "--test" "regression.test.mjs"';
  const runs = events.flatMap((event) => {
    if (event.payload.type !== "action") return [];
    const action = event.payload.action,
      facts = action.facts;
    if (
      action.tool !== "run_command" ||
      action.status !== "succeeded" ||
      facts?.kind !== "command" ||
      facts.command !== command ||
      facts.timedOut ||
      facts.signal !== null ||
      facts.exitCode === null
    )
      return [];
    const observation = observations.find(
      (value) => value.actionId === action.actionId,
    );
    const started = events.find(
      (value) =>
        value.payload.type === "action" &&
        value.payload.action.actionId === action.actionId &&
        value.payload.action.status === "running",
    );
    if (
      !observation ||
      !started ||
      observation.sequence >= started.sequence ||
      started.sequence >= event.sequence ||
      observation.source.status !== "observed" ||
      observation.test.status !== "observed"
    )
      return [];
    return [
      { sequence: event.sequence, exitCode: facts.exitCode, observation },
    ];
  });
  const red = seedSourceSha256
    ? runs.find(
        (run) =>
          run.exitCode !== 0 &&
          run.observation.source.sha256 === seedSourceSha256 &&
          run.observation.test.sha256,
      )
    : undefined;
  const green = red
    ? runs.find(
        (run) =>
          run.sequence > red.sequence &&
          run.exitCode === 0 &&
          run.observation.source.sha256 !== seedSourceSha256 &&
          run.observation.source.sha256 === finalSourceSha256 &&
          run.observation.test.sha256 === red.observation.test.sha256,
      )
    : undefined;
  const preserved = Boolean(
    red &&
      finalTestSha256 &&
      finalTestSha256 === red.observation.test.sha256 &&
      observations
        .filter((value) => value.sequence >= red.observation.sequence)
        .every(
          (value) =>
            value.test.status === "observed" &&
            value.test.sha256 === finalTestSha256,
        ),
  );
  return {
    regressionFailedOnUnchangedSource: Boolean(red),
    regressionPassedOnChangedSource: Boolean(green),
    regressionTestBytesPreserved: preserved,
    autonomousRegressionCycleObserved: Boolean(red && green && preserved),
  };
}
