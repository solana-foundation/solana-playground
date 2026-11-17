/** The terminal line for a buffer write the cluster refused, with its message; the next round sends it again */
export const refusedWriteLine = (message: string) =>
  `Warning: The cluster refused a buffer write (${message}), sending it again...`;
