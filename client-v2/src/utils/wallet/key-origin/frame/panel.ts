// @vitest-environment node -- noble checks `instanceof Uint8Array`, which jsdom's realm fails
import {
  isPanelMessage,
  isSecretKey,
  isThemeTokens,
  type KeyReply,
  type KeyRequest,
  type PanelMessage,
  type ThemeTokens,
} from "../protocol";
import { base58Encode, reportFailure } from "./handler";
import type { KeyStore } from "./store";

/** What the fragment asks the panel to show */
export type PanelRoute =
  | { mode: "import"; theme: ThemeTokens }
  | { mode: "export"; publicKey: string; name: string; theme: ThemeTokens };

const BASE58_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PUBLIC_KEY_LENGTH = 32;

/**
 * @param encoded base64url of the tokens' JSON
 * @returns the tokens, or none when the value does not decode to tokens
 */
export const decodeTheme = (encoded: string | null): ThemeTokens => {
  if (!encoded) return {};
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const tokens: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isThemeTokens(tokens) ? tokens : {};
  } catch (error) {
    // A fragment that is not base64 JSON: the panel draws in its own default
    // colours, which a bad theme must not stop it from showing. Only the
    // error's name is logged, never the fragment
    reportFailure(error);
    return {};
  }
};

/**
 * @param hash the key page's `location.hash`
 * @returns the panel the fragment names, or `undefined` when it names none
 */
export const panelRouteOf = (hash: string): PanelRoute | undefined => {
  const fragment = hash.replace(/^#/, "");
  const queryAt = fragment.indexOf("?");
  const route = queryAt === -1 ? fragment : fragment.slice(0, queryAt);
  const query = new URLSearchParams(
    queryAt === -1 ? "" : fragment.slice(queryAt + 1)
  );
  const theme = decodeTheme(query.get("theme"));
  const [panel, mode, publicKey, ...rest] = route.split("/");
  if (panel !== "panel" || rest.length > 0) return undefined;
  if (mode === "import" && publicKey === undefined) {
    return { mode, theme };
  }
  if (mode === "export" && publicKey && BASE58_KEY.test(publicKey)) {
    return { mode, publicKey, name: query.get("name") ?? "", theme };
  }
  return undefined;
};

/**
 * @param name the wallet's name
 * @returns the key file's name, safe on every file system
 */
export const keyFileName = (name: string) => {
  const safe = name
    // eslint-disable-next-line no-control-regex -- control characters are what it removes
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "-")
    .trim()
    .slice(0, 100);
  return `${safe || "wallet"}-keypair.json`;
};

/**
 * @param text a key file's content
 * @returns its 64 secret bytes, or `undefined` when it is not a key file
 */
export const keyFileBytes = (text: string) => {
  try {
    const parsed: unknown = JSON.parse(text);
    return isSecretKey(parsed) ? parsed : undefined;
  } catch (error) {
    // The parser's message quotes the file, which is the key: never pass it
    // on. `reportFailure` logs the error's name alone
    reportFailure(error);
    return undefined;
  }
};

/**
 * Sent for a file that is not a key file; it names no byte of the file. The
 * app's own words for it (`KeypairFileError`), so an import says the same
 * under either provider.
 */
export const NOT_A_KEY_FILE =
  "That file is not a keypair. Pick a .json file saved from Playground or the Solana CLI.";

/**
 * Stores the key in a key file. The key's halves are checked, and the store
 * read back, by the handler's `adopt`, so the panel and the hidden frame
 * accept the same keys.
 *
 * @param handle the panel's own request handler
 * @returns for a key file's content, the message for the page: the stored
 * key's public key and whether this import stored it newly, or why not
 */
export const importKeyFileWith =
  (handle: (request: KeyRequest) => Promise<KeyReply>) =>
  async (text: string): Promise<PanelMessage> => {
    const key = keyFileBytes(text);
    if (!key) return { type: "error", message: NOT_A_KEY_FILE };
    // The file's own public half: `adopt` refuses it unless it is the key's
    const publicKey = base58Encode(
      Uint8Array.from(key.slice(PUBLIC_KEY_LENGTH))
    );
    const held = await handle({ id: 0, type: "accounts" });
    if (!held.ok) return { type: "error", message: held.error };
    const isNew = !(
      Array.isArray(held.result) && held.result.includes(publicKey)
    );
    const reply = await handle({ id: 0, type: "adopt", keys: [key] });
    if (!reply.ok) return { type: "error", message: reply.error };
    return { type: "imported", publicKey, isNew };
  };

/**
 * @param store the key store
 * @param publicKey the account to export
 * @returns the key file's content, or `undefined` when the key is not stored
 */
export const keyFileOf = async (store: KeyStore, publicKey: string) => {
  const secret = (await store.all()).get(publicKey);
  return secret && JSON.stringify(Array.from(secret));
};

