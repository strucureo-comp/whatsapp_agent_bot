package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port     int
	RedisURL string
	DBURL    string
	Secret   string
	// ProxyAddress is the SOCKS5/HTTP proxy for outbound WhatsApp connections.
	// Per-tenant proxy support: set via SetProxyAddress in session manager.
	ProxyAddress string
	// MaxSendRate limits outbound messages per second per tenant.
	// Conservative default to avoid WhatsApp bans.
	MaxSendRate int
}

func Load() *Config {
	return &Config{
		Port:         getEnvInt("GATEWAY_PORT", 8080),
		RedisURL:     getEnv("REDIS_URL", "redis://127.0.0.1:6379"),
		DBURL:        getEnv("DATABASE_URL", "postgresql://strucureo:strucureo@127.0.0.1:5432/strucureo"),
		Secret:       getEnv("GATEWAY_SECRET", "change-me"),
		ProxyAddress: getEnv("GATEWAY_PROXY_ADDRESS", ""),
		MaxSendRate:  getEnvInt("GATEWAY_MAX_SEND_RATE", 5),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}
