const Packet = require('./Packet.js');
const Bytehelper = require('./Bytehelper.js');

// A TS' packet maximum size is 188 bytes!
const PACKET_MAX_SIZE = 188;
const STORAGE_MAX_PACKETS = 2000

module.exports = class Packetizer{
    constructor(mux, storage, logger, host) {
        this.mux = mux;
        this.storage = storage;
        this.logger = logger;
        this.packet = null;
        this.packets = [];
        this.segment_length = 0;
        this.segment = new Uint8Array(0);
        this.buffer = new Uint8Array(0);
        this.set_unit_start = true;
        this.set_pcr = true;
        this.cache = caches.default;
        this.host = host;
    }

    async add(buffer, pat_callback, pmt_callback, pes_callback) {
        // add full multiplex buffer to the end of still existing buffer
        this.buffer = Bytehelper.merge(this.buffer, buffer);

        this.segment_length = 0;
        this.segment = new Uint8Array(5*this.buffer.length);

        let i = 0;
        let packet_slice;
        let written;
        let end;

        while(i < this.buffer.length) {
            // if there is not enough data for a full packet, let's skip processing
            if (i + PACKET_MAX_SIZE > this.buffer.length) {
                break;
            }

            // creating PAT and PMT packets periodically
            if (!i) {
                this.push_segment_bytes(await pat_callback())
                this.push_segment_bytes(await pmt_callback())
                //await this.push_bytes(await pat_callback());
                //await this.push_bytes(await pmt_callback());
            }

            if (!i) {
                this.set_pcr = true;
            }

            //written = await this.push_bytes(await pes_callback(this));
            written = this.push_segment_bytes(await pes_callback(this))
            end = i + PACKET_MAX_SIZE - written;

            // check how many pictures we found in slice
            for (let p = i; p < end; p++) {
                if (!Bytehelper.is_nal(this.buffer.slice(p, p+4))) {
                    continue;
                }

                if (!Bytehelper.is_picture(this.buffer[p+4])) {
                    continue;
                }

                this.mux.increment_counter('picture', 0);

                // we know the video is 30fps, so at every picture we are increasing by 33ms to have an almost accurate PCR/PTS
                this.mux.set_counter('ms', this.mux.get_counter('ms') + 33.33);
                this.set_pcr = true;
            }

            packet_slice = this.buffer.slice(i, end);
            this.mux.increment_counter('packetizer_packets', 0)
            i += this.push_segment_bytes(packet_slice)
            //i += await this.push_bytes(this.buffer.slice(i, end));
        }

        await this.persist_segment();

        this.buffer = this.buffer.slice(i, this.buffer.length);

        //await this.logger.write(`Packetizer: Found ${test} pictures. Buffer still: ${this.buffer.length} (NALs in this: ${this.mux.nal_in_buffer(this.buffer)})`);

        await this.mux.write_counter('picture');
        await this.mux.write_counter('packetizer_packets');
        await this.mux.write_counter('storage');
        await this.mux.write_counter('pat');
        await this.mux.write_counter('pmt');

        return end;
    }

    // storing the segment via Cache API
    async persist_segment() {
        let segment;

        segment = this.segment.slice(0, this.segment_length);

        let cachekey = `https://${this.host}/packet/${this.mux.get_counter('storage')}`;
        let response = new Response(segment, {
            status: 200
        });

        await this.cache.put(cachekey, response)
        this.mux.increment_counter('storage', 0);

        this.segment = new Uint8Array(0);
        this.segment_length = 0;
    }

    push_segment_bytes(buffer) {
        let buffer_length = buffer.length;

        this.segment.set(buffer, this.segment_length);
        this.segment_length += buffer_length;

        return buffer_length;
    }

    async store_packet(packet) {
        this.packets.push(packet);
        this.mux.increment_counter('packetizer_packets', 0);

        await this.persist_packets();
    }

    async persist_packets() {
        if (this.packets.length === STORAGE_MAX_PACKETS) {
            let store = new Uint8Array(0);

            for (let i = 0; i < STORAGE_MAX_PACKETS; i++) {
                store = Bytehelper.merge(store, this.packets[i].buffer);
            }

            await this.storage.put(
                `storage_${this.mux.get_counter('storage')}`,
                store
            );

            this.mux.increment_counter('storage', 0);

            this.packets = [];
        }
    }

    async push_bytes(data) {
        let written;

        if (this.packet === null ||
            this.packet.size() >= PACKET_MAX_SIZE) {

            this.packet = new Packet(this.mux);
        }

        written = this.packet.add(data);

        if (this.packet.size() === PACKET_MAX_SIZE) {
            await this.store_packet(this.packet);
        }

        return written;
    }

    size() {
        return this.packets.length;
    }
}