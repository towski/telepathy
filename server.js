// A server/client for distributing file changes in realtime
// The first process will be the server, and the second the client
// Checks for a server on the local network first
// Binds a ROUTER socket on 5555

require('tty').setRawMode(true);

var context = require('zeromq'),
  sys = require('sys'),
  fs = require('fs'),
  mdns = require('mdns'),
  util = require('util'),
  router  = context.createSocket('router'),
  request     = context.createSocket('request'),
  reply     = context.createSocket('reply'),
  name    = process.env.NAME || process.env.USER,
  connect_port  = process.env.CONNECT_PORT || '5555',
  serve_port = process.env.SERVE_PORT || '5555',
  dmp = require('diff_match_patch')
  
  
var browser = mdns.createBrowser('http', 'tcp');
var foundServer = false,
  peers = [],
  message  = '',
  match    = null,
  server = false,
  ignoreChange = false

browser.on('serviceUp', function(info, flags) {
  foundServer = true
});

browser.start();

router.identity = name

function updateFile(msg){
  var dar = new dmp.diff_match_patch();
  try{
    var derta = JSON.parse(msg.toString())
    var patch = derta.patch
    var file = derta.file
    console.log("updating ", file)
    fs.readFile(file, function(err, data){
      if(err)
        data = ""
      var result = dar.patch_apply(patch, data) 
      fs.open(file + ".old", "w+", 0666, function(err, fd){
        fs.write(fd, data, 0, data.length)
      })
      fs.open(file, "w+", 0666, function(err, fd){
        buffer = new Buffer(result[0]);
        fs.write(fd, buffer, 0, buffer.length)
        ignoreChange = true
      })
    });
  }catch(e){
    console.log(e)
  }
}

setTimeout(function(){ 
  if(foundServer){
    console.log("Logging in as", name)
    router.connect("tcp://localhost:5555")
    router.on('message', function(from, msg) {
      updateFile(msg)
    })
    setTimeout(function(){
      router.send("towski","");
    }, 1000)
    process.stdin.resume()
  } else {
    console.log("starting server", name)
    var ad = mdns.createAdvertisement('http', 4321)
    ad.start()
    server = true
    router.bind("tcp://*:5555", function() {
      process.stdin.resume()
    })
    router.on('message', function(from, msg) {
      var sender = from.toString();
      if(msg.length == 0){
        console.log("Peer joined: ", sender)
        if(peers.indexOf(sender) == -1){
          peers.push(sender)
        }
      } else {
        for(peer in peers){
          if(sender != peers[peer]){
            router.send(peers[peer], msg)
          }
        }
        updateFile(msg)
      }
    })
  } 
}, 1000)

process.stdin.on("data", function(buf) {
  if(buf[0] == 13) {
    var text = message.trim()
    message = ''
    if(text == '') return
    if(text == 'q') {
      console.log("Closing...")
      process.stdin.pause()
      router.close()
      process.kill()
    } 
  } else {
    message += buf.toString()
  }
})

function watchFile(file){
  return function (curr, prev) {
    if(curr.mtime.getTime() != prev.mtime.getTime()){
      console.log(ignoreChange)
      if(!ignoreChange){
        console.log("File "+ file +" changed, building diff")
        fs.readFile(file + '.old', function(err, data){
          var oldData;
          var dar = new dmp.diff_match_patch();
          if(err){
            oldData = ""
          }else{
            oldData = data.toString();
          }
          var newBuffer = fs.readFileSync(file);
          var patch = dar.patch_make(oldData, newBuffer.toString())
          fs.open(file + ".old", "w+", 0666, function(err, fd){
            buffer = new Buffer(newBuffer);
            fs.write(fd, buffer, 0, buffer.length)
          })
          if(server){
            for(peer in peers){
              router.send(peers[peer], JSON.stringify({patch: patch, file: file}))
            }
          } else {
            router.send("towski", JSON.stringify({patch: patch, file: file}))
          }
        })
      } else {
        ignoreChange = false
      }
    }
  }
}

fs.readdir('.', function(err, files){
  for(fil in files) {
    var file = files[fil]
    if(!file.match(/.old$/) && !file.match(/.swp$/)){
      fs.watchFile(file, watchFile(file));
    }
  }
})
