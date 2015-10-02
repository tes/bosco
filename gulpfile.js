var gulp = require('gulp');
var markedMan = require('gulp-marked-man');
var fs = require('fs');

gulp.task('default', function() {

  fs.readdir('./help', function(err, files) {
    files.forEach(function(file) {
      gulp.src('./help/' + file)
        .pipe(markedMan())
        .pipe(gulp.dest('./man/man3'));
    });
  });

});
