import { missingObservabilityIds } from "./observability.mjs";

describe("missingObservabilityIds", () => {
  it("should name every id that is unset or empty", () => {
    expect(missingObservabilityIds({ REACT_APP_SENTRY_DSN: "" })).toEqual([
      "REACT_APP_SENTRY_DSN is not set; errors are not reported to Sentry",
      "REACT_APP_GA_MEASUREMENT_ID is not set; events are not sent to Google Analytics",
    ]);
  });

  it("should name nothing when both ids are set", () => {
    expect(
      missingObservabilityIds({
        REACT_APP_SENTRY_DSN: "https://key@o0.ingest.sentry.io/0",
        REACT_APP_GA_MEASUREMENT_ID: "G-TEST",
      })
    ).toEqual([]);
  });
});
