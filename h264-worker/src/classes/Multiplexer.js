const Packet = require('./Packet.js');
const Packetizer = require('./Packetizer.js');
const Header = require('./Header.js');
const PAT = require('./PAT.js');
const PMT = require('./PMT.js');
const PES = require('./PES.js');
const Adaptation = require('./Adaptation.js');
const Bytehelper = require('./Bytehelper');

module.exports = class Mux {
    constructor(storage, logger, host) {
        this.storage = storage;
        this.logger = logger;
        this.buffer = new Uint8Array(0);
        this.counters = [];
        this.packetizer = new Packetizer(this, storage, logger);
        this.host = host;
    }

    async initialize() {
        // setting all local counters by restoring from database
        await this.reset(1, 0);
    }

    async reset(restore, reset) {
        this.buffer = new Uint8Array(0);
        this.packetizer = new Packetizer(this, this.storage, this.logger, this.host);

        // if restore is true, try to read from database
        // if restore is false, we will hard reset counters and write to the database
        await this.load_counter("idr", 0, restore, reset);
        await this.load_counter("pat", 0, restore, reset);
        await this.load_counter("pmt", 0, restore, reset);
        await this.load_counter("picture", 0, restore, reset);
        await this.load_counter("ms", 0, restore, reset);
        await this.load_counter("program", 0, restore, reset);
        await this.load_counter("storage", 0, restore, reset);
        await this.load_counter("raw_buf_pos", 0, restore, reset);
        await this.load_counter("packetizer_packets", 0, restore, reset);
    }

    async push(buffer) {
        let _i;
        let ret = {};
        let idr_slice;

        // first we add the inbound bitstream to the existing buffer
        this.buffer = Bytehelper.merge(this.buffer, buffer);

        // iterating over the buffer
        for (let i = this.get_counter('raw_buf_pos'); i < this.buffer.length - 4; i++) {
            this.set_counter('raw_buf_pos', i);
            // searching for NAL units
            if (!Bytehelper.is_nal(this.buffer.slice(i, i+4))) {
                continue;
            }

            // we have a NAL,start reading the NAL header ...
            let header = this.buffer[i+4];

            // ... to find the NAL unit type
            let nal_unit_type = header & 0x1F;

            // if it's not a SPS frame, we will continue looking for them
            if (nal_unit_type !== 0x07) {
                continue;
            }

            // if we find an SPS frame, we know that an IDR picture will follow, so we increase the IDR counter
            // this is very opinionated but we know it's fine for the raspivid use-case
            this.increment_counter('idr', 0);

            // As soon as we see the 4th IDR picture, we will pass the buffer - including 3 IDRs -
            // to the multiplexer
            if (this.get_counter('idr') === 1 || (this.get_counter('idr')-1) % 3) {
                continue;
            }

            // persist the IDR counter first
            await this.write_counter('idr');

            // remove the three IDRs from our buffer ... and pass them to the multiplexer
            idr_slice = this.buffer.slice(0, i);

            ret = await this.multiplex(idr_slice);

            this.buffer = this.buffer.slice(i, this.buffer.length)

            // skipping the NAL header, because we know it will be an SPS packet
            this.set_counter('raw_buf_pos', 1);
        }

        return ret;
    }

    async multiplex(buffer) {
        let processed_end;

        // PAT packet callback
        const ins_pat = async () => {
            let pat = this.make_pat();
            this.increment_counter('pat');
            return pat;
        }

        // PMT packet callback
        const ins_pmt = async () => {
            let program = this.make_pmt();
            this.increment_counter('pmt');
            return program;
        }

        // PES packet callback
        const ins_pes = async (pax) => {
            let pes = this.make_pes(pax);
            this.increment_counter('program');
            return pes;
        }

        // pass multiplex buffer to packetizer
        // the packetizer returns the number of bytes, that have not been processed
        processed_end = await this.packetizer.add(buffer, ins_pat, ins_pmt, ins_pes);


        return {
            processed_end: processed_end
        };
    }

    make_pat() {
        let pat = new Uint8Array(0);

        let pat_header = new Header(
            0,
            1,
            0,
            0,
            0,
            1,
            this.get_counter('pat') % 16
        );

        let pat_payload = new PAT(
            0,
            0,
            1,
            13,
            1,
            0,
            1,
            0,
            0,
            1,
            4096
        );

        pat = Bytehelper.merge(pat, pat_header.to_bytes());
        pat = Bytehelper.merge(pat, pat_payload.to_bytes());
        pat = Bytehelper.merge(pat, Bytehelper.stuffing(0xFF, 188-pat.length));

        return pat;
    }

    async make_pmt() {
        let pmt = new Uint8Array(0);

        let pmt_header = new Header(
            0,
            1,
            0,
            4096,
            0,
            1,
            this.get_counter('pmt') % 16
        );

        let pmt_payload = new PMT(
            0,
            0x02,
            1,
            18,
            1,
            0,
            1,
            0,
            0,
            256,
            0,
            0x1B,
            256,
            0
        );

        pmt = Bytehelper.merge(pmt, pmt_header.to_bytes());
        pmt = Bytehelper.merge(pmt, pmt_payload.to_bytes());
        pmt = Bytehelper.merge(pmt, Bytehelper.stuffing(0xFF, 188-pmt.length));

        return pmt;
    }

    async make_pes(pax) {
        let pes;
        let pes_header;
        let pes_adaptation;
        let pes_payload;

        pes = new Uint8Array(0);
        pes_adaptation = new Uint8Array(0);
        pes_payload = new Uint8Array(0);

        pes_header = new Header(
            0,
            (pax.set_pcr === true) ? 1 : 0,
            0,
            256,
            0,
            (pax.set_pcr === true) ? 3 : 1,
            this.get_counter('program') % 16
        );
        pax.set_unit_start = false;

        pes = Bytehelper.merge(pes, pes_header.to_bytes());

        if (pax.set_pcr === true) {
            pax.set_pcr = false;

            pes_adaptation = new Adaptation(
                0x07,
                0,
                (pax.set_pcr === true) ? 1 : 0,
                0,
                1,
                0,
                0,
                0,
                0,
                this.get_counter('ms')
            );

            pes_payload = new PES(
                0xE0,
                0,
                0,
                0,
                0,
                0,
                0,
                2,
                0,
                0,
                0,
                0,
                0,
                0,
                0x05,
                this.get_counter('ms')
            );

            pes = Bytehelper.merge(pes, pes_adaptation.to_bytes());
            pes = Bytehelper.merge(pes, pes_payload.to_bytes());
        }

        return pes;
    }

    buffer_slice(buffer, position, num) {
        let len = buffer.length

        // in case there are less than num bytes in the buffer
        if ((len-position) < num) {
            num = (len-position);
        }

        return {
            slice: buffer.slice(position, position+num),
            slice_len: num,
            position: position+num,
        }
    }

    // base_mod increments a continuity counter
    increment_counter(name, mod) {
        this.counters[name] = this.counters[name] + 1;
        if (mod > 0) {
            this.counters[name] = this.counters[name] % mod;
        }
        return this.counters[name];
    }

    async load_counter(name, def, restore, reset) {
        let counter = null;

        if (!reset) {
            counter = this.counters[name];
        }

        if (!counter && !reset && restore) {
            counter = await this.read_counter(name);
        }

        this.counters[name] = counter || def;

        if (!counter) {
            await this.write_counter(name);
        }
    }

    get_counter(name) {
        return this.counters[name];
    }

    set_counter(name, value) {
        this.counters[name] = value;
    }

    // returns continuity counter from storage
    async read_counter(name) {
        return await this.storage.get(name);
    }

    async write_counter(name) {
        await this.storage.put(name, this.counters[name]);
    }

    nal_in_buffer(buffer) {
        let x = 0;

        for (let i = 0; i < buffer.length-4; i++) {
            let nal_unit_type = buffer[i+4] & 0x1F;

            if (buffer[i] === 0x00 &&
                buffer[i+1] === 0x00 &&
                buffer[i+2] === 0x00 &&
                buffer[i+3] === 0x01) {

                x++;
            }
        }

        return x;
    }

    length() {
        return this.buffer.length;
    }
}