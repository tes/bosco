const _ = require('lodash');

module.exports = {
  name: 's3delete',
  description: 'Deletes a published asset set from S3',
  usage: '[-e <environmment>] <build>',
};

function cmd(bosco, args) {
  if (!bosco.knox) bosco.error('You don\'t appear to have any S3 config for this environment?');
  const toDelete = args[0] || 'Not specified';

  function confirm(message, next) {
    bosco.prompt.start();
    bosco.prompt.get({
      properties: {
        confirm: {
          description: message,
        },
      },
    }, (err, result) => {
      if (!result) return next({ message: 'Did not confirm' });
      if (result.confirm === 'Y' || result.confirm === 'y') {
        next(null, true);
      } else {
        next(null, false);
      }
    });
  }

  bosco.knox.list({ prefix: `${bosco.options.environment}/${toDelete}` }, (listErr, data) => {
    const files = _.map(data.Contents, 'Key');
    if (files.length === 0) return bosco.error('There doesn\'t appear to be any files matching that push.');

    confirm(`${'Are you sure you want to delete '.white + (`${files.length}`).green} files in push ${toDelete.green}?`, (confirmErr, confirmed) => {
      if (confirmErr || !confirmed) return;
      bosco.knox.deleteMultiple(files, (deleteErr, res) => {
        if (deleteErr) return bosco.error(deleteErr.message);
        if (res.statusCode === '200') {
          bosco.log(`Completed deleting ${toDelete.blue}`);
        }
      });
    });
  });
}

module.exports.cmd = cmd;
