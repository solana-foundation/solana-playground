import { PgCommon, SidebarPage, SidebarPageParam } from "../../utils";

/**
 * Create a sidebar page.
 *
 * @param page sidebar page
 * @returns the page with correct types
 */
export const createSidebarPage = <N extends string>(
  page: SidebarPageParam<N>
) => {
  page.title ??= page.name;
  page.importComponent ??= () => {
    return import(`./${PgCommon.toKebabFromTitle(page.name)}/Component`);
  };
  return page as SidebarPage<N>;
};
