# Tasks

Ticket for every task: HOO-2254 (Polish: tutorials gallery and tutorial
page, child of HOO-2237). Task 1 runs alongside 2 and 3; 3 needs 2.

## 1. The About page as the stand draws it

- [x] 1.1 About page: "Start" / "Continue" / "Completed" in title case
      beside the heading and pinned at a phone's foot (R55); Level as the
      green tag, Framework and Languages as icon and title-case text (R74);
      the e2e specs that find `START` follow to `Start` ([plan](plans/1-about-page.md))
- [x] 1.2 Beside the About page with no project: the assistant's head and
      empty state name the tutorial (R53), the files column is empty (R54) ([plan](plans/1-about-page.md))

## 2. The tutorial card (after nothing; before 3)

- [x] 2.1 Tutorials' progress read from `PgTutorial` (new, started page N
      of M, completed: `useTutorialProgress`), and `BaseTutorialCard`, fed
      through `useTutorialList` rather than a connected card of its own: brand
      cover, caption, corner ↗ / tick, "N of M", phone chevron, failure on
      the card ([plan](plans/2-tutorial-card.md))
- [x] 2.2 New project's Tutorials list draws `BaseTutorialCard`; Programs
      keeps its card ([plan](plans/2-tutorial-card.md))

## 3. The Tutorials page (after 2)

- [ ] 3.1 Heading, search ("Search 16 tutorials") and the framework filter,
      the results line, level sections with counts and Show all; emits
      `catalog_filtered`
- [ ] 3.2 The Start here banner in its three states with the voxel mark,
      starting its tutorial on open; emits `catalog_banner_opened`
