interface ImageAddressProps {
  /** The image's address, as the Markdown wrote it; empty when the renderer cleared it */
  src?: string;
  /** The image's alt text */
  alt?: string;
}

/** `alt (src)`, or whichever of the two the image has */
const textOf = ({ src, alt }: ImageAddressProps) => {
  if (alt && src) return `${alt} (${src})`;
  return alt || src || "";
};

/**
 * A Markdown image that is not loaded, shown as text in the prose around it.
 * Plain text, never a link: a link would put the other host one click away.
 * A long address wraps anywhere, so a narrow panel never scrolls sideways.
 */
export const ImageAddress = (props: ImageAddressProps) => (
  <span className="[overflow-wrap:anywhere]">{textOf(props)}</span>
);
