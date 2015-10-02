bosco-s3push(3) -- Push static assets up to S3
==============================================

## SYNOPSIS

    bosco -e <environment> -b <build> s3push

## DESCRIPTION

This command will run the bundling and minification process and
push all of the static assets up to S3 using the AWS configuration
supplied in the configuration file specific to the specificed
environment.

## COMMAND LINE OPTIONS

### -e, --environment

* Default: local
* Type: String

This sets the environment path

### -b, --build

* Default: default
* Type: String

The build name / number to assign to this push.

## CONFIGURATION REQUIREMENTS

For this command to work you must have configured the AWS configuration within the `.bosco` configuration files.  This can either be in the `bosco.json` file (which means it is common across all environments), or in a file named `environment.json` which means it is applied based on the environment name applied in the `-e` option.

The configuration needs to contain the following:

    "aws": {
        "key": "XXX-AWS-KEY-XXX",
        "secret": "XXX-AWS-SECRET-XXX",
        "bucket": "bucket-name",
        "region": "region-name",
        "cdn": "https://your-cloudfront.cloudfront.net"
    }

## SEE ALSO

* bosco help cdn
