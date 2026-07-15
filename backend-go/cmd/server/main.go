package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/tiagofur/muebles-backend/internal/api"
	"github.com/tiagofur/muebles-backend/internal/config"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func main() {
	log.Println("Starting Muebles Backend Server...")

	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Invalid configuration, refusing to start: %v", err)
	}

	// Inicializar Base de Datos
	store, err := storage.NewPostgresStore(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Critical error: failed to initialize database store: %v", err)
	}
	defer store.Close()

	// NOTE: the admin account is no longer provisioned at boot (seed removed).
	// Create or rotate it with the dedicated CLI:
	//   go run ./cmd/admin create --email <email>
	//   go run ./cmd/admin reset-password --email <email>

	// Crear Server API
	serverAPI := api.NewServer(store, cfg.JWTSecret, cfg.AllowedOrigins, cfg.RateLimitRPS, cfg.RateLimitBurst)
	handler := api.RegisterRoutes(serverAPI)

	srv := &http.Server{
		Addr:            ":" + cfg.Port,
		Handler:         handler,
		ReadTimeout:     10 * time.Second,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:    10 * time.Second,
		IdleTimeout:     120 * time.Second,
		MaxHeaderBytes:  1 << 20, // 1 MiB
	}

	// Ejecución asíncrona del servidor
	go func() {
		log.Printf("Listening and serving HTTP on port %s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("HTTP server ListenAndServe error: %v", err)
		}
	}()

	// Graceful Shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down HTTP server gracefully...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("HTTP server stopped. Goodbye!")
}
