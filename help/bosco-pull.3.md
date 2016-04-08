bosco-pull(3) -- Run 'git pull --rebase master' and 'docker pull' across all repositories in your Github team.
==============================================

## SYNOPSIS

    bosco pull
    bosco pull -r <repoPattern>

## DESCRIPTION

This command is used to pull changes from all of the github repositories in your configured Github team.

It also pulls down any docker images for your team.

## COMMAND LINE OPTIONS

### -r, --repo

* Default: .*
* Type: String

This sets a regex string that is used to filter the repository list.

### --noremote

This prevents bosco from trying to pull docker images from a remote registry.

## SEE ALSO

* bosco help pull-git
* bosco help pull-docker
