const Bytehelper = require('./Bytehelper.js');

const SYSTEM_CLOCK_FREQ = 27000000

module.exports = class PES{
    constructor(stream_id,
                pes_packet_length,
                pes_scrambling_control,
                pes_priority,
                data_alignment_indicator,
                copyright,
                original_or_copy,
                pts_dts_flags,
                escr_flag,
                es_rate_flag,
                dsm_trick_mode_flag,
                additional_copy_info_flag,
                pes_crc_flag,
                pes_extension_flag,
                pes_header_data_length,
                ms) {

        this.stream_id = stream_id;
        this.pes_packet_length = pes_packet_length;
        this.pes_scrambling_control = pes_scrambling_control;
        this.pes_priority = pes_priority;
        this.data_alignment_indicator = data_alignment_indicator;
        this.copyright = copyright;
        this.original_or_copy = original_or_copy;
        this.pts_dts_flags = pts_dts_flags;
        this.escr_flag = escr_flag;
        this.es_rate_flag = es_rate_flag;
        this.dsm_trick_mode_flag = dsm_trick_mode_flag;
        this.additional_copy_info_flag = additional_copy_info_flag;
        this.pes_crc_flag = pes_crc_flag;
        this.pes_extension_flag = pes_extension_flag;
        this.pes_header_data_length = pes_header_data_length;
        this.ms = ms;
    }


    to_bytes() {
        let buffer = new Uint8Array(14);
        let pts_base = (SYSTEM_CLOCK_FREQ * ((1400 + this.ms) / 1000)) / 300;

        buffer.set(
            [
                // byte 1 to 3 aka packet_start_code_prefix
                0x00,
                0x00,
                0x01,

                // byte 4
                this.stream_id,

                // bytes 5 and 6
                ...Bytehelper.swap16(
                    new Uint16Array([
                        (
                            this.pes_packet_length
                        )
                    ])
                ),

                // byte 7
                (
                    1 << 7 |
                    this.pes_scrambling_control << 4 |
                    this.pes_priority << 3 |
                    this.data_alignment_indicator << 2 |
                    this.copyright << 1 |
                    this.original_or_copy
                ),

                // byte 8
                (
                    this.pts_dts_flags << 6 |
                    this.escr_flag << 5 |
                    this.es_rate_flag << 4 |
                    this.dsm_trick_mode_flag << 3 |
                    this.additional_copy_info_flag << 2 |
                    this.pes_crc_flag << 1 |
                    this.pes_extension_flag
                ),

                // byte 9
                this.pes_header_data_length,

                // byte 10
                (
                    (1 << 5) |
                    (pts_base >> 28) |
                    1
                ),

                (
                    pts_base >> 22
                ),

                (
                    1 | pts_base >> 14
                ),

                (
                    pts_base >> 7
                ),

                (
                    1 + (pts_base << 1)
                ),
            ]
        );


        return buffer;
    }
}