# Spec Delta

## Purpose

The browser MCP client of client-v2: the connections it keeps to MCP servers, directly or through the
`/api/mcp` gateway, and the events it reports about them.

## ADDED Requirements

### Requirement: A connection follows its server entry

The client SHALL keep at most one connection per server entry id. When an entry's URL or credentials change, or
the entry is removed, the client SHALL close the previous connection, so no request carries the old credentials.
A call already running on the previous connection SHALL finish before its session closes. A call that reaches the
previous connection after it was closed, including the repeat of a call whose session expired, SHALL reject
without sending a request. A call whose entry was removed after the call started SHALL reject without opening a
connection. A tool built from an entry SHALL call the entry as it is when the tool runs: an entry edited after
the tools were built is called with its current URL and credentials, and a call to an entry removed or turned off
since SHALL be refused without sending a request. A list with an entry whose URL, with its query parameters, does
not parse SHALL be rejected when it is applied, and the list in effect SHALL stay unchanged.

#### Scenario: An entry's token, URL, or query parameters change (manual)

- **WHEN** a server's tools are listed, its token, URL, or query parameters are changed, and its tools are listed
  again
- **THEN** the second listing's requests carry the new value, and the first connection is closed

#### Scenario: An entry is removed (manual)

- **WHEN** a server entry whose tools were listed is removed
- **THEN** its connection is closed

#### Scenario: An entry removed while a call starts (manual)

- **WHEN** a listing of a server's tools starts and the server entry is removed before the listing reaches its
  connection
- **THEN** the listing rejects, no request is sent, and no connection is kept for the entry

#### Scenario: An entry edited after the tools were built (manual)

- **WHEN** the assistant's tools are built from a server entry, the entry's URL or token is changed, and the model
  then calls one of those tools
- **THEN** the call carries the new URL and token and none carries the old; if the entry was removed instead, the
  call is refused and no request is sent

#### Scenario: A call running when its connection closes (manual)

- **WHEN** a tool call is waiting for the server's answer and its connection is closed
- **THEN** the call returns the server's answer, the session closes after it, and a later call on that connection
  rejects without opening a session

#### Scenario: A server URL that does not parse (manual)

- **WHEN** the user applies a server list with an entry whose URL, with its query parameters, does not parse
- **THEN** the editor shows an error naming the entry, and the server list in effect is unchanged

### Requirement: The gateway's entry wins an id

The servers the assistant uses SHALL hold one entry per id. When the gateway serves an id that a local entry also
has, the client SHALL use the gateway's entry: the local entry contributes no tools and no connection, and the
connection and discovered tools it had SHALL be dropped. A listing of the local entry's tools that ends after the
gateway took the id SHALL be discarded. The local entry SHALL stay in the user's list, shown as
replaced by the gateway's server, and SHALL be used again once the gateway stops serving the id.

#### Scenario: A gateway server takes over a local entry's id (manual)

- **WHEN** a local entry `explorer` is applied while the gateway does not serve `explorer`, its tools are listed,
  and the gateway then serves `explorer`
- **THEN** the assistant uses one `explorer` entry, the gateway's; its tools build without a duplicate name; the
  local entry's connection is closed and no later listing or call reaches the local entry's URL; the Sources tab
  shows the local entry as replaced; and when the gateway stops serving `explorer`, the local entry is used again

#### Scenario: Discovery that started before a takeover does not restore the old tools (manual)

- **WHEN** a listing of a local entry `explorer`'s tools starts, the gateway then serves `explorer`, and the
  listing ends with the local entry's tools, whether the panel's discovery or the server console started it
- **THEN** the cached tools for `explorer` are not the local entry's, and the next turn offers none of them

### Requirement: Listing a server's tools is reported

The event `mcp_tools_listed` SHALL fire each time a server's tools are listed, with `server`: `gateway` for a server
reached through `/api/mcp`, `user` for one the user added; and `tools`: the number of tools, an integer of 0 or more.

#### Scenario: A gateway server lists two tools (manual)

- **WHEN** the tools of a server reached through the gateway are listed and it offers two
- **THEN** `mcp_tools_listed` fires once with `server: "gateway"` and `tools: 2`

### Requirement: A failed listing is reported

The event `mcp_tools_list_failed` SHALL fire each time listing a server's tools fails, with `server` as in
`mcp_tools_listed`, and `reason`: `unreachable` when the browser cannot reach the host, `timeout` when a request
outlived the connection's timeout, `session-expired` when the session expired again after one reopen, `other`
otherwise.

#### Scenario: An unreachable host (manual)

- **WHEN** listing the tools of a user server fails because the browser cannot reach its host
- **THEN** `mcp_tools_list_failed` fires once with `server: "user"` and `reason: "unreachable"`

### Requirement: A tool call is reported

The event `mcp_tool_called` SHALL fire each time a tool call settles, with `server` as in `mcp_tools_listed`;
`outcome`: `ok`, `tool-error` when the server answered with an error result, `aborted` when the caller's signal
stopped the call, `timeout` when the call outlived the connection's timeout, or `failed` when the call rejected for
any other reason; and `retried`: `true` when the call ran again on a new session, `false` otherwise. A call the user
stopped SHALL NOT be shown in the panel as failed.

#### Scenario: A call retried on a new session (manual)

- **WHEN** a tool call fails on an expired session and succeeds on the reopened one
- **THEN** `mcp_tool_called` fires once with `outcome: "ok"` and `retried: true`

#### Scenario: A call the user stops (manual)

- **WHEN** the caller's signal is aborted before a tool call settles
- **THEN** `mcp_tool_called` fires once with `outcome: "aborted"`, and the panel shows no failed tool call

#### Scenario: A call that outlives the timeout (manual)

- **WHEN** a tool call gets no answer within the connection's timeout
- **THEN** `mcp_tool_called` fires once with `outcome: "timeout"`

### Requirement: A reopened session is reported

The event `mcp_session_reopened` SHALL fire once for each expired session the client reopens, with `server` as in
`mcp_tools_listed`.

#### Scenario: Two calls share one reopen (manual)

- **WHEN** two concurrent tool calls fail on the same expired session and both run again on one new session
- **THEN** `mcp_session_reopened` fires once

### Requirement: Events carry no server data

No event of the client SHALL carry a URL, a header, a token, a tool name, or tool arguments.

#### Scenario: A user server with a token (manual)

- **WHEN** a user server configured with a token lists its tools and one of them is called
- **THEN** no parameter of `mcp_tools_listed` or `mcp_tool_called` contains the server's URL, the token, or the tool's name
