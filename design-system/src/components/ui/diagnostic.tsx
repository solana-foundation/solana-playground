import * as React from "react"
import { cn } from "cn"

/* A build error, said the way a person would: what went wrong, where, and
   the line itself with the fault marked. The compiler's own words sit
   behind a toggle under it (a Collapsible), for whoever wants them. */

function Diagnostic({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="diagnostic"
      role="group"
      className={cn("flex w-full min-w-0 flex-col overflow-hidden rounded-xl border border-error/40 bg-surface-raised animate-rise [animation-duration:180ms]", className)}
      {...props}
    />
  )
}

function DiagnosticHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="diagnostic-header"
      className={cn("flex items-start gap-2.5 px-3.5 pt-3 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-error", className)}
      {...props}
    />
  )
}

function DiagnosticTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="diagnostic-title" className={cn("min-w-0 flex-1 text-control font-act text-foreground", className)} {...props} />
}

/* The compiler's code for it, E0425 and the like */
function DiagnosticCode({ className, ...props }: React.ComponentProps<"code">) {
  return (
    <code
      data-slot="diagnostic-code"
      className={cn("shrink-0 rounded-full bg-error/10 px-2 py-0.5 font-mono text-[0.6875rem] text-error lowercase", className)}
      {...props}
    />
  )
}

function DiagnosticDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="diagnostic-description" className={cn("px-3.5 pt-1 pl-[2.375rem] text-caption font-read text-muted-foreground", className)} {...props} />
}

function DiagnosticSource({ className, ...props }: React.ComponentProps<"pre">) {
  return (
    <pre
      data-slot="diagnostic-source"
      className={cn("mx-3.5 my-3 overflow-x-auto rounded-lg border border-border bg-surface-well py-2 font-mono text-[0.8125rem] leading-relaxed text-syntax-plain", className)}
      {...props}
    />
  )
}

/* One line of the excerpt. The faulty one gets a red edge and says why */
function DiagnosticLine({
  className,
  number,
  fault,
  children,
  ...props
}: React.ComponentProps<"div"> & { number: number; fault?: string }) {
  return (
    <div
      data-slot="diagnostic-line"
      data-fault={fault ? "" : undefined}
      className={cn("grid grid-cols-[2.5rem_1fr] border-l-2 border-transparent pr-3 data-fault:border-error data-fault:bg-error/[0.06]", className)}
      {...props}
    >
      <span aria-hidden="true" className="pr-3 text-right text-subtle select-none">
        {number}
      </span>
      <code className="min-w-0 whitespace-pre">{children}</code>
      {fault && <span className="col-start-2 font-sans text-xs text-error">{fault}</span>}
    </div>
  )
}

function DiagnosticFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="diagnostic-footer" className={cn("flex flex-wrap items-center gap-2 border-t border-border px-3.5 py-2", className)} {...props} />
}

export {
  Diagnostic,
  DiagnosticCode,
  DiagnosticDescription,
  DiagnosticFooter,
  DiagnosticHeader,
  DiagnosticLine,
  DiagnosticSource,
  DiagnosticTitle,
}
