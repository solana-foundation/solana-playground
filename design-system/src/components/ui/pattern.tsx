import * as React from "react"
import { cn } from "@/lib/utils"

/* The brand pattern, the ground of the whole window, lit where the pointer
   is. Four layers of one image: the pattern at rest, as two layers (one
   masked to fall away towards the top, one even, balanced by `fade`); a
   faint halo; and the pattern a little brighter, seen only through a soft
   circle that trails the pointer, so moving the mouse reads as a light
   passing over the grid. It sits under everything: transparent panes
   (the conversation, a stage with nothing in it yet) show it, opaque ones
   cover it. Everything moves through three custom properties set from one
   animation frame loop that stops once the light has caught up, so nothing
   re-renders and nothing runs while the pointer is still. */

/* One cell: the square minus the brand tile, filled even-odd, so four
   neighbouring cells' corners meet and make the star */
const TILE =
  "M0 38C0 47.4281 0 52.1421 2.9289 55.0711C5.8579 58 10.5719 58 20 58H38" +
  "C47.4281 58 52.1421 58 55.0711 55.0711C58 52.1421 58 47.4281 58 38V20" +
  "C58 10.5719 58 5.8579 55.0711 2.9289C52.1421 0 47.4281 0 38 0H20" +
  "C10.5719 0 5.8579 0 2.9289 2.9289C0 5.8579 0 10.5719 0 20V38Z"
const CELL = `M0 0H60V60H0Z${TILE}`

/* The pattern as a background image at a given strength; the alpha is baked
   into the fill so the lit copy agrees with the resting one to the pixel */
const patternImage = (alpha: number) =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' ` +
  `width='60' height='60'%3E%3Cpath fill-rule='evenodd' d='${CELL}' ` +
  `fill='%23fff' fill-opacity='${alpha}'/%3E%3C/svg%3E")`

/* Brightest just below the bottom edge, gone by the top */
const RISE = "radial-gradient(ellipse 84.7% 148% at 48.5% 136%, black, transparent)"

const LIGHT =
  "radial-gradient(circle var(--lr) at var(--lx) var(--ly), black 0%, color-mix(in srgb, black 50%, transparent) 38%, transparent 100%)"

/* How much of the remaining distance the light closes each frame */
const FOLLOW = 0.14

/* The cell's pitch follows the window, a 32nd of it, never under 24 px; the
   offset places the grid as the brand's slides do */
const LAYER = "absolute inset-0 [background-size:var(--pp)_var(--pp)] [background-position:calc(var(--pp)/30)_calc(var(--pp)*31/60)]"

function Pattern({
  rest = 0.1,
  lit = 0.24,
  fade = 0,
  className,
  style,
  ...props
}: React.ComponentProps<"div"> & {
  /** Strength at rest */
  rest?: number
  /** Strength under the light */
  lit?: number
  /** How much of the rise the resting layer takes: 0 is even, 1 is gone by the top */
  fade?: number
}) {
  const wrap = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const el = wrap.current
    if (!el) return
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
    const k = still ? 1 : FOLLOW
    let x = 0
    let y = 0
    let tx = 0
    let ty = 0
    let on = 0
    let tOn = 0
    let seen = false
    let frame = 0

    const paint = () => {
      el.style.setProperty("--lx", `${x.toFixed(1)}px`)
      el.style.setProperty("--ly", `${y.toFixed(1)}px`)
      el.style.setProperty("--lon", on.toFixed(3))
    }
    const tick = () => {
      x += (tx - x) * k
      y += (ty - y) * k
      on += (tOn - on) * (still ? 1 : 0.1)
      paint()
      const moving = Math.abs(tx - x) + Math.abs(ty - y) > 0.4 || Math.abs(tOn - on) > 0.004
      frame = moving ? requestAnimationFrame(tick) : 0
    }
    const wake = () => {
      if (!frame) frame = requestAnimationFrame(tick)
    }
    const onMove = (ev: PointerEvent) => {
      const box = el.getBoundingClientRect()
      tx = ev.clientX - box.left
      ty = ev.clientY - box.top
      /* First sighting: start the light where the pointer is */
      if (!seen) {
        seen = true
        x = tx
        y = ty
      }
      tOn = 1
      wake()
    }
    const onLeave = (ev: PointerEvent) => {
      if (ev.relatedTarget) return
      tOn = 0
      wake()
    }
    window.addEventListener("pointermove", onMove, { passive: true })
    document.documentElement.addEventListener("pointerleave", onLeave)
    return () => {
      window.removeEventListener("pointermove", onMove)
      document.documentElement.removeEventListener("pointerleave", onLeave)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div
      ref={wrap}
      data-slot="pattern"
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden [--lon:0] [--lr:clamp(14rem,26vmax,26rem)] [--lx:-999px] [--ly:-999px] [--pp:max(24px,calc(min(100vw,1920px)/32))] supports-[width:round(1.5px,1px)]:[--pp:max(24px,round(calc(min(100vw,1920px)/32),1px))]",
        className
      )}
      style={style}
      {...props}
    >
      {/* A mask cannot be half applied, so the rise is two resting layers,
          one masked and one even, and the balance between them */}
      <div
        className={LAYER}
        style={{ backgroundImage: patternImage(rest), opacity: fade, WebkitMaskImage: RISE, maskImage: RISE }}
      />
      <div className={LAYER} style={{ backgroundImage: patternImage(rest), opacity: 1 - fade }} />
      <div
        className={LAYER}
        style={{
          opacity: "var(--lon)",
          background:
            "radial-gradient(circle calc(var(--lr) * 1.4) at var(--lx) var(--ly), color-mix(in srgb, white 4%, transparent) 0%, color-mix(in srgb, white 1.2%, transparent) 45%, transparent 100%)",
        }}
      />
      <div
        className={LAYER}
        style={{ backgroundImage: patternImage(lit), opacity: "var(--lon)", WebkitMaskImage: LIGHT, maskImage: LIGHT }}
      />
    </div>
  )
}

export { Pattern }
