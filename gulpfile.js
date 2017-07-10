var gulp = require('gulp');
var args = require('yargs').argv;
var browserSync = require('browser-sync');
var config = require('./gulp.config')();
var del = require('del');
var $ = require('gulp-load-plugins')({lazy: true});
var port = process.env.PORT || config.defaultPort;

gulp.task('help', $.taskListing);
gulp.task('default', ['help']);

gulp.task('vet', function() {
    log('Analyzing source with JSHint and JSCS...');
    return gulp
    .src(config.alljs)
    .pipe($.if(args.verbose, $.print()))
    .pipe($.jscs())
    .pipe($.jshint())
    .pipe($.jshint.reporter('jshint-stylish', {verbose: true}))
    .pipe($.jshint.reporter('fail'));
});

gulp.task('styles', ['clean-styles'], function() {
    log('Compiling Less --> CSS');

    return gulp
        .src(config.less)
        .pipe($.plumber())
        .pipe($.less())
        .pipe($.autoprefixer({browsers:['last 2 version', '> 5%']}))
        .pipe(gulp.dest(config.temp));
});

gulp.task('fonts', ['clean-fonts'], function() {
    log('Copying fonts...');

    return gulp
        .src(config.fonts)
        .pipe(gulp.dest(config.build + 'fonts'));
});


gulp.task('images', ['clean-images'], function() {
    log('Copying and compressing the images...');

    return gulp
        .src(config.images)
        .pipe($.imagemin({optimizationLevel: 4}))
        .pipe(gulp.dest(config.build + 'images'));
});

gulp.task('clean', function() {
    var delconfig = [].concat(config.build, config.temp);
    log('Cleaning: ' + $.util.colors.blue(delconfig));
    del(delconfig);
});


gulp.task('clean-fonts', function() {
    return clean(config.build + 'fonts/**/*.*');
});


gulp.task('clean-images', function() {
    return clean(config.build + 'images/**/*.*');
});

//not returning stream but a promise from del
gulp.task('clean-styles', function() {
    return clean(config.temp + '**/*.css');
});


gulp.task('clean-code', function() {
    var files = [].concat(
        config.temp + '**/*.js',
        config.build + '**/*.html',
        config.build + 'js/**/*.js'
    );
    return clean(files);
});


gulp.task('less-watcher', function() {
    gulp.watch([config.less], ['styles']);
});

gulp.task('templatecache', ['clean-code'], function(){
    log('Creating AngularJS $templateCache');

    return gulp
        .src(config.htmltemplates)
        .pipe($.minifyHtml({empty: true}))
        .pipe($.angularTemplatecache(
            config.templateCache.file,
            config.templateCache.options
        ))
        .pipe(gulp.dest(config.temp));
});

//called by bower postinstall so needs to be fast
gulp.task('wiredep', function() {
    log('Wire up the bower css js and our app js into the html');
    var options = config.getWiredepDefaultOptions();
    var wiredep = require('wiredep').stream;
    return gulp
        .src(config.index)
        .pipe(wiredep(options))
        .pipe($.inject(gulp.src(config.js)))
        .pipe(gulp.dest(config.client));
});

gulp.task('inject', ['wiredep', 'styles', 'templatecache'], function() {
    log('Wire up the app css into the html, and call wiredep');

    return gulp
        .src(config.index)
        .pipe($.inject(gulp.src(config.css)))
        .pipe(gulp.dest(config.client));
});


gulp.task('optimize', ['inject'], function(){
    log('Optimizing the javascript, css, html');

    var assets = $.useref({searchPath: './'});
    var templateCache = config.temp + config.templateCache.file;
    var cssFilter = $.filter('**/*.css', { restore: true });
    var jsLibFilter = $.filter('**/' + config.optimized.lib, { restore: true });
    var jsAppFilter = $.filter('**/' + config.optimized.app, { restore: true });
    var notIndexFilter = $.filter(['**/*', '!**/index.html'], { restore: true });

    //note change to to v3 of gulp-useref
    return gulp
        .src(config.index)
        .pipe($.plumber())
        .pipe($.inject(gulp.src(templateCache, {read: false}), {
            starttag: '<!-- inject:templates:js -->'
        }))
        .pipe(assets)
        .pipe(cssFilter)
        .pipe($.csso())
        .pipe(cssFilter.restore)
        .pipe(jsLibFilter)
        .pipe($.uglify())
        .pipe(jsLibFilter.restore)
        .pipe(jsAppFilter)
        .pipe($.ngAnnotate())
        .pipe($.uglify())
        .pipe(jsAppFilter.restore)
        .pipe(notIndexFilter)
        .pipe($.rev())
        .pipe(notIndexFilter.restore)
        .pipe($.revReplace())
        .pipe($.rev.manifest())
        .pipe(gulp.dest(config.build));
});

gulp.task('serve-build', ['optimize'], function(){
    serve(false /* isDev */);
});


gulp.task('serve-dev', ['inject'], function() {
    serve(true /* isDev */);
});

/////////////////////////
function serve(isDev) {
    var nodeOptions = {
        script: config.nodeServer,
        delayTime: 1,
        env: {
            'PORT': port,
            'NODE_ENV': isDev ? 'dev' : 'build'
        },
        watch: [config.server]
    };

    return $.nodemon(nodeOptions)
        .on('restart', function(evt){
            log('*** nodemon restarted');
            log('files changed on restart:\n' + evt);
            setTimeout(function() {
                browserSync.notify('reloading now...');
                browserSync.reload({stream: false});
            }, config.browserReloadDelay);
        })
        .on('start', function(evt){
            log('*** nodemon started');
            startBrowserSync(isDev);
        })
        .on('crash', function(evt){
            log('*** nodemon crashed: script crashed for some reason');
        })
        .on('exit', function(evt){
            log('*** nodemon exited cleanly');
        }); 
}

function changeEvent(event) {
    var srcPattern = new RegExp('/.*(?=/' + config.source + ')/');
    log('File ' + event.path.replace(srcPattern, '') + ' ' + event.type);
}


function startBrowserSync(isDev) {
    if (args.nosync || browserSync.active) {
        return;
    }
    log('Starting browser-sync on port ' + port );

    if (isDev) {
        gulp.watch([config.less], ['styles'])
            .on('change', function(event) { changeEvent(event)})
    } else {
        gulp.watch([config.less, config.js, config.html], ['optimize', browserSync.reload])
            .on('change', function(event){ changeEvent(event); });
    }

    var options = {
        proxy: 'localhost:' + port,
        port: 3000,
        files: isDev ? [
            config.client + '**/*.*',
            '!' + config.less,
            config.temp + '**/*.css'
        ] : [],
        ghostMode: {
            clicks: true,
            location: false,
            forms: true,
            scroll: true
        },
        injectChanges: true,
        logFileChanges: true,
        logLevel: 'debug',
        logPrefix: 'gulp-patterns',
        notify: true,
        reloadDelay: 1000
    };

    browserSync(options);
};


function errorLogger(error) {
    log('*** Start of Error ***');
    log(error);
    log('*** End of Error ***');
    this.emit('end');
}

function clean(path) {
    log('Cleaning: ' + $.util.colors.blue(path));
    return del(path);
}

function log(msg) {
    if (typeof(msg) === 'object') {
        for (var item in msg) {
            if (msg.hasOwnProperty(item)) {
                $.util.log($.util.colors.blue(msg[item]));
            }
        }
    } else {
        $.util.log($.util.colors.blue(msg));
    }
}