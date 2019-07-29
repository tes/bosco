bosco-cdn(3) -- Serve static assets locally for development.
==============================================

## SYNOPSIS

    bosco cdn
    bosco cdn minify

## DESCRIPTION

This command will run the bundling and minification process and then serve all of the static assets locally, which defaults to `http://localhost:7334/`.  It will watch the assets specified in the `bosco-service.json` file and reload if they change.

It is expected that you leave this command running while doing development on services, as if you are also using Compoxure then it provides the HTML fragments that allow the static assets to be included in other pages.

## CONFIGURATION REQUIREMENTS

For this command to work you must have configured the `bosco-service.json` file in the base of the micro services who would like to take part in the asset minification process.

An example `bosco-service.json` file is shown below for a simple service that doesn't have its own build script:

    {
        "tags": ["review"],
        "assets": {
            "basePath": "/src/public",
            "js": {
                "bottom": [
                    "js/report-review.js",
                    "js/lib/lean-modal.min.js",
                    "js/moderate-review.js"
                ]
            },
            "css": {
                "top": [
                    "css/reviews.sass"
                ]
            }
        }
    }

For a project that has it's own build step, you can have Bosco wrap around it:

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
            "js": {
                "upload": [
                    "js/tsl-uploader.js"
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


## SEE ALSO

* bosco help s3push
