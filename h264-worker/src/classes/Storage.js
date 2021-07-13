const Bytehelper = require('./Bytehelper.js');

// Maximum number of bytes we can write to a DO storage key
const STORAGE_MAX_SIZE = 32768;
exports.STORAGE_MAX_SIZE = STORAGE_MAX_SIZE;

module.exports = class Storage{
    constructor() {
        this.buffer = new Uint8Array(0);
    }

    // adds the data from buffer to instance's buffer and returns the number of bytes, that have been added
    add(buffer) {
        // let's extract the maximum data we can add to packet
        let copy = buffer.slice(0, PACKET_MAX_SIZE-this.buffer.length);

        // merge buffers
        this.buffer = Bytehelper.merge(this.buffer, copy);

        // return number of bytes written
        return copy.length;
    }

    size() {
        return this.buffer.length;
    }
}