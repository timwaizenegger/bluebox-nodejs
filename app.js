/* Copyright IBM Corp. 2013 All Rights Reserved                      */
/* jslint node:true*/

var http = require('http');
var path = require('path');
var express = require('express');
var hogan = require('hogan-express');
var mysql = require('mysql');
var redis = require('redis');
var passport = require('passport');
var LocalStrategy = require('passport-local').Strategy;
//var MongoStore = require('connect-mongo')(express);
//var RedisStore = require('connect-redis')(express);
var mongo = require('mongodb');

var fs = require('fs');

var port = (process.env.VCAP_APP_PORT || 3000);
var host = (process.env.VCAP_APP_HOST || 'localhost');
// all environments

////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
// Get Env Credentials
// check if application is being run in cloud environment
if (process.env.VCAP_SERVICES) {
	var services = JSON.parse(process.env.VCAP_SERVICES);
	
	// look for mysql credentials
	var mysqlCredentials = services['mysql-5.5'][0]['credentials'];
	if (!mysqlCredentials ) console.error("ERRROR: could not get mysql credentials"), process.exit(1);
	var db = mysql.createConnection({
		host: mysqlCredentials.host,
		port: mysqlCredentials.port,
		user: mysqlCredentials.user,
		password: mysqlCredentials.password,
		database: mysqlCredentials.name
	});
	createTable();
	
	// look for redis service credentials
	var redisCredentials = services['redis-2.6'][0]['credentials'];
	if (!redisCredentials ) console.error("ERRROR: could not get redis credentials"), process.exit(1);
	var redisClient = redis.createClient(redisCredentials.port, redisCredentials.host);
	redisClient.auth(redisCredentials.password);
	
	// look for twilio credentials
	var twilioCredentials;
	for (var key in services){
		cs = services[key][0];
		if (cs['name'] == 'twilio') twilioCredentials = cs['credentials'];
	}
	if (!twilioCredentials ) console.error("ERRROR: could not get twilio credentials"), process.exit(1);
	console.error(twilioCredentials);
	var twilio = require('twilio')(twilioCredentials.accountSID, twilioCredentials.authToken);
	var twilioMyNumber = '+18022824507';
	
	var mongoCredentials = services['mongodb-2.2'][0].credentials;
	//mongoCredentials.auto_reconnect = "true";
	mongoInitUsers();
}



////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////






var app = express();

app.set('port', port);
app.set('views', __dirname + '/views');
app.set('view engine', 'html');
app.set('env', 'development');
app.engine('html', hogan);


app.use(express.favicon(path.join(__dirname, 'public/images/favicon.ico')));
app.use(express.logger());
app.use(express.bodyParser());
app.use(express.methodOverride());

app.use(express.cookieParser('SECRET'));
app.use(express.cookieSession());

//app.use(express.session({
//	store: new RedisStore({
//		client: redisSessionClient
//	}),
//	secret: '123456'
//}));

//app.use(express.session({secret: "123456"}));
//app.use(express.session({
//	secret: "123456",
//	store: new MongoStore(mongoCredentials)
//	}));

app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname, 'public')));

app.use(app.router);


////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
// User management
//var users = [
//    { id: 1, username: 'tim', password: 'tim', email: 'asdasd' }
//  , { id: 2, username: 'matthias', password: 'matthias', email: 'asdassda' }
//  , { id: 3, username: 'guest', password: 'guest', email: 'asdassda' }
//];

//function findById(id, fn) {
//  var idx = id - 1;
//  if (users[idx]) {
//    fn(null, users[idx]);
//  } else {
//    fn(new Error('User ' + id + ' does not exist'));
//  }
//}

//function findByUsername(username, fn) {
//  for (var i = 0, len = users.length; i < len; i++) {
//    var user = users[i];
//    if (user.username === username) {
//      return fn(null, user);
//    }
//  }
//  return fn(null, null);
//}

// Passport session setup.
//   To support persistent login sessions, Passport needs to be able to
//   serialize users into and deserialize users out of the session.  Typically,
//   this will be as simple as storing the user ID when serializing, and finding
//   the user by ID when deserializing.
passport.serializeUser(function(user, done) {
  //done(null, user.id);
  done(null, user._id);
});

passport.deserializeUser(function(id, done) {
  //findById(id, function (err, user) {
  mongoFindUserById(id, function (err, user) {
    done(err, user);
  });
});