const CSS_VARIABLE: Record<keyof ThemeTokens, string> = {
  bg: "--bg",
  fg: "--fg",
  border: "--border",
  radius: "--radius",
  font: "--font",
  focus: "--focus",
  height: "--height",
  padding: "--padding",
  fontSize: "--font-size",
  fontWeight: "--font-weight",
  hoverBg: "--hover-bg",
  hoverFg: "--hover-fg",
  ring: "--ring",
};

/**
 * Sets the tokens as the CSS variables the page's stylesheet reads. Each is a
 * custom property, so a value cannot reach any other property.
 *
 * @param root the element the variables are set on
 * @param tokens the theme's tokens
 */
export const applyTheme = (root: HTMLElement, tokens: ThemeTokens) => {
  for (const [token, value] of Object.entries(tokens)) {
    const variable = CSS_VARIABLE[token as keyof ThemeTokens];
    if (variable && value !== undefined)
      root.style.setProperty(variable, value);
  }
};

/**
 * @param on what the panel does with each of the page's messages: new theme
 * tokens, and the account's new name
 * @returns a handler of what arrives on the panel's port; anything that is
 * not a page message is ignored
 */
export const pageMessageHandler =
  (on: {
    theme: (tokens: ThemeTokens) => void;
    name: (name: string) => void;
  }) =>
  (data: unknown) => {
    if (!isPanelMessage(data)) return;
    if (data.type === "theme") on.theme(data.tokens);
    else if (data.type === "name") on.name(data.name);
  };

/**
 * @param send posts a message to the page
 * @returns a keydown handler that tells the page of Escape, so the dialog
 * around the panel closes as it does when its own document has the focus
 */
export const escapeHandler =
  (send: (message: PanelMessage) => void) =>
  (event: Pick<KeyboardEvent, "key">) => {
    if (event.key === "Escape") send({ type: "escape" });
  };

/** How long a key file's `blob:` URL outlives the click that downloads it */
const REVOKE_AFTER_MS = 10_000;

const LABEL: Record<PanelRoute["mode"], string> = {
  import: "Import keypair",
  export: "Save keypair",
};

/**
 * Draws the panel's one button and runs it once the app's port arrives. The
 * button stays disabled until then, since its result has nowhere to go.
 *
 * @param handle the panel's own request handler
 * @param store the key store
 * @returns for the panel the fragment names and the port the app hands
 * over, a running panel in the key page's document
 */
