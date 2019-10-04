# Bosco

[![Build Status](https://travis-ci.org/tes/bosco.svg?branch=master)](https://travis-ci.org/tes/bosco)
[![Dependencies Status](https://david-dm.org/tes/bosco.png)](https://david-dm.org/tes/bosco)
[![Dev Dependencies Status](https://david-dm.org/tes/bosco/dev-status.png)](https://david-dm.org/tes/bosco#info=devDependencies)
[![Coverage Status](https://img.shields.io/coveralls/tes/bosco.svg)](https://coveralls.io/r/tes/bosco?branch=master) [![Gitter](https://badges.gitter.im/JoinChat.svg)](https://gitter.im/tes/bosco?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

Bosco is a utility knife to help manage the complexity that using microservices, which naturally results in a large number of code repositories, brings with it.  Inspired by the Github 'setup', e.g. can a developer run one simple command and get up and running?

Docs: https://bosco.readme.io/v0.4.0/docs/what-is-bosco

## Get Started

Ensure that you have Node installed using nvm (https://github.com/creationix/nvm), Bosco uses this to support services running across multiple node versions, then install bosco:

```
npm install bosco -g
bosco setup
```

## Configuration

It will ask initially for:

|Configuration|Description|
|:-----------------|-----------|
|Github name|Your username|
|Github Auth Key|A key that gives read access to the repositories in the organization (you can set this up here: https://github.com/blog/1509-personal-api-tokens).|

This is then saved in a configuration file locally on disk, default is in ~/.bosco/bosco.json, so all subsequent commands use it.

It will then ask for a team to start with, and a folder (referred to below as <folder>) to link the team to (it will create it if it doesn't exist).

After this, do the following:

```
cd <folder>
bosco morning
```

At the end of this sequence of steps you will have:

* All of the projects checked out into your project folder.
* Any dependent modules linked between projects (e.g. if one repo is actually a module depended on by another).
* All projects fully npm installed.

### Github enterprise support

In order to use Bosco with your github enterprise account an additional parameter is avaialable in the bosco config file.

````
apiHostname: "your.enterprise.hostname/api/v3"
````


## To join a new team

```
bosco team setup
<select team>
<select folder>
cd <folder>
bosco morning
```

## Workspaces

Bosco is built around the idea that you use github teams to manage groups of repositories.  So, when you first run setup, Bosco will connect to Github, grab all of the teams that you belong to - across all organisations - and cache them locally.

It will then ask you to link a team to a workspace folder - this folder can be anywhere, but it just lets Bosco know that this is the place where that team lives, this then appears in the output of the command 'bosco team ls'.

```
[07:09:26] Bosco: Initialised using [/Users/cliftonc/.bosco/bosco.json] in environment [local] with team [service]
[07:09:26] Bosco: Your current github organisations and teams
[07:09:26] Bosco:  - tes/southampton-buildings > /Users/cliftonc/work/resources
[07:09:26] Bosco:  - tes/staff > Not linked
[07:09:26] Bosco:  - tes/cms > Not linked
[07:09:26] Bosco:  - tes/twigkit > Not linked
[07:09:26] Bosco:  - tes/example > Not linked
[07:09:26] Bosco:  - tes/engineering > Not linked
[07:09:26] Bosco:  - tes/world-university-rankings > Not linked
[07:09:26] Bosco:  - tes/profiles > /Users/cliftonc/work/profiles
[07:09:26] Bosco:  - Calipso/owners > Not linked
[07:09:26] Bosco:  - tes/owners > Not linked
```

To link a workspace, simply:

```
bosco team ln tes/example .
```

This will link the team 'tes/example' into the current folder as its workspace.

## Command List

Commands in Bosco are defined via specific command files within the 'commands' folder: [https://github.com/tes/bosco/tree/master/commands](commands).

To get help on any command just type;

```
bosco help clone
```

## Parameters

You can use a number of parameters to control the behaviour of Bosco.  Parameters are configuration options that can be used across commands.

|parameter|description|default|
|---------|-----------|--------|
|-e, --environment|Environment name|local|
|-b, --build|Build number or tag|default|
|-c, --configFile|Config file|~/.bosco/bosco.json|
|-p, --configPath|Config path|~/.bosco/bosco.json|
|-n, --noprompt|Do not prompt for confirmation|false|
|-f, --force|Force over ride of any files|false|
|-s, --service|Inside single service|false|
|--nocache|Ignore local cache for github projects|false|
|--offline|Ignore expired cache of remote service data and use local if available|false|

To see all possible commands and parameters, just type 'bosco'.

## Bash completion

To enable bash <tab> completion for bosco, add the following line to your ~/.bashrc file:

```
eval "$(bosco --completion=bash)"
```

## Key Commands

### Setup

The default command, this sets you up.

```
bosco setup
```

This will sync with github, ask you for a default team and workspace folder, clone all the repositories in that team, auto link any dependent modules together (saving lots of 'npm link ../module', and then finally run npm install on all of them.  This literally will save you hours of work on a larger project.

If any repository already exists locally it will skip it.  Typically you only use this command once, and use the other pull, install, morning commands on a daily basis.

## Service Configuration

### bosco-service.json

If services want to take part in the static asset pipeline that Bosco provides, as well as allow bosco to start and stop them, then they need a bosco-service.json config file.

e.g.

```json
{
    "service": {
        "name": "app-resource",
        "dependsOn": [
            "infra-nginx-gateway",
            "service-page-composer",
            "service-site-assets",
            "service-resource-reviews",
            "service-refdata-api"
        ]
    },
    "tags": ["upload", "resource"],
    "assets": {
        "basePath": "/src/public",
        "js": {
            "bottom": [
                "js/lib/base64.min.js",
                "js/lib/bind.shim.min.js",
                "js/lib/cookies.min.js",
                "js/lib/lean-modal.min.js",
                "js/report-review.js",
                "js/resources.js"
            ],
            "top": [
                "js/event-tracking.js"
            ]
        },
        "css": {}
    }
}
```

### Supported static asset types

Bosco has a specific list of asset filetypes that it will process, although this can be easily extended using options.fileTypesWhitelist.

The current list is 'js', 'css', 'img', 'html', 'swf', 'fonts', 'pdf'.

To serve swf, fonts or pdf, you should add them under a 'files' key (at the same level as the 'assets' key), with the following structure:

```json
{
  "assets": {
    ...
  },
  "files": {
    "info": {
      "basePath": "dist",
      "fonts": [
        "pdf/guide.pdf"
      ]
    }
  },
  "libraries": [
    {
        "basePath": "src/vendor",
        "glob": "**/**"
    }
  ]
}
```

## Using Bosco to start Docker projects

If you add a bosco-service.json at the base of your docker projects, you can take advantage of Bosco knowing how to build, pull and run them as dependencies of your services:

```
{
    "service": {
        "type": "docker",
        "name": "infra-redis",
        "registry": "docker-registry.tescloud.com",
        "username": "tescloud",
        "version": "latest",
        "alwaysPull": true,
        "docker": {
            "HostConfig": {
                "PortBindings": {
                    "6379/tcp": [{
                        "HostIp": "0.0.0.0",
                        "HostPort": "6379"
                    }]
                }
            }
        }
    }
}
```

## Remote dependencies

If you have defined your infrastructure docker files as projects like the one above, pushed to your organisations repo, you can then take advantage of another feature.

You can define a dependency:

```
{
    "service": {
        "name": "app-resource",
        "dependsOn": [
            "infra-nginx-gateway",
            "service-page-composer",
            "infra-redis"
        ]
    }
}
```

And if Bosco can't find the project in the current team, it will go to your github repository, grab the definition file and run it for you anyway.  Very helpful.

## Docker Compose

You can also define a project as containing a docker-compose definition file:

```
{
    "tags": [],
    "service": {
        "name": "jobs-containers",
        "type": "docker-compose"
    }
}
```

This expects then a ```docker-compose.yml``` in the root of the project.

## Using project specific build tools

Some projects will want (or need) something more sophisticated than a simple concatenation / minification step for assets.  To support this, Bosco allows you to define a build configuration on a per project basis in the bosco-service.json file.

For example, a project that uses Gulp to create assets as well as watch for change, can use a configuration like that below in the bosco-service.json:

```json
{
    "build": {
        "command": "gulp build",
        "watch": {
            "command": "gulp build --watch",
            "ready": "Finished 'build'"
        }
    },
    "assets": {
        "basePath": "/dist",
        "alreadyMinified": true,
        "js": {
            "upload": [
                "js/tsl-uploader.js"
                "js/tsl-uploader.js.map"
            ]
        },
        "css": {
            "upload": [
                "css/tsl-uploader.css"
            ]
        },
        "images": {
            "upload": [
                "img"
            ]
        }
    }
}
```

In this mode, instead of directly defining the JS and CSS assets, simply define a build configuration that includes the command to run before pulling together the assets, along with a watch command (if available).

The files created as a result of the build step should just be included as normal, but they won't be read until the build command is complete.

If you provide the `alreadyMinified` flag, you can also provide a source map (this is optional), see above.

### CDN

This will aggregate and serve all of the static assets (those defined within bosco-service.json files within each project) on a single pseudo CDN url.

```
bosco cdn <minify>
```

If passed the minify parameter it will minify the JS as it does if pushing to s3, but serve locally.

In CDN mode you can just visit the index page, default: [Bosco Index](http://localhost:7334/) and it will list all the files for you.

The html fragments for [compoxure](https://github.com/tes/compoxure) in local mode (or the raw asset files) can be built by following a simple convention:

```
http://localhost:7334/<environment>/<build>/html/tag.type.html
```

For example:

- [http://localhost:7334/local/default/html/bottom.js.html](http://localhost:7334/local/default/html/bottom.js.html)

This would contain a fragment that has script tags for all of the JS tagged in the bottom group.

You can view all assets that are being tracked by `bosco cdn` by going to any url once the `bosco cdn` command is running and using the cdn port (i.e: 127.0.0.1:7334). You can also see a list of repos by going to /repos on the `bosco cdn` server (i.e: 127.0.0.1:7334/repos).

#### Example of bosco CDN with watch
You can use any part of the service name. For example if we have ```service1, service2, service3```

To watch all 3 services:
```
bosco cdn -w "service"
```
and to watch **service1** and **service2** only:
```
bosco cdn -w "service1|service2"
```

#### Start up CDN for specified services only
You might have 15 repos in your bosco team folder but you only need assets served for two of them, for example the app you're currently working on plus one other serving shared assets. You can use the -r flag to specify that CDN starts for only those services, making the CDN startup time much quicker:

```
bosco cdn -r "service1|service2"
```

### S3 Push

This will create bundles for front end assets (JS, CSS, Templates), this command can be run *across* repositories in a workspace, but it is typically run within a single service (hence the -s parameter below) by a build server that dynamically assigns a build number.

```
bosco s3push -s -e <environment> -b <buildnumber>
```

This command requires that you have configured your AWS details for S3.  Best to put these into a .bosco folder in the project workspace a per environment config, e.g. .bosco/tes.json.

```json
{
    "aws": {
        "key": "XXXXXX",
        "secret": "XXXXXX",
        "bucket": "bucket-name",
        "region": "eu-west-1",
        "cdn": "https://dudu89lpwit3y.cloudfront.net"
    }
}

```

To then access the html fragments for [compoxure](https://github.com/tes/compoxure), it follows a simple convention:

```
<cdn>/<environment>/<build>/<type>/<bundle>.<fragmentType>.<js|css|html|map|txt>
```

For example:

- [https://dudu89lpwit3y.cloudfront.net/tes/55/html/bottom.js.html](https://dudu89lpwit3y.cloudfront.net/tes/55/html/bottom.js.html)

This would contain a fragment that has script a tag for all of the minified JS tagged in the bottom group.

## Manifest Files

To ensure that we always know what was in a specific release, the minification process creates a manifest file
for each bundle that includes each file, along with the last commit that was made to that file.

Before you push, it will do a diff between the last manifest file created, and the one for the bundle you are about to push, and ask you to confirm that all of the files changed are ones that you expected to be changed.  e.g. it will try to avoid you pushing someone elses change unexpectedly.

```
service-hub-beta/js/lib/html5shiv-min.js, Last commit: 09b61e7 refactor
service-hub-beta/js/lib/jquery-1.11.0-min.js, Last commit: 09b61e7 refactor
service-hub-beta/js/lib/jquery-mobile-1.4.3-min.js, Last commit: 09b61e7 refactor
service-hub-beta/js/lib/modernizr-2.7.1-min.js, Last commit: 09b61e7 refactor
service-hub-beta/js/dom.js, Last commit: 09b61e7 refactor
service-hub-beta/js/measure.js, Last commit: 09b61e7 refactor
service-hub-beta/js/page.js, Last commit: 2353274 @doodlemoonch @csabapalfi fix broken browse section height
service-hub-beta/js/resource.js, Last commit: 09b61e7 refactor
service-hub-beta/js/sequence.js, Last commit: 09b61e7 refactor
service-hub-beta/js/upload.js, Last commit: 09b61e7 refactor
service-resource/js/lib/base64.min.js, Last commit: 29bba10 @antony @tepafoo Moved own resource logic to front-end
service-resource/js/lib/bind.shim.min.js, Last commit: e1b212b @antony User cannot review their own resource.
service-resource/js/lib/cookies.min.js, Last commit: 29bba10 @antony @tepafoo Moved own resource logic to front-end
service-resource/js/lib/lean-modal.min.js, Last commit: 8ba20d1 @antony Fire a modal when reporting a review
service-resource/js/report-review.js, Last commit: e0c5af0 @antony @carolineBda Feedback / Report review form
service-resource/js/resources.js, Last commit: bf28fc9 @cressie176 fixing server side use of authentication state
```

## Duplicate Files and Libraries

Bosco will attempt to detect duplicate files (via a checksum), as well as duplicate libraries (e.g. multiple versions of jQuery).  If it spots a duplicate, it will not add it to a minified bundle after warning you that it found it.  Because of this the first version of a library it finds will 'win'.

It is strongly recommended that you pull all 'core' libraries like jQuery into a central single project to avoid duplication, but Bosco will try and help you if you don't.

Note that if you use the external build option then the files inside this project don't get included in the duplicate check.

## Local Commands

To create your own Bosco commands for your project (ones that you don't want to submit back to core via a pull request), simply create a 'commands' folder in the root of your Bosco workspace and add commands to it.  You can use any of the core commands as a starting point.

At TES we have a github project that is a 'default' Bosco workspace that contains local commands and configuration that teams use as their workspace.

## Npm Commands

You can create bosco commands as npm packages and install it via npm (local or global). These commands must be named bosco-command-*command* such as bosco-command-ports. Bosco will try to find such commands as long as they match the naming pattern. This was inspired by [Yeoman generators](http://yeoman.io/authoring/)

### Options and Args in new commands

There are two ways of passing input through to a command: options and args.

#### Options (e.g. Command Line Options)

Options are specified via - switches, and are typically applied across more than one command.  For example, -e development.

```
bosco -e development s3push
bosco -e development cdn minify
```

Bosco commands can specify one or more options they are interested in and they will be parsed at runtime. You can see an example on the activity command source file.

Within a command these are then accessed via the global Bosco object, by their long name (see /bin/bosco.js).

```
var environment = bosco.options.environment;
```

#### Arguments (to specific commands)

Arguments are an array of strings that follow the command.

For example:

```
bosco cdn minify
```

In the above command, the command is cdn, the args are: ["minify"]

To use in a command, you typically scan the array for their presence and set a variable (as in most instances they actually represent a Boolean vs a string).

```
var minify = _.contains(args, 'minify');
```

## Troubleshooting

### You switch Node versions

To remove all the node_modules folders in your team's repos:
```
bosco clean-modules
```

Then run npm install across them all again:
```
bosco install
```
