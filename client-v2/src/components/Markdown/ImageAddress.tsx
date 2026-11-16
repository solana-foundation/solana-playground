import { FC } from "react";

interface ImageAddressProps {
  /** The image's address, as the Markdown wrote it */
  src?: string;
  /** The image's alt text */
  alt?: string;
}

/**
 * An image that is not loaded, shown as its alt text and address in the
 * prose around it. Plain text, never a link: a link would put the other host
 * one click away. A long address wraps anywhere, so a narrow panel never
 * scrolls sideways.
 */
const ImageAddress: FC<ImageAddressProps> = ({ src, alt }) => (
  <span className="[overflow-wrap:anywhere]">
    {alt ? `${alt} (${src})` : src}
  </span>
);

export default ImageAddress;
