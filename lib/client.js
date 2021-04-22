const net = require('net');
const Tunnel = require('./Tunnel');

class Client {
    constructor({
        serverIP,
        serverPort,
        targetIP,
        targetPort,
        listenPort
    }) {
        this.serverIP = serverIP;
        this.serverPort = serverPort;
        this.targetIP = targetIP;
        this.targetPort = targetPort;
        this.listenPort = listenPort;
        this.tunnel = new Tunnel('client', this.targetIP, this.targetPort);
        // 代表是否连接到server
        this.timer = null;
    }

    init() {
        this.handleConnect();
    }

    handleConnect() {
        const remoteConnect = net.createConnection({
            host: this.serverIP,
            port: this.serverPort
        },
            async () => {
                console.log('slave client connect to server');
                this.tunnel.init(remoteConnect);
                this.tunnel.sendPort(this.listenPort);
                this.connected = true;
            }
        );
        remoteConnect.on('error', () => {
            process.stdout.write('\rtrying')
            this.retry();
        });
        remoteConnect.on('close', () => {
            process.stdout.write('\rtrying')
            this.retry();
        })
    }
    retry() {
        if (this.timer) {
            return;
        }
        console.log('add timer');
        this.timer = setTimeout(() => {
            this.handleConnect();
            this.timer = null;
        }, 1000);
    }
}

module.exports = Client;



