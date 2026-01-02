<?php

declare(strict_types=1);

namespace Momal\Tests\Server;

use Ratchet\ConnectionInterface;

/**
 * Minimal test double for Ratchet connections.
 * Collects all outgoing messages via ->send().
 */
final class FakeConnection implements ConnectionInterface
{
    /** @var list<string> */
    public array $sent = [];

    public function __construct(
        public int $resourceId,
    ) {
    }

    public function send($data)
    {
        $this->sent[] = (string)$data;

        return $this;
    }

    public function close(): void
    {
        // no-op
    }
}
