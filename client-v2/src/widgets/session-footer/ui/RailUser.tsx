/**
 * A head and shoulders at 16 px, drawn as the rail's status icons are
 * (`widgets/status`, `rail-glyphs.tsx`): a 1.7 px line with flat ends, and no
 * cut, so the figure stays whole. A widget does not import another, so it is
 * drawn here.
 */
const RailUser = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    strokeLinecap="butt"
    strokeLinejoin="miter"
    aria-hidden="true"
    data-glyph="user"
    className="size-4"
  >
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

export default RailUser;
