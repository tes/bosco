bosco-template(3) -- Create new projects based on pre-defined template repositories.
==============================================

## SYNOPSIS

    bosco template
    bosco template add tes/tes-service-template
    bosco template remove tes/tes-service-template
    bosco template create tes-service-template service-amazing 5001

## DESCRIPTION

This command will let you manage the template projects that bosco can create, and then create those projects wherever you might be.

## CONFIGURATION REQUIREMENTS

For this command to work you need to have actually created a template project.  A template project is just a normal project, but it has one extra thing - a 'bosco-templates.json' file in its root.

For example:

    [
        {"source": "templates/default.json.hbs", "destination": "config/default.json"},
        {"source": "templates/README.md.hbs", "destination": "README.md"},
        {"source": "templates/package.json.hbs", "destination": "package.json"},
        {"source": "templates/bosco-service.json.hbs", "destination": "bosco-service.json"},
        {"source": "templates/Makefile.hbs", "destination": "Makefile"},
        {"source": "templates/Dockerfile.hbs", "destination": "Dockerfile"},
        {"source": "templates/example-service.conf.hbs", "destination": "docker/supervisor/{{serviceName}}.conf"}
    ]

This file is just an array of files (stored in the template folder), that are processed when creating the service and any of the variables within replaced with the service name or port.

The variables you can use are:  {{serviceName}}, {{serviceShortName}}, {{port}} or {{user}}.

## CREATING A NEW SERVICE

Creating a new service is as simple as running the create command:

    bosco template create tes-service-template service-amazing 5001

This takes the structure of:

    bosco template create <templateName> <serviceName> <port>

The template name argument can actually be any part of the name (to avoid you having to type the whole thing).

## SEE ALSO

* bosco help s3push
