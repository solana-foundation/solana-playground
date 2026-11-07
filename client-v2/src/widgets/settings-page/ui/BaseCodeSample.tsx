/** Two lines in the picked code font, with the glyphs fonts tell apart */
const BaseCodeSample = ({ font }: { font: string }) => (
  <pre
    aria-hidden
    style={{ fontFamily: font }}
    className="mx-4 mb-4 overflow-x-auto rounded-lg border border-border bg-surface-well px-3 py-2.5 text-code whitespace-pre text-muted-foreground"
  >
    {"pub fn initialize(ctx: Context<Init>) -> Result<()> {\n"}
    {"    let count = 0; // 0O 1lI {} []"}
  </pre>
);

export default BaseCodeSample;
