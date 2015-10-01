/**
 * Core bosco libraries
 */

var _ = require('lodash');
var async = require('async');
var events = require('events');
var fs = require('fs');
var knox = require('knox');
var mkdirp = require('mkdirp');
var path = require('path');
var progress = require('progress');
var prompt = require('prompt');
var request = require('request');
var semver = require('semver');
var sf = require('sf');
var Table = require('cli-table');
var util = require('util');
var osenv = require('osenv');

prompt.message = 'Bosco'.green;

function Bosco() {}
util.inherits(Bosco, events.EventEmitter);
module.exports = Bosco;

Bosco.prototype.init = function(options) {

    var self = this;

    self._defaults = {
        _defaultConfig: [__dirname, 'config/bosco.json'].join('/')
    };

    self.options = _.defaults(_.clone(options), self._defaults);

    // Load base bosco config from home folder unless over ridden with path
    self.options.configPathSet = options.configPath ? true : false;
    self.options.configPath = options.configPath ? path.resolve(options.configPath) : [self.findHomeFolder(), '.bosco'].join('/');
    self.options.configFile = options.configFile ? path.resolve(options.configFile) : [self.options.configPath, 'bosco.json'].join('/');
    self.options.defaultsConfigFile = [self.options.configPath, 'defaults.json'].join('/');

    self.options.cpus = require('os').cpus().length;
    self.options.inService = false;

    self.config = require('nconf');
    self.prompt = prompt;
    self.progress = progress;

    self.concurrency = {
        network: self.options.cpus * 4, // network constrained
        cpu: self.options.cpus // cpu constrained
    }

    events.EventEmitter.call(this);

    self.run();

}

Bosco.prototype.run = function() {

    var self = this;

    self._init(function(err) {

        self._checkVersion();

        if (err) { return console.log(err); }

        var quotes, quotePath = self.config.get('quotes') || './quotes.json';
        try {
            quotes = require(quotePath);
        } catch (ex) {
            console.log('Failed to load quotes: ' + quotePath);
        }
        if (quotes) {
            self.log(quotes[Math.floor(Math.random() * quotes.length)].blue);
        }

        // Workspace found by reverse lookup in config - github team >> workspace.
        self.options.workspace = self.findWorkspace();
        self.options.workspaceConfigPath = [self.options.workspace, '.bosco'].join('/');

        // Environment config files are only ever part of workspace config
        self.options.envConfigFile = [self.options.workspaceConfigPath, self.options.environment + '.json'].join('/');

        // Now load the environment specific config
        self.config.add('env-override', { type: 'file', file: self.options.envConfigFile });

        var aws = self.config.get('aws');
        if (aws && aws.key) {
            self.knox = knox.createClient({
                key: aws.key,
                secret: aws.secret,
                bucket: aws.bucket,
                region: aws.region
            });
        }

        self.staticUtils = require('./src/StaticUtils')(self);

        self.checkInService();

        var teamDesc = self.getTeam() || 'Outside workspace!';
        self.log('Initialised using [' + self.options.configFile.magenta + '] in environment [' + self.options.environment.green + '] with team [' + teamDesc.cyan + ']');
        self._cmd();

    });
}

Bosco.prototype._init = function(next) {

    var self = this;

    var loadConfig = function() {
        self.config.env()
            .file({
                file: self.options.configFile
            })
            .file('defaults', {
                file: self.options.defaultsConfigFile
            });
    }

    self._checkConfig(function(err, initialise) {

        if (err) return;

        loadConfig();

        if (initialise) {
            self._initialiseConfig(function(err) {
                if (err) return;
                next();
            });
        } else {
            if (!self.config.get('github:user')) {
                self.error('It looks like you are in a micro service folder or something is wrong with your config?\n');
                next('Exiting - no available github configuration.');
            } else {
                next();
            }
        }

    });

}

Bosco.prototype._checkConfig = function(next) {

    var self = this,
        defaultConfig = self.options._defaultConfig,
        configPath = self.options.configPath,
        configFile = self.options.configFile;

    var checkConfigPath = function(cb) {
        if (self.exists(configPath)) return cb();
        mkdirp(configPath, cb);
    }

    var checkConfig = function(cb) {
        if (self.exists(configFile)) return cb();

        prompt.start();
        prompt.get({
            properties: {
                confirm: {
                    description: 'This looks like the first time you are using Bosco, do you want to create a new configuration file in your home folder (y/N)?'.white
                }
            }
        }, function(err, result) {
            if (!result || (result.confirm != 'Y' && result.confirm != 'y')) {
                return cb({
                    message: 'Did not confirm'
                });
            }

            var content = fs.readFileSync(defaultConfig);
            fs.writeFileSync(configFile, content);
            cb(null, true);
        });
    }

    async.series([checkConfigPath, checkConfig], function(err, result) {
        next(err, result[1]);
    });
}

