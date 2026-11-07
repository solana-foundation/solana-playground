/**
 * The line a terminal command ends with when it needs the built-in wallet's
 * key bytes and the key origin keeps them: the `--sign-only` pre-check names
 * the command, `secretKeyFor` does not know it.
 *
 * @param subject the command as the person typed it, in backticks, or
 * "This command"
 * @returns the line
 */
export const keyCommandLine = (subject: string) =>
  `${subject} can't run here: it needs the Playground wallet's key, which this app keeps on a separate origin the terminal can't read. Deploy with \`deploy\` or Build & Deploy, or sign from a client script with \`pg.wallet\`.`;

/**
 * What `secretKeyFor` throws under the key origin, for a WASM package built
 * against a `PgWallet` without `signTransactionMessage`
 */
export const CLI_KEY_ERROR = keyCommandLine("This command");
