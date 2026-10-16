/**
 * The persistence feature's only door into Monaco.
 *
 * Monaco keeps one model per path and `Monaco.tsx` reuses it whenever that
 * path is opened again (`onDidOpenFile`), so text written to disk underneath
 * an open tab stays invisible -- and the next autosave writes the old text
 * back. Anything that replaces files under a live editor has to drop those
 * models; this is where that happens.
 *
 * Loaded lazily, as `playground-bridge.ts` does, so nothing here pulls the
 * editor into a bundle or a test that never needed it.
 */
const models = async () => (await import("monaco-editor")).editor.getModels();

export const PgEditorModels = {
  /** @returns the model's current text, or `null` when there is no model */
  async valueOf(path: string): Promise<string | null> {
    const model = (await models()).find((m) => m.uri.path === path);
    return model ? model.getValue() : null;
  },

  /**
   * Dispose the models for these paths, so the next open builds them from
   * the explorer's state. Disposing is not an edit: no content-change event
   * fires, so no autosave writes anything back.
   */
  async drop(paths: readonly string[]) {
    const wanted = new Set(paths);
    for (const model of await models()) {
      if (wanted.has(model.uri.path)) model.dispose();
    }
  },

  /**
   * Whether any model under a directory holds text its file's state does not.
   *
   * That text is keystrokes autosave has not written yet. A path `saved` has
   * no answer for is not counted: nothing in state means nothing that
   * rebuilding the models from state could lose.
   */
  async anyEditedUnder(
    prefix: string,
    saved: (path: string) => string | undefined
  ): Promise<boolean> {
    return (await models()).some((model) => {
      if (!model.uri.path.startsWith(prefix)) return false;
      const content = saved(model.uri.path);
      return content !== undefined && content !== model.getValue();
    });
  },

  /**
   * `drop` for every model under a directory, trailing slash included.
   *
   * @param then runs straight after the models are gone, in the same task.
   * An editor whose model was disposed shows nothing, and `Monaco.tsx`'s
   * autosave timer saves whatever the editor shows -- so a caller that means
   * to open a file again has to do it before any timer can run, and an
   * `await` between the two would give one the chance.
   */
  async dropUnder(prefix: string, then?: () => void) {
    for (const model of await models()) {
      if (model.uri.path.startsWith(prefix)) model.dispose();
    }
    then?.();
  },
};
