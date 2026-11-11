-- The GitHub account id on each `build_audit` row (HOO-2422), copied from the
-- user's GitHub `account` row when the build starts.
--
-- `login` alone did not name every builder: sign-in stores it only when it
-- creates the user, so a user created before the column, or through the OAuth
-- proxy on a preview, has none, and later sign-ins never fill it. The account
-- id is there for every GitHub user, never changes, and survives a rename;
-- `https://api.github.com/user/<id>` turns it back into the current handle.
-- No foreign key, like the rest of the row: the account row goes with the user.

-- migrate:up

alter table build_audit add column github_id text;

-- migrate:down

alter table build_audit drop column github_id;
