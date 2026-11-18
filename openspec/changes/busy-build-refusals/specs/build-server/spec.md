# Spec Delta

## ADDED Requirements

### Requirement: The server bounds the wait for a build slot

A build request that finds no free slot SHALL wait in a queue of at most
`PG_BUILD_QUEUE_LIMIT` requests (default 6), each for at most
`PG_BUILD_QUEUE_WAIT_SECS` seconds (default 60). A request past either bound
SHALL be answered `503` with `Retry-After` in seconds, SHALL take no slot,
and SHALL leave no place held in the queue. The wait and the build together
SHALL stay within the request's time limit, which ends before the
`maxDuration` of `/api/build-server`.

#### Scenario: A free slot (manual)

- **WHEN** a build request arrives while a slot is free
- **THEN** the build starts at once, as before

#### Scenario: The queue is full (manual)

- **WHEN** every slot is taken and `PG_BUILD_QUEUE_LIMIT` requests are
  already waiting, and another build request arrives
- **THEN** the server answers it `503` with `Retry-After` at once

#### Scenario: The wait runs out (manual)

- **WHEN** a waiting request gets no slot within `PG_BUILD_QUEUE_WAIT_SECS`
- **THEN** the server answers it `503` with `Retry-After`, and no slot is
  used for it

#### Scenario: A caller that leaves while waiting (manual)

- **WHEN** a request leaves the queue before it gets a slot
- **THEN** its place in the queue is free for the next request
