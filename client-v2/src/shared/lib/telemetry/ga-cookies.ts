const isGaCookie = (name: string) => name === "_ga" || name.startsWith("_ga_");

/** `a.b.example.com` -> that host and each parent with a dot left: `b.example.com`, `example.com` */
const domainsOf = (hostname: string) => {
  const labels = hostname.split(".");
  // A bare name (`localhost`) or an IP address has no parent domain to try
  if (labels.length < 2 || /^[\d.]+$|:/.test(hostname)) return [];
  return labels.slice(0, -1).map((_, index) => labels.slice(index).join("."));
};

const cookieNames = () =>
  document.cookie
    .split(";")
    .map((pair) => pair.split("=")[0].trim())
    .filter(Boolean);

/**
 * Expires GA4's `_ga` and `_ga_<id>` cookies. gtag.js sets them on the highest
 * domain the browser allows, so each is expired on the host alone and on the
 * host and every parent domain.
 */
export const expireGaCookies = (hostname: string) => {
  for (const name of cookieNames().filter((n) => isGaCookie(n))) {
    const expired = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    document.cookie = expired;
    for (const domain of domainsOf(hostname)) {
      document.cookie = `${expired}; domain=${domain}`;
      document.cookie = `${expired}; domain=.${domain}`;
    }
  }
};

if (import.meta.vitest) {
  const { describe, it, expect, afterEach } = import.meta.vitest;

  describe("shared/lib/telemetry/ga-cookies", () => {
    afterEach(() => {
      for (const name of cookieNames()) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      }
    });

    it("should expire _ga and _ga_<id> and leave other cookies", () => {
      document.cookie = "_ga=GA1.1.1; path=/";
      document.cookie = "_ga_TEST000000=GS1; path=/";
      document.cookie = "_gat=1; path=/";
      document.cookie = "theme=dark; path=/";

      expireGaCookies(window.location.hostname);

      expect(cookieNames().sort()).toEqual(["_gat", "theme"]);
    });

    it("should list the host and each parent domain, and none for a bare host", () => {
      expect(domainsOf("app.example.com")).toEqual([
        "app.example.com",
        "example.com",
      ]);
      expect(domainsOf("localhost")).toEqual([]);
      expect(domainsOf("127.0.0.1")).toEqual([]);
    });
  });
}
