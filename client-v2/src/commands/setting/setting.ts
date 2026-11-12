import {
  PgCommon,
  PgConnection,
  PgSettings,
  PgTerminal,
  TonedLineError,
} from "../../utils";
import { createArgs, createCmd, createSubcmd } from "../create";

/** Read-only and outside `PgSettings`: the env owns the read-buffer RPCs, so nothing is stored */
const READ_BUFFER_ENDPOINT_ID = "connection.readBufferEndpoint";

/** The RPC a deploy reads program buffers through, from the same rule the deploy uses */
const getReadBufferEndpoint = () =>
  PgConnection.getReadBufferConnection(PgConnection.current).rpcEndpoint;

/** Every setting ID, the read-only one in its sorted place among the connection keys */
const getSettingIds = () => {
  const ids = PgSettings.all.map((s) => s.id);
  const next = ids.findIndex((id) => id > READ_BUFFER_ENDPOINT_ID);
  ids.splice(next === -1 ? ids.length : next, 0, READ_BUFFER_ENDPOINT_ID);
  return ids;
};

/** Common setting ID argument */
const idArg = {
  name: "id",
  description: "Setting ID",
  values: getSettingIds,
} as const;

export const setting = createCmd({
  name: "setting",
  description: "Manage playground settings",
  subcommands: [
    createSubcmd({
      name: "get",
      description: "Get setting value",
      args: createArgs([idArg]),
      handle: (input) => {
        if (input.args.id === READ_BUFFER_ENDPOINT_ID) {
          PgTerminal.println(getReadBufferEndpoint());
          return;
        }

        const value = getSetting(input.args.id).getValue();
        PgTerminal.println(value);
      },
    }),

    createSubcmd({
      name: "set",
      description: "Set setting value",
      args: createArgs([
        idArg,
        {
          name: "value",
          description: "Value to set",
          values: (token, tokens) => {
            const id = getSettingIdFromTokens(tokens);
            // Any value passes, so `handle` refuses it with its own line
            if (id === READ_BUFFER_ENDPOINT_ID) return token ? [token] : [];

            const selected = getSetting(id);

            // If `values` field is not specified, default to boolean
            if (!selected.values) return ["true", "false"];

            // Normalize values
            const values = PgCommon.callIfNeeded(selected.values).flatMap(
              (v) => {
                if (typeof v === "string") return v;
                if (typeof v === "object" && v.name && v.value) return v.name;
                if (typeof v === "object" && v.values) return v.values;

                throw new Error(`Unimplemented setting value: ${v}`);
              }
            );

            // If the setting has a custom value parser, allow the current
            // token to be used as a setting value after a validation check
            if (selected.custom) {
              try {
                selected.custom.parse(token);
                values.push(token);
              } catch {}
            }

            return values;
          },
          parse: (token, tokens) => {
            const id = getSettingIdFromTokens(tokens);
            if (id === READ_BUFFER_ENDPOINT_ID) return token;

            const selected = getSetting(id);
            const value = token;
            const namedValue = PgCommon.callIfNeeded(selected.values)?.find(
              (v) => v.name === value
            )?.value;
            if (namedValue) return namedValue;

            if (selected.custom) {
              try {
                return selected.custom.parse(value);
              } catch {}
            }

            return selected.values ? value : value === "true";
          },
        },
      ]),
      handle: (input) => {
        if (input.args.id === READ_BUFFER_ENDPOINT_ID) {
          throw new TonedLineError(
            "error",
            `\`${READ_BUFFER_ENDPOINT_ID}\` comes from the environment and can't be set here.`
          );
        }

        getSetting(input.args.id).setValue(input.args.value);
      },
    }),
  ],
});

/**
 * Get the setting's implementation from its id.
 *
 * @param id setting id
 * @throws if the setting is not found
 * @returns the full setting object
 */
const getSetting = (id: string) => {
  const found = PgSettings.all.find((s) => s.id === id);
  if (!found) throw new Error(`Setting not found: ${id}`);
  return found;
};

/**
 * Get setting ID from the given tokens.
 *
 * This makes strong assumptions about the location of the setting ID argument
 * (index 2), which works fine for now, but would break in the case of nested
 * subcommands.
 *
 * **NOTE:** A better way to handle this situation would be to provide parsed
 * tokens rather than raw tokens to `arg.values` and `arg.parse`. However, this
 * is not straight-forward to achieve because `arg.values` is also used in the
 * autocompletion logic, which currently only concerns itself with the current
 * token without keeping track of the previous ones. Technically, we could do
 * this for `arg.parse`, since that's only used by the command processor, but
 * we're choosing to not do that in order to keep the APIs (arguments) the same.
 *
 * @param tokens command tokens
 * @returns the setting ID without checking whether it's a valid ID
 */
// TODO: Provide parsed tokens instead of raw ones to `arg.values` and `arg.parse`
const getSettingIdFromTokens = (tokens: string[]) => {
  const id = tokens.filter((t) => !t.startsWith("-")).at(2);
  if (!id) throw new Error("Setting ID not found in tokens");
  return id;
};