passport.use(new LocalStrategy(
  function(username, password, done) {
    // asynchronous verification, for effect...
    process.nextTick(function () {
      
      // Find the user by username.  If there is no user with the given
      // username, or the password is not correct, set the user to `false` to
      // indicate failure and set a flash message.  Otherwise, return the
      // authenticated `user`.
      //findByUsername(username, function(err, user) {
      mongoFindUserByUsername(username, function(err, user) {
        if (err) { return done(err); }
        if (!user) { return done(null, false, { message: 'Unknown user ' + username }); }
        if (user.password != password) { return done(null, false, { message: 'Invalid password' }); }
        return done(null, user);
      })
    });
  }
));

////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////


// start initial disposal run
setTimeout(disposalSweep, 10000);
////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

// development only
if ('development' == app.get('env')) {
	app.use(express.errorHandler());
}

// show table
app.all('/', ensureAuthenticated, function (req, res) {
	renderFileTable(null, null, req, res);
});

// Login
app.post('/login', function(req, res, next) {
  passport.authenticate('local', function(err, user, info) {
    if (err) { return next(err) }
    if (!user) {
      req.session.messages =  [info.message];
      return res.redirect('/login');
    }
    req.logIn(user, function(err) {
      if (err) { return next(err); }
      req.session.messages =  [];
      return res.redirect('/');
    });
  })(req, res, next);
});

app.get('/login', function(req, res){
	var msg;
	if (req.session) msg = req.session.messages;
	res.render('login.html', {message : msg});
});

// logout
app.get('/logout', ensureAuthenticated, function(req, res){
  req.logout();
  res.redirect('/');
});

// check authentication
function ensureAuthenticated(req, res, next) {
	console.error("checking auth...");
	if (req.isAuthenticated()) {console.error("... authenticated"); return next(); }
	console.error("... not authenticated");
	res.redirect('/login');
}
////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

// test
app.all('/mongot', function (req, res) {
		mongoInitUsers();
		res.send("ok");
});
// kill this instance
app.all('/killinstance', function (req, res) {
		process.exit(1);
});
// show env
app.all('/showenv', function (req, res) {
		res.send(process.env);
});
// call sweep
app.all('/sweep', ensureAuthenticated, function (req, res) {
	disposalSweep();
	res.send("ok");
});
// test twilio
app.all('/testsms', ensureAuthenticated, function (req, res) {
	twilio.sendMessage({
		to:'+491626895517',
		from: twilioMyNumber,
		body: 'hihihihi'
	}, function(err, responseData) {
		if (err) console.error(JSON.stringify(err)), res.send(JSON.stringify(err));
		res.send(JSON.stringify(responseData));
	});
});
// show redis info
app.all('/redisinfo', function (req, res) {
		res.send(redisClient.server_info);
});
// show redis info
app.all('/redisflushdb', ensureAuthenticated, function (req, res) {
	redisClient.flushdb();
	res.send("test");
});
////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
// XML-HTTP API

// search posts
app.post('/searchAPI', ensureAuthenticated, function (req, res) {
	var query = req.param("q");
	console.error("xhttp: " + query);
	searchEntries(query, function (results) {
		res.send(JSON.stringify(results));
	});
});

// get account list
app.get('/accountsAPI', ensureAuthenticated, function (req, res) {
	mongoGetAllAccounts(function(accounts){
		res.send(JSON.stringify(accounts));
	});
});

// new account
app.post('/accountsAPI', ensureAuthenticated, function (req, res) {
	var account = {
			username: req.param("username"),
			password: req.param("password"),
			email: req.param("email"),
			cellNumber: req.param("cellNumber")
	};
	
	mongoInsertAccount(account, function(){
		mongoGetAllAccounts(function(accounts){
			res.send(JSON.stringify(accounts));
		});
	});
});

// delete account
app.delete('/accountsAPI/:id', ensureAuthenticated, function (req, res) {
	var id = req.param("id");
	
	mongoDeleteAccount(id, function(){
		mongoGetAllAccounts(function(accounts){
			res.send(JSON.stringify(accounts));
		});
	});
});

////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
// HTML rendering

