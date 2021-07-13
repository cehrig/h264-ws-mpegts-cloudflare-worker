const Bytehelper = require('./Bytehelper.js');

const SYSTEM_CLOCK_FREQ = 27000000

module.exports = class Adaptation{
    constructor(adaptation_field_length,
                discontinuity_indicator,
                random_access_indicator,
                elementary_stream_priority_indicator,
                pcr_flag,
                opcr_flag,
                splicing_point_flag,
                transport_private_data_flag,
                adaptation_field_extension_flag,
                ms) {

        this.adaptation_field_length = adaptation_field_length;
        this.discontinuity_indicator = discontinuity_indicator;
        this.random_access_indicator = random_access_indicator;
        this.elementary_stream_priority_indicator = elementary_stream_priority_indicator;
        this.pcr_flag = pcr_flag;
        this.opcr_flag = opcr_flag;
        this.splicing_point_flag = splicing_point_flag;
        this.transport_private_data_flag = transport_private_data_flag;
        this.adaptation_field_extension_flag = adaptation_field_extension_flag;
        this.ms = ms;
    }


    to_bytes() {
        let buffer = new Uint8Array(8);
        let pcr_base = (SYSTEM_CLOCK_FREQ * ((700 + this.ms) / 1000)) / 300;

        buffer.set(
            [
                // byte 1, adaption field length, very opinionated again. We will very likely not need any other length
                // for our use-case here
                this.adaptation_field_length,

                // byte 2
                (
                    this.discontinuity_indicator << 7 |
                    this.random_access_indicator << 6 |
                    this.elementary_stream_priority_indicator << 5 |
                    this.pcr_flag << 4 |
                    this.opcr_flag << 3 |
                    this.splicing_point_flag << 2 |
                    this.transport_private_data_flag << 1 |
                    this.adaptation_field_extension_flag
                ),

                // byte 3
                (
                    pcr_base >> 25
                ),

                (
                    pcr_base >> 17
                ),

                (
                    pcr_base >> 9
                ),

                (
                    pcr_base >> 1
                ),

                (
                    (63 << 1) + (pcr_base & 0x01)
                ),

            ]
        );


        return buffer;
    }
}