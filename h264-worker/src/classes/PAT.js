const Bytehelper = require('./Bytehelper.js');

module.exports = class PAT{
    constructor(pointer_field,
                table_id,
                section_syntax_indicator,
                section_length,
                transport_stream_id,
                version_number,
                current_next_indicator,
                section_number,
                last_section_number,
                program_number,
                network_program_map_pid) {

        this.pointer_field = pointer_field;
        this.table_id = table_id;
        this.section_syntax_indicator = section_syntax_indicator;
        this.section_length = section_length;
        this.transport_stream_id = transport_stream_id;
        this.version_number = version_number;
        this.current_next_indicator = current_next_indicator;
        this.section_number = section_number;
        this.last_section_number = last_section_number;
        this.program_number = program_number;
        this.network_program_map_pid = network_program_map_pid;
    }


    to_bytes() {
        let buffer = new Uint8Array(17);

        buffer.set(
            [
                // byte 1
                this.pointer_field,

                // byte 2
                this.table_id,

                // bytes 3 and 4
                ...Bytehelper.swap16(
                    new Uint16Array([
                        (
                            this.section_syntax_indicator << 15 |
                            1 << 13 |
                            1 << 12 | // two reserved bits set
                            this.section_length
                        )
                    ])
                ),

                // bytes 5 and 6
                ...Bytehelper.swap16(
                    new Uint16Array([
                        (
                            this.transport_stream_id
                        )
                    ])
                ),

                // byte 7
                (
                    1 << 7 |
                    1 << 6 | // two reserved bits set
                    this.version_number << 5 |
                    this.current_next_indicator
                ),

                // byte 8
                (
                    this.section_number
                ),


                // byte 9
                (
                    this.last_section_number
                ),

                // A real multiplexer would merge multiple programs into a single transport stream
                // Since we are only dealing with one video stream here, we are hard-coding the program.

                // bytes 10 and 11
                ...Bytehelper.swap16(
                    new Uint16Array([
                        (
                            this.program_number
                        )
                    ])
                ),

                // bytes 12 and 13
                ...Bytehelper.swap16(
                    new Uint16Array([
                        (
                            1 << 15 |
                            1 << 14 |
                            1 << 13 |
                            this.network_program_map_pid
                        )
                    ])
                ),
            ]
        );

        buffer.set(
            [
                // 32-bit MPEG2 CRC excluding the pointer field
                ...Bytehelper.swap32(
                    Bytehelper.crc32asUint8(buffer.slice(1, 13))
                )
            ], 13
        )

        return buffer;
    }
}