// upload file
app.post('/file', ensureAuthenticated, function (req, res) {
	//res.send(req);
	var filename = req.files.file.name;
	var filesize = req.files.file.size;
	var filetype = req.files.file.type;
	var retentionInterval = req.param("retentionInterval");
	var filecontent = fs.readFileSync(req.files.file.path, 'base64');
	console.error('uploading ' + filename + ' - ' + filesize + ' - ' + filetype + ' - ' + retentionInterval);
	
	addPosts(filename, filesize, filetype, filecontent, retentionInterval, req.user.username, function (err, result) {
		renderFileTable(err, 'upload successful, added file with ID ' + result.insertId, req, res);
	});

});

// delete everything
app.get('/delete', ensureAuthenticated, function (req, res) {
	deleteEverything(function (err, result) {
		renderFileTable(err, 'MySQL and Redis cleared', req, res);
	});
});

// get file
app.get('/file/:id', ensureAuthenticated, function (req, res) {
	var id = req.param("id");
	var sql = 'SELECT filename, filesize, filetype FROM posts WHERE id = ' + db.escape(id);
	console.error('reading from db (query): ' + sql)
	db.query(sql, function (err, result) {

		if (err) return new Error(err);
		
		console.error('redis get: ' + id);
		redisClient.get(id, function(err2, result2) {
			console.error('redis file load: ' + err2);// + ' - ' + result2);
			buf = new Buffer(result2, 'base64');
			res.setHeader('Content-Type', result[0].filetype);
			res.setHeader('Content-Length', result[0].filesize);
			res.attachment(result[0].filename);
			res.end(buf);
		});
	});

});

// delete individual file
// don't use /:id so we stay in / for other links to work...
app.get('/delfile', ensureAuthenticated, function (req, res) {
	var id = req.param("id");
	deletePost(id, function (err) {
		renderFileTable(err, 'Deleted file ID ' + id, req, res);
	});
	

});

// account overview
app.get('/accounts', ensureAuthenticated, function (req, res) {
	res.render('accounts.html', {user: req.user.username});
});

// start server
http.createServer(app).listen(app.get('port'), function () {
	console.log('Express server listening at http://' + host + ':' + port);
});

////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

function renderFileTable(err, msg, req, res) {
	if (err) return new Error(err);
	getPosts(function (err, posts) {
		if (err) return new Error(err);
		getStatistics(function (err, stats) {
			if (err) return new Error(err);
			res.render('index.html', {posts: posts, msg: msg, user: req.user.username, stats: stats});
		});
		
	});
	
}

////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
// MYSQL
function getPosts(cb) {
	var sql = 'SELECT id, filename, filesize, filetype, insertdate, TIMESTAMPDIFF(SECOND, NOW(), retentiondate) AS eta, ownername FROM posts';
	db.query(sql, function (err, result) {
		if (err) return cb(new Error("error getting posts" + err));
		cb(null, result);
	});
}

function createTable() {
	var sql = 'CREATE TABLE IF NOT EXISTS posts ('
						+ 'id INTEGER PRIMARY KEY AUTO_INCREMENT,'
						+ 'filename TEXT,'
						+ 'filesize INTEGER,'
						+ 'filetype TEXT,'
						+ 'insertdate DATETIME,'
						+ 'retentiondate DATETIME,'
						+ 'ownername TEXT'
					+ ');'; 
	db.query(sql, function (err, result) {
		if (err) new Error(err);
	});
}

function searchEntries(query, cb) {
	var sql = 'SELECT id FROM posts where filename like "%'+query+'%" OR filetype like "%'+query+'%" OR ownername like "%'+query+'%";';
	db.query(sql, function (err, result) {
		if (err) return err;
		console.error("search results (sql): " + JSON.stringify(result));
		cb(result);
	});
}

function getStatistics(cb) {
	var sql = 'SELECT SUM(filesize) AS sum, filetype FROM posts GROUP BY filetype;';
	db.query(sql, function (err, result) {
		console.error("statistics results (sql): " + JSON.stringify(result));
		cb(err, result);
	});
}

function addPosts(filename, filesize, filetype, filecontent, retentionInterval, ownername, cb) {
	var sql = 'INSERT INTO posts (filename, filesize, filetype, insertdate, retentiondate, ownername) VALUES (?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? MINUTE), ?);'
	var fields = [filename, filesize, filetype, retentionInterval, ownername];
	
	db.query(sql, fields, function (err, result) {
		if (err) return cb(new Error("sql error " + err));
		var newId = result.insertId;
		console.error('redis set ' + newId);
		console.error('sql result, err ' + JSON.stringify(result) + " - " + err);
		
		redisClient.set(newId, filecontent, function (err2, result2) {
			console.error('redis response ' + err2 + ' . ' + result2);
			cb(err2, result);
		});
	});
}

