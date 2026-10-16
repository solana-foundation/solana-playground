import * as React from "react"
import { cn } from "cn"

/* Where a file lands: an IDL, a keypair, a program to import. It is also a
   button to browse for one, since not everyone can drag. */

function DropZone({
  className,
  onFiles,
  accept,
  multiple,
  disabled,
  children,
  ...props
}: Omit<React.ComponentProps<"label">, "onDrop"> & {
  onFiles?: (files: File[]) => void
  accept?: string
  multiple?: boolean
  disabled?: boolean
}) {
  const [over, setOver] = React.useState(false)
  return (
    <label
      data-slot="drop-zone"
      data-dragging={over || undefined}
      data-disabled={disabled || undefined}
      onDragOver={(e) => {
        if (disabled) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (!disabled) onFiles?.([...e.dataTransfer.files])
      }}
      className={cn(
        "flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-primary/40 bg-primary/[0.086] px-6 py-8 text-center transition-[opacity,border-color] focus-within:ring-2 focus-within:ring-ring data-dragging:border-primary data-dragging:[&>*]:opacity-55 data-disabled:pointer-events-none data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <input
        type="file"
        className="sr-only"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => onFiles?.([...(e.target.files ?? [])])}
      />
      {children}
    </label>
  )
}

function DropZoneIcon({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="drop-zone-icon" aria-hidden="true" className={cn("mb-1 text-brand-purple [&_svg:not([class*='size-'])]:size-6", className)} {...props} />
}

function DropZoneTitle({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="drop-zone-title" className={cn("text-control font-act text-foreground", className)} {...props} />
}

function DropZoneDescription({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="drop-zone-description" className={cn("text-caption font-read text-muted-foreground", className)} {...props} />
}

export { DropZone, DropZoneDescription, DropZoneIcon, DropZoneTitle }
