import { PgCommon } from "./common";
import { PgTerminal } from "./terminal";
import type { Arrayable, Disposable, Getable, SyncOrAsync } from "./types";

/**
 * Whether a run can be stopped now: `stoppable` honours its signal, `step`
 * is a stoppable command in a step that cannot stop (deploy's last
 * transaction), `never` is a command that does not honour a stop
 */
type Stoppability = "stoppable" | "step" | "never";

/** A command run in flight, for `PgCommandManager.stop` */
interface Run {
  /** Name of the top-level command */
  readonly name: string;
  stoppability: Stoppability;
  readonly controller: AbortController;
}

/** Terminal command creation parameter */
export type CommandParam<
  N extends string,
  A extends Arg[],
  O extends Option[],
  S,
  R
> = {
  /** Name of the command that will be used in terminal */
  name: N;
  /** Description that will be seen in the `help` command */
  description: string;
  /* Only process the command if the condition passes */
  preChecks?: Arrayable<() => SyncOrAsync<void>>;
  /**
   * Whether the handler honours its input's `signal`: a stop (Ctrl+C, the
   * console strip's Stop) aborts it, and the handler ends with a
   * `StoppedError`. Any other command answers a stop with "can't be stopped".
   */
  stoppable?: true;
} & (WithSubcommands<S> | WithHandle<A, O, R>);

type WithSubcommands<S> = {
  /** Command arguments */
  args?: never;
  /** Command options */
  options?: never;
  /** Function to run when the command is called */
  handle?: never;
  /** Subcommands */
  subcommands?: S;
};

type WithHandle<A, O, R> = {
  /** Command arguments */
  args?: A;
  /** Command options */
  options?: O;
  /** Function to run when the command is called */
  handle: (input: ParsedInput<A, O>) => R;
  /** Subcommands */
  subcommands?: never;
};

type ParsedInput<A, O> = {
  /** Raw input */
  raw: string;
  /** Parsed arguments */
  args: ParsedArgs<A>;
  /** Parsed options */
  options: ParsedOptions<O>;
  /** Aborted when the person stops the run (see `stoppable`) */
  signal: AbortSignal;
  /**
   * The rest of this run is one step that cannot stop: a stop from here on
   * says "This step can't be stopped" and the run goes on
   */
  lockStop: () => void;
};

/** Recursively map argument types */
type ParsedArgs<A> = A extends [infer Head, ...infer Tail]
  ? Head extends Arg<infer N, infer V, infer P>
    ? (Head["optional"] extends true
        ? {
            [K in N]?: ArgValue<Head, V, P>;
          }
        : {
            [K in N]: ArgValue<Head, V, P>;
          }) &
        ParsedArgs<Tail>
    : never
  : {};

type ArgValue<A extends Arg, V, P> = A["multiple"] extends true
  ? A["parse"] extends NonNullable<A["parse"]>
    ? P[]
    : V[]
  : A["parse"] extends NonNullable<A["parse"]>
  ? P
  : V;

/** Recursively map option types */
type ParsedOptions<O> = O extends [infer Head, ...infer Tail]
  ? Head extends Option<infer N, infer V, infer P>
    ? (Head["takeValue"] extends true
        ? { [K in N]?: OptionValue<Head, V, P> }
        : { [K in N]?: boolean }) &
        ParsedOptions<Tail>
    : never
  : {};

type OptionValue<O extends Option, V, P> = O["parse"] extends NonNullable<
  O["parse"]
>
  ? P
  : V;

/** Command argument */
export type Arg<
  N extends string = string,
  V extends string = string,
  P = unknown
> = {
  /** Name of the argument */
  name: N;
  /** Description of the argument */
  description?: string;
  /** Whether the argument can be omitted */
  optional?: boolean;
  /** Whether to take multiple values */
  multiple?: boolean;
  /** Accepted values */
  values?: V[] | ((token: string, tokens: string[]) => V[]);
  /** Parse the argument */
  parse?: (token: string, tokens: string[]) => P;
};

