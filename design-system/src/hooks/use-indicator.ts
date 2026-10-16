import * as React from "react"

type Box = { left: number; top: number; width: number; height: number }

/**
 * Where the active item sits inside a track, for a thumb that slides to it.
 * Measured rather than guessed, and measured again whenever the track or an
 * item changes size, so a label that grows or a font that loads late moves
 * the thumb with it.
 */
function useIndicator<T extends HTMLElement>(selector: string, deps: React.DependencyList) {
  const ref = React.useRef<T | null>(null)
  const [box, setBox] = React.useState<Box | null>(null)

  React.useLayoutEffect(() => {
    const track = ref.current
    if (!track) return
    const measure = () => {
      const active = track.querySelector<HTMLElement>(selector)
      setBox(
        active
          ? { left: active.offsetLeft, top: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight }
          : null
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(track)
    for (const child of track.children) ro.observe(child)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return [ref, box] as const
}

export { useIndicator }
