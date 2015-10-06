bosco-s3delete(3) -- Delete a bundled build from S3.
==============================================

## SYNOPSIS

    bosco -e <environment> s3delete <build>

## DESCRIPTION

This command will delete a previously pushed build from `bosco s3push` from S3 - e.g. allowing you to be a good citizen and clean up after yourself.

Note that in this command the build is passed as an additional argument, not as a command line option.

## COMMAND LINE OPTIONS

### -e, --environment

* Default: local
* Type: String

This sets the environment path

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

* bosco help s3push