/** Command option */
export type Option<
  N extends string = string,
  V extends string = string,
  P = unknown
> = {
  /** Name of the option */
  name: N;
  /** Description of the option */
  description?: string;
  /** Short form of the option passed with a single dash (`-`) */
  short?: boolean | string;
} & (
  | {
      /** Whether to take value for the option */
      takeValue: true;
      /** Accepted values */
      values?: Getable<V[]>;
      /** Parse the option */
      parse?: (token: string, tokens: string[]) => P;
    }
  | {
      takeValue?: never;
      values?: never;
      parse?: never;
    }
);

/** Inferred terminal command implementation */
export type Command<
  N extends string,
  A extends Arg[],
  O extends Option[],
  S,
  R
> = Omit<CommandParam<N, A, O, S, R>, "subcommands"> & {
  subcommands?: S extends Command<
    infer N2,
    infer A2,
    infer O2,
    infer S2,
    infer R2
  >
    ? Command<N2, A2, O2, S2, R2>
    : any[];
};

/** Executable command type for external usage */
type ExecutableCommand<
  N extends string = string,
  A extends Arg[] = Arg[],
  O extends Option[] = Option[],
  S = unknown,
  R = unknown
> = Pick<Command<N, A, O, S, R>, "name"> & {
  /** Process the command. */
  execute(...args: string[]): Promise<Awaited<R>>;
  /**
   * @param cb callback function to run when the command starts running
   * @returns a dispose function to clear the event
   */
  onDidStart(cb: (input: string | null) => void): Disposable;
  /**
   * @param cb callback function to run when the command finishes running
   * @returns a dispose function to clear the event
   */
  onDidFinish(
    cb: (
      result: { ok: Awaited<R>; err?: never } | { err: Error; ok?: never }
    ) => void
  ): Disposable;
};

/** Name of all the available commands (only code) */
type CommandCodeName = keyof InternalCommands;

/** Ready to be used commands */
type Commands = {
  [N in CommandCodeName]: InternalCommands[N] extends Command<
    infer N,
    infer A,
    infer O,
    infer S,
    infer R
  >
    ? ExecutableCommand<N, A, O, S, R>
    : never;
};

/** All commands */
export const PgCommand: Commands = new Proxy({} as any, {
  get: (
    target: { [K in CommandCodeName]?: ExecutableCommand },
    cmdCodeName: CommandCodeName
  ) => {
    if (!target[cmdCodeName]) {
      const name = PgCommandManager.all[cmdCodeName].name;
      target[cmdCodeName] = {
        name,
        execute: (...args) => PgCommandManager.execute([name, ...args]),
        onDidStart: (cb) => PgCommandManager.onDidStart(name, cb),
        onDidFinish: (cb) => PgCommandManager.onDidFinish(name, cb),
      };
    }

    return target[cmdCodeName];
  },
});

/**
 * Terminal command manager.
 *
 * This is intended for internal usage. Running commands should be done with
 * `PgCommand` instead.
 */
export class PgCommandManager {
  /** All internal commands */
  static all: InternalCommands;

  /**
   * Get the available command names.
   *
   * @returns the command names
   */
  static getNames() {
    return Object.values(this.all).map((cmd) => cmd.name);
  }

  /**
   * Get the available command completions.
   *
   * @returns the command completions
   */
  static getCompletions() {
    type CompletionArg = { values?: Getable<string[]>; multiple?: boolean };
    type CompletionOption = { takeValue?: boolean; other?: string };
    interface Completions {
      [key: string]: Completions | CompletionArg | CompletionOption;
    }
    const recursivelyGetCompletions = (
      commands: Command<string, any[], any[], any[], any>[],
      completions: Completions = {}
    ) => {
      for (const cmd of commands) {
        completions[cmd.name] = {};
        const completion = completions[cmd.name] as Completions;
        if (cmd.subcommands) {
          recursivelyGetCompletions(cmd.subcommands, completion);
        }
        if (cmd.args) {
          for (const [i, arg] of Object.entries(cmd.args)) {
            completion[i] = { values: arg.values, multiple: arg.multiple };
          }
        }
        if (cmd.options) {
          for (const opt of cmd.options) {
            const long = `--${opt.name}`;
            completion[long] = { takeValue: opt.takeValue, values: opt.values };

            if (opt.short) {
              const short = `-${opt.short}`;
              completion[long] = { ...completion[long], other: short };
              completion[short] = {
                ...completion[long],
                other: long,
              };
            }
          }
        }
      }

      return completions;
    };

    return recursivelyGetCompletions(Object.values(PgCommandManager.all));
  }

