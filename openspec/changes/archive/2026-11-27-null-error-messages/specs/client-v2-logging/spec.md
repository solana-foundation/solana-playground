# Spec Delta

## MODIFIED Requirements

### Requirement: A thrown value that is not an Error keeps its value

When an entry is logged with a value that is not an `Error`, the logger SHALL
create an `Error` whose message is the value converted to a string and whose
`cause` is the original value. A `null` or `undefined` value SHALL instead get
the message `<namespace> logged <value> instead of an Error`, the namespace
being the entry's, or, for an unhandled entry, `a promise rejected with
<value> and nothing caught it`; its `cause` SHALL still be the original value.

#### Scenario: A string is thrown

- **WHEN** `Logger.error("timeout")` is called with a string as the error
- **THEN** the recorded entry's error is an `Error` with message `timeout`
  and `cause` `"timeout"`

#### Scenario: A null error is logged

- **WHEN** a logger bound to `editor:editor` logs `null` as an error
- **THEN** the recorded entry's error is an `Error` with message
  `editor:editor logged null instead of an Error` and `cause` `null`

#### Scenario: A promise rejects with null and nothing catches it

- **WHEN** the global handler logs an unhandled rejection whose reason is
  `null`
- **THEN** the recorded entry's error is an `Error` with message `a promise
  rejected with null and nothing caught it`

## ADDED Requirements

### Requirement: A persistence failure with no error object is named by what failed

When persistence diagnostics record a failure that came with `null` or
`undefined` instead of an error, such as an HTTP answer, the reported entry's
error SHALL be an `Error` whose message is what failed. The recorded failure
SHALL keep the original value.

#### Scenario: A fetched project is gone

- **WHEN** persistence diagnostics record `fetch project p1: HTTP 404` with
  `null` as the error
- **THEN** the logger records an `error` entry with `report: true` whose
  error is an `Error` with message `fetch project p1: HTTP 404`
