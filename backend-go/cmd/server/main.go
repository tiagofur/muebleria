package main

import (
	"context"
	"errors"
	"log/slog"
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
	// Configure structured logger (Google / 12-factor cloud standard)
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	slog.Info("Starting Granete Backend Server...")

	cfg, err := config.LoadConfig()
	if err != nil {
		slog.Error("Invalid configuration, refusing to start", "error", err)
		os.Exit(1)
	}

	// Migrations use a dedicated owner-capable role. The pool is closed before
	// runtime starts so request code never receives schema-owner credentials.
	migrationStore, err := storage.NewPostgresStore(cfg.MigrationDatabaseURL)
	if err != nil {
		slog.Error("Critical error: failed to initialize migration store", "error", err)
		os.Exit(1)
	}
	migCtx, migCancel := context.WithTimeout(context.Background(), 30*time.Second)
	if err := migrationStore.RunMigrations(migCtx); err != nil {
		migCancel()
		migrationStore.Close()
		slog.Error("Critical error: failed to run database migrations", "error", err)
		os.Exit(1)
	}
	migCancel()
	migrationStore.Close()

	store, err := storage.NewPostgresStore(cfg.DatabaseURL)
	if err != nil {
		slog.Error("Critical error: failed to initialize runtime database store", "error", err)
		os.Exit(1)
	}
	defer store.Close()
	readinessCtx, readinessCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := store.VerifyRLSReadiness(readinessCtx); err != nil {
		readinessCancel()
		slog.Error("Critical error: unsafe runtime database role or RLS inventory", "error", err)
		os.Exit(1)
	}
	readinessCancel()

	// NOTE: the admin account is no longer provisioned at boot (seed removed).
	// Create or rotate it with the dedicated CLI:
	//   go run ./cmd/admin create --email <email>
	//   go run ./cmd/admin reset-password --email <email>

	// Crear Server API (media dir for catalog images F040). Log the resolved
	// path so operators know where uploads land (it lives outside the repo by
	// default, so it survives clean/clone cycles but is not obvious from cwd).
	slog.Info("Media storage configured", "media_dir", cfg.MediaDir)
	serverAPI := api.NewServerWithMedia(store, cfg.JWTSecret, cfg.AllowedOrigins, cfg.RateLimitRPS, cfg.RateLimitBurst, cfg.MediaDir)
	handler := api.RegisterRoutes(serverAPI)

	// Timeouts mitigate slowloris and hung clients (issue #20).
	// TLS/HSTS: this process serves plain HTTP; terminate TLS at a reverse
	// proxy (Caddy/nginx) in production and set DATABASE_URL with sslmode=require.
	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadTimeout:       10 * time.Second,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20, // 1 MiB
	}

	// Ejecución asíncrona del servidor
	go func() {
		slog.Info("Listening and serving HTTP", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("HTTP server ListenAndServe error", "error", err)
			os.Exit(1)
		}
	}()

	// Graceful Shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	slog.Info("Shutting down HTTP server gracefully...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("Server forced to shutdown", "error", err)
		os.Exit(1)
	}

	slog.Info("HTTP server stopped. Goodbye!")
}
