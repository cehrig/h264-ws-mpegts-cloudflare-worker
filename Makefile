main: src/main.o src/ws.o src/ring.o
	gcc -lwebsockets -lpthread -g -o $@ $^

clean:
	-rm src/*.o
	-rm ./main

run: main
	./main

publish:
	cd h264-worker && wrangler publish

all: clean main

.PHONY: main all clean publish