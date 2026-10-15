import { useEffect, useState } from "react";

/** Open state seeded from `isOpen`, and set again whenever `isOpen` changes. */
export const useSyncedOpen = (isOpen: boolean = false) => {
  const [open, setOpen] = useState(isOpen);
  useEffect(() => setOpen(isOpen), [isOpen]);
  return [open, setOpen] as const;
};
