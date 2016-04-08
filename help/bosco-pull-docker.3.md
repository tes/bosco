bosco-pull-docker(3) -- Pull docker images
==============================================

## SYNOPSIS

    bosco pull-docker
    bosco pull-docker -r <repoPattern>

## DESCRIPTION

This command is used to pull changes from your docker registry.

It is called as part of the wrapper script: `morning`.

## COMMAND LINE OPTIONS

### -r, --repo

* Default: .*
* Type: String

This sets a regex string that is used to filter the repository list.

### --noremote

This prevents bosco from trying to pull docker images from a remote registry.

## SEE ALSO

* bosco help morning
