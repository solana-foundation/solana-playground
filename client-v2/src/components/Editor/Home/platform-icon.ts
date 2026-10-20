import { createLogger } from "@/shared/lib/logger";

const log = createLogger("editor:home");

const PLATFORM_ICONS = {
  "youtube.com": "youtube.png",
  "dev.to": "devto.png",
} as const;

/** The platform icon for a tutorial URL whose host is a {@link PLATFORM_ICONS} domain or its subdomain. */
export const getSrc = (url: string): string | undefined => {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // An unparsable URL gets no icon rather than breaking the card
    log.warn("tutorial url does not parse, so it gets no platform icon", {
      context: { url },
    });
    return;
  }

  const match = Object.entries(PLATFORM_ICONS).find(
    ([domain]) => hostname === domain || hostname.endsWith("." + domain)
  );
  if (match) return "/icons/platforms/" + match[1];
};
