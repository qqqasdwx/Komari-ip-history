package main

import (
	"log"

	"komari-ip-history/internal/app"
)

func main() {
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
