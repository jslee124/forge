import { setTimeout as delay } from "node:timers/promises";
import {
  configuredSecrets,
  ExecutionLease,
  GatewayStore,
} from "@forge/persistence";
import type { RunDependencies } from "../run.js";
import { ChannelError } from "./channel.js";
import {
  gatewayBinding,
  gatewayHome,
  gatewayToken,
  readGatewayConfig,
  validateGatewayWorkspace,
} from "./config.js";
import { NativeGatewayRunner } from "./runner.js";
import { GatewayService } from "./service.js";
import { TelegramAdapter } from "./telegram.js";

export async function runGateway(
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  dependencies: {
    readonly fetcher?: typeof fetch;
    readonly createAdapter?: RunDependencies["createAdapter"];
  } = {},
): Promise<void> {
  const config = await readGatewayConfig(env);
  await validateGatewayWorkspace(config, env);
  const adapter = new TelegramAdapter(
    config.accountId,
    gatewayToken(env),
    dependencies.fetcher,
  );
  const lease = await ExecutionLease.acquire(`telegram:${config.accountId}`);
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  const serviceSignal = controller.signal;
  let service: GatewayService | undefined;
  let delivery: Promise<void> | undefined;
  let deliveryFailure: unknown;
  const callbackReplies = new Set<Promise<void>>();
  try {
    await adapter.verify(serviceSignal);
    const store = new GatewayStore(gatewayHome(env));
    const state = await store.load(gatewayBinding(config));
    service = new GatewayService(
      state,
      store,
      config,
      adapter,
      new NativeGatewayRunner(config, env, dependencies.createAdapter),
      configuredSecrets(env),
    );
    await service.recover();
    const runningService = service;
    delivery = (async () => {
      while (!serviceSignal.aborted) {
        await runningService.flush(serviceSignal);
        await delay(250, undefined, { signal: serviceSignal });
      }
    })().catch((error) => {
      if (!serviceSignal.aborted) deliveryFailure = error;
      controller.abort();
    });
    let failures = 0;
    while (!serviceSignal.aborted) {
      let updates: Awaited<ReturnType<TelegramAdapter["poll"]>>;
      try {
        updates = await adapter.poll(state.offset, serviceSignal);
      } catch (error) {
        if (serviceSignal.aborted) break;
        if (!(error instanceof ChannelError) || error.fatal) throw error;
        await service.connection("reconnecting");
        await delay(
          Math.max(
            error.retryAfterMs,
            Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)),
          ),
          undefined,
          { signal: serviceSignal },
        );
        continue;
      }
      failures = 0;
      await service.connection("connected");
      for (const update of updates) {
        if (serviceSignal.aborted) break;
        if (update.offset <= state.offset) continue;
        await service.receive(update.event, update.offset);
        if (
          update.callbackId &&
          update.event?.private &&
          config.allowedUserIds.includes(update.event.senderId) &&
          callbackReplies.size < 8
        ) {
          // UI acknowledgements must never block receipt of cancellation or approvals.
          const reply = adapter
            .answerCallback(
              update.callbackId,
              AbortSignal.any([serviceSignal, AbortSignal.timeout(2000)]),
            )
            .catch(() => {})
            .finally(() => {
              callbackReplies.delete(reply);
            });
          callbackReplies.add(reply);
        }
      }
    }
    if (deliveryFailure) throw deliveryFailure;
  } catch (error) {
    if (!signal.aborted) throw error;
  } finally {
    controller.abort();
    await delivery;
    await Promise.allSettled(callbackReplies);
    try {
      await service?.stop();
    } finally {
      signal.removeEventListener("abort", stop);
      await lease.release();
    }
  }
}

/** Local operator recovery only: retries delivery, never agent execution. */
export async function retryGatewayDelivery(
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const config = await readGatewayConfig(env);
  const lease = await ExecutionLease.acquire(`telegram:${config.accountId}`);
  try {
    const store = new GatewayStore(gatewayHome(env));
    const state = await store.load(gatewayBinding(config));
    // Approval state is process-local and must not be revived.
    state.outbox = state.outbox.filter(
      (item) => item.kind !== "approval" && item.kind !== "progress",
    );
    for (const item of state.outbox) {
      item.attempts = 0;
      item.failed = false;
      item.nextAttemptAt = 0;
    }
    await store.save(state);
    return state.outbox.length;
  } finally {
    await lease.release();
  }
}
