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
            t.add(userSocket, (data) => userSocket.write(data));
            userSocket.on('error', () => {
                userSocket.destroy();
            })
        });

        remoteServer.listen(port, () => {
            console.log(`server listen in: ${port}`);
        });

        remoteServer.on('error', (e) => {
            remoteServer.unref();
        });

        remoteServer.on('close', (e) => {
            remoteServer.unref();
        });

        t.on('close', () => {
            console.log('close client tunnel at ', port);
            remoteServer.close();
            remoteServer.unref();
        })
    }

    handleConnect() {
        // 监听来自slave的连接
        const localServer = net.createServer(async (clientSocket) => {
            console.log('new local slave!');

            let t = new Tunnel('server');
            t.init(clientSocket);
            this.tunnels.add(t);

            t.on('listen', (port) => {
                console.log('server open ', port)
                this.listenRemote(port, t);
            });
            
            clientSocket.on('close', () => {
                t.closeListen()
                clientSocket.destroy();
                this.tunnels.delete(t);
            });

            clientSocket.on('error', () => {
                clientSocket.destroy();
                t.closeListen()
                this.tunnels.delete(t);
            })
        })
        localServer.listen(this.listenPort, () => {
            console.log('local client can connect at ', this.listenPort);
        })

        localServer.on('error', (e) => {
            localServer.close();
            localServer.unref();
        })
    }
}

module.exports = Server;