export const runPanelWith =
  (handle: (request: KeyRequest) => Promise<KeyReply>) =>
  (store: KeyStore) =>
  (route: PanelRoute, connected: Promise<MessagePort>) => {
    const doc = document;
    const importKeyFile = importKeyFileWith(handle);
    applyTheme(doc.documentElement, route.theme);
    let name = route.mode === "export" ? route.name : "";

    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = LABEL[route.mode];
    button.disabled = true;
    doc.body.append(button);

    const input = doc.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.hidden = true;
    doc.body.append(input);

    void connected.then((port) => {
      const send = (message: PanelMessage) => port.postMessage(message);
      const onPageMessage = pageMessageHandler({
        theme: (tokens) => applyTheme(doc.documentElement, tokens),
        name: (next) => (name = next),
      });
      port.onmessage = (event: MessageEvent) => onPageMessage(event.data);
      doc.addEventListener("keydown", escapeHandler(send));

      const whileBusy = async (task: () => Promise<PanelMessage>) => {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        send({ type: "busy", busy: true });
        try {
          send(await task());
        } catch (error) {
          // Named by type only: a browser's message is not ours to vouch for.
          // Logged here too, so an IndexedDB failure leaves a trace on the key page
          const kind = error instanceof Error ? error.name : typeof error;
          // eslint-disable-next-line no-console -- the key page loads no logger: it is its own bundle, with nothing third-party
          console.error("The key page failed:", kind);
          send({ type: "error", message: `The key page failed: ${kind}` });
        } finally {
          button.removeAttribute("aria-busy");
          button.disabled = false;
          send({ type: "busy", busy: false });
        }
      };

      if (route.mode === "import") {
        button.addEventListener("click", () => input.click());
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          input.value = "";
          if (!file) return;
          void whileBusy(async () => importKeyFile(await file.text()));
        });
      } else {
        button.addEventListener("click", () => {
          void whileBusy(async () => {
            const content = await keyFileOf(store, route.publicKey);
            if (!content) {
              return {
                type: "error",
                message: `No key for account ${route.publicKey}`,
              };
            }
            const url = URL.createObjectURL(
              new Blob([content], { type: "application/json" })
            );
            const link = doc.createElement("a");
            link.href = url;
            link.download = keyFileName(name);
            link.click();
            // Revoked at once, Firefox and Safari can cancel the download
            setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
            return { type: "exported" };
          });
        });
      }

      button.disabled = false;
    });
  };

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll } = import.meta.vitest;

  describe("utils/wallet/key-origin/frame/panel", () => {
    let ed25519: typeof import("@noble/ed25519");
    let handlerWith: typeof import("./handler").handlerWith;

    beforeAll(async () => {
      ed25519 = await import("@noble/ed25519");
      ({ handlerWith } = await import("./handler"));
    });

    const encode = (value: unknown) =>
      btoa(
        String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))
      )
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    const PUBLIC_KEY = "11111111111111111111111111111111";

    it("reads the import and export panels from the fragment", () => {
      const theme = encode({
        bg: "var(--surface-panel)",
        font: "Inter, sans-serif",
      });
      expect(panelRouteOf(`#panel/import?theme=${theme}`)).toEqual({
        mode: "import",
        theme: { bg: "var(--surface-panel)", font: "Inter, sans-serif" },
      });
      expect(
        panelRouteOf(
          `#panel/export/${PUBLIC_KEY}?name=My%20wallet&theme=${theme}`
        )
      ).toEqual({
        mode: "export",
        publicKey: PUBLIC_KEY,
        name: "My wallet",
        theme: { bg: "var(--surface-panel)", font: "Inter, sans-serif" },
      });
      expect(panelRouteOf("#panel/import")).toEqual({
        mode: "import",
        theme: {},
      });
    });

    it("names no panel for anything else", () => {
      for (const hash of [
        "",
        "#",
        "#panel",
        "#panel/delete",
        "#panel/import/x",
        "#panel/export",
        "#panel/export/not-base58!",
        `#panel/export/${PUBLIC_KEY}/more`,
        "#other/import",
      ]) {
        expect(panelRouteOf(hash)).toBeUndefined();
      }
    });

    it("drops a theme that does not decode to known string tokens", () => {
      expect(decodeTheme("%%%")).toEqual({});
      expect(decodeTheme(encode({ bg: 1 }))).toEqual({});
      expect(decodeTheme(encode({ colour: "red" }))).toEqual({});
      expect(decodeTheme(encode(["bg"]))).toEqual({});
    });

    it("takes the page's theme and name, and nothing else", () => {
      const seen: unknown[] = [];
      const onPageMessage = pageMessageHandler({
        theme: (tokens) => seen.push(["theme", tokens]),
        name: (name) => seen.push(["name", name]),
      });
      onPageMessage({
        type: "theme",
        tokens: { hoverBg: "var(--surface-hover)" },
      });
      onPageMessage({ type: "name", name: "Mine" });
      onPageMessage({ type: "name", name: 5 });
      onPageMessage({ type: "imported", publicKey: PUBLIC_KEY });
      onPageMessage("theme");
      expect(seen).toEqual([
        ["theme", { hoverBg: "var(--surface-hover)" }],
        ["name", "Mine"],
      ]);
    });

    it("tells the page of Escape, and of no other key", () => {
      const sent: PanelMessage[] = [];
      const onKeyDown = escapeHandler((message) => sent.push(message));
      onKeyDown({ key: "Enter" });
      onKeyDown({ key: "Escape" });
      expect(sent).toEqual([{ type: "escape" }]);
    });

    it("names the key file safely", () => {
      expect(keyFileName("main")).toBe("main-keypair.json");
      expect(keyFileName("a/b\\c:d")).toBe("a-b-c-d-keypair.json");
      expect(keyFileName("  ")).toBe("wallet-keypair.json");
    });

    it("reads only a 64-number key file", () => {
      const key = Array.from({ length: 64 }, (_, i) => i);
      expect(keyFileBytes(JSON.stringify(key))).toEqual(key);
      expect(keyFileBytes(JSON.stringify(key.slice(1)))).toBeUndefined();
      expect(keyFileBytes("[1,2,")).toBeUndefined();
      expect(keyFileBytes('{"a":1}')).toBeUndefined();
    });

    it("imports a key file through adopt, and refuses one whose halves differ", async () => {
      const kept = new Map<string, Uint8Array>();
      const store: KeyStore = {
        all: async () => new Map(kept),
        put: async (entries) => {
          for (const [k, v] of entries) kept.set(k, v);
        },
        remove: async (k) => {
          kept.delete(k);
        },
      };
      const importKeyFile = importKeyFileWith(handlerWith(store));

      const priv = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
      const pub = await ed25519.getPublicKey(priv);
      const secret = Array.from(priv).concat(Array.from(pub));

      const imported = await importKeyFile(JSON.stringify(secret));
      expect(imported).toEqual({
        type: "imported",
        publicKey: base58Encode(pub),
        isNew: true,
      });
      // The same file again stores nothing new
      expect(await importKeyFile(JSON.stringify(secret))).toEqual({
        type: "imported",
        publicKey: base58Encode(pub),
        isNew: false,
      });
      expect(await keyFileOf(store, base58Encode(pub))).toBe(
        JSON.stringify(secret)
      );

      const mismatched = Array.from(priv).concat(new Array(32).fill(7));
      const refused = await importKeyFile(JSON.stringify(mismatched));
      expect(refused).toEqual({
        type: "error",
        message: "Key 1 does not match its public key",
      });
      expect(await importKeyFile("[1,2,")).toEqual({
        type: "error",
        message: NOT_A_KEY_FILE,
      });
      expect(await keyFileOf(store, PUBLIC_KEY)).toBeUndefined();
    });
  });
}
