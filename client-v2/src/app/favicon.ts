import faviconUrl from "./favicon.svg";

/**
 * Point the tab's icon at the prototype's: the triangle-and-circle mark on
 * the brand gradient. Only the tab's: `apple-touch-icon` and `manifest.json`
 * keep upstream's images.
 *
 * Set here rather than in `index.html`, because `public/` is copied from
 * upstream's `client/public` (`scripts/update-static.mjs`) and keeps its
 * favicon. Before this runs, the tab briefly shows upstream's. A page whose
 * `index.html` names no icon gets one, so a change upstream cannot bring the
 * old icon back unnoticed.
 */
export const applyFavicon = () => {
  let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.append(link);
  }
  link.type = "image/svg+xml";
  link.href = faviconUrl;
};
