
var _ = require('lodash');
var async = require('async');
var fs = require('fs');
var http = require('http');
var pm2 = require('pm2');

module.exports = {
	name:'run',
	description:'Runs all of the microservices (or subset based on regex pattern) using pm2',
	example:'bosco run <pattern>',
	cmd:cmd
}

function cmd(bosco, args) {

	var repoPattern = args.shift() || '.*';
	var repoRegex = new RegExp(repoPattern);
	var repos = bosco.config.get('github:repos');
	var runningServices = {};

	// Connect or launch PM2
	pm2.connect(function(err) {

		var startRunnableServices = function(running) {			
			async.map(repos, function(repo, next) {				
				var boscoService, basePath, repoPath = bosco.getRepoPath(repo), boscoJson = [repoPath,"bosco-service.json"].join("/");
				if(repo.match(repoRegex) && bosco.exists(boscoJson)) {
					boscoService = require(boscoJson);
					if(_.contains(running, repo)) {
						bosco.warn(repo + " already running, use 'bosco stop " + repo + "'");
						return next();
					}					
					if(boscoService.scripts) {
						runService(repo, boscoService.scripts, repoPath, next);
					} else {
						next();
					}
				} else {
					next();
				}

			}, function(err) {				
				process.exit(0);
			});

		}

		var getRunningServices = function(next) {
			pm2.list(function(err, list) {
				next(err, _.pluck(list,'name'));				
			});
		}

		var runService = function(repo, scripts, repoPath, next) {
			bosco.log("Starting " + repo + " @ " + repoPath + " via " + scripts.start.blue);
			run(repo, scripts, repoPath, next);
		}

		var run = function(repo, scripts, repoPath, next) {				
			pm2.start(scripts.start, { name: repo, cwd: repoPath, watch: true, executeCommand: scripts.isCommand}, next);
		}

		bosco.log("Run each mircoservice " + args);

		getRunningServices(function(err, running) {
			startRunnableServices(running);	
		});

	});

}
	