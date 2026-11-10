import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import {
  AGENT_SUFFIXES,
  agentEnv,
  deprecatedAgentNames,
} from "./server-env.mjs";

const PG_AI_VARIABLES = AGENT_SUFFIXES.map((suffix) => `PG_AI_${suffix}`);
/** The deprecated names, cleared too: a developer's `.env` may still set them */
const AGENT_VARIABLES = AGENT_SUFFIXES.map((suffix) => `AGENT_${suffix}`);

/** A fresh copy of the module, so its warned-about names start empty */
let fresh = 0;
const freshAgentEnv = async () =>
  (await import(`./server-env.mjs?fresh=${++fresh}`)).agentEnv;

describe("agentEnv", () => {
  // Cleared before each case, not after: `yarn test-api` loads `.env`
  beforeEach(() => {
    for (const name of PG_AI_VARIABLES) delete process.env[name];
    for (const name of AGENT_VARIABLES) delete process.env[name];
  });

  afterEach(() => mock.restoreAll());

  it("defaults every limit to the design's starting values", () => {
    const env = agentEnv();
    assert.deepEqual(
      {
        API_KEY: env.API_KEY,
        NEWCOMER_API_KEY: env.NEWCOMER_API_KEY,
        PROVIDERS: env.PROVIDERS,
        PRICE_INPUT: env.PRICE_INPUT,
        PRICE_OUTPUT: env.PRICE_OUTPUT,
        MAX_BODY_BYTES: env.MAX_BODY_BYTES,
        MAX_OUTPUT_TOKENS: env.MAX_OUTPUT_TOKENS,
        NEWCOMER_AGE_DAYS: env.NEWCOMER_AGE_DAYS,
        NEWCOMER_DAILY_CAP: env.NEWCOMER_DAILY_CAP,
        ESTABLISHED_DAILY_CAP: env.ESTABLISHED_DAILY_CAP,
      },
      {
        API_KEY: undefined,
        NEWCOMER_API_KEY: undefined,
        PROVIDERS: [],
        PRICE_INPUT: 0.2475,
        PRICE_OUTPUT: 0.825,
        MAX_BODY_BYTES: 524288,
        MAX_OUTPUT_TOKENS: 8192,
        NEWCOMER_AGE_DAYS: 30,
        NEWCOMER_DAILY_CAP: 0.1,
        ESTABLISHED_DAILY_CAP: 0.5,
      }
    );
  });

  it("reads each variable over its default", () => {
    process.env.PG_AI_NEWCOMER_API_KEY = "nk";
    process.env.PG_AI_PROVIDERS = " baseten , ,groq";
    process.env.PG_AI_PRICE_INPUT = "0.3";
    process.env.PG_AI_PRICE_OUTPUT = "1";
    process.env.PG_AI_MAX_BODY_BYTES = "1024";
    process.env.PG_AI_MAX_OUTPUT_TOKENS = "256";
    process.env.PG_AI_NEWCOMER_AGE_DAYS = "7";
    process.env.PG_AI_NEWCOMER_DAILY_CAP = "0.02";
    process.env.PG_AI_ESTABLISHED_DAILY_CAP = "2";

    const env = agentEnv();

    assert.equal(env.NEWCOMER_API_KEY, "nk");
    assert.deepEqual(env.PROVIDERS, ["baseten", "groq"]);
    assert.equal(env.PRICE_INPUT, 0.3);
    assert.equal(env.PRICE_OUTPUT, 1);
    assert.equal(env.MAX_BODY_BYTES, 1024);
    assert.equal(env.MAX_OUTPUT_TOKENS, 256);
    assert.equal(env.NEWCOMER_AGE_DAYS, 7);
    assert.equal(env.NEWCOMER_DAILY_CAP, 0.02);
    assert.equal(env.ESTABLISHED_DAILY_CAP, 2);
  });

  it("reads an empty variable as unset", () => {
    for (const name of PG_AI_VARIABLES) process.env[name] = "";
    // The one exception, asserted on its own below
    delete process.env.PG_AI_PROVIDERS;

    const env = agentEnv();

    assert.equal(env.API_KEY, undefined);
    assert.equal(env.NEWCOMER_API_KEY, undefined);
    assert.equal(env.PRICE_INPUT, 0.2475);
    assert.equal(env.MAX_BODY_BYTES, 524288);
    assert.equal(env.MAX_OUTPUT_TOKENS, 8192);
    assert.equal(env.NEWCOMER_AGE_DAYS, 30);
    assert.equal(env.ESTABLISHED_DAILY_CAP, 0.5);
  });

  it("defaults the providers only when the upstream is the Gateway", () => {
    process.env.PG_AI_BASE_URL = "https://ai-gateway.vercel.sh/v1";
    assert.deepEqual(agentEnv().PROVIDERS, ["baseten", "fireworks"]);
  });

  it("sends no providers to an upstream that is not the Gateway", () => {
    // Nous refuses `providerOptions` with `400 unknown_parameter`
    process.env.PG_AI_BASE_URL = "https://inference-api.nousresearch.com/v1";
    assert.deepEqual(agentEnv().PROVIDERS, []);
  });

  it("reads an empty provider list as no restriction, unlike unset", () => {
    process.env.PG_AI_BASE_URL = "https://ai-gateway.vercel.sh/v1";
    process.env.PG_AI_PROVIDERS = "";
    assert.deepEqual(agentEnv().PROVIDERS, []);
  });

  it("falls back to the default, and says so, on a malformed number", () => {
    const warned = mock.method(console, "warn", () => {});
    process.env.PG_AI_PRICE_INPUT = "cheap";
    process.env.PG_AI_NEWCOMER_DAILY_CAP = "-1";
    process.env.PG_AI_MAX_OUTPUT_TOKENS = "8192.5";

    const env = agentEnv();

    assert.equal(env.PRICE_INPUT, 0.2475);
    assert.equal(env.NEWCOMER_DAILY_CAP, 0.1);
    assert.equal(env.MAX_OUTPUT_TOKENS, 8192);
    assert.equal(warned.mock.callCount(), 3);
  });
  it("reads an old AGENT_ name, warning once per name", async () => {
    const warned = mock.method(console, "warn", () => {});
    process.env.AGENT_API_KEY = "old";
    process.env.AGENT_BASE_URL = "https://ai-gateway.vercel.sh/v1";
    const read = await freshAgentEnv();

    read();
    const env = read();

    assert.equal(env.API_KEY, "old");
    assert.equal(env.BASE_URL, "https://ai-gateway.vercel.sh/v1");
    assert.deepEqual(env.PROVIDERS, ["baseten", "fireworks"]);
    assert.equal(warned.mock.callCount(), 2);
    // The server logger prints its namespace first, then the message
    const [, first] = warned.mock.calls[0].arguments;
    assert.match(first, /AGENT_API_KEY/);
    assert.match(first, /PG_AI_API_KEY/);
  });

  it("prefers the PG_AI_ name over the old one", async () => {
    mock.method(console, "warn", () => {});
    process.env.PG_AI_MODEL = "new";
    process.env.AGENT_MODEL = "old";

    assert.equal((await freshAgentEnv())().MODEL, "new");
  });

  it("does not fall back from an empty PG_AI_ name", async () => {
    mock.method(console, "warn", () => {});
    process.env.PG_AI_API_KEY = "";
    process.env.AGENT_API_KEY = "old";

    assert.equal((await freshAgentEnv())().API_KEY, undefined);
  });

  it("keeps an empty PG_AI_PROVIDERS over an old list", async () => {
    mock.method(console, "warn", () => {});
    process.env.PG_AI_BASE_URL = "https://ai-gateway.vercel.sh/v1";
    process.env.PG_AI_PROVIDERS = "";
    process.env.AGENT_PROVIDERS = "baseten";

    assert.deepEqual((await freshAgentEnv())().PROVIDERS, []);
  });

  it("reads old AGENT_ routing and limits, and warns under the old name", async () => {
    const warned = mock.method(console, "warn", () => {});
    process.env.AGENT_PROVIDERS = "baseten";
    process.env.AGENT_PRICE_INPUT = "cheap";
    process.env.AGENT_NEWCOMER_DAILY_CAP = "0.02";

    const env = (await freshAgentEnv())();

    assert.deepEqual(env.PROVIDERS, ["baseten"]);
    assert.equal(env.PRICE_INPUT, 0.2475);
    assert.equal(env.NEWCOMER_DAILY_CAP, 0.02);
    const messages = warned.mock.calls.map((call) => call.arguments[1]);
    assert.ok(messages.some((m) => m.includes('AGENT_PRICE_INPUT="cheap"')));
  });

  it("says once when an old AGENT_ value differs from its PG_AI_ copy", async () => {
    const warned = mock.method(console, "warn", () => {});
    process.env.PG_AI_API_KEY = "rotated";
    process.env.AGENT_API_KEY = "stale";
    process.env.PG_AI_MODEL = "same";
    process.env.AGENT_MODEL = "same";
    const read = await freshAgentEnv();

    read();
    assert.equal(read().API_KEY, "rotated");
    assert.equal(warned.mock.callCount(), 1);
    const [, message] = warned.mock.calls[0].arguments;
    assert.match(message, /AGENT_API_KEY is ignored/);
    assert.doesNotMatch(message, /stale|rotated/);
  });

  it("lists the old AGENT_ names still set", () => {
    process.env.AGENT_API_KEY = "k";
    process.env.AGENT_PROVIDERS = "";
    process.env.PG_AI_MODEL = "m";
    assert.deepEqual(deprecatedAgentNames(), [
      "AGENT_API_KEY",
      "AGENT_PROVIDERS",
    ]);
  });

  it("names each setting after a suffix the deprecated names are listed by", () => {
    assert.deepEqual(Object.keys(agentEnv()), AGENT_SUFFIXES);
  });
});