Bosco.prototype._initialiseConfig = function(next) {

    var self = this;
    prompt.start();

    prompt.get({
        properties: {
            githubUser: {
                description: 'Enter your github user name'.white
            },
            authToken: {
                description: 'Enter the auth token (see: https://github.com/blog/1509-personal-api-tokens)'.white
            }
        }
    }, function(err, result) {
        if(err) {
            return self.error('There was an error during setup: ' + err.message.red);
        }
        self.config.set('github:user', result.githubUser);
        self.config.set('github:authToken', result.authToken);
        console.log('\r');
        self.config.save(next);
    });
};

Bosco.prototype._cmd = function() {

    var self = this,
        args = self.options.args,
        command = args.shift(),
        globalCommandModule = [self.getGlobalCommandFolder(), command, '.js'].join(''),
        localCommandModule = [self.getLocalCommandFolder(), command, '.js'].join(''),
        commandModule,
        module;

    if (self.exists(localCommandModule)) {
        commandModule = localCommandModule;
    }

    if (self.exists(globalCommandModule)) {
        if (commandModule) {
            self.warn('global command ' + globalCommandModule + ' overriding local command ' + localCommandModule);
        }
        commandModule = globalCommandModule;
    }

    if (commandModule) {
        module = require(commandModule);
    }

    if (module) {
        return module.cmd(self, args, function(err) {
            var code = 0;
            if (err) {
              code = 1;
              if (err.code > 0) code = err.code;
            }
            process.exit(code);
        });
    }

    if (self.options.shellCommands) return self._shellCommands();

    self._commands();
}

Bosco.prototype._shellCommands = function() {

    var self = this,
        cmdPath = self.getGlobalCommandFolder(),
        localPath =  self.getLocalCommandFolder();

    var showCommands = function(cPath, files, next) {
        var cmdString = '';
        files.forEach(function(file) {
            cmdString += file.replace('.js', '') + ' ';
        });
        next(null, cmdString.split(' '));
    }

    async.series([

            function(next) {
                fs.readdir(cmdPath, function(err, files) {
                    showCommands(cmdPath, files, next)
                })
            },
            function(next) {
                fs.readdir(localPath, function(err, files) {
                    if (!files || files.length === 0) return next();
                    showCommands(localPath, files, next);
                })
            }
        ],
        function(err, files) {
            files = _.uniq(_.flatten(files));
            console.log('Available commands: ' + files.join(' '));
            process.exit(0);
        });
}

Bosco.prototype._commands = function() {

    var self = this,
        cmdPath = self.getGlobalCommandFolder(),
        localPath =  self.getLocalCommandFolder();

    var showTable = function(tableName, cPath, files, next) {

        var table = new Table({
            chars: {'mid': '', 'left-mid': '', 'mid-mid': '', 'right-mid': ''},
            head: [tableName, 'Example'],
            colWidths: [12, 80]
        });

        var showCommand = function(cmd) {
            table.push([cmd.name, cmd.example || '']);
        }

        if (cPath) {
            files = files.map(function(file) {
            return path.join(cPath, file);
            }).filter(function(file) {
                return fs.statSync(file).isFile();
            }).forEach(function(file) {
                if (path.extname(file) !== '.js') { return null; }
                showCommand(require(file));
            });
        } else {
            files.forEach(function(file) {
                showCommand(file);
            });
        }

        console.log(table.toString());
        console.log('\r');
        next();
    }

    console.log('\r');
    self.warn('Hey, to use bosco, you need to enter one of the following commands:')

    async.series([

            function(next) {
                fs.readdir(cmdPath, function(err, files) {
                    showTable('Core', cmdPath, files, next)
                })
            },
            function(next) {
                fs.readdir(localPath, function(err, files) {
                    if (!files || files.length === 0) return next();
                    showTable('Local', localPath, files, next)
                })
            },
            function(next) {
                var wait = function() {
                    if (self._checkingVersion) {
                        setTimeout(wait, 100);
                    } else {
                        next();
                    }
                }
                wait();
            },
            function(next) {
                console.log('You can also specify these parameters:')
                console.log(self.options.program.help());
                next();
            }
        ],
        function() {
            // Do nothing
        });


}

Bosco.prototype._checkVersion = function() {
    // Check the version in the background
    var self = this;
    self._checkingVersion = true;
    var npmUrl = 'http://registry.npmjs.org/bosco';
    request({
        url: npmUrl,
        timeout: 1000
    }, function(error, response, body) {
        if (!error && response.statusCode == 200) {
            var jsonBody = JSON.parse(body);
            var version = jsonBody['dist-tags'].latest;
            if (semver.lt(self.options.version, version)) {
                self.error('There is a newer version (Local: ' + self.options.version.yellow + ' < Remote: ' + version.green + ') of Bosco available, you should upgrade!');
                console.log('\r');
            }
        }
        self._checkingVersion = false;
    });
}

