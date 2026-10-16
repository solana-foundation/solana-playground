import { Section, SwatchGrid, TokenRow } from "./parts"

function Colour() {
  return (
    <Section
      id="colour"
      title="Colour"
      note="The product is an equal-channel grey ramp with one accent. Solana's purple marks what is current and what acts. Its green means done. Nothing else in the window carries colour."
    >
      <SwatchGrid
        title="Brand"
        tokens={[
          ["--brand-purple", "Purple"],
          ["--brand-green", "Green"],
          ["--brand-teal", "Teal"],
          ["--brand-violet", "Violet"],
          ["--brand-periwinkle", "Periwinkle"],
          ["--brand-ink", "Ink"],
          ["--brand-deep-green", "Deep green, on paper"],
          ["--gradient-brand", "Brand fill, the landing's"],
          ["--gradient-product", "Product gradient"],
          ["--gradient-product-flat", "Product gradient, flat"],
        ]}
      />
      <SwatchGrid
        title="Surfaces and lines"
        tokens={[
          ["--surface-base", "Base"],
          ["--surface-panel", "Panel"],
          ["--surface-well", "Well, the terminal's"],
          ["--frosted", "Frosted bar"],
          ["--surface", "Surface"],
          ["--surface-raised", "Raised"],
          ["--surface-hover", "Hover"],
          ["--border", "Border"],
          ["--border-strong", "Border, strong"],
        ]}
      />
      <SwatchGrid
        title="Text"
        tokens={[
          ["--text-primary", "Primary"],
          ["--text-secondary", "Secondary"],
          ["--text-tertiary", "Tertiary"],
        ]}
      />
      <SwatchGrid
        title="shadcn semantic tokens"
        tokens={[
          ["--background"],
          ["--foreground"],
          ["--card"],
          ["--popover"],
          ["--primary"],
          ["--secondary"],
          ["--muted"],
          ["--muted-foreground"],
          ["--accent"],
          ["--destructive"],
          ["--input"],
          ["--ring"],
        ]}
      />
      <SwatchGrid
        title="Status"
        tokens={[
          ["--success", "Success"],
          ["--warning", "Warning"],
          ["--info", "Info"],
          ["--error", "Error"],
        ]}
      />
      <SwatchGrid
        title="Syntax"
        tokens={[
          ["--syntax-keyword", "Keyword"],
          ["--syntax-type", "Type"],
          ["--syntax-function", "Function"],
          ["--syntax-string", "String"],
          ["--syntax-number", "Number"],
          ["--syntax-comment", "Comment"],
        ]}
      />
      <SwatchGrid
        title="Tracks and charts"
        tokens={[
          ["--track-brand", "Brand track"],
          ["--track-product", "Product track"],
          ["--chart-1"],
          ["--chart-2"],
          ["--chart-3"],
          ["--chart-4"],
          ["--chart-5"],
        ]}
      />
    </Section>
  )
}

function Type() {
  return (
    <Section
      id="type"
      title="Type"
      note="Stack Sans Headline for headings and Stack Sans Text for everything else. The weights run lighter than usual because light text on a dark ground blooms. Code keeps the monospace, and nothing else does."
    >
      <div className="rounded-card border border-border px-6">
        <TokenRow
          name="text-display"
          sample={<div className="font-heading text-display font-headline">Where should we begin?</div>}
          detail="28 px · 400 · the one headline a screen has"
        />
        <TokenRow
          name="text-title"
          sample={<div className="text-title font-act">Deploy to devnet</div>}
          detail="17 px · 440 · what a page or sheet is called"
        />
        <TokenRow
          name="text-body"
          sample={<div className="text-body font-read">A Solana workbench in a browser tab.</div>}
          detail="16 px · 320 · what you read"
        />
        <TokenRow
          name="text-control"
          sample={<div className="text-control font-act">Build and deploy</div>}
          detail="15 px · 440 · what you press"
        />
        <TokenRow
          name="text-caption"
          sample={<div className="text-caption font-read text-muted-foreground">Built 12 s ago · Anchor 1.2</div>}
          detail="13 px · 320 · what supports the body"
        />
        <TokenRow
          name="font-label"
          sample={<div className="text-caption font-label text-subtle">Step 2 of 6</div>}
          detail="13 px · 380 · labels, counts, footnotes"
        />
        <TokenRow
          name="text-code"
          sample={<code className="font-mono text-code">anchor build --no-idl</code>}
          detail="13 px mono · code only"
        />
      </div>
    </Section>
  )
}

