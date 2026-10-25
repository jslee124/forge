import {
  type ProductActivity,
  type ProductActivityItem,
  type ProductRecordPayload,
  type ProductRunRecord,
  ProductRunStorageError,
  type ProductRunWriter,
} from "@forge/persistence";
import type { ProductRunCompletion } from "./product-run.js";

export type { ProductActivity, ProductActivityItem } from "@forge/persistence";

/** Serializes presentation writes; a lost critical write poisons the run. */
export class ProductRunRecorder {
  #tail: Promise<void> = Promise.resolve();
  #failed = false;
  #observerCharacters = 0;
  #observerMessages = 0;
  readonly controller = new AbortController();
  constructor(readonly writer: ProductRunWriter) {}
  get failed() {
    return this.#failed || this.writer.failed;
  }
  record(payload: ProductRecordPayload): Promise<void> {
    this.#tail = this.#tail
      .then(() => this.writer.record(payload))
      .catch((cause: unknown) => {
        this.#failed = true;
        this.controller.abort();
        throw new ProductRunStorageError({ cause });
      });
    // Synchronous observers may enqueue writes. Every critical barrier still awaits this queue.
    void this.#tail.catch(() => undefined);
    return this.#tail;
  }
  observe(payload: ProductRecordPayload): void {
    const characters = "text" in payload ? payload.text.length : 0;
    const optional =
      payload.type === "text" ||
      (payload.type === "detail" && payload.kind !== "error");
    if (
      optional &&
      (this.#observerMessages >= 1024 ||
        this.#observerCharacters + characters > 1_048_576)
    ) {
      this.writer.noteOmission(characters, true);
      return;
    }
    this.#observerCharacters += characters;
    this.#observerMessages++;
    void this.record(payload)
      .catch(() => undefined)
      .finally(() => {
        this.#observerCharacters -= characters;
        this.#observerMessages--;
      });
  }

  async result(
    completion: ProductRunCompletion,
  ): Promise<ProductRunCompletion> {
    const message = completion.message?.slice(0, 16_384);
    this.writer.noteOmission(
      (completion.message?.length ?? 0) - (message?.length ?? 0),
    );
    const bounded = {
      ...completion,
      ...(message !== undefined ? { message } : {}),
    };
    await this.record({ type: "result", completion: bounded });
    return bounded;
  }
  async finish(completion: ProductRunCompletion): Promise<void> {
    await this.#tail;
    await this.writer.finish(completion);
  }
}

/** Historical projection deliberately cannot restore an executable approval request. */
export function projectRecordedActivity(
  record: ProductRunRecord,
): ProductActivity {
  let items: ProductActivityItem[] = [];
  let omitted = record.summary.omittedEvents;
  for (const { sequence, payload } of record.events) {
    if (payload.type === "text" || payload.type === "result") continue;
    if (payload.type === "action") {
      const key = `action-${payload.action.actionId}`;
      const item: ProductActivityItem = {
        id: key,
        kind: "action",
        text: "",
        action: payload.action,
        truncated: Boolean(payload.action.truncated),
      };
      const index = items.findIndex((entry) => entry.id === key);
      if (index >= 0) items[index] = item;
      else items.push(item);
    } else if (payload.type === "approval") {
      items.push({
        id: `approval-${payload.approvalId}`,
        kind: "approval",
        text: payload.description,
        decision: "unresolved",
        truncated: false,
      });
    } else if (payload.type === "decision") {
      items = items.map((item) =>
        item.id === `approval-${payload.approvalId}`
          ? { ...item, decision: payload.allow ? "allowed" : "denied" }
          : item,
      );
    } else {
      const previous = items.at(-1);
      if (
        payload.kind === "reasoning" &&
        previous?.kind === "reasoning" &&
        previous.step === payload.step
      ) {
        const text = previous.text + payload.text;
        items[items.length - 1] = {
          ...previous,
          text: text.slice(0, 65_536),
          truncated:
            previous.truncated ||
            Boolean(payload.truncated) ||
            text.length > 65_536,
        };
      } else
        items.push({
          id: `detail-${sequence}`,
          kind: payload.kind,
          text: payload.text,
          truncated: Boolean(payload.truncated),
          ...(payload.step ? { step: payload.step } : {}),
        });
    }
    if (items.length > 500) {
      omitted += items.length - 500;
      items = items.slice(-500);
    }
  }
  items = items.map((item) => {
    if (
      !item.action ||
      ["succeeded", "failed", "denied"].includes(item.action.status)
    )
      return item;
    return {
      ...item,
      action: {
        ...item.action,
        status: item.action.status === "running" ? "unknown" : "cancelled",
      },
    };
  });
  // Bound the view DTO independently of the on-disk journal; keep semantic rows.
  let remaining = 262_144;
  items = items
    .reverse()
    .map((item) => {
      const clip = (text: string) => {
        const value = text.slice(0, Math.min(8192, remaining));
        remaining -= value.length;
        return value;
      };
      const text = clip(item.text);
      const action = item.action
        ? {
            ...item.action,
            input: clip(item.action.input),
            ...(item.action.output !== undefined
              ? { output: clip(item.action.output) }
              : {}),
          }
        : undefined;
      return {
        ...item,
        text,
        ...(action ? { action } : {}),
        truncated:
          item.truncated ||
          text.length < item.text.length ||
          Boolean(
            action &&
              (action.input.length < (item.action?.input.length ?? 0) ||
                (action.output?.length ?? 0) <
                  (item.action?.output?.length ?? 0)),
          ),
      };
    })
    .reverse();
  return { items, omitted };
}