Bosco.prototype.findHomeFolder = function() {
    return osenv.home() || process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE;
}

Bosco.prototype.findWorkspace = function() {
    for (var p = path.resolve('.');; p = path.resolve(p, '..')) {
        if (this.exists(path.join(p, '.bosco'))) return p;
        if (p === '/') break;
    }
    return path.resolve('.');
}

Bosco.prototype.getWorkspacePath = function() {
    var self = this;
    return self.options.workspace;
}

Bosco.prototype.getTeam = function() {
    var self = this;
    var teamConfig = self.config.get('teams'), currentTeam;
    _.keys(teamConfig).forEach(function(team) {
        if(teamConfig[team].path === self.options.workspace) {
            currentTeam = team;
        }
    });
    return currentTeam || 'no-team';
}

Bosco.prototype.getRepos = function() {
    var self = this;
    var team = self.getTeam();
    if(team == 'no-team') {
        return [path.relative('..','.')]
    } else {
        return self.config.get('teams:' + team).repos;
    }
}

Bosco.prototype.getOrg = function() {
    var self = this;
    var teamConfig = self.config.get('teams'), currentOrg = '';
    _.keys(teamConfig).forEach(function(team) {
        if(teamConfig[team].path === self.options.workspace) {
            currentOrg = team.split('/')[0];
        }
    });
    return currentOrg;
}

Bosco.prototype.getOrgPath = function() {
    return path.resolve(this.getWorkspacePath());
}

Bosco.prototype.getRepoPath = function(repo) {
    // Strip out / to support full github references
    var repoName;
    if (repo.indexOf('/') < 0) {
        repoName = repo;
    } else {
        repoName = repo.split('/')[1];
    }
    return [path.resolve(this.getWorkspacePath()), repoName].join('/');
}

// Additional exports
Bosco.prototype.getGlobalCommandFolder = function() {
    return [__dirname, '/', 'commands', '/'].join('');
}

Bosco.prototype.getLocalCommandFolder = function() {
    var self = this,
        workspace = self.options && self.options.workspace ? self.options.workspace : self.findWorkspace();
    return [workspace, '/', 'commands', '/'].join('');
}

Bosco.prototype.getRepoUrl = function(repo) {
    var org;
    var host     = this.config.get('github:hostname') || 'github.com';
    var hostUser = this.config.get('github:hostUser') || 'git';
    host         = hostUser + '@' + host + ':';

    if (repo.indexOf('/') < 0) {
        org = this.getOrg() + '/';
    }
    return [host, org ? org : '', repo, '.git'].join('');
}

Bosco.prototype.isLocalCdn = function () {
    return !this.config.get('aws:cdn');
};

Bosco.prototype.getCdnUrl = function () {
    if (!this.isLocalCdn()) {
        return this.config.get('aws:cdn');
    }

    var cdnPort = this.config.get('cdn:port') || '7334';
    var cdnHostname = this.config.get('cdn:hostname') || 'localhost';

    return 'http://'+ cdnHostname +':' + cdnPort;
};

Bosco.prototype.getBaseCdnUrl = function () {
    var baseUrl = this.getCdnUrl();

    if (baseUrl.substr(-1) === '/') {
        baseUrl = baseUrl.substr(0, baseUrl.length - 1);
    }

    if (!this.isLocalCdn()) {
        baseUrl += '/' + this.options.environment;
    }

    return baseUrl;
}

Bosco.prototype.getAssetCdnUrl = function (assetUrl) {
    var baseUrl = this.getBaseCdnUrl();

    if (assetUrl.substr(0, 1) === '/') {
        assetUrl = assetUrl.substr(1);
    }

    return baseUrl + '/' + assetUrl;
}

Bosco.prototype.checkInService = function() {
    var self = this, cwd = path.resolve('bosco-service.json');
    if(self.exists(cwd) && self.options.service) {
        self.options.inService = true;
        self.options.workspace = path.resolve('..');
        // Replace getRepos
        self.getRepos = function() {
            return [path.relative('..','.')];
        }
    }
}

Bosco.prototype.warn = function(msg, args) {
    this._log('Bosco'.yellow, msg, args);
}

Bosco.prototype.log = function(msg, args) {
    this._log('Bosco'.cyan, msg, args);
}

Bosco.prototype.error = function(msg, args) {
    this._log('Bosco'.red, msg, args);
}

Bosco.prototype._log = function(identifier, msg, args) {
    var parts = {
        identifier: identifier,
        time: new Date(),
        message: args ? sf(msg, args) : msg
    };
    console.log(sf('[{time:hh:mm:ss}] {identifier}: {message}', parts));
}

Bosco.prototype.console = global.console;

Bosco.prototype.exists = function(path) {
    return fs.existsSync(path);
}
