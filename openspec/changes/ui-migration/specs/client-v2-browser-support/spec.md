# Spec Delta

## Purpose

The browsers the production bundle of `client-v2` targets, so that CSS and
JavaScript features are chosen against a stated floor rather than a guess.

## ADDED Requirements

### Requirement: The production floor is Safari 16.4, Chrome 111, Firefox 128, Edge 111

The production build SHALL target Safari 16.4, Chrome 111, Firefox 128 and
Edge 111 or newer, and the build configuration SHALL state that floor in one
place.

#### Scenario: A browser at the floor

- **WHEN** the product is opened in Safari 16.4 or Chrome 111
- **THEN** every screen renders as designed, including cascade layers,
  `@property` and `color-mix()` colours

#### Scenario: A browser below the floor

- **WHEN** the product is opened in Safari 14 or Chrome 67
- **THEN** the product makes no promise about its appearance; no polyfill is
  shipped for the features above
