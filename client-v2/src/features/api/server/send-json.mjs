/**
 * Answer `res` with `body` as JSON under `status`, never cached: how the
 * cron gate and the cron routes answer, so a change to the answer's headers
 * lands in all of them.
 *
 * @param {import("node:http").ServerResponse} res
 */
export const sendJsonFor = (res) => (status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};
