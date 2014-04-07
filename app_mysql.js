/* Copyright IBM Corp. 2013 All Rights Reserved                      */
/* jslint node:true*/

var http = require('http');
var path = require('path');
var express = require('express');
var hogan = require('hogan-express');
var mysql = require('mysql');
var fs = require('fs');

var port = (process.env.VCAP_APP_PORT || 3000);
var host = (process.env.VCAP_APP_HOST || 'localhost');

// all environments
var app = express();

// check if application is being run in cloud environment
if (process.env.VCAP_SERVICES) {
	var services = JSON.parse(process.env.VCAP_SERVICES);

	// look for a service starting with 'mysql'
	for (var svcName in services) {
		if (svcName.match(/^mysql/)) {
			var mysqlCreds = services[svcName][0]['credentials'];
			var db = mysql.createConnection({
				host: mysqlCreds.host,
				port: mysqlCreds.port,
				user: mysqlCreds.user,
				password: mysqlCreds.password,
				database: mysqlCreds.name
			});

			createTable();
		}
	}
}

app.set('port', port);
app.set('views', __dirname + '/views');
app.set('view engine', 'html');
app.set('env', 'development');
app.engine('html', hogan);

app.use(express.favicon(path.join(__dirname, 'public/images/favicon.ico')));
app.use(express.logger());
app.use(express.bodyParser());
app.use(express.methodOverride());
app.use(app.router);
app.use(express.static(path.join(__dirname, 'public')));

// development only
if ('development' == app.get('env')) {
	app.use(express.errorHandler());
}

// show table
app.all('/', function (req, res) {
	getPosts(function (err, posts) {
		if (err) return res.json(err);
		res.render('index.html', {posts: posts});
	});
});


// show env
app.all('/showenv', function (req, res) {
		res.send(process.env);
});

// upload file
app.post('/upload', function (req, res) {
	//res.send(req.files);
	var filename = req.files.file.name;
	var filesize = req.files.file.size;
	var filetype = req.files.file.type;
	var filecontent = fs.readFileSync(req.files.file.path, 'base64');
	console.error('uploading ' + filename + ' - ' + filesize + ' - ' + filetype);
	
	
	// insert posts into mysql db
	addPosts(filename, filesize, filetype, filecontent, function (err, result) {
		if (err) return res.json(err);
		var msg = 'Added ' + result.affectedRows + ' rows.';

		// display all posts
		getPosts(function (err, posts) {
			if (err) return res.json(err);
			res.render('index.html', {posts: posts, msg: msg});
		});
	});

});

// clear table
app.get('/delete', function (req, res) {
	deletePosts(function (err, result) {
		if (err) return res.json(err);
		var msg = 'Deleted ' + result.affectedRows + ' rows.';
		res.render('index.html', {msg: msg});
	});
});

// get file
app.get('/file/:id', function (req, res) {
	var id = req.param("id");
	var sql = 'SELECT filename, filesize, filetype, filecontent FROM posts WHERE id = ' + db.escape(id);
	console.error('reading from db (query): ' + sql)
	db.query(sql, function (err, result) {

		//console.error('reading from db: ' + result[0].filecontent + ' err: ' + err)

		if (err) res.send(err);
		
		buf = new Buffer(result[0].filecontent, 'base64');
		
		
		res.setHeader('Content-Type', result[0].filetype);
		res.setHeader('Content-Length', result[0].filesize);
		res.end(buf);
	});

});

// start server
http.createServer(app).listen(app.get('port'), function () {
	console.log('Express server listening at http://' + host + ':' + port);
});

function createTable() {
	var sql = 'CREATE TABLE IF NOT EXISTS posts ('
						+ 'id INTEGER PRIMARY KEY AUTO_INCREMENT,'
						+ 'filename TEXT,'
						+ 'filesize INTEGER,'
						+ 'filetype TEXT,'
						+ 'filecontent longtext'
					+ ');'; 
	db.query(sql, function (err, result) {
		if (err) console.log(err);
	});
}

function getPosts(cb) {
	var sql = 'SELECT id, filename, filesize, filetype FROM posts';
	db.query(sql, function (err, result) {
		if (err) return cb(err);
		cb(null, result);
	});
}

function addPosts(filename, filesize, filetype, filecontent, cb) {
	var sql = 'INSERT INTO posts (filename, filesize, filetype, filecontent) VALUES ('
	+ db.escape(filename) + ', '
	+ db.escape(filesize) + ', '
	+ db.escape(filetype) + ', "'
	+ filecontent + '");';
	
	//console.error('inserting ' + filename + ' . ' + content);
	//console.error('inserting sql ' + sql);
	
	db.query(sql, function (err, result) {
		if (err) return cb(err);
		cb(null, result);
	});
}

function deletePosts(cb) {
	var sql = 'DROP TABLE posts';
	db.query(sql, function (err, result) {
		if (err) return cb(err);
		cb(null, result);
	});
	createTable();
}

function isNotEmpty(str) {
	return str && str.trim().length > 0;
}
