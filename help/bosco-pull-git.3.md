bosco-pull-git(3) -- Run 'git pull --rebase master' across all repositories in your Github team.
==============================================

## SYNOPSIS

    bosco pull-git
    bosco pull-git -r <repoPattern>

## DESCRIPTION

This command is used to pull changes from all of the github repositories in your configured Github team.

It is called as part of the wrapper script: `morning`.

## COMMAND LINE OPTIONS

### -r, --repo

* Default: .*
* Type: String

This sets a regex string that is used to filter the repository list.

## SEE ALSO

* bosco help morning
