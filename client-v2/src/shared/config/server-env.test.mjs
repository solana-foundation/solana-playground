import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { agentEnv } from "./server-env.mjs";

/** Every `AGENT_*` variable `agentEnv` reads, cleared so `.env` cannot leak in */
const AGENT_VARIABLES = [
  "AGENT_API_KEY",
  "AGENT_NEWCOMER_API_KEY",
  "AGENT_BASE_URL",
  "AGENT_MODEL",
  "AGENT_REASONING_EFFORT",
  "AGENT_PROVIDERS",
  "AGENT_PRICE_INPUT",
  "AGENT_PRICE_OUTPUT",
  "AGENT_MAX_BODY_BYTES",
  "AGENT_MAX_OUTPUT_TOKENS",
  "AGENT_NEWCOMER_AGE_DAYS",
  "AGENT_NEWCOMER_DAILY_CAP",
  "AGENT_ESTABLISHED_DAILY_CAP",
];

describe("agentEnv", () => {
  // Cleared before each case, not after: `yarn test-api` loads `.env`
  beforeEach(() => {
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
        PRICE_INPUT: 0.15,
        PRICE_OUTPUT: 0.5,
        MAX_BODY_BYTES: 524288,
        MAX_OUTPUT_TOKENS: 8192,
        NEWCOMER_AGE_DAYS: 30,
        NEWCOMER_DAILY_CAP: 0.1,
        ESTABLISHED_DAILY_CAP: 0.5,
      }
    );
  });

  it("reads each variable over its default", () => {
    process.env.AGENT_NEWCOMER_API_KEY = "nk";
    process.env.AGENT_PROVIDERS = " baseten , ,groq";
    process.env.AGENT_PRICE_INPUT = "0.3";
    process.env.AGENT_PRICE_OUTPUT = "1";
    process.env.AGENT_MAX_BODY_BYTES = "1024";
    process.env.AGENT_MAX_OUTPUT_TOKENS = "256";
    process.env.AGENT_NEWCOMER_AGE_DAYS = "7";
    process.env.AGENT_NEWCOMER_DAILY_CAP = "0.02";
    process.env.AGENT_ESTABLISHED_DAILY_CAP = "2";

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
    for (const name of AGENT_VARIABLES) process.env[name] = "";
    // The one exception, asserted on its own below
    delete process.env.AGENT_PROVIDERS;

    const env = agentEnv();

    assert.equal(env.API_KEY, undefined);
    assert.equal(env.NEWCOMER_API_KEY, undefined);
    assert.equal(env.PRICE_INPUT, 0.15);
    assert.equal(env.MAX_BODY_BYTES, 524288);
    assert.equal(env.MAX_OUTPUT_TOKENS, 8192);
    assert.equal(env.NEWCOMER_AGE_DAYS, 30);
    assert.equal(env.ESTABLISHED_DAILY_CAP, 0.5);
  });

  it("defaults the providers only when the upstream is the Gateway", () => {
    process.env.AGENT_BASE_URL = "https://ai-gateway.vercel.sh/v1";
    assert.deepEqual(agentEnv().PROVIDERS, ["baseten", "fireworks"]);
  });

  it("sends no providers to an upstream that is not the Gateway", () => {
    // Nous refuses `providerOptions` with `400 unknown_parameter`
    process.env.AGENT_BASE_URL = "https://inference-api.nousresearch.com/v1";
    assert.deepEqual(agentEnv().PROVIDERS, []);
  });

  it("reads an empty provider list as no restriction, unlike unset", () => {
    process.env.AGENT_BASE_URL = "https://ai-gateway.vercel.sh/v1";
    process.env.AGENT_PROVIDERS = "";
    assert.deepEqual(agentEnv().PROVIDERS, []);
  });

  it("falls back to the default, and says so, on a malformed number", () => {
    const warned = mock.method(console, "warn", () => {});
    process.env.AGENT_PRICE_INPUT = "cheap";
    process.env.AGENT_NEWCOMER_DAILY_CAP = "-1";
    process.env.AGENT_MAX_OUTPUT_TOKENS = "8192.5";

    const env = agentEnv();

    assert.equal(env.PRICE_INPUT, 0.15);
    assert.equal(env.NEWCOMER_DAILY_CAP, 0.1);
    assert.equal(env.MAX_OUTPUT_TOKENS, 8192);
    assert.equal(warned.mock.callCount(), 3);
  });
});
