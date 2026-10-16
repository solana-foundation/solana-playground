import { assistant } from "./assistant";
import { buildDeploy } from "./build-deploy";
import { explorer } from "./explorer";
import { programs } from "./programs";
import { test } from "./test";
import { tutorials } from "./tutorials";

/** The page the app opens on, and falls back to when leaving a routed page */
export const DEFAULT_SIDEBAR_PAGE: SidebarPageName = "Assistant";

/** All sidebar pages in order */
export const SIDEBAR = [
  assistant,
  explorer,
  buildDeploy,
  test,
  tutorials,
  programs,
];