  /**
   * Execute from the given tokens.
   *
   * All command processing logic happens in this method.
   *
   * @param tokens parsed input tokens
   * @returns the return value of the command
   */
  static async execute(tokens: string[]) {
    return await PgTerminal.process(async () => {
      const inputCmdName = tokens.at(0);
      if (!inputCmdName) return;

      const topCmd = Object.values(PgCommandManager.all).find(
        (cmd) => cmd.name === inputCmdName
      );
      if (!topCmd) {
        throw new Error(
          `Command \`${PgTerminal.italic(inputCmdName)}\` not found.`
        );
      }

      const input = tokens.join(" ");

      const run: Run = {
        name: topCmd.name,
        stoppability: topCmd.stoppable ? "stoppable" : "never",
        controller: new AbortController(),
      };

      // Dispatch start event
      const eventNames = PgCommandManager._getEventNames(topCmd.name);
      PgCommon.createAndDispatchCustomEvent(eventNames.start, input);

      // A run that started finishes however it ends: a pre-check or a parse
      // that throws would otherwise leave every `onDidFinish` listener, the
      // flow's stages among them, on "running". Help and a bare parent
      // command print and end without a result, and finish nothing.
      let result: { ok: unknown } | { err: unknown } | undefined;
      try {
        PgCommandManager._runs.add(run);
        let cmd: Command<string, Arg[], Option[], any[], any> = topCmd;
        const args = [];
        const opts = [];

        for (const i in tokens) {
          const token = tokens[i];
          const nextIndex = +i + 1;
          const nextToken = tokens.at(nextIndex);
          const subcmd = cmd.subcommands?.find((cmd) => cmd.name === token);
          if (subcmd) cmd = subcmd;

          // Handle checks
          if (cmd.preChecks) {
            const preChecks = PgCommon.toArray(cmd.preChecks);
            for (const preCheck of preChecks) await preCheck();
          }

          // Early continue if it's not the end of the command
          const isLast = +i === tokens.length - 1;
          const isNextTokenSubcmd = cmd.subcommands?.some(
            (cmd) => cmd.name === nextToken
          );
          if (!isLast && isNextTokenSubcmd) continue;

          // Check missing command processor
          if (!cmd.handle) {
            PgTerminal.println(`
${cmd.description}

Usage: ${[...tokens.slice(0, +i), cmd.name].join(" ")} <COMMAND>

Commands:

${PgTerminal.formatList(cmd.subcommands!)}`);
            break;
          }

          const hasArgsOrOpts = cmd.args?.length || cmd.options!.length > 1;
          if (hasArgsOrOpts) {
            // Handle `help` option
            if (nextToken === "--help" || nextToken === "-h") {
              const usagePrefix = `Usage: ${[
                ...tokens.slice(0, +i),
                cmd.name,
              ].join(" ")} [OPTIONS]`;
              const lines = [cmd.description];
              if (cmd.subcommands) {
                lines.push(
                  `${usagePrefix} <COMMAND>`,
                  "Commands:",
                  PgTerminal.formatList(cmd.subcommands)
                );
              }
              if (cmd.args) {
                const toArgStr = (arg: Arg) => {
                  const name = arg.name.toUpperCase();
                  return arg.multiple ? `[${name}]` : `<${name}>`;
                };

                const usageArgs = cmd.args.reduce(
                  (acc, arg) => acc + toArgStr(arg) + " ",
                  ""
                );
                const argList = cmd.args.map((arg) => [
                  toArgStr(arg),
                  (arg.description ?? "") +
                    (Array.isArray(arg.values)
                      ? ` (possible values: ${arg.values.join(", ")})`
                      : ""),
                ]);
                lines.push(
                  `${usagePrefix} ${usageArgs}`,
                  "Arguments:",
                  PgTerminal.formatList(argList)
                );
              }
              if (cmd.options) {
                const optList = cmd.options.map((opt) => [
                  `${opt.short ? `-${opt.short}, ` : ""}--${opt.name} ${
                    opt.takeValue ? `<${opt.name.toUpperCase()}>` : ""
                  }`,
                  opt.description ?? "",
                ]);
                lines.push("Options:", PgTerminal.formatList(optList));
              }

              PgTerminal.println(lines.join("\n\n"));
              return;
            }

            // Get subcommands, args and options
            if (nextToken && !isNextTokenSubcmd) {
              let takeValue = false;
              for (const argOrOpt of tokens.slice(nextIndex)) {
                if (takeValue) {
                  opts.push(argOrOpt);
                  takeValue = false;
                  continue;
                }

                const isOpt = argOrOpt.startsWith("-");
                if (isOpt && cmd.options) {
                  const opt = cmd.options.find(
                    (o) =>
                      "--" + o.name === argOrOpt || "-" + o.short === argOrOpt
                  );
                  if (!opt)
                    throw new Error(`Unexpected option: \`${argOrOpt}\``);

                  opts.push(argOrOpt);
                  if (opt.takeValue) takeValue = true;
                } else if (cmd.args) {
                  args.push(argOrOpt);
                }
              }

              if (!cmd.args && cmd.subcommands) {
                if (nextToken.startsWith("-")) {
                  throw new Error(`Unexpected option: \`${nextToken}\``);
                }

                throw new Error(
                  `Subcommand doesn't exist: \`${nextToken}\`

Available subcommands: ${cmd.subcommands.map((cmd) => cmd.name).join(", ")}`
                );
              }
              if (
                args.length > (cmd.args?.length ?? 0) &&
                !cmd.args?.at(-1)?.multiple
              ) {
                throw new Error(
                  `Provided argument count is higher than expected: ${args.length}`
                );
              }
            }
          }

          // Parse args
          const parsedArgs: Record<string, Arrayable<unknown>> = {};
          if (cmd.args) {
            for (const i in cmd.args) {
              const arg = cmd.args[i];
              const inputArgs = arg.multiple
                ? args.slice(+i)
                : args[i]
                ? [args[i]]
                : [];
              if (!inputArgs.length) {
                if (!arg.optional) {
                  throw new Error(`Argument not specified: \`${arg.name}\``);
                }

                // Optional argument value not specified, skip
                continue;
              }

              // Validate values if specified
              if (inputArgs.length && arg.values) {
                const values =
                  typeof arg.values === "function"
                    ? arg.values(args[i], tokens)
                    : arg.values;
                const invalidValue = inputArgs.find(
                  (inputArg) => !values.includes(inputArg)
                );
                if (invalidValue) {
                  throw new Error(
                    [
                      `Incorrect argument value given: \`${invalidValue}\``,
                      `(possible values: ${values.join(", ")})`,
                    ].join(" ")
                  );
                }
              }

              if (arg.parse) {
                const parse = PgCommandManager._createParse("argument", arg);
                parsedArgs[arg.name] = arg.multiple
                  ? inputArgs.map((token) => parse(token, tokens))
                  : parse(inputArgs[0], tokens);
              } else {
                parsedArgs[arg.name] = arg.multiple ? inputArgs : inputArgs[0];
              }
            }
          }

          // Parse options
          const parsedOpts: Record<string, unknown> = {};
          if (cmd.options) {
            for (const opt of cmd.options) {
              const i = opts.findIndex(
                (o) => o === "--" + opt.name || o === "-" + opt.short
              );
              if (i === -1) continue;

              if (opt.takeValue) {
                const val = opts.at(i + 1);
                if (!val) {
                  throw new Error(`Option value not given: \`${opt.name}\``);
                }

                // Validate values if specified
                if (opt.values) {
                  const values = PgCommon.callIfNeeded(opt.values);
                  if (!values.includes(val)) {
                    throw new Error(
                      [
                        `Incorrect option value given: \`${val}\``,
                        `(possible values: ${values.join(", ")})`,
                      ].join(" ")
                    );
                  }
                }

                parsedOpts[opt.name] = opt.parse
                  ? PgCommandManager._createParse("option", opt)(val, tokens)
                  : val;
              } else {
                parsedOpts[opt.name] = true;
              }
            }
          }

          // Run the command processor
          run.stoppability = cmd.stoppable ? "stoppable" : "never";
          const ret = await cmd.handle({
            raw: input,
            args: parsedArgs,
            options: parsedOpts,
            signal: run.controller.signal,
            lockStop: () => {
              if (run.stoppability === "stoppable") run.stoppability = "step";
            },
          });
          result = { ok: ret };
          return ret;
        }
      } catch (e) {
        result = { err: e };
        throw e;
      } finally {
        PgCommandManager._runs.delete(run);
        if (result) {
          PgCommon.createAndDispatchCustomEvent(eventNames.finish, result);
        }
      }
    });
  }

