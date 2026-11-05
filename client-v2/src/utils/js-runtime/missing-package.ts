// Kept apart from `kit.ts` so the UI can read a failed run without loading
// the TypeScript compiler that `kit.ts` imports.

/**
 * The message `PgJsRuntimePackage.import` throws for a package it lacks
 *
 * @param name the package
 * @returns the message, which `missingPackageOf` reads back
 */
export const missingPackageMessage = (name: string) =>
  `Package \`${name}\` is not available.`;

const MISSING_PACKAGE_REGEX = /^Package `(.+)` is not available\.$/;

/**
 * Get the package a failed import asked for.
 *
 * @param message the error's message
 * @returns the package name, or `undefined` when the error is not a missing
 * package
 */
export const missingPackageOf = (message: string): string | undefined =>
  MISSING_PACKAGE_REGEX.exec(message)?.[1];
