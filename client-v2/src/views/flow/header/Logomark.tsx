import type { ComponentProps } from "react";

import { LogoMark } from "@/shared/ui/logo";

/** The product's mark, at the top of the navigation */
const Logomark = (props: ComponentProps<typeof LogoMark>) => (
  <LogoMark className="size-5" {...props} />
);

export default Logomark;
