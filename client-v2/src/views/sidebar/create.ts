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
  // A bare filename refers to `public/icons/sidebar`, which lives in the assets
  // submodule. An already-resolved icon (an imported asset, a URL, a data URI)
  // is used as-is so a page can ship its own.
  if (!/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(page.icon)) {
    page.icon = "/icons/sidebar/" + page.icon;
  }
  page.title ??= page.keybind ? `${page.name} (${page.keybind})` : page.name;
  page.importComponent ??= () => {
    return import(`./${PgCommon.toKebabFromTitle(page.name)}/Component`);
  };
  return page as SidebarPage<N>;
};
