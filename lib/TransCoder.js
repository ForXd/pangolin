/**
 * 
 *  _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ 
 * | type(8bit) | id(8bit)  |  length(32bit)   |
 * |_ _ _ _ _ _ | _ _ _ _ _ | _ _ _ _ _ _ _ _ _|
 * |          buffer(length(byte))             |
 * |_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _|
 */


class TransCoder {
    constructor() {
        // 包头长度为6字节
        this.pkgHeaderLen = 6;
        this.bodyLengthLen = 4;
        this.idLen = 1;
        this.typeLen = 1;
    }

    encode(data, id, type) {
        const body = Buffer.from(data);
        const header = Buffer.alloc(this.pkgHeaderLen);
        header.writeInt8(type);
        header.writeInt8(id, this.typeLen);
        header.writeInt32BE(body.length, this.idLen + this.typeLen);
        return Buffer.concat([header, body]);
    }

    decode(buffer) {
        const header = buffer.slice(0, this.pkgHeaderLen);
        const body = buffer.slice(this.pkgHeaderLen);

        return {
            type: header.readInt8(),
            id: header.readInt8(this.typeLen),
            length: header.readInt32BE(this.idLen + this.typeLen),
            body
        }
    }

    // 获取完整数据包长度，包括头部
    getPkgLength(buffer) {
        if (buffer.length < this.pkgHeaderLen) {
            return 0;
        }
        return this.pkgHeaderLen + buffer.readInt32BE(this.idLen + this.typeLen);
    }
}

module.exports = TransCoder