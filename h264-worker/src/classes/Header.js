const Bytehelper = require('./Bytehelper.js');

module.exports = class Header{
    constructor(transport_error_indicator,
                payload_unit_start_indicator,
                transport_priority,
                pid,
                transport_scrambling_control,
                adaption_field_control,
                continuity_counter) {

        this.transport_error_indicator = transport_error_indicator;
        this.payload_unit_start_indicator = payload_unit_start_indicator;
        this.transport_priority = transport_priority;
        this.pid = pid;
        this.transpor_scrambling_control = transport_scrambling_control;
        this.adaption_field_control = adaption_field_control;
        this.continuity_counter = continuity_counter;
    }

    // returns the 4 byte transport packet header
    to_bytes() {
        let buffer = new Uint8Array(4);

        buffer.set(
            [
                // sync byte
                0x47,

                // bytes 2 and 3
                ...Bytehelper.swap16(
                    new Uint16Array([
                        (
                            this.transport_error_indicator << 15 |
                            this.payload_unit_start_indicator << 14 |
                            this.transport_priority << 13 |
                            this.pid
                        )
                    ])
                ),

                // byte 4
                (
                    this.transpor_scrambling_control << 6 |
                    this.adaption_field_control << 4 |
                    this.continuity_counter
                )
            ]
        );

        return buffer;
    }
}