function deleteEverything(cb) {
	var sql = 'DROP TABLE posts';
	db.query(sql, function (err, result) {
		if (err) return cb(new Error("sql error " + err));
		cb(null, result);
	});
	createTable();
	redisClient.flushdb();
	mongoDropSessionStore();
	mongoDropAccountStore();
	mongoInitUsers();
}

function deletePost(id, cb) {
	var sql = 'DELETE FROM posts WHERE id = ' + db.escape(id);
	console.error('del: ' + id);

	redisClient.del(id, function(err2, result2) {
		console.error('redis file del: ' + err2 + ' - ' + result2);
		if (err2 || (result2 != 1)) cb(err2);
		db.query(sql, function (err4, result4) {
			if (err4) cb(err4);
			cb(null);
		});
	});
}

function disposalSweep() {
	console.error("called disposal sweep");
	var sql = "SELECT id FROM posts WHERE retentiondate < NOW();"
	db.query(sql, function (err, result) {
		if (err) new Error("disposal error: " + err);
		for (var i in result) {
			console.error("ds id: " + i + " # " + JSON.stringify(result));
			deletePost(result[i].id, function(err) {
				if (err) new Error("disposal error: " + err);
			});
		}
	setTimeout(disposalSweep, 10000);
	});
	
}
////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
// MONGODB

function mongoExecute(f) {
	console.error("connecting to mongoDB");
	mongo.Db.connect(mongoCredentials.url, { auto_reconnect: true }, function(err, db) {
		console.error("connected to mongoDB " + err);
		if (err) return new Error("mongoDB connection error: " + err);
		f(db);
	});
	
}

function mongoDropSessionStore() {
	mongoExecute(function(db) {
			db.dropCollection("sessions", function(err,db){db.close();});
		});
}

function mongoDropAccountStore() {
	mongoExecute(function(db) {
			db.dropCollection("accounts", function(err,db){db.close();});
		});
}

function mongoInitUsers() {
	console.error("initializing mongoDB account collection...");
	mongoExecute(function(db) {
			var adminUserRecord = { username: 'admin', password: 'admin', email: 'null@null', cellNumber: '0' };
			var col = db.collection("accounts");
			
			col.ensureIndex({username: 1}, {unique: true, sparse: true, dropDups: true}, function(err){
				if (err) db.close(), console.error("mongoDB error creating index: " + err);
				col.insert(adminUserRecord, function(err){
						console.error(err);
						db.close();
				});
			});
		});
}

function mongoFindUserById(id, fn) {
	mongoExecute(function(db) {
			var col = db.collection("accounts");
			col.findOne({_id: mongo.ObjectID(id)}, function(err, res){
					db.close();
					if (err) fn(new Error('Error querying for user in MongoDB: ' + id));
					if (res) {
							fn(null, res);
						} else {
							fn(new Error('User ' + id + ' does not exist'));
						}
				});
		});
}

function mongoFindUserByUsername(username, fn) {
	mongoExecute(function(db) {
			var col = db.collection("accounts");
			col.findOne({username: username}, function(err, res){
					db.close();
					if (err) fn(new Error('Error querying for user in MongoDB: ' + username));
					if (res) {
							fn(null, res);
						} else {
							fn(new Error('User ' + username + ' does not exist'));
						}
				});
		});
}

function mongoGetAllAccounts(fn) {
	mongoExecute(function(db) {
			var col = db.collection("accounts");
			col.find().toArray(function(err, res){
					db.close();
					if (err) fn(new Error('Error querying MongoDB: ' +err));
					fn(res);

				});
		});
}

function mongoInsertAccount(account, fn) {
	mongoExecute(function(db){
		var col = db.collection("accounts");
		col.insert(account, function(err){
				db.close();
				if (err) fn(new Error('Error inserting account into MongoDB: ' +err));
				fn(null);
		});	
	});
}

function mongoDeleteAccount(id, fn) {
	try {
		var id = mongo.ObjectID(id)
		mongoExecute(function(db){
			var col = db.collection("accounts");
			col.remove({_id: id}, function(err){
					db.close();
					if (err) fn(new Error('Error removing account from MongoDB: ' +err));
					fn(null);
			});	
		});
	} catch (err) {
		fn(new Error('Error removing account from MongoDB: ' +err));	
	}
}
