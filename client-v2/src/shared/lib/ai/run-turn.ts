import { APICallError, isStepCount, streamText } from "ai";
import type {
  Instructions,
  JSONValue,
  LanguageModel,
  ModelMessage,
  ProviderMetadata,
  ToolSet,
} from "ai";

import { createLogger } from "../logger";
import { FAILURE_MESSAGE, failureKindOf, isReportedFailure } from "./failure";
import type { AiFailureKind } from "./failure";
import { isNetworkFailure } from "./network-failure";
import { redactKey } from "./redact";

const log = createLogger("ai:run-turn");

/** Model requests one turn may send, not counting resumes of a paused turn */
const FALLBACK_MAX_STEPS = 12;

/** Times one turn may resume after the provider paused it */
const FALLBACK_MAX_RESUMES = 3;

/** Anthropic's raw stop reason for a turn it stopped early and expects resumed */
const PAUSE_TURN = "pause_turn";

/**
 * Why a turn failed, so a caller can word each case for its own users: a
 * failed request is an {@link AiFailureKind} (`failure.ts` maps its status),
 * then a refusal, a turn that kept pausing, or the connection dropping
 */
export type AiTurnErrorKind = AiFailureKind | "refusal" | "paused" | "network";

/**
 * A turn the provider ended in failure: an error, a refusal, a turn that
 * kept pausing, or the connection dropping (`isNetworkFailure`). A failed
 * request's message is Spec 08's words; the provider's own is in `detail`.
 * Neither carries the connection's key.
 */
export class AiTurnError extends Error {
  readonly kind: AiTurnErrorKind;
  /** The HTTP status, when the provider answered with one */
  readonly status?: number;
  /** The failed response's body with the key redacted, so a caller can read its own backend's fields */
  readonly body?: string;
  /**
   * What the provider said, status and body included, with the key redacted:
   * for logs and details, never the first line a user reads
   */
  readonly detail?: string;
  /** Seconds the server asked to wait (`retry-after`), on a `busy` failure */
  readonly retryAfter?: number;

  constructor(
    message: string,
    {
      kind = "provider",
      status,
      body,
      detail,
      retryAfter,
    }: {
      kind?: AiTurnErrorKind;
      status?: number;
      body?: string;
      detail?: string;
      retryAfter?: number;
    } = {}
  ) {
    super(message);
    this.name = "AiTurnError";
    this.kind = kind;
    this.status = status;
    this.body = body;
    this.detail = detail;
    this.retryAfter = retryAfter;
  }
}

/** A tool call the model made, reported before the tool runs */
export interface ToolCallEvent {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface RunTurnOptions {
  model: LanguageModel;
  /** The conversation so far, ending with the user's message */
  messages: readonly ModelMessage[];
  instructions?: Instructions;
  tools?: ToolSet;
  providerOptions?: Record<string, Record<string, JSONValue>>;
  /** Without it, the Anthropic provider caps a model it does not know at 4096 */
  maxOutputTokens?: number;
  /** Aborts the turn; the turn rejects with the signal's reason */
  signal?: AbortSignal;
  /** Defaults to {@link FALLBACK_MAX_STEPS} */
  maxSteps?: number;
  /** Defaults to {@link FALLBACK_MAX_RESUMES} */
  maxResumes?: number;
  /** The connection's key, replaced in every error message */
  apiKey?: string;
  onText?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  onToolCall?: (call: ToolCallEvent) => void;
}

export interface TurnResult {
  /** The input history followed by everything this turn added */
  messages: ModelMessage[];
  /** The model still wanted tools when the step limit stopped the turn */
  reachedStepLimit: boolean;
}

const messageOf = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const { message } = error as { message?: unknown };
    if (typeof message === "string") return message;
    return JSON.stringify(error);
  }
  return String(error);
};

/** Characters of an unparsed error body kept in the detail */
const BODY_IN_DETAIL = 300;

/**
 * The SDK's message, or, for a failed response whose body did not match the
 * provider's error shape, the status, its text, and the start of the body.
 */
const apiCallDetail = (error: APICallError, body: string | undefined) => {
  // The SDK sets `data` only when it parsed the error; otherwise its message is the bare status text
  const unparsed =
    error.data === undefined &&
    error.statusCode !== undefined &&
    error.statusCode >= 400 &&
    body !== undefined;
  if (!unparsed) return error.message;
  const status = [String(error.statusCode), error.message]
    .filter(Boolean)
    .join(" ");
  const detail = body.trim();
  return detail ? `${status} — ${detail.slice(0, BODY_IN_DETAIL)}` : status;
};

