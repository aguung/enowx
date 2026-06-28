.PHONY: web build run dev tidy

VERSION ?= dev
LDFLAGS := -s -w -X main.version=$(VERSION)

web:
	cd web && npm run build
	rm -rf server/webdist && cp -r web/dist server/webdist

build: web
	CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/enx ./cmd/enowx

run:
	CGO_ENABLED=0 go run ./cmd/enowx

dev: build
	./bin/enx

tidy:
	go mod tidy
