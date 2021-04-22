const net = require('net');
const Tunnel = require('./Tunnel');

class Server {
    constructor({
        listenPort,
    }) {
        this.listenPort = listenPort;
        this.tunnels = new Set();
        this.listenTable = new Set();
    }

    init() {
        this.handleConnect();
    }

    // 监听来自转发端口的用户的连接
    listenRemote(port, t) {
        const remoteServer = net.createServer((userSocket) => {
            console.log('get connect from ' + port);
            t.add(userSocket, (data) => userSocket.write(data));
            userSocket.on('error', () => {
                userSocket.destroy();
            })

        });

        remoteServer.listen(port, () => {
            console.log('handle connect from remote user');
        });

        remoteServer.on('error', (e) => {
            console.log(e);
            console.log('remote error');
            remoteServer.unref();
        });

        remoteServer.on('close', (e) => {
            console.log(e);
            console.log('remote close');
            remoteServer.unref();
        });

        t.on('close', () => {
            console.log('server close client tunnel');
            remoteServer.close();
            remoteServer.unref();
        })
    }

    handleConnect() {
        // 监听来自slave的连接
        const localServer = net.createServer(async (clientSocket) => {
            console.log('get connect from local slave');

            let t = new Tunnel('server');
            t.init(clientSocket);
            this.tunnels.add(t);

            t.on('listen', (port) => {
                console.log(port)
                this.listenRemote(port, t);
            });
            
            clientSocket.on('close', () => {
                console.log('close client:close');
                t.closeListen()
                clientSocket.destroy();
                this.tunnels.delete(t);
            });

            clientSocket.on('error', () => {
                console.log('close client:error');
                clientSocket.destroy();
                t.closeListen()
                this.tunnels.delete(t);
            })
        })
        localServer.listen(this.listenPort, () => {
            console.log('handle local connect from client');
        })

        localServer.on('error', (e) => {
            console.log(e)
            console.log('local error');
        })
    }
}

module.exports = Server;

