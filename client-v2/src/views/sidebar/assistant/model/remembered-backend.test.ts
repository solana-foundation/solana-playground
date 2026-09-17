import {
  forgetBackend,
  isDefaultBackendRemembered,
  rememberBackend,
} from "./remembered-backend";

describe("remembered backend", () => {
  beforeEach(() => localStorage.clear());

  it("remembers nothing until a backend has been chosen", () => {
    expect(isDefaultBackendRemembered()).toBe(false);
  });

  it("remembers the default backend", () => {
    rememberBackend("default");
    expect(isDefaultBackendRemembered()).toBe(true);
  });

  it("does not remember a backend that needs a key of its own", () => {
    rememberBackend("anthropic");
    expect(isDefaultBackendRemembered()).toBe(false);
  });

  it("stops remembering the default once another backend is chosen", () => {
    rememberBackend("default");
    rememberBackend("openai");
    expect(isDefaultBackendRemembered()).toBe(false);
  });

  it("forgets on request", () => {
    rememberBackend("default");
    forgetBackend();
    expect(isDefaultBackendRemembered()).toBe(false);
  });

  it("answers no when storage refuses to say", () => {
    // Private windows and blocked site data both throw here rather than
    // returning null, and the panel has to open anyway
    const spy = jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });

    expect(isDefaultBackendRemembered()).toBe(false);
    spy.mockRestore();
  });

  it("does not throw when storage refuses to be written to", () => {
    const spy = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });

    expect(() => rememberBackend("default")).not.toThrow();
    spy.mockRestore();
  });
});
