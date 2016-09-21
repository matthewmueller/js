# Contributing

First and foremost, thanks for taking the time to support this project!


## Submit issues to the relevant repository

The makojs organization has quite a few repositories, so please do your best to
submit any issues to the most relevant one. If you are unsure where to file your
issue, don't spend _too_ much time wondering, as the issue can get moved to the
appropriate repository after it has been created.

If multiple repositories are involved in a particular bug, please submit an
issue to each of them. Also, make sure to link those issues together so it is
easy to keep track.

## Submit all changes through a Pull Request

Rather than pushing commits directly to `master`, open a PR for every change.
This gives more visibility into changes that are happening, and gives other
contributors time to weigh in before code actually lands.

This process will also help protect against broken code from being released
accidentally, since Pull Requests are all subject to automated checks.

## Squash all PR merge commits

This is intended to keep the commit history as clean as possible, as well as
making it easier to revert changes if needed.

## Creating new releases

To release a new version, follow this procedure:

1. Use [semver][semver] to determine what to bump. In general:
   - `patch`: bug fixes
   - `minor`: new features
   - `major`: backwards-incompatible changes
2. Run `npm version <patch|minor|major>`, which automatically:
   - runs `npm test` to ensure the tests pass at least locally
   - bumps the `package.json` to the correct new version
   - opens the changelog using the new version (requires [git-extras][git-extras])
   - creates a new release commit/tag
   - pushes to github

Once this is complete, [TravisCI][travis] will run the tests. If they all pass,
the new version will be published automatically.


[semver]: http://semver.org/
[git-extras]: https://github.com/tj/git-extras
[travis]: https://travis-ci.org/makojs/cache
