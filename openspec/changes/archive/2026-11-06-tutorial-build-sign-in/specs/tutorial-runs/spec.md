# Spec Delta

## ADDED Requirements

### Requirement: A build refused for sign-in asks the learner to sign in

When the build server refuses a tutorial's build because nobody is signed in (an answer with reason `signed-out`), the act's result SHALL be a sign-in card, not a failed build. The card SHALL read "Sign in to build", with the line "Builds run on Playground's build server, which needs a GitHub sign-in. Your code stays in this browser.", and SHALL carry one primary action: "Sign in with GitHub" while nobody is signed in, "Build" once someone is. "Sign in with GitHub" SHALL sign in without leaving the page, and "Build" SHALL run the build act again. The card SHALL show no Explain and no "I'll fix it myself", and SHALL keep its reason across a reload. A build-and-deploy whose build is refused this way SHALL say "Sign in with GitHub to build." on its failed card.

#### Scenario: A signed-out learner presses Build
- **WHEN** a signed-out learner runs a tutorial's Build act and the build server answers with reason `signed-out`
- **THEN** the result card reads "Sign in to build" with the line above and one primary "Sign in with GitHub", and no Explain

#### Scenario: Signing in turns the primary into Build
- **WHEN** the learner signs in from that card
- **THEN** the tutorial stays on the same step and the card's primary reads "Build", which runs the build again

#### Scenario: A reload keeps the sign-in card
- **WHEN** the page reloads while that card is the step's latest result
- **THEN** the card still reads "Sign in to build", not "Build failed"
