import { declareDecorator, updatable } from "./decorators";

interface GlobalState {
  buildLoading: boolean;
  deployState: "ready" | "loading" | "paused" | "cancelled";
  /**
   * An `anchor idl` write runs in the terminal. Every transaction of it goes
   * to the network it started on, so the selected network must hold still.
   */
  isIdlWriting: boolean;
}

const defaultState: GlobalState = {
  buildLoading: false,
  deployState: "ready",
  isIdlWriting: false,
};

@updatable({ defaultState })
class _PgGlobal {}

export const PgGlobal = declareDecorator(_PgGlobal, {
  updatable: { defaultState },
});
