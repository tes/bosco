bosco-run(3) -- Run your services.
==============================================

## SYNOPSIS

    bosco run
    bosco run -r <repoPattern>
    bosco run -t <tag>

## DESCRIPTION

This command launches all of your services - either as Node processes via PM2, or as Docker images if specified in the `bosco-service.json`.

### Node Services

Node services are launched via PM2, via one of two mechanisms:

* If a `start` command is specified in the `package.json`, then it will launch the service using this command.
* If there is no start command in the `package.json`, but a `start` command is specified in the `bosco-service.json`, then it will launch the service using this command.

For example, in `package.json`:

    {
        "scripts": {
            "start": "node cluster"
        }
    }

In `bosco-service.json`:

    {
        "tags": ["review", "summary"],
        "service": {
            "type": "node",
            "start": "node cluster"
        }
    }

### Docker Services

Docker services are launched via Docker, and need the Docker configuration to be specified within the `bosco-service.json` file.

For example, in `bosco-service.json`:

    {
        "tags": ["review"],
        "service": {
            "type": "docker",
            "name": "infra-mongodb",
            "registry": "docker-registry.tescloud.com",
            "username": "tescloud",
            "version": "latest",
            "ports": {
                "27017/tcp": [{"HostPort": "27017"}],
                "28017/tcp": [{"HostPort": "28017"}]
            }
        }
    }


## COMMAND LINE OPTIONS

### -r, --repo

* Default: .*
* Type: String

This sets a regex string to use to filter the repostory list.

### -t, --tag

This sets a tag to use to filter the repostory list (as specified in `bosco-service.json` as above).

### -d, --deps-only

This only starts dependencies of the current service.

## SEE ALSO

* bosco help stop
* bosco help ps
* bosco help tail
