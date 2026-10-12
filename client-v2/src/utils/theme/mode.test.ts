import { applyThemeMode } from "./mode";

describe("applyThemeMode", () => {
  afterEach(() => {
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
  });

  it("puts the dark class and colour scheme on <html>", () => {
    applyThemeMode("dark");

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("takes the dark class off for light", () => {
    applyThemeMode("dark");
    applyThemeMode("light");

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("leaves other classes on <html> alone", () => {
    document.documentElement.classList.add("keep-me");
    applyThemeMode("dark");
    applyThemeMode("light");

    expect(document.documentElement.classList.contains("keep-me")).toBe(true);
  });
});
