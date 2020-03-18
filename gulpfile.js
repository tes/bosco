/* eslint-disable */
const gulp = require('gulp');
const marked = require('marked-man');
const through = require('through2');

/** Copied from https://github.com/jsdevel/gulp-marked-man
 *  Copyright (c) 2014 Joseph Spencer
 */
function markedMan() {
  const stream = through.obj(function (file, enc, callback) {
    if (file.isBuffer()) {
      file.contents = Buffer.from(marked(file.contents.toString('utf8')));
    }

    file.extname = '';

    this.push(file);

    callback();
  });

  return stream;
}

gulp.task('default', () => gulp.src('./help/*.md')
  .pipe(markedMan())
  .pipe(gulp.dest('./man')));
