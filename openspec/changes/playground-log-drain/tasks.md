# Tasks

## 1. Receiver

- [x] 1.1 (ticket to file) Implement the authenticated receiver and focused Node tests; no dependency on other tasks.
- [x] 1.2 (ticket to file) Document secret names, drain filtering and activation checks; depends on 1.1.

## 2. Activation

- [ ] 2.1 (ticket to file) Merge and deploy the receiver after repository checks and review; depends on 1.1 and 1.2.
- [ ] 2.2 (ticket to file) Create the production-only drain, verify real event fields in Loki and enable the Grafana rules; depends on 2.1.
