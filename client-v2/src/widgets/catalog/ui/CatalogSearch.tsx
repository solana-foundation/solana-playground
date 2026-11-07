import { Search } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/shared/ui/input-group";

export interface CatalogSearchProps {
  /** The list's things, plural and lowercase; names the field */
  label: string;
  query: string;
  onQuery: (query: string) => void;
  className?: string;
  /** The magnifier in front; New project draws the field without it */
  icon?: boolean;
  /** The hint, "Search <label>" by default */
  placeholder?: string;
}

/** The catalog's search field: "Search tutorials", "Search programs" */
const CatalogSearch = ({
  label,
  query,
  onQuery,
  className,
  icon = true,
  placeholder = `Search ${label}`,
}: CatalogSearchProps) => (
  // The width of the page below `md`, as the cards under it are
  <InputGroup className={cn("max-w-80 max-md:max-w-none", className)}>
    {icon ? (
      <InputGroupAddon>
        <Search aria-hidden="true" />
      </InputGroupAddon>
    ) : null}
    <InputGroupInput
      type="search"
      placeholder={placeholder}
      aria-label={`Search ${label}`}
      value={query}
      onChange={(e) => onQuery(e.target.value)}
    />
  </InputGroup>
);

export default CatalogSearch;
