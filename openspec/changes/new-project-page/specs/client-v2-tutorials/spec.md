## MODIFIED Requirements

### Requirement: The Tutorials page leads with a heading, a search and a filter

The Tutorials page and Home SHALL list only the tutorials of the start
ladder, Hello Anchor (Beginner), Lumberjack (Intermediate) and Zero Copy
(Advanced), in that order, and so SHALL New project's Tutorials list; every
other tutorial stays registered (its link keeps it) but leaves the start.
Home shows the three and its link to the Tutorials page reads "All 3".

The Tutorials page SHALL open with the heading "Tutorials" (its only `h1`),
a search field whose placeholder reads "Search <n> tutorials" with `n` the
number of tutorials listed ("Search 3 tutorials"; "Search <framework>
tutorials" while a framework is picked), labelled "Search tutorials", and a
framework filter button beside it, drawn only while the list holds two or
more frameworks. The filter button SHALL be labelled "Filter by framework" while no
framework is picked and "Framework: <name>" while one is, and SHALL open a
menu titled "Framework" with All, Anchor, Seahorse and Native. The search
SHALL match a tutorial's name and description, and the filter its framework;
both apply together. While a search or a filter is on, a status line SHALL
say "<n> results" ("1 result"), or "No tutorials match “<query>”" ("No
<framework> tutorials match …"; "No <framework> tutorials yet" with no
query) when nothing matches.

#### Scenario: The start lists the three v2 lessons

- **WHEN** a user opens Tutorials
- **THEN** Beginner holds Hello Anchor, Intermediate Lumberjack and Advanced
  Zero Copy, the search reads "Search 3 tutorials", and no framework filter
  shows, since all three are Anchor

#### Scenario: Filtering by framework

- **WHEN** the list holds Anchor and Seahorse tutorials and a user opens
  "Filter by framework" and picks Seahorse
- **THEN** only Seahorse tutorials show, the button is labelled
  "Framework: Seahorse", the search reads "Search Seahorse tutorials", and
  a status line gives the count

#### Scenario: A search with no match

- **WHEN** a user types "zzz" in the Tutorials page's search field
- **THEN** the status line reads "No tutorials match “zzz”" and no card shows
