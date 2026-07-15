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

	cfg := config.LoadConfig()

	// Inicializar Base de Datos
	store, err := storage.NewPostgresStore(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Critical error: failed to initialize database store: %v", err)
	}
	defer store.Close()

	// Crear usuario admin si no existe
	store.EnsureAdminExists(context.Background())

	// Crear Server API
	serverAPI := api.NewServer(store, cfg.JWTSecret)
	handler := api.RegisterRoutes(serverAPI)

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      handler,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
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
