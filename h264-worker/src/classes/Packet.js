const Bytehelper = require('./Bytehelper.js');

// A TS' packet maximum size is 188 bytes!
const PACKET_MAX_SIZE = 188;

module.exports = class Packet{
    constructor(mux) {
        this.mux = mux;
        this.buffer = new Uint8Array(0);
    }

    // adds the data from buffer to instance's buffer and returns the number of bytes, that have been added
    add(buffer) {
        // let's extract the maximum data we can add to packet, this is a security mechanism and should actually not
        // happen
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