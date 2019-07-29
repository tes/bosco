var gulp = require('gulp');
var marked = require('marked-man');
var through = require('through2');

/** Copied from https://github.com/jsdevel/gulp-marked-man
 *  Copyright (c) 2014 Joseph Spencer
 */
function markedMan() {
  var stream = through.obj(function (file, enc, callback) {
    if (file.isBuffer()) {
      file.contents = new Buffer(marked(file.contents.toString('utf8')));
    }

    file.extname = '';

    this.push(file);

    callback();
  });

  return stream;
}

gulp.task('default', function () {
  return gulp.src('./help/*.md')
    .pipe(markedMan())
    .pipe(gulp.dest('./man'));
});
