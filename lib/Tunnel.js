const EventEmitter = require('events');
const TransCoder = require('./TransCoder');
const net = require('net');
const { DATA, SEND_PORT, CLOSE} = require('../constant/message');


// 代表对端关闭
class Tunnel extends EventEmitter{
    constructor(type, targetIP, targetPort) {
        super();
        // 记录对端的socket和id的对应关系
        this.table = new Map();
        // 记录对端收到消息后的处理函数
        this.handleTable = new Map();
        this.max = 100;
        // 记录当前可用的id列表，false代表可用
        this.sockPool = new Array(this.max).fill(false);
        // 用于数据包编解码
        this.trans = new TransCoder();
        // server 或者 slave
        this.type = type;

        this.targetIP = targetIP;
        this.targetPort = targetPort;
    }

    // 为接收事件建立handler
    init(sock) {
        this.socket = sock;
        // 记录超出传输缓冲区的上次未处理完的部分
        let overageBuffer = null; 
        this.socket.on('data', (buffer) => {
            // console.log('buffer length: ' + buffer.length);
            if (overageBuffer) {
                buffer = Buffer.concat([overageBuffer, buffer]);
            }
    
            let pkgLen = 0;
            while (pkgLen = this.trans.getPkgLength(buffer)) {
                // console.log('pkg length: ' + pkgLen);

                // 数据未全部传输，需要将buffer先缓存
                if (pkgLen <= buffer.length) {
                    const pkg = buffer.slice(0, pkgLen);
                    buffer = buffer.slice(pkgLen);
                    this.processPkg(pkg);
                } else {
                    overageBuffer = buffer;
                    break;
                }      
            }
            overageBuffer = buffer;
        })
    }

    processPkg(pkg) {
        const res = this.trans.decode(pkg);
        switch (res.type) {
            case CLOSE:
                // 如果对端关闭连接，需要断开对应的sock
                this.remove(res.id);
                break;
            case SEND_PORT:
                // 触发服务端的监听事件
                this.emit('listen', res.body.readInt32BE());
                break;
            case DATA:
                // 服务端可以交给对应的handler处理
                // slave端需要考虑处理方法
                if (this.type === 'server') {
                    this.emit(res.id, res.body);
                } else {
                    if (!this.table.has(res.id)) {
                        let sock = net.createConnection({port:this.targetPort, host: this.targetIP});
                        sock.write(res.body);
                        this.add(sock, (buf) => sock.write(buf), res.id);

                        // close 会在 error之后触发
                        sock.once('close', () => {
                            // 发送close
                            this.remove(res.id);
                        })
                        sock.once('error', () => {
                            this.remove(res.id);
                        })
                    } else {
                        this.table.get(res.id).write(res.body);
                    }
                    
                }
                break;
            default:
                console.log('type error: ' + res.type);
        }
    }

    sendPort(port) {
        const buf = Buffer.alloc(4);
        buf.writeInt32BE(port);
        this.send(buf, 0, SEND_PORT);
    }

    closeListen() {
        this.emit('close');
    }

    // 新用户或者到目标地址的新连接
    add(sock, handler, id) {
        let index;
        if (id || id === 0) {
            index = id;
        } else {
            index = this.sockPool.findIndex(i => !i);
            if (index === -1) return -1;
        }
        // console.log(this.type + ' add ' + index);
        this.table.set(index, sock);
        this.handleTable.set(index, handler);
        this.sockPool[index] = true;
        // socket ===> sock
        // handler只需要将收到的消息发送给对应的sock
        this.addListener(index, handler);

        // sock ===> socket
        // 收到sock的数据后发送
        sock.on('data', (buf) => {
            this.send(buf, index, DATA);
        })
        return index;
    }

    // 移除新用户或者到目标地址的连接
    remove(id) {
        // 销毁对应socket
        if (this.table.has(id)) {
            this.socket.write(this.trans.encode('', id, CLOSE));
            this.table.get(id).destroy();
            this.sockPool[id] = false;
            this.table.delete(id);
            this.handleTable.delete(id);
        }
    }

    send(buffer, id, type) {
        this.socket.write(this.trans.encode(buffer, id, type));
    }
}

module.exports = Tunnel;