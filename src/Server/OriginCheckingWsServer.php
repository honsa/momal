<?php

declare(strict_types=1);

namespace Momal\Server;

use Psr\Http\Message\RequestInterface;
use Ratchet\ConnectionInterface;
use Ratchet\WebSocket\WsServer;

/**
 * Simple Origin allowlist for WebSocket connections.
 *
 * Ratchet exposes the HTTP request via $conn->httpRequest on WsConnection.
 * If the header is missing, we treat it as not allowed when an allowlist is configured.
 */
final class OriginCheckingWsServer extends WsServer
{
    /** @var list<string> */
    private array $allowedOrigins;

    /** @param list<string> $allowedOrigins */
    public function __construct($component, array $allowedOrigins)
    {
        parent::__construct($component);
        $this->allowedOrigins = $allowedOrigins;
    }

    public function onOpen(ConnectionInterface $conn, ?RequestInterface $request = null): void
    {
        if ($this->allowedOrigins !== []) {
            $origin = null;

            if ($request !== null) {
                $origin = $request->getHeaderLine('Origin') ?: null;
            } elseif (property_exists($conn, 'httpRequest') && $conn->httpRequest !== null) {
                $origin = $conn->httpRequest->getHeaderLine('Origin') ?: null;
            }

            // If origin is missing or not in allowlist, drop the connection.
            if ($origin === null || !in_array($origin, $this->allowedOrigins, true)) {
                $conn->close();

                return;
            }
        }

        parent::onOpen($conn, $request);
    }
}