function Shape() {
  return (
    <Section
      id="shape"
      title="Radius, layout and elevation"
      note="Controls are rounded 8 px, panels 12 and cards and dialogs 16. The layout sizes are the canvas's own, so every column's head and bar lines up across the window."
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-card border border-border p-6">
          <div className="mb-4 text-control font-act">Radius</div>
          <div className="flex flex-wrap items-end gap-4">
            {[
              ["rounded-control", "8"],
              ["rounded-panel", "12"],
              ["rounded-card", "16"],
              ["rounded-full", "full"],
            ].map(([cls, n]) => (
              <div key={cls} className="flex flex-col items-center gap-2">
                <div className={`size-14 border border-border-strong bg-surface-raised ${cls}`} />
                <code className="font-mono text-[11px] text-subtle">{cls.replace("rounded-", "")} · {n}</code>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-card border border-border p-6">
          <div className="mb-4 text-control font-act">Layout</div>
          {[
            ["h-head", "2.75rem", "every column's first row"],
            ["h-subhead", "2.375rem", "a panel's own switch"],
            ["h-bar", "1.75rem", "the bar on a panel's edge"],
            ["w-rail", "3.5rem", "the icon rail"],
            ["gap-gap", "8px", "page to panel"],
            ["h-target", "48px", "a touch target, on a phone"],
            ["h-phone-bar", "60px", "a phone's top and bottom bars"],
          ].map(([cls, v, what]) => (
            <div key={cls} className="flex items-baseline gap-3 border-b border-border py-2 last:border-b-0">
              <code className="w-24 font-mono text-caption text-muted-foreground">{cls}</code>
              <span className="text-caption font-act">{v}</span>
              <span className="text-caption font-read text-subtle">{what}</span>
            </div>
          ))}
        </div>
        <div className="rounded-card border border-border p-6">
          <div className="mb-4 text-control font-act">Elevation</div>
          <div className="flex flex-wrap gap-5">
            {[
              ["shadow-panel", "menus and panels"],
              ["shadow-modal", "dialogs"],
              ["shadow-composer", "the composer"],
              ["shadow-thumb", "a sliding thumb"],
              ["shadow-glow", "what is current"],
            ].map(([cls, what]) => (
              <div key={cls} className="flex flex-col items-center gap-2">
                <div className={`size-14 rounded-panel bg-surface-raised ${cls}`} />
                <code className="font-mono text-[11px] text-subtle">{cls.replace("shadow-", "")}</code>
                <span className="text-[11px] text-subtle">{what}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  )
}

function Motion() {
  return (
    <Section
      id="motion"
      title="Motion"
      note="The product moves on one curve, ease-standard, and its menus on a quicker one. The deck and the landing add three of their own. Hover a row to see its curve."
    >
      <div className="rounded-card border border-border px-6">
        {[
          ["ease-standard", "cubic-bezier(0.2, 0, 0, 1)", "the product's one curve · thumb 220, sidebar 200, console 320 ms"],
          ["ease-menu", "cubic-bezier(0.22, 1, 0.36, 1)", "a menu arriving · 120 to 140 ms"],
          ["ease-out", "cubic-bezier(0.22, 0.61, 0.24, 1)", "arrivals · 620 ms"],
          ["ease-move", "cubic-bezier(0.45, 0, 0.2, 1)", "the ground and carried words · 900 to 1400 ms"],
          ["ease-pop", "cubic-bezier(0.2, 0.8, 0.3, 1)", "letters and small marks · 440 ms"],
        ].map(([cls, curve, what]) => (
          <TokenRow
            key={cls}
            name={cls}
            sample={
              <div className="group relative h-8 rounded-control bg-surface-raised">
                <div
                  className={`absolute top-1 left-1 size-6 rounded-full bg-primary transition-transform duration-700 ${cls} group-hover:translate-x-64`}
                />
                <code className="absolute right-3 top-1.5 font-mono text-[11px] text-subtle">{curve}</code>
              </div>
            }
            detail={what}
          />
        ))}
      </div>
    </Section>
  )
}

export { Colour, Motion, Shape, Type }
