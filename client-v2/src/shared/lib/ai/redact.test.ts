import type { ModelMessage } from "ai";

import { fakeFetch, openAiError } from "./__fixtures__/fake-provider";
import { createModel } from "./models";
import { REDACTED_KEY } from "./redact";
import { runTurn } from "./run-turn";
import type { AiTurnError } from "./run-turn";

const KEY = "test-key-0123456789";
const USER: ModelMessage[] = [{ role: "user", content: "hello" }];

describe("runTurn error text", () => {
  it("replaces a key the provider quotes in a 401", async () => {
    const { fetch } = fakeFetch(
      openAiError(401, `Incorrect API key provided: ${KEY}`)
    );

    const error: AiTurnError = await runTurn({
      model: createModel({
        provider: "openai",
        apiKey: KEY,
        baseUrl: "https://llm.test/v1",
        model: "m",
        fetch,
      }),
      messages: USER,
      apiKey: KEY,
    }).catch((e) => e);

    // The message is Spec 08's; the provider's words, key replaced, are the detail
    expect(error.detail).toContain(REDACTED_KEY);
    expect(`${error.message} ${error.detail}`).not.toContain(KEY);
  });
});
