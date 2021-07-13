cmake_minimum_required(VERSION 3.19)
project(h264_ws C)

set(CMAKE_C_STANDARD 11)

add_executable(h264_ws
        src/main.c src/ring.c src/ws.c)
