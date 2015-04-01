var _ = require('lodash');
var async = require('async');
var NodeRunner = require('../src/RunWrappers/Node');
var DockerRunner = require('../src/RunWrappers/Docker');
var mkdirp = require('mkdirp');
var runningServices = [];
var notRunningServices = [];

module.exports = {
    name: 'run',
    description: 'Runs all of the microservices (or subset based on regex pattern)',
    example: 'bosco run -r <repoPattern> -t <tag>',
    cmd: cmd,
    options: [{
        option: 'tag',
        syntax: ['-t, --tag [tag]', 'Filter by a tag defined within bosco-service.json']
    },
    {
        option: 'watch',
        syntax: ['-w, --watch', 'Watch the applications started with run for changes']
    },
    {
        option: 'list',
        syntax: ['-l, --list [list]', 'Start a list of repos (comma separated).']
    }
    ]
}

function cmd(bosco, args, cb) {

    var repoPattern = bosco.options.repo;
    var repoRegex = new RegExp(repoPattern);
    var watchPattern = bosco.options.watch || '$a';
    var watchRegex = new RegExp(watchPattern);
    var repoTag = bosco.options.tag;

    var repos;
    if(bosco.options.list) {
        repos = bosco.options.list.split(',');
    } else {
        repos = bosco.getRepos();
    }

    var initialiseRunners = function(next) {
        var runners = [NodeRunner, DockerRunner];
        async.map(runners, function loadRunner(runner, cb) {
            runner.init(bosco, cb);
        }, next);
    }

     var disconnectRunners = function(next) {
        var runners = [NodeRunner, DockerRunner];
        async.map(runners, function loadRunner(runner, cb) {
            runner.disconnect(cb);
        }, next);
    }

    var getRunConfig = function(repo) {

        var pkg, svc,
            repoPath = bosco.getRepoPath(repo),
            watch = repo.match(watchRegex) ? true : false,
            packageJson = [repoPath, 'package.json'].join('/'),
            boscoService = [repoPath, 'bosco-service.json'].join('/'),
            svcConfig = {
                name: repo,
                cwd: repoPath,
                watch: watch,
                service: {}
            };

        if (bosco.exists(packageJson)) {
            pkg = require(packageJson);
            if (pkg.scripts && pkg.scripts.start) {
                svcConfig = _.extend(svcConfig, {
                    service: {
                        type: 'node',
                        start: pkg.scripts.start
                    }
                });
            }
        }

        if (bosco.exists(boscoService)) {
            svc = require(boscoService);
            svcConfig = _.extend(svcConfig, {
                tags: svc.tags,
                order: svc.order
            });
            if (svc.service) {
                svcConfig.service = _.extend(svcConfig.service, svc.service);
            }
        }

        return svcConfig;

    }

    var getRunList = function(next) {

        var depTree = {};
        var revDepTree = {};
        var repoList = [];
        var runList = [];
        var svcConfig;
        var addDependencies = function(dependent, dependsOn) {
            dependsOn.forEach(function(dependency) {
                if(!_.contains(repoList, dependency)) repoList.push(dependency); // Ensures we then check the dependcies of depencies

                revDepTree[dependency] = revDepTree[dependency] || [];
                revDepTree[dependency].push(dependent);
            });
        }

        // First build the tree and filtered core list
        repos.forEach(function(repo) {
            svcConfig = getRunConfig(repo);
            depTree[svcConfig.name] = svcConfig;
            if ((!repoTag && repo.match(repoRegex)) || (repoTag && _.contains(svcConfig.tags, repoTag))) {
                repoList.push(repo);
            }
        });

        // Now iterate, but use the dependency tree to build the run list
        while (repoList.length > 0) {
            var currentRepo = repoList.shift();
            svcConfig = depTree[currentRepo];
            if (!svcConfig) return next(new Error('Trying to run ' + currentRepo + ' which does not exist on the list of repos. This is a dependency for ' + revDepTree[currentRepo]));

            if (svcConfig.service) {
                runList.push(svcConfig);
                if (svcConfig.service.dependsOn) {
                    addDependencies(currentRepo, svcConfig.service.dependsOn);
                }
            }
        }

        // Uniq and sort
        runList = _.chain(runList)
            .uniq(function(item) { return item.name; })
            .sortBy(function(item) {
                if (item.order) return item.order;
                return item.service.type === 'docker' ? 100 : 500
            }).value();

        next(null, runList);

    }

    var startRunnableServices = function(next) {

        getRunList(function(err, runList) {
            if (err) return next(err);

            async.mapSeries(runList, function(runConfig, cb) {
                if (runConfig.service && runConfig.service.type == 'docker') {
                    if (_.contains(runningServices, runConfig.name)) {
                        bosco.warn('Service ' + runConfig.name.green + ' is already running ...');
                        return cb();
                    }
                    bosco.log('Running docker service ' + runConfig.name.green + ' ...');
                    return DockerRunner.start(runConfig, cb);
                }

                if (runConfig.service && runConfig.service.type == 'node') {
                    if (_.contains(runningServices, runConfig.name)) {
                        bosco.warn('Service ' + runConfig.name.green + ' is already running ...');
                        return cb();
                    }
                    return NodeRunner.start(runConfig, cb);
                }
                cb();
            }, next);
        })

    }

    var stopNotRunningServices = function(next) {
        bosco.log('Removing stopped/dead services');

        async.each(notRunningServices, function(service, cb){
            NodeRunner.stop({name: service}, cb);
        }, next);
    };

    var getRunningServices = function(next) {
        NodeRunner.listRunning(false, function(err, nodeRunning) {
            DockerRunner.list(false, function(err, dockerRunning) {
                dockerRunning = _.map(_.flatten(dockerRunning), function(item) { return item.replace('/',''); });
                runningServices = _.union(nodeRunning, dockerRunning);
                next();
            });
        });
    }

    var getStoppedServices = function(next) {
        NodeRunner.listNotRunning(false, function(err, nodeNotRunning) {
            notRunningServices = nodeNotRunning;
            next();
        });
    };

    var ensurePM2 = function(next) {

        // Ensure that the ~/.pm2 folders exist
        var folders = [
            process.env.HOME + '/.pm2/logs',
            process.env.HOME + '/.pm2/pids'
        ];

        async.map(folders, function(folder, cb) {
            mkdirp(folder, function (err) {
                cb(err);
            });
        },function(err) {
            next(err);
        });

    }

    bosco.log('Run each microservice ... ');

    async.series([ensurePM2, initialiseRunners, getRunningServices, getStoppedServices, stopNotRunningServices, startRunnableServices, disconnectRunners], function(err) {
        if (err) {
            bosco.error(err);
            if (cb) cb();

            return;
        }

        bosco.log('All services started.');
        if(_.contains(args, 'cdn')) {
            var cdn = require('./cdn');
            cdn.cmd(bosco, [], function() {});
        } else {
            if(cb) return cb();
        }
    })

}
