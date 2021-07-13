const Bytehelper = require('./Bytehelper.js');

module.exports = class PAT{
    constructor(pointer_field,
                table_id,
                section_syntax_indicator,
                section_length,
                program_number,
                version_number,
                current_next_indicator,
                section_number,
                last_section_number,
                pcr_pid,
                program_info_length,
                stream_type,
                elementary_pid,
                es_info_length) {

        this.pointer_field = pointer_field;
        this.table_id = table_id;
        this.section_syntax_indicator = section_syntax_indicator;
        this.section_length = section_length;
        this.program_number = program_number;
        this.version_number = version_number;
        this.current_next_indicator = current_next_indicator;
        this.section_number = section_number;
        this.last_section_number = last_section_number;
        this.pcr_pid = pcr_pid;
        this.program_info_length = program_info_length;
        this.stream_type = stream_type;
        this.elementary_pid = elementary_pid;
        this.es_info_length = es_info_length;
    }


    to_bytes() {
        let buffer = new Uint8Array(22);

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
                            this.program_number
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

                // bytes 10 and 11
                ...Bytehelper.swap16(
                    new Uint16Array([
                        (
                            1 << 15 |
                            1 << 14 |
                            1 << 13 |
                            this.pcr_pid
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
                            1 << 12 | // four reserved bits
                            this.program_info_length
                        )
                    ])
                ),

                // byte 14
                (
                    this.stream_type
                ),

                // bytes 15 and 16
                ...Bytehelper.swap16(
                    new Uint16Array([
                        (
                            1 << 15 |
                            1 << 14 |
                            1 << 13 | // four reserved bits
                            this.elementary_pid
                        )
                    ])
                ),

                // bytes 17 and 18
                ...Bytehelper.swap16(
                    new Uint16Array([
                        (
                            1 << 15 |
                            1 << 14 |
                            1 << 13 |
                            1 << 12 | // four reserved bits
                            this.es_info_length
                        )
                    ])
                ),
            ]
        );

        buffer.set(
            [
                // 32-bit MPEG2 CRC excluding the pointer field
                ...Bytehelper.swap32(
                    Bytehelper.crc32asUint8(buffer.slice(1, 18))
                )
            ], 18
        )

        return buffer;
    }
}