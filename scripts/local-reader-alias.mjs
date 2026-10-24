// Fixed loopback compatibility alias inside the isolated Compose namespace.
// Never publish this service's ports or attach it to the original app namespace.
import net from 'node:net';
const server=net.createServer(incoming=>{
 const upstream=net.connect({host:'127.0.0.1',port:18084});
 const close=()=>{incoming.destroy();upstream.destroy();};
 incoming.setTimeout(120000,close);upstream.setTimeout(120000,close);
 incoming.on('error',close);upstream.on('error',close);
 incoming.on('close',()=>upstream.destroy());upstream.on('close',()=>incoming.destroy());
 incoming.pipe(upstream).pipe(incoming);
});
server.on('error',()=>{console.error('local-reader-alias unavailable');process.exitCode=1;});
server.listen(18083,'127.0.0.1',()=>console.info('local-reader-alias ready: loopback18083 to loopback18084'));
process.once('SIGTERM',()=>server.close());process.once('SIGINT',()=>server.close());
