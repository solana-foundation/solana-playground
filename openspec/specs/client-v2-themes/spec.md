# client-v2-themes Specification

## Purpose

How the theme's base colours apply where a part names none.

## Requirements

### Requirement: A border without a colour of its own is the hairline

Any element that draws a border without naming its colour SHALL draw it in the
theme's border colour (`--color-border`), never in the text colour, in every
theme. This covers the edges of sheets, dialog footers, cards and tables.

#### Scenario: A sheet's edge in the dark theme

- **WHEN** a sheet opens in the dark theme
- **THEN** its edge is drawn in the border colour, not in the text's white