  /**
   * Stop the runs in flight: Ctrl+C (or ⌘. on a Mac) in the terminal and the
   * console strip's Stop. A run of a `stoppable` command has its signal
   * aborted and ends with a `StoppedError` at its next safe point; a run in a
   * step that cannot stop, or of a command that does not honour a stop, goes
   * on, and the terminal says so. A stop pressed again while a run is
   * already stopping says nothing. When one run starts another (deploy
   * builds first when the program is not built), every stoppable one stops.
   *
   * @returns whether a run is stopping
   */
  static stop() {
    const runs = [...PgCommandManager._runs];
    const last = runs.at(-1);
    if (!last) return false;

    const stoppable = runs.filter(
      (run) =>
        run.stoppability === "stoppable" && !run.controller.signal.aborted
    );
    if (stoppable.length) {
      PgTerminal.println("^C");
      for (const run of stoppable) run.controller.abort();
      return true;
    }
    if (runs.some((run) => run.controller.signal.aborted)) return true;

    const why = runs.some((run) => run.stoppability === "step")
      ? "This step can't be stopped."
      : `\`${last.name}\` can't be stopped.`;
    PgTerminal.println(`^C\n${why} Wait for it to finish.`);
    return false;
  }

  /** Runs in flight, oldest first */
  private static readonly _runs = new Set<Run>();

