/**
 * The build audit: one `build_audit` row per forwarded build (see its
 * migration). Opened before the build server is called and closed when it
 * answers, so a build that never ended still shows who started it.
 *
 * Every statement runs on a `query` the route passes in, the persistence
 * slice's in production, as `features/agent`'s ledger does.
 */
import { createServerLogger } from "../../../shared/lib/logger/server.mjs";

const log = createServerLogger("build-server:audit");

/**
 * @typedef {(text: string, params?: unknown[]) => Promise<{ rows: any[] }>} Query
 */

/**
 * Open the row for a build. Throws when it cannot be written, and the route
 * refuses the build then: an unrecorded build is the thing this prevents.
 *
 * @param {Query} query
 * @returns {(build: {
 *   userId: string;
 *   project: { id?: string; name?: string };
 *   unstable: boolean;
 *   bytes: number;
 * }) => Promise<number>} what opens a build's row and gives its id
 */
export const startAuditWith =
  (query) =>
  async ({ userId, project, unstable, bytes }) => {
    const { rows } = await query(
      `insert into build_audit
       (user_id, login, project_id, project_name, unstable, request_bytes)
     values ($1, (select login from "user" where id = $1), $2, $3, $4, $5)
     returning id`,
      [userId, project.id, project.name, unstable, bytes]
    );
    return Number(rows[0].id);
  };

/** How long a closing update may hold a finished build's answer back */
export const FINISH_DEADLINE_MS = 5_000;

/**
 * Close the row with how the build ended. Never throws, and gives up after
 * `deadlineMs`: the answer waits on it, and a stalled database must not hold
 * a finished build until the function times out and the answer is lost. The
 * row exists either way; one left open reads as a build that never ended.
 *
 * @param {Query} query
 * @param {{ deadlineMs?: number }} [opts]
 * @returns {(outcome: {
 *   id: number;
 *   programUuid?: string;
 *   status: number;
 *   durationMs: number;
 * }) => Promise<void>} what closes a row; a `programUuid` absent keeps what
 *   the row has
 */
export const finishAuditWith =
  (query, { deadlineMs = FINISH_DEADLINE_MS } = {}) =>
  async ({ id, programUuid, status, durationMs }) => {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new Error(`build_audit update took over ${deadlineMs} ms`)),
        deadlineMs
      );
    });
    try {
      await Promise.race([
        query(
          `update build_audit
          set program_uuid = coalesce($2, program_uuid),
              status = $3,
              duration_ms = $4
        where id = $1`,
          // `pg` sends an undefined parameter as null
          [id, programUuid, status, Math.max(0, Math.round(durationMs))]
        ),
        deadline,
      ]);
    } catch (e) {
      log.error(e, { report: true, context: { op: "finishAudit", id } });
    } finally {
      clearTimeout(timer);
    }
  };
