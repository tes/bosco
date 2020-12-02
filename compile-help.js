/* eslint-disable import/no-extraneous-dependencies,no-param-reassign */
const glob = require('glob');
const man = require('remark-man');
const markdown = require('remark-parse');
const unified = require('unified');
const vfile = require('to-vfile');

glob('./help/*.md', (errGlob, files) => {
  if (errGlob) throw errGlob;

  files.forEach((name) => unified()
    .use(markdown)
    .use(man)
    .process(vfile.readSync(name), (err, file) => {
      if (err) throw err;
      file.dirname = 'man';
      file.extname = '';
      vfile.writeSync(file);
    }));
});
