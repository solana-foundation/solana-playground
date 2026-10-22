/**
 * An open Radix layer that floats over the page: a menu, a popover, a select
 * or a tooltip. A layer playing its exit animation is still mounted but no
 * longer `open`, so the state is what tells them apart.
 */
const OPEN_LAYER = ["open", "delayed-open", "instant-open"]
  .map((s) => `[data-radix-popper-content-wrapper] > [data-state="${s}"]`)
  .join(", ");

/** The most layers a stack can hold before we stop pressing Escape */
const MAX_LAYERS = 5;

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Closes every Radix menu, popover, select or tooltip that is open. They
 * portal to `body`, so a full-window page drawn over the app would not hide
 * them, and a modal menu's focus trap would pull focus back from it. Each
 * closes on an Escape seen on the document, but only the topmost layer does,
 * and only after React renders, so one Escape is sent per frame, from that
 * layer, while a layer is still open. With none open nothing is sent: Escape
 * would then reach the next layer down, such as the navigation's Sheet.
 *
 * Resolves with the trigger of the layer focus was in, when there was one, as
 * the control to give focus back to: the item focus was on unmounts with it.
 */
export const closeOpenLayers = async (): Promise<HTMLElement | null> => {
  const trigger = triggerOf(document.activeElement);
  for (let i = 0; i < MAX_LAYERS; i++) {
    const open = document.querySelectorAll(OPEN_LAYER);
    if (open.length === 0) break;
    // From the topmost layer, not from focus: a field being typed in (a
    // project's rename) would read the Escape as a cancel
    open[open.length - 1].dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      })
    );
    await nextFrame();
  }
  return trigger;
};

/** The control that opened the layer `el` sits in, found by its `aria-controls` */
const triggerOf = (el: Element | null): HTMLElement | null => {
  const content = el?.closest("[data-radix-popper-content-wrapper] > [id]");
  if (!content) return null;
  // Compared, not put in a selector: Radix's ids carry colons
  const triggers = document.querySelectorAll<HTMLElement>("[aria-controls]");
  return (
    [...triggers].find((t) => t.getAttribute("aria-controls") === content.id) ??
    null
  );
};

if (import.meta.vitest) {
  const { describe, it, expect, afterEach } = import.meta.vitest;

  describe("shared/lib/close-open-layers", () => {
    afterEach(() => {
      document.body.innerHTML = "";
    });

    /** A layer as Radix renders it: a wrapper around content with a state */
    const layer = (id: string, state: string) => {
      const wrapper = document.createElement("div");
      wrapper.setAttribute("data-radix-popper-content-wrapper", "");
      const content = document.createElement("div");
      content.id = id;
      content.tabIndex = -1;
      content.setAttribute("data-state", state);
      wrapper.append(content);
      document.body.append(wrapper);
      return content;
    };

    /** Escape closes the topmost open layer, as Radix's layer stack does */
    const closesTopmostOnEscape = () => {
      const listener = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        const open = [...document.querySelectorAll(OPEN_LAYER)];
        open.at(-1)?.setAttribute("data-state", "closed");
      };
      document.addEventListener("keydown", listener);
      return () => document.removeEventListener("keydown", listener);
    };

    it("closes a stack of two layers, one Escape each", async () => {
      layer("popover", "open");
      layer("tooltip", "delayed-open");
      let sent = 0;
      const count = () => sent++;
      document.addEventListener("keydown", count);
      const stop = closesTopmostOnEscape();
      await closeOpenLayers();
      stop();
      document.removeEventListener("keydown", count);
      expect(document.querySelector(OPEN_LAYER)).toBeNull();
      expect(sent).toBe(2);
    });

    it("sends nothing when no layer is open, a closing one included", async () => {
      layer("menu", "closed");
      let sent = 0;
      const count = () => sent++;
      document.addEventListener("keydown", count);
      await closeOpenLayers();
      document.removeEventListener("keydown", count);
      expect(sent).toBe(0);
    });

    it("sends Escape from the layer, never from a field the user is typing in", async () => {
      const rename = document.createElement("input");
      document.body.append(rename);
      rename.focus();
      let cancelled = false;
      rename.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") cancelled = true;
      });
      layer("tooltip", "delayed-open");
      const stop = closesTopmostOnEscape();
      await closeOpenLayers();
      stop();
      expect(cancelled).toBe(false);
      expect(document.querySelector(OPEN_LAYER)).toBeNull();
    });

    it("names the trigger of the layer focus was in", async () => {
      const trigger = document.createElement("button");
      trigger.setAttribute("aria-controls", "account-menu");
      document.body.append(trigger);
      const menu = layer("account-menu", "closed");
      menu.focus();
      expect(await closeOpenLayers()).toBe(trigger);
    });
  });
}
