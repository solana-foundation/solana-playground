# GraphQL Queries Reference

## Fetch unresolved review threads (paginated)

Run it with `gh api graphql --paginate -F owner=OWNER -F repo=REPO -F number=PR_NUMBER -f query='...'`. `--paginate` follows `pageInfo.endCursor` while `hasNextPage` is true, and requires the cursor variable to be named `$endCursor`.

```graphql
query($owner: String!, $repo: String!, $number: Int!, $endCursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          comments(first: 3) {
            nodes {
              body
              path
              author { login }
              createdAt
            }
          }
        }
      }
    }
  }
}
```

## Batch-resolve threads

```graphql
mutation {
  t1: resolveReviewThread(input: {threadId: "ID1"}) { thread { isResolved } }
  t2: resolveReviewThread(input: {threadId: "ID2"}) { thread { isResolved } }
}
```

## Fetch general PR comments edited in place (REST)

General PR comments are issue comments. Greptile may update one summary comment repeatedly, so select by `updated_at` instead of `created_at`. Match the bot logins exactly: a substring match would accept any account whose login contains `greptile`.

```bash
gh api --paginate "repos/{owner}/{repo}/issues/<PR_NUMBER>/comments?per_page=100" \
  | jq -s 'add
    | map(select(.user.login == "greptile-apps[bot]" or .user.login == "greptile-apps-staging[bot]"))
    | sort_by(.updated_at)
    | last
    | {author: .user.login, updated_at, body}'
```