  /**
   * Runs after the command starts execution.
   *
   * @param name command name
   * @returns a disposable to clear the event listener
   */
  static onDidStart(
    name: string,
    ...params: Parameters<ExecutableCommand["onDidStart"]>
  ) {
    return PgCommon.onDidChange(this._getEventNames(name).start, ...params);
  }

  /**
   * Runs after the command finishes execution.
   *
   * @param name command name
   * @returns a disposable to clear the event listener
   */
  static onDidFinish(
    name: string,
    ...params: Parameters<ExecutableCommand["onDidFinish"]>
  ) {
    return PgCommon.onDidChange(this._getEventNames(name).finish, ...params);
  }

  /** Get custom event names of the given command. */
  private static _getEventNames(name: string) {
    return {
      start: "ondidrunstart" + name,
      finish: "ondidrunfinish" + name,
    };
  }

  /** Create a parse function with better error messages. */
  private static _createParse<T extends Arg | Option>(
    kind: "argument" | "option",
    item: T
  ): NonNullable<T["parse"]> {
    const parse = item.parse;
    if (!parse) throw new Error(`Parse not defined: ${item.name}`);

    return (...args) => {
      try {
        return item.parse!(...args);
      } catch (e: any) {
        throw new Error(
          `Failed to parse ${kind}: \`${item.name}\`${
            e.message ? `: ${e.message}` : ""
          }`
        );
      }
    };
  }
}
