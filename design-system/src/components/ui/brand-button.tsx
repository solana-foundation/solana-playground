import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

/* The one call to action a screen has. ring is the brand action: a hairline
   of Solana's two colours that fills with them on hover. accent is the flat
   purple, for where the ring would be too loud. */
const brandButtonVariants = cva(
  "group/brand-button inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap text-white outline-none select-none transition-[transform,filter,opacity] duration-200 ease-[cubic-bezier(0.22,0.61,0.36,1)] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        ring: "rounded-full brand-action [--stroke-fill:var(--surface-hover)] hover:not-disabled:-translate-y-px",
        accent: "rounded-lg bg-primary font-act hover:brightness-[1.12]",
      },
      size: {
        default: "h-10 pr-4 pl-5 font-heading text-[0.9375rem] [&_svg:not([class*='size-'])]:size-[1.15em]",
        sm: "h-[1.625rem] px-3 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        icon: "size-8 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    compoundVariants: [{ variant: "accent", size: "default", className: "rounded-lg px-4 font-sans text-sm" }],
    defaultVariants: {
      variant: "ring",
      size: "default",
    },
  }
)

function BrandButton({
  className,
  variant = "ring",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof brandButtonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button"
  return (
    <Comp
      data-slot="brand-button"
      data-variant={variant}
      data-size={size}
      className={cn(brandButtonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

/* The play ring that trails the label: the mark's play shape inside a ring */
function BrandButtonIcon({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg data-slot="brand-button-icon" viewBox="0 0 212 212" aria-hidden="true" className={cn("fill-current", className)} {...props}>
      <path
        fillRule="evenodd"
        d="M105.586 0C163.899 0 211.172 47.2724 211.172 105.586C211.172 163.899 163.899 211.172 105.586 211.172C47.2724 211.172 0 163.899 0 105.586C0 47.2724 47.2724 0 105.586 0ZM105.586 24C60.5273 24 24 60.5273 24 105.586C24 150.645 60.5273 187.172 105.586 187.172C150.645 187.172 187.172 150.645 187.172 105.586C187.172 60.5273 150.645 24 105.586 24ZM75.4014 57.0391C75.4098 55.21 77.6217 54.2994 78.915 55.5928L96.9424 73.6201C97.331 74.0089 97.548 74.5372 97.5449 75.0869L97.2096 132.81C97.1954 135.248 96.2208 137.582 94.4972 139.306L77.2266 156.577C77.0659 156.738 77.0661 156.998 77.2266 157.159L79.8467 159.779C80.0074 159.94 80.268 159.94 80.4287 159.779L100.128 140.079C100.312 139.895 100.521 139.738 100.703 139.553L104.282 135.925L114.666 125.542C114.799 125.409 114.855 125.21 114.987 125.077L130.945 108.906C131.332 108.515 131.86 108.294 132.41 108.294H157.917C159.744 108.294 160.666 110.497 159.383 111.798L109.159 162.694C108.773 163.086 108.245 163.306 107.694 163.307H82.1865C82.0954 163.307 82.0065 163.301 81.9199 163.29C81.7545 163.27 81.5886 163.245 81.4219 163.245H76.9775C75.8372 163.245 74.9138 162.318 74.9189 161.178L75.4014 57.0391ZM109.717 48.1621C110.267 48.1622 110.795 48.3827 111.182 48.7744L161.405 99.6709C162.688 100.971 161.767 103.174 159.94 103.175H134.433C133.882 103.175 133.354 102.954 132.968 102.562L82.7441 51.666C81.461 50.3655 82.383 48.1621 84.21 48.1621H109.717Z"
      />
    </svg>
  )
}

export { BrandButton, BrandButtonIcon, brandButtonVariants }
