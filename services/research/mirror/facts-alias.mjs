// Both copied databases live in the new cluster. Preserve the simulator's
// separate facts port without forwarding to any host or source database.
import {createServer,connect} from 'node:net';
createServer(socket=>{
 const upstream=connect({host:'127.0.0.1',port:5437});
 socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());
 socket.on('close',()=>upstream.destroy());upstream.on('close',()=>socket.destroy());
 socket.pipe(upstream).pipe(socket);
}).listen(5434,'127.0.0.1');
