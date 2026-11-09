import { GITHUB_URL } from "../../constants";
import { SERVER_URL } from "../../shared/config/client-env";
import { createLogger } from "../../shared/lib/logger";
import { PgCommon } from "../../utils";
import { createSetting } from "../create";
import {
  defaultServerEndpoint,
  LOCAL_ENDPOINT,
  SERVER_ENDPOINT_OPTIONS,
} from "./default-endpoint";

const log = createLogger("settings:server");

// Once per page load: the module is evaluated once
if (!SERVER_URL) {
  log.warn(
    `REACT_APP_SERVER_URL is not set; the build server defaults to ${LOCAL_ENDPOINT}`
  );
}

export const server = [
  createSetting({
    id: "server.endpoint",
    // Not "Endpoint", which `connection.endpoint` takes from its id
    name: "Build server",
    description: "Build server URL",
    // The list lives beside the default so it cannot offer the upstream
    // host the default avoids
    values: [...SERVER_ENDPOINT_OPTIONS],
    default: defaultServerEndpoint({ REACT_APP_SERVER_URL: SERVER_URL }),
    custom: {
      parse: (v) => {
        if (PgCommon.isUrl(v)) return v;
        throw new Error(`The setting value must be a URL: ${v}`);
      },
      type: "URL",
      placeholder: "https://...",
      tip: `Make sure the endpoint runs [the playground server](${GITHUB_URL}/tree/master/server).`,
    },
  }),
];
