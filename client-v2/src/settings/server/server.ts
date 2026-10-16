import { GITHUB_URL } from "../../constants";
import { SERVER_URL } from "../../shared/config/client-env";
import { PgCommon } from "../../utils";
import { createSetting } from "../create";
import {
  defaultServerEndpoint,
  SERVER_ENDPOINT_OPTIONS,
} from "./default-endpoint";

export const server = [
  createSetting({
    id: "server.endpoint",
    description: "Build server URL",
    // The list lives beside the default so the two cannot disagree about
    // which host is Solana's and which is upstream's (D30)
    values: [...SERVER_ENDPOINT_OPTIONS],
    default: defaultServerEndpoint({
      REACT_APP_SERVER_URL: SERVER_URL,
      NODE_ENV: process.env.NODE_ENV,
    }),
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