const toTurnError = (error: unknown, apiKey: string | undefined) => {
  if (error instanceof AiTurnError) return error;
  // Before the status: a body that drops early is wrapped with the 200 it began with
  if (isNetworkFailure(error)) {
    return new AiTurnError(redactKey(messageOf(error), apiKey), {
      kind: "network",
    });
  }
  if (!APICallError.isInstance(error)) {
    // Neither the provider nor the connection: a bug of ours (a tool or a
    // callback that threw), which a resend repeats, so the team hears of it
    const detail = redactKey(messageOf(error), apiKey);
    log.warn("model request failed", { report: true, context: { detail } });
    return new AiTurnError(FAILURE_MESSAGE.provider, { detail });
  }
  const body =
    error.responseBody === undefined
      ? undefined
      : redactKey(error.responseBody, apiKey);
  const status = error.statusCode;
  const detail = redactKey(apiCallDetail(error, body), apiKey);
  const kind = failureKindOf(status, body);
  // Spec 08: the status and the server's words stay in the log
  log.warn("model request failed", {
    report: isReportedFailure(kind, status),
    context: { status, detail },
  });
  return new AiTurnError(FAILURE_MESSAGE[kind], {
    kind,
    status,
    body,
    detail,
    retryAfter: kind === "busy" ? retryAfterOf(error) : undefined,
  });
};

/** The `retry-after` header in seconds; an HTTP date is not worth parsing here */
const retryAfterOf = (error: APICallError) => {
  const raw = error.responseHeaders?.["retry-after"];
  const seconds = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
};

// Anthropic reports the refusal category in its metadata; other providers give none
const refusalCategory = (metadata: ProviderMetadata | undefined) => {
  for (const entry of Object.values(metadata ?? {})) {
    const details = entry.stopDetails as { category?: unknown } | undefined;
    if (typeof details?.category === "string") return details.category;
  }
};

/**
 * Run one turn: stream the model's answer, run its tools, and repeat until
 * it stops, the step limit is reached, or `signal` aborts.
 *
 * Never retries a failed request. A paused turn is resumed up to `maxResumes`.
 *
 * @throws {AiTurnError} on a provider error, a refusal, or a turn that kept pausing
 * @example One turn with tools
 * ```ts
 * const { messages } = await runTurn({ model, messages: history, tools, onText: append });
 * ```
 */
export const runTurn = async ({
  model,
  messages,
  instructions,
  tools,
  providerOptions,
  maxOutputTokens,
  signal,
  maxSteps = FALLBACK_MAX_STEPS,
  maxResumes = FALLBACK_MAX_RESUMES,
  apiKey,
  onText,
  onReasoning,
  onToolCall,
}: RunTurnOptions): Promise<TurnResult> => {
  const history = Array.from(messages);
  let stepsTaken = 0;
  let resumes = 0;

  try {
    for (;;) {
      const result = streamText({
        model,
        messages: history,
        instructions,
        tools,
        providerOptions,
        maxOutputTokens,
        abortSignal: signal,
        maxRetries: 0,
        // The SDK's default logs the raw error, key included; runTurn rethrows it redacted by toTurnError
        onError: () => undefined,
        // Checked only after a step with tool calls: no request follows a Stop
        stopWhen: [
          isStepCount(maxSteps - stepsTaken),
          () => signal?.aborted ?? false,
        ],
      });

      for await (const part of result.stream) {
        switch (part.type) {
          case "text-delta":
            onText?.(part.text);
            break;
          case "reasoning-delta":
            onReasoning?.(part.text);
            break;
          case "tool-call":
            onToolCall?.({
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
            });
            break;
          case "error":
            throw part.error;
          case "abort":
            signal?.throwIfAborted();
            throw new AiTurnError("The turn was aborted.");
        }
      }
      signal?.throwIfAborted();

      const steps = await result.steps;
      const final = steps[steps.length - 1];
      history.push(...(await result.responseMessages));

      if (final.finishReason === "content-filter") {
        const category = refusalCategory(final.providerMetadata);
        throw new AiTurnError(
          `The model declined this request${category ? ` (${category})` : ""}.`,
          { kind: "refusal" }
        );
      }

      if (final.rawFinishReason !== PAUSE_TURN) {
        return {
          messages: history,
          reachedStepLimit: final.finishReason === "tool-calls",
        };
      }

      if (resumes === maxResumes) {
        throw new AiTurnError(
          `The turn paused ${resumes + 1} times without finishing.`,
          { kind: "paused" }
        );
      }
      resumes++;
      // The paused step is continued by the resume, so it does not use up a step
      stepsTaken += steps.length - 1;
      log.debug("Resuming a paused turn", { context: { resumes } });
    }
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    throw toTurnError(error, apiKey);
  }
};
