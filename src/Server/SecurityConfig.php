<?php

declare(strict_types=1);

namespace Momal\Server;

final class SecurityConfig
{
    /**
     * Comma-separated allowlist of allowed HTTP Origins for WebSocket connections.
     * Example: "http://localhost:8000,http://127.0.0.1:8000"
     */
    public static function allowedWsOrigins(): array
    {
        $raw = getenv('MOMAL_WS_ALLOWED_ORIGINS');
        if ($raw === false || trim($raw) === '') {
            return [];
        }

        $parts = array_map('trim', explode(',', $raw));
        $parts = array_values(array_filter($parts, static fn (string $p): bool => $p !== ''));

        return $parts;
    }

    public static function maxWsTextBytes(): int
    {
        $raw = getenv('MOMAL_WS_MAX_TEXT_BYTES');
        $v = $raw !== false ? (int)$raw : 65536;

        return $v > 0 ? $v : 65536;
    }

    public static function maxWsBinaryBytes(): int
    {
        $raw = getenv('MOMAL_WS_MAX_BINARY_BYTES');
        $v = $raw !== false ? (int)$raw : 131072;

        return $v > 0 ? $v : 131072;
    }
}
