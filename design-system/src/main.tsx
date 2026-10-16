import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"

/* shadcn's Command (cmdk) scrolls its first item into view as it mounts.
   In a dialog that is right. Here, far down a long page, it drags the
   window there on load. Until the reader has touched the page, a Command's
   own scrolling is ignored. */
let touched = false
for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) {
  addEventListener(type, () => (touched = true), { capture: true, passive: true })
}
const scrollIntoView = Element.prototype.scrollIntoView
Element.prototype.scrollIntoView = function (arg?: boolean | ScrollIntoViewOptions) {
  if (!touched && this.closest('[data-slot="command"]')) return
  return scrollIntoView.call(this, arg)
}

/* The page ships as a snapshot of itself, so Studio can read the specimens
   without running it. The first render replaces that snapshot. */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
