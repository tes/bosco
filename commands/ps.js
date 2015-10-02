
var async = require('async');
var Table = require('cli-table');
var _ = require('lodash');
var NodeRunner = require('../src/RunWrappers/Node');
var DockerRunner = require('../src/RunWrappers/Docker');
var nodeList = [];
var dockerList = [];

module.exports = {
    name:'ps',
    description:'Lists all running services',
    cmd:cmd
}

function cmd(bosco) {

    var initialiseRunners = function(next) {
        var runners = [NodeRunner, DockerRunner];
        async.map(runners, function loadRunner(runner, cb) {
            runner.init(bosco, cb);
        }, next);
    }

    var getRunningServices = function(next) {
        NodeRunner.listRunning(true, function(err, nodeRunning) {
            if (err) return next(err);
            nodeList = nodeRunning;
            DockerRunner.list(true, function(err, dockerRunning) {
                if (err) return next(err);
                dockerList = dockerRunning;
                next();
            })
        })
    }

    var printNodeServices = function(name, list) {

        var table = new Table({
            chars: {'mid': '', 'left-mid': '', 'mid-mid': '', 'right-mid': ''},
            head: [name + ' Service', 'PID', 'Status', 'Mode', 'Watch'], colWidths: [60,10,10,12,10]
        });

        list.forEach(function(item) {
            table.push([item.name, item.pid, item.pm2_env.status, item.pm2_env.exec_mode, item.pm2_env.watch || '']);
        });

        console.log(table.toString());
        console.log('\r');

    }

    var printDockerServices = function(name, list) {

        var table = new Table({
            chars: {'mid': '', 'left-mid': '', 'mid-mid': '', 'right-mid': ''},
            head: [name + ' Service', 'Status', 'FQN'], colWidths: [25,20,60]
        });

        list.forEach(function(item) {
            table.push([
                       _.map(item.Names, function(item) { return item.replace('/',''); }).join(', '),
                       item.Status,
                       item.Image
                    ]);
        });

        console.log(table.toString());
        console.log('\r');

    }

    bosco.log('Getting running microservices ...');

    async.series([initialiseRunners, getRunningServices], function() {

        console.log('');
        bosco.log('Running NodeJS Services (via PM2):');
        printNodeServices('Node', nodeList);

        bosco.log('Running Docker Images:');
        printDockerServices('Docker', dockerList);

        process.exit(0);
    })

